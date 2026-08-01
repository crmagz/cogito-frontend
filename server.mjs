import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const allowed = [
  { method: "GET", path: /^\/healthz$/ },
  { method: "GET", path: /^\/api\/v1\/workbench\/projects$/ },
  { method: "GET", path: /^\/api\/v1\/workbench\/runs(?:\/[^/]+(?:\/(?:timeline|evidence\/(?:source|plan|implementation)))?)?$/ },
  { method: "POST", path: /^\/api\/v1\/coordination\/runs\/[^/]+\/actions\/(?:plan|implementation)$/ }
];

export function createRelay({ upstreamUrl, token, fetchImpl = fetch }) {
  if (!upstreamUrl || !token) {
    throw new Error("COGITO_UPSTREAM_URL and COGITO_UPSTREAM_TOKEN are required for the development relay");
  }
  const upstream = new URL(upstreamUrl);
  const app = express();
  app.use(express.json({ limit: "16kb" }));
  app.use("/api/cogito", async (request, response) => {
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
    } catch {
      response.status(502).json({
        detail: "Workbench relay cannot reach the configured API. Verify the local API URL and port-forward."
      });
    }
  });
  return app;
}

export function createSessionRelay({ sessionRelayUrl, fetchImpl = fetch }) {
  if (!sessionRelayUrl) {
    throw new Error("COGITO_SESSION_RELAY_URL is required for the production session relay");
  }
  const upstream = new URL(sessionRelayUrl);
  const app = express();
  app.use(express.json({ limit: "16kb" }));
  app.use("/api/cogito", async (request, response) => {
    const pathWithQuery = request.originalUrl.replace(/^\/api\/cogito/, "");
    const requestUrl = new URL(pathWithQuery, upstream);
    if (requestUrl.origin !== upstream.origin || !allowed.some((rule) => rule.method === request.method && rule.path.test(requestUrl.pathname))) {
      return response.status(404).json({ detail: "Workbench relay path not found" });
    }
    try {
      const headers = { accept: "application/json" };
      for (const name of ["cookie", "if-none-match", "idempotency-key"]) {
        if (request.headers[name]) headers[name] = request.headers[name];
      }
      if (request.method !== "GET") headers["content-type"] = "application/json";
      const upstreamResponse = await fetchImpl(requestUrl, {
        method: request.method,
        headers,
        body: request.method === "GET" ? undefined : JSON.stringify(request.body)
      });
      const body = await upstreamResponse.text();
      for (const name of ["etag", "set-cookie"]) {
        const value = upstreamResponse.headers.get(name);
        if (value) response.setHeader(name, value);
      }
      response.status(upstreamResponse.status);
      if (body) response.type("application/json").send(body);
      else response.end();
    } catch {
      response.status(502).json({ detail: "Workbench session relay cannot reach the configured upstream." });
    }
  });
  return app;
}

export function createDevelopmentServer({ upstreamUrl, token, staticDirectory, healthcheck = false, environment = process.env.NODE_ENV }) {
  if (environment === "production") {
    throw new Error("Production startup requires an OIDC session relay; static upstream tokens are development-only");
  }
  const app = createRelay({ upstreamUrl, token });
  if (healthcheck) app.get("/healthz", (_request, response) => response.status(200).json({ status: "ok" }));
  if (staticDirectory) {
    app.use(express.static(staticDirectory));
    app.use((request, response, next) => {
      const isApiPath = request.path === "/api" || request.path.startsWith("/api/");
      if (request.method !== "GET" || request.path === "/healthz" || isApiPath) return next();
      return response.sendFile("index.html", { root: staticDirectory });
    });
  }
  return app;
}

export function createProductionServer({ sessionRelayUrl, staticDirectory, fetchImpl = fetch }) {
  if (!staticDirectory) throw new Error("A static directory is required for the production Workbench server");
  const app = createSessionRelay({ sessionRelayUrl, fetchImpl });
  app.get("/healthz", (_request, response) => response.status(200).json({ status: "ok" }));
  app.use(express.static(staticDirectory));
  app.use((request, response, next) => {
    const isApiPath = request.path === "/api" || request.path.startsWith("/api/");
    if (request.method !== "GET" || request.path === "/healthz" || isApiPath) return next();
    return response.sendFile("index.html", { root: staticDirectory });
  });
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const app = process.env.COGITO_RELAY_MODE === "session"
    ? createProductionServer({ sessionRelayUrl: process.env.COGITO_SESSION_RELAY_URL, staticDirectory: path.join(dirname, "dist") })
    : createDevelopmentServer({
      upstreamUrl: process.env.COGITO_UPSTREAM_URL,
      token: process.env.COGITO_UPSTREAM_TOKEN,
      staticDirectory: path.join(dirname, "dist"),
      healthcheck: process.env.COGITO_RELAY_MODE === "static",
      environment: process.env.COGITO_RELAY_MODE === "static" ? "development" : process.env.NODE_ENV
    });
  app.listen(process.env.PORT || 4173);
}
