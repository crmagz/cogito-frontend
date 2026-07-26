import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const allowed = [
  { method: "GET", path: /^\/api\/v1\/workbench\/runs(?:\/[^/]+(?:\/evidence\/(?:source|plan|implementation))?)?$/ },
  { method: "POST", path: /^\/api\/v1\/coordination\/runs\/[^/]+\/actions\/(?:plan|implementation)$/ }
];

export function createRelay({ upstreamUrl, token, fetchImpl = fetch }) {
  if (!upstreamUrl || !token) {
    throw new Error("COGITO_UPSTREAM_URL and COGITO_UPSTREAM_TOKEN are required for the development relay");
  }
  const upstream = new URL(upstreamUrl);
  const app = express();
  app.use(express.json({ limit: "16kb" }));
  app.use("/api/cogito", async (request, response, next) => {
    const pathWithQuery = request.originalUrl.replace(/^\/api\/cogito/, "");
    const requestUrl = new URL(pathWithQuery, upstream);
    // A scheme-relative path (for example //attacker.example/...) would make
    // URL resolve to a different host. Never forward the relay credential off
    // the explicitly configured upstream origin.
    if (requestUrl.origin !== upstream.origin || !allowed.some((rule) => rule.method === request.method && rule.path.test(requestUrl.pathname))) {
      return response.status(404).json({ detail: "Workbench relay path not found" });
    }
    try {
      const headers = { authorization: `Bearer ${token}`, accept: "application/json" };
      for (const name of ["if-none-match", "idempotency-key"]) {
        if (request.headers[name]) headers[name] = request.headers[name];
      }
      if (request.method !== "GET") headers["content-type"] = "application/json";
      const upstreamResponse = await fetchImpl(requestUrl, {
        method: request.method,
        headers,
        body: request.method === "GET" ? undefined : JSON.stringify(request.body)
      });
      const body = await upstreamResponse.text();
      const etag = upstreamResponse.headers.get("etag");
      if (etag) response.setHeader("ETag", etag);
      response.status(upstreamResponse.status);
      if (body) response.type("application/json").send(body);
      else response.end();
    } catch (error) {
      next(error);
    }
  });
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Production startup requires an OIDC session relay; static upstream tokens are development-only");
  }
  const app = createRelay({
    upstreamUrl: process.env.COGITO_UPSTREAM_URL,
    token: process.env.COGITO_UPSTREAM_TOKEN
  });
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  app.use(express.static(path.join(dirname, "dist")));
  app.listen(process.env.PORT || 4173);
}
