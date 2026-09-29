#!/usr/bin/env node
/**
 * Dựng video dọc 9:16 (1080x1920) từ kịch bản JSON + file giọng đọc.
 *
 *   node video/render.cjs video/kich-ban/<ten>.json [tuỳ chọn]
 *
 *   --voice <file.mp3|wav>   giọng đọc (tự thu hoặc TTS). Không có => thời lượng ước theo số ký tự
 *   --out <file.mp4>         mặc định video/out/<ten>/video.mp4
 *   --fps 30                 khung hình/giây
 *   --crf 18                 chất lượng H.264 (thấp = nét hơn, file to hơn)
 *   --music <file.mp3>       nhạc nền (lặp), --music-vol 0.12
 *   --preview 1.5,8,20       chỉ xuất ảnh PNG tại các mốc giây để duyệt bố cục, không dựng video
 *   --png                    chụp khung PNG (không mất nét, chậm hơn) thay vì JPEG
 *
 * Kết quả: video.mp4, thumb.jpg, phu-de.srt, timeline.json trong thư mục --out.
 * Yêu cầu: Node 18+, playwright (npm i playwright && npx playwright install chromium),
 *          ffmpeg (hoặc pip install imageio-ffmpeg, hoặc biến môi trường FFMPEG_PATH).
 *          Font Be Vietnam Pro + Lora tự tải về video/fonts ở lần chạy đầu.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const W = 1080, H = 1920;

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i > -1 && process.argv[i + 1] != null ? process.argv[i + 1] : def; }
function flag(name) { return process.argv.includes('--' + name); }

function findFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const w = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], { encoding: 'utf8' });
  if (w.status === 0 && w.stdout.trim()) return w.stdout.trim().split(/\r?\n/)[0];
  const p = spawnSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' });
  if (p.status === 0 && p.stdout.trim()) return p.stdout.trim();
  throw new Error('Không tìm thấy ffmpeg. Cài ffmpeg, hoặc `pip install imageio-ffmpeg`, hoặc đặt FFMPEG_PATH.');
}

function loadPlaywright() {
  try { return require('playwright'); } catch (_) {}
  const g = spawnSync('npm', ['root', '-g'], { encoding: 'utf8' });
  if (g.status === 0) { try { return require(path.join(g.stdout.trim(), 'playwright')); } catch (_) {} }
  throw new Error('Không tìm thấy playwright. Chạy: npm i playwright && npx playwright install chromium');
}

/* ---------- Font (tự tải lần đầu, giấy phép OFL) ---------- */
const FONT_BASE = 'https://raw.githubusercontent.com/google/fonts/main/ofl/';
const FONTS = [
  ['bevietnampro/BeVietnamPro-Regular.ttf', 'BeVietnamPro-Regular.ttf'],
  ['bevietnampro/BeVietnamPro-Italic.ttf', 'BeVietnamPro-Italic.ttf'],
  ['bevietnampro/BeVietnamPro-Medium.ttf', 'BeVietnamPro-Medium.ttf'],
  ['bevietnampro/BeVietnamPro-SemiBold.ttf', 'BeVietnamPro-SemiBold.ttf'],
  ['bevietnampro/BeVietnamPro-Bold.ttf', 'BeVietnamPro-Bold.ttf'],
  ['bevietnampro/BeVietnamPro-ExtraBold.ttf', 'BeVietnamPro-ExtraBold.ttf'],
  ['bevietnampro/BeVietnamPro-Black.ttf', 'BeVietnamPro-Black.ttf'],
  ['lora/Lora%5Bwght%5D.ttf', 'Lora[wght].ttf'],
];
async function ensureFonts() {
  const dir = path.join(__dirname, 'fonts');
  fs.mkdirSync(dir, { recursive: true });
  const missing = FONTS.filter(([, name]) => !fs.existsSync(path.join(dir, name)));
  if (!missing.length) return;
  console.log(`Tải ${missing.length} file font (Be Vietnam Pro, Lora) vào video/fonts ...`);
  for (const [remote, name] of missing) {
    const url = FONT_BASE + remote, dest = path.join(dir, name);
    // curl tôn trọng HTTPS_PROXY; fetch của Node là phương án dự phòng.
    const c = spawnSync('curl', ['-sSL', '--fail', '--max-time', '60', '-o', dest, url], { encoding: 'utf8' });
    if (c.status === 0 && fs.existsSync(dest) && fs.statSync(dest).size > 10000) continue;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Không tải được font ' + name + ' (HTTP ' + res.status + '). Tải tay 8 file trong FONTS vào video/fonts.');
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  }
}

