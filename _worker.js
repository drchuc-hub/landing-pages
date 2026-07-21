// Cloudflare Worker — drchuc.com
// POST /api/sepay-webhook → phân luồng theo prefix nội dung CK:
//   chứa "MMBS" → Apps Script B (funnel Mỡ Máu)
//   còn lại (TVBS...) → Apps Script A (funnel Tiểu Đường)
// Tất cả request khác → static HTML assets

const APPS_SCRIPT_A =
  'https://script.google.com/macros/s/AKfycbzuHNt_0O-FxTs6krH2fhOjmGhCgiN8StC7_6Axc4mEetHQAVyc6cNLJXupEGazizujLg/exec';
const APPS_SCRIPT_B =
  'https://script.google.com/macros/s/AKfycbyZ-6sEMg1Kj9OApnKVRbVO_H56JH7LSY6_Z5B12QVs4iHzTiPi1BC_o_8S9O4mjBtx3Q/exec';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /* ── SePay webhook proxy (phân luồng theo prefix) ─────────────────────
       SePay gửi POST → drchuc.com/api/sepay-webhook
       Worker đọc nội dung CK, chọn đúng Apps Script rồi chuyển sang GET
       (?action=sepay_webhook&payload=<json>) — tránh Apps Script 302
       convert POST → GET làm doPost không chạy.
    ─────────────────────────────────────────────────────────────────── */
    if (request.method === 'POST' && url.pathname === '/api/sepay-webhook') {
      try {
        const body = await request.text();
        // Chọn Apps Script đích theo prefix mã đơn trong nội dung CK
        const upper = body.toUpperCase();
        const target = upper.includes('MMBS') ? APPS_SCRIPT_B : APPS_SCRIPT_A;

        const scriptUrl = target + '?action=sepay_webhook&payload=' + encodeURIComponent(body);
        const resp = await fetch(scriptUrl, { method: 'GET', redirect: 'follow' });
        const text = await resp.text(); // OK_AUTO / NO_MATCH / ERROR:...
        return new Response(text || 'OK', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        });
      } catch (err) {
        return new Response('PROXY_ERROR: ' + err.message, { status: 500 });
      }
    }

    /* ── CORS preflight (OPTIONS) ─────────────────────────────────────── */
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    /* ── Còn lại → thử static assets; không có asset → trả về WordPress ──
       Lưới an toàn: URL lọt vào route worker mà không có file tĩnh tương ứng
       sẽ được chuyển về origin (WordPress) thay vì văng exception 1101
       (sự cố /cam-on-tai-lieu-mat-co/ ngày 21/07/2026). */
    try {
      const assetResp = await env.ASSETS.fetch(request);
      if (assetResp.status !== 404) return assetResp;
    } catch (e) {
      // ASSETS lỗi hoặc thiếu binding → rơi xuống origin
    }
    return fetch(request);
  },
};
