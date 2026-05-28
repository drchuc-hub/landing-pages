// Cloudflare Worker — drchuc.com
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzuHNt_0O-FxTs6krH2fhOjmGhCgiN8StC7_6Axc4mEetHQAVyc6cNLJXupEGazizujLg/exec';
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/api/sepay-webhook') {
      try {
        const body = await request.text();
        const resp = await fetch(APPS_SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, redirect: 'follow' });
        const text = await resp.text();
        return new Response(text || 'OK', { status: 200, headers: { 'Content-Type': 'text/plain' } });
      } catch (err) { return new Response('PROXY_ERROR: ' + err.message, { status: 500 }); }
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
    }
    return env.ASSETS.fetch(request);
  },
};
