// netlify/edge-functions/llm-proxy.js
//
// Đây là backend mà claude-code-controller.html cần ở đường dẫn "/api/llm-proxy".
// App gọi tới đây (cùng-origin, nên không dính CORS) kèm header "X-Proxy-Target"
// chứa URL thật (vd TokenRouter/GLM) — function này chuyển tiếp (proxy) request
// sang đó và trả kết quả về, kèm header CORS để trình duyệt chấp nhận.
//
// Vì sao cần: TokenRouter (và nhiều API tương tự) không trả header CORS, nên
// trình duyệt sẽ chặn nếu gọi thẳng từ JS phía client. Chỉ cần chạy trên server
// (ở đây là Netlify Edge Function) mới tránh được giới hạn đó.
//
// LƯU Ý: file này CHỈ chạy khi repo được deploy trên Netlify. Nếu bạn deploy
// bằng GitHub Pages (host tĩnh, không chạy được server code) thì endpoint này
// sẽ không tồn tại và app sẽ báo lỗi 404/405 khi gọi GLM Chatbot.

export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed, use POST' }, 405);
  }

  const target = request.headers.get('x-proxy-target');
  if (!target) {
    return json({ error: 'Missing X-Proxy-Target header' }, 400);
  }

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    return json({ error: 'Invalid X-Proxy-Target URL' }, 400);
  }

  // Chỉ cho phép proxy sang các host LLM đã biết, để tránh bị lợi dụng làm proxy mở.
  const ALLOWED_HOSTS = [
    'www.tokenrouter.com',
    'tokenrouter.com',
    'api.deepseek.com',
    'generativelanguage.googleapis.com',
    'api.anthropic.com',
  ];
  if (!ALLOWED_HOSTS.includes(targetUrl.hostname)) {
    return json({ error: 'Target host not allowed: ' + targetUrl.hostname }, 403);
  }

  const authHeader = request.headers.get('authorization') || '';

  let upstreamRes;
  try {
    upstreamRes = await fetch(targetUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: await request.text(),
    });
  } catch (e) {
    return json({ error: 'Upstream fetch failed: ' + (e && e.message) }, 502);
  }

  // Chuyển tiếp nguyên trạng response (kể cả streaming SSE) về client, chỉ thêm CORS.
  const headers = new Headers(upstreamRes.headers);
  for (const [k, v] of Object.entries(corsHeaders())) headers.set(k, v);
  headers.delete('content-encoding');
  headers.delete('content-length');

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    statusText: upstreamRes.statusText,
    headers,
  });
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Proxy-Target',
  };
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}