/* ---------- Kịch bản ---------- */
const plain = s => String(s == null ? '' : s).replace(/\*/g, '').replace(/\s+/g, ' ').trim();

// Các "đơn vị chữ" hiện lần lượt trong một cảnh, theo đúng thứ tự template dựng DOM.
function unitsOf(sc) {
  switch (sc.style) {
    case 'point': return [sc.title, sc.desc].filter(Boolean);
    case 'stat': return [String(sc.stat && sc.stat.value != null ? sc.stat.value : ''), sc.stat && sc.stat.label].filter(Boolean);
    case 'cta': { const c = sc.cta || {}; return [c.title, c.sub, c.pill].filter(Boolean); }
    default: return sc.lines || [];
  }
}
const voiceOf = sc => plain(sc.voice || unitsOf(sc).join('. '));

/* ---------- Âm thanh ---------- */
function probeAudio(ff, file) {
  const r = spawnSync(ff, ['-hide_banner', '-nostats', '-i', file, '-af', 'silencedetect=noise=-33dB:d=0.28', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const log = r.stderr || '';
  const times = [...log.matchAll(/time=(\d+):(\d+):(\d+\.?\d*)/g)];
  let duration = NaN;
  if (times.length) { const m = times[times.length - 1]; duration = +m[1] * 3600 + +m[2] * 60 + +m[3]; }
  if (!(duration > 0)) { const m = log.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/); if (m) duration = +m[1] * 3600 + +m[2] * 60 + +m[3]; }
  if (!(duration > 0)) throw new Error('Không đọc được thời lượng file giọng đọc: ' + file);
  const silences = [];
  const re = /silence_start:\s*([\d.]+)[\s\S]*?silence_end:\s*([\d.]+)/g;
  let x; while ((x = re.exec(log))) silences.push({ start: +x[1], end: +x[2], mid: (+x[1] + +x[2]) / 2, len: +x[2] - +x[1] });
  return { duration, silences };
}

/* ---------- Timeline ---------- */
function buildTimeline(script, audio) {
  const scenes = script.scenes;
  const leadIn = script.leadIn != null ? +script.leadIn : 0.3;   // giọng đọc bắt đầu sau leadIn giây
  const tail = script.tail != null ? +script.tail : 1.8;         // giữ cảnh kết thêm tail giây
  const weights = scenes.map(sc => Math.max(8, voiceOf(sc).length));
  const totalW = weights.reduce((a, b) => a + b, 0);
  const D = audio ? audio.duration : weights.reduce((a, w) => a + w / 15 + 0.5, 0);

  // Mốc chuyển cảnh ước theo tỉ lệ ký tự, rồi "bắt" vào khoảng lặng gần nhất của giọng đọc.
  const bounds = [0]; let acc = 0;
  for (let i = 0; i < scenes.length - 1; i++) { acc += weights[i]; bounds.push(D * acc / totalW); }
  bounds.push(D);
  if (audio && audio.silences.length) {
    for (let k = 1; k < bounds.length - 1; k++) {
      const est = bounds[k];
      const tol = Math.min(D * weights[k - 1] / totalW, D * weights[k] / totalW) * 0.45;
      const cands = audio.silences.filter(s => Math.abs(s.mid - est) <= tol && s.mid > bounds[k - 1] + 0.4);
      if (!cands.length) continue;
      const long = cands.filter(s => s.len >= 0.45);
      const pool = long.length ? long : cands;
      pool.sort((a, b) => Math.abs(a.mid - est) - Math.abs(b.mid - est));
      bounds[k] = pool[0].mid;
    }
    for (let k = 1; k < bounds.length; k++) if (bounds[k] < bounds[k - 1] + 0.4) bounds[k] = bounds[k - 1] + 0.4;
  }

  const out = scenes.map((sc, i) => {
    const start = bounds[i] + leadIn;
    const end = i === scenes.length - 1 ? D + leadIn + tail : bounds[i + 1] + leadIn;
    const dur = end - start;
    const units = unitsOf(sc);
    const lens = units.map(u => Math.max(1, plain(u).length));
    const sumL = lens.reduce((a, b) => a + b, 0);
    const usable = Math.max(0.3, dur - 0.7);
    let starts;
    if (sc.style === 'hook') starts = units.map((_, k) => 0.18 * k);
    else if (sc.style === 'cta') starts = units.map((_, k) => 0.22 * k);
    else if (sc.style === 'stat') starts = units.map((_, k) => k ? 0.55 : 0);
    else if (sc.style === 'point') starts = units.map((_, k) => k ? Math.max(0.75, usable * lens[0] / sumL) : 0.15);
    else { let c = 0; starts = units.map((_, k) => { const s = usable * c / sumL; c += lens[k]; return s; }); }
    starts = starts.map(s => Math.min(s, Math.max(0, dur - 0.6)));
    return { i, style: sc.style || 'text', start: +start.toFixed(3), end: +end.toFixed(3), units: units.map((u, k) => ({ text: plain(u), start: +(start + starts[k]).toFixed(3) })) };
  });
  return { total: +(D + leadIn + tail).toFixed(3), leadIn, tail, audioDuration: +D.toFixed(3), scenes: out };
}

/* ---------- Phụ đề SRT ---------- */
function srtTime(t) { const ms = Math.round(t * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000), s = Math.floor(ms % 60000 / 1000), x = ms % 1000; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(x).padStart(3, '0')}`; }
function buildSrt(script, tl) {
  const cues = [];
  tl.scenes.forEach((ts, i) => {
    const text = voiceOf(script.scenes[i]); if (!text) return;
    const parts = text.split(/(?<=[.!?…])\s+/).filter(Boolean);
    const total = parts.reduce((a, p) => a + p.length, 0);
    let t = ts.start; const span = Math.max(0.5, ts.end - ts.start - 0.15);
    parts.forEach(p => { const d = span * p.length / total; cues.push({ a: t, b: t + d, text: p }); t += d; });
  });
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.a)} --> ${srtTime(c.b)}\n${c.text}\n`).join('\n');
}

