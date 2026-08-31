// netlify/edge-functions/llm-proxy.js
//
// Proxy cùng-origin cho các lệnh gọi chat-completions tới GLM/TokenRouter (và các
// endpoint OpenAI-compatible khác) — chạy ở server (Deno, trong hạ tầng Netlify Edge)
// nên KHÔNG bị trình duyệt áp CORS. Client (claude-code-controller.html, hàm callGLM)
// gọi cùng-origin tới "/api/llm-proxy" kèm header "X-Proxy-Target" chứa URL thật cần gọi;
// function này đọc header đó, forward request sang đích thật, rồi trả nguyên response
// (kể cả stream SSE) về lại cho trình duyệt.
//
// Route "/api/llm-proxy" -> function "llm-proxy" đã được khai báo sẵn trong netlify.toml
// ([[edge_functions]]) — chỉ cần file này tồn tại đúng đường dẫn là route sẽ hoạt động.

// Chỉ cho phép proxy tới các host đã biết, tránh biến function thành "open proxy" ai cũng
// gọi được đi bất kỳ đâu (SSRF). Thêm host mới vào đây nếu bạn đổi Base URL trong Cấu hình.
const ALLOWED_HOSTS = new Set([
  "www.tokenrouter.com",
  "tokenrouter.com",
  "api.deepseek.com",
  "generativelanguage.googleapis.com",
]);

export default async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type, authorization, x-proxy-target",
      },
    });
  }

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const target = request.headers.get("x-proxy-target");
  if (!target) {
    return new Response(JSON.stringify({ error: "Thiếu header X-Proxy-Target" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    return new Response(JSON.stringify({ error: "X-Proxy-Target không phải URL hợp lệ" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  if (targetUrl.protocol !== "https:" || !ALLOWED_HOSTS.has(targetUrl.hostname)) {
    return new Response(JSON.stringify({ error: "Đích proxy không được phép: " + targetUrl.hostname }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  // Forward gần như nguyên vẹn header của client (Authorization, Content-Type...),
  // chỉ bỏ các header đặc thù cùng-origin không nên đi tiếp.
  const forwardHeaders = new Headers(request.headers);
  forwardHeaders.delete("x-proxy-target");
  forwardHeaders.delete("host");
  forwardHeaders.delete("content-length");

  let upstream;
  try {
    upstream = await fetch(targetUrl.toString(), {
      method: "POST",
      headers: forwardHeaders,
      body: request.body,
      // @ts-ignore: cần thiết trên Deno khi forward một stream request body
      duplex: "half",
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Không gọi được đích proxy: " + (e && e.message || String(e)) }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }

  // Trả nguyên response (kể cả stream SSE) về cho trình duyệt, cùng-origin nên không
  // dính CORS nữa. Thêm access-control-allow-origin cho chắc trong các trường hợp khác.
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.set("access-control-allow-origin", "*");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
};
