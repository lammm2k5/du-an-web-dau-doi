// netlify/edge-functions/llm-proxy.js
//
// Proxy trung gian: trình duyệt gọi vào /api/llm-proxy (cùng origin với site,
// nên không bao giờ dính CORS). Edge Function này gọi tiếp sang API thật ở
// phía server (server-to-server thì trình duyệt không tham gia -> CORS không
// áp dụng), rồi trả kết quả (kể cả streaming SSE) ngược lại cho trình duyệt.
//
// Trình duyệt phải gửi kèm header "X-Proxy-Target" chứa URL đích thật sự
// (vd: https://www.tokenrouter.com/v1/chat/completions). Chỉ các domain
// trong ALLOWED_PREFIXES mới được phép, để tránh site bị lợi dụng làm proxy
// mở (open proxy) cho bất kỳ URL nào.

const ALLOWED_PREFIXES = [
  'https://www.tokenrouter.com/',
  'https://api.deepseek.com/',
  'https://api.anthropic.com/',
  'https://generativelanguage.googleapis.com/',
];

function isAllowed(target) {
  return ALLOWED_PREFIXES.some((p) => target.startsWith(p));
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access, X-Proxy-Target',
};

export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const target = request.headers.get('x-proxy-target') || '';

  if (!target || !isAllowed(target)) {
    return new Response(
      JSON.stringify({ error: 'X-Proxy-Target thiếu hoặc không nằm trong danh sách domain được phép.' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  const forwardHeaders = new Headers();
  forwardHeaders.set('Content-Type', 'application/json');
  for (const h of ['authorization', 'x-api-key', 'anthropic-version']) {
    const v = request.headers.get(h);
    if (v) forwardHeaders.set(h, v);
  }

  let upstream;
  try {
    upstream = await fetch(target, {
      method: 'POST',
      headers: forwardHeaders,
      body: request.body,
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: 'Không gọi được upstream: ' + (e && e.message ? e.message : String(e)) }),
      { status: 502, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  const respHeaders = new Headers(upstream.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) respHeaders.set(k, v);

  // Trả thẳng body dạng stream (hỗ trợ cả SSE streaming lẫn JSON thường)
  return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
};

export const config = { path: '/api/llm-proxy' };