/* ---------- Chính ---------- */
async function main() {
  const scriptPath = process.argv[2];
  if (!scriptPath || scriptPath.startsWith('--')) { console.error('Cách dùng: node video/render.cjs <kich-ban.json> [--voice giong.mp3] [--out video.mp4] ...'); process.exit(1); }
  const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
  const name = path.basename(scriptPath).replace(/\.json$/i, '');
  const outFile = path.resolve(arg('out', path.join(__dirname, 'out', name, 'video.mp4')));
  const outDir = path.dirname(outFile);
  fs.mkdirSync(outDir, { recursive: true });
  const fps = +arg('fps', 30), crf = +arg('crf', 18);
  const voice = arg('voice', null) ? path.resolve(arg('voice')) : null;
  const music = arg('music', null) ? path.resolve(arg('music')) : null;
  const musicVol = +arg('music-vol', 0.12);
  const preview = arg('preview', null);
  const ff = findFfmpeg();
  await ensureFonts();

  const audio = voice ? probeAudio(ff, voice) : null;
  if (voice) console.log(`Giọng đọc: ${(audio.duration).toFixed(2)}s, ${audio.silences.length} khoảng lặng`);
  const tl = buildTimeline(script, audio);
  if (!preview) { // chế độ --preview không ghi đè timeline/phụ đề của lần dựng thật
    fs.writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify(tl, null, 2));
    fs.writeFileSync(path.join(outDir, 'phu-de.srt'), buildSrt(script, tl));
  }
  console.log(`Tổng thời lượng video: ${tl.total}s, ${tl.scenes.length} cảnh`);
  tl.scenes.forEach(s => console.log(`  cảnh ${s.i + 1} [${s.style}] ${s.start}s → ${s.end}s`));

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('Lỗi trong template:', e.message));
  await page.goto('file://' + path.join(__dirname, 'template.html'));
  await page.evaluate(() => document.fonts.ready);
  // Ảnh nền/avatar trong kịch bản là đường dẫn tương đối so với file kịch bản.
  const base = path.dirname(path.resolve(scriptPath));
  const absolutize = p => (p && !/^([a-z]+:)?\/\//i.test(p) && !p.startsWith('data:')) ? 'file://' + path.resolve(base, p) : p;
  const scriptForPage = JSON.parse(JSON.stringify(script));
  scriptForPage.scenes.forEach(sc => { if (sc.bg) sc.bg = absolutize(sc.bg); if (sc.cta && sc.cta.avatar) sc.cta.avatar = absolutize(sc.cta.avatar); });
  await page.evaluate(({ s, t }) => window.__load(s, t), { s: scriptForPage, t: tl });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);

  if (preview) {
    for (const ts of preview.split(',').map(Number)) {
      await page.evaluate(t => window.__seek(t), ts);
      const f = path.join(outDir, `preview-${ts}s.png`);
      await page.screenshot({ path: f, type: 'png' });
      console.log('Đã xuất', f);
    }
    await browser.close(); return;
  }

  // Ảnh bìa
  const thumbAt = script.thumbAt != null ? +script.thumbAt : tl.scenes[0].start + 1.2;
  await page.evaluate(t => window.__seek(t), thumbAt);
  await page.screenshot({ path: path.join(outDir, 'thumb.jpg'), type: 'jpeg', quality: 95 });

  // ffmpeg nhận khung hình qua stdin, ghép giọng đọc (+ nhạc nền), xuất H.264/AAC.
  const usePng = flag('png');
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', usePng ? 'png' : 'mjpeg', '-i', 'pipe:0'];
  const leadMs = Math.round(tl.leadIn * 1000);
  const filters = []; let amap = null; let idx = 1;
  if (voice) { args.push('-i', voice); filters.push(`[${idx}:a]adelay=${leadMs}|${leadMs},apad[v]`); idx++; }
  if (music) { args.push('-stream_loop', '-1', '-i', music); filters.push(`[${idx}:a]volume=${musicVol}[m]`); idx++; }
  if (voice && music) { filters.push('[v][m]amix=inputs=2:duration=first:dropout_transition=2[a]'); amap = '[a]'; }
  else if (voice) { filters[filters.length - 1] = filters[filters.length - 1].replace('[v]', '[a]'); amap = '[a]'; }
  else if (music) { filters[filters.length - 1] = filters[filters.length - 1].replace('[m]', '[a]'); amap = '[a]'; }
  else { args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'); amap = `${idx}:a`; }
  if (filters.length) args.push('-filter_complex', filters.join(';'));
  args.push('-map', '0:v', '-map', amap);
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-r', String(fps), '-profile:v', 'high', '-level', '4.1');
  args.push('-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-shortest', '-movflags', '+faststart', outFile);

  const enc = spawn(ff, args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => enc.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg thoát mã ' + c))));
  const nFrames = Math.ceil(tl.total * fps);
  const t0 = Date.now();
  for (let i = 0; i < nFrames; i++) {
    await page.evaluate(t => window.__seek(t), i / fps);
    const buf = await page.screenshot(usePng ? { type: 'png' } : { type: 'jpeg', quality: 95 });
    if (!enc.stdin.write(buf)) await new Promise(r => enc.stdin.once('drain', r));
    if (i % (fps * 5) === 0 || i === nFrames - 1) process.stdout.write(`\r  khung ${i + 1}/${nFrames}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  process.stdout.write('\n');
  enc.stdin.end();
  await done;
  await browser.close();
  console.log('Xong:', outFile);
  console.log('Kèm theo: thumb.jpg, phu-de.srt, timeline.json trong', outDir);
}

main().catch(e => { console.error(e); process.exit(1); });
