interface Env {
  TECHNOCORE_ORIGIN: string;
  ALLOWED_ORIGINS: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("origin") ?? "";
    const allowed = env.ALLOWED_ORIGINS.split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!origin || !allowed.includes(origin))
      return new Response("Origin not allowed", { status: 403 });
    if (!["GET", "POST", "OPTIONS"].includes(request.method))
      return cors(new Response("Method not allowed", { status: 405 }), origin);
    const url = new URL(request.url);
    if (!allowedPath(url.pathname))
      return cors(new Response("Path not allowed", { status: 404 }), origin);
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }), origin);
    const upstream = new URL(url.pathname + url.search, assertOrigin(env.TECHNOCORE_ORIGIN));
    const headers = new Headers();
    for (const name of ["accept", "content-type"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const response = await fetch(upstream, {
      method: request.method,
      headers,
      body: request.method === "POST" ? request.body : undefined,
      redirect: "manual",
    });
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("set-cookie");
    return cors(
      new Response(response.body, { status: response.status, headers: responseHeaders }),
      origin,
    );
  },
};

export function allowedPath(path: string): boolean {
  return (
    /^\/r\/[a-z0-9][a-z0-9_-]{0,47}$/.test(path) ||
    /^\/kv\/did-[a-f0-9]{2}\/[a-f0-9]{14}$/.test(path) ||
    /^\/kv\/contrib\/[a-f0-9]{16}$/.test(path)
  );
}
export function assertOrigin(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("TECHNOCORE_ORIGIN must use HTTPS");
  return url;
}
function cors(response: Response, origin: string): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "content-type, accept");
  headers.set("Vary", "Origin");
  return new Response(response.body, { status: response.status, headers });
}
