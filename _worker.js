// Cloudflare Worker — drchuc.com
// Route POST /api/sepay-webhook → proxy to Apps Script (follow HTTP 302 redirect)
// All other requests → serve static HTML assets

const APPS_SCRIPT_URL =
    'https://script.google.com/macros/s/AKfycbzuHNt_0O-FxTs6krH2fhOjmGhCgiN8StC7_6Axc4mEetHQAVyc6cNLJXupEGazizujLg/exec';

export default {
    async fetch(request, env) {
          const url = new URL(request.url);

      /* ── SePay webhook proxy ─────────────────────────────────────────────
             SePay gửi POST → drchuc.com/api/sepay-webhook
             Worker chuyển sang GET với ?action=sepay_webhook&payload=<json>
             (tránh vấn đề Apps Script 302 convert POST → GET làm doPost không chạy)
          ─────────────────────────────────────────────────────────────────── */
      if (request.method === 'POST' && url.pathname === '/api/sepay-webhook') {
              try {
                        const body = await request.text();
                        // Encode SePay payload vào GET request — doGet xử lý action=sepay_webhook
                const scriptUrl = APPS_SCRIPT_URL + '?action=sepay_webhook&payload=' + encodeURIComponent(body);
                        const resp = await fetch(scriptUrl, {
                                    method: 'GET',
                                    redirect: 'follow',
                        });
                        const text = await resp.text(); // OK_AUTO / NO_MATCH / ERROR:...
                return new Response(text || 'OK', {
                            status: 200,
                            headers: { 'Content-Type': 'text/plain' },
                });
              } catch (err) {
                        return new Response('PROXY_ERROR: ' + err.message, { status: 500 });
              }
      }

      /* ── CORS preflight (OPTIONS) cho create_order từ frontend ───────── */
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

      /* ── Tất cả request còn lại → static assets ─────────────────────── */
      return env.ASSETS.fetch(request);
    },
};
