/** @jest-environment node */

import type { Server } from "node:http";
import { jest } from "@jest/globals";

import { createDevelopmentServer, createRelay } from "../server.mjs";

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("relay did not bind a TCP address");
  return `http://127.0.0.1:${address.port}`;
}

test("forwards only allowlisted Workbench requests with the server-side credential", async () => {
  const upstream = jest.fn(async (): Promise<Response> => new Response(JSON.stringify({ items: [] }), { status: 200 }));
  const app = createRelay({
    upstreamUrl: "https://api.example.test",
    token: "server-only-token",
    fetchImpl: upstream as unknown as typeof fetch
  });
  const server = app.listen(0, "127.0.0.1");
  const origin = await listen(server);

  const allowed = await fetch(`${origin}/api/cogito/api/v1/workbench/runs`);
  const denied = await fetch(`${origin}/api/cogito/api/v1/runs`);
  const crossOrigin = await fetch(`${origin}/api/cogito//attacker.example/api/v1/workbench/runs`);
  await new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()));

  expect(allowed.status).toBe(200);
  expect(denied.status).toBe(404);
  expect(crossOrigin.status).toBe(404);
  expect(upstream).toHaveBeenCalledTimes(1);
  expect(upstream).toHaveBeenCalledWith(
    new URL("https://api.example.test/api/v1/workbench/runs"),
    expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer server-only-token" }) })
  );
});

test("preserves queries, selected request headers, upstream errors, ETags, and empty 304 responses", async () => {
  const upstream = jest.fn(async (url: URL, init: RequestInit): Promise<Response> => {
    if (url.searchParams.has("artifact_sha256")) {
      return new Response(JSON.stringify({ detail: "evidence not found" }), { status: 404 });
    }
    if (new Headers(init.headers).get("if-none-match") === '"current"') {
      return new Response(null, { status: 304, headers: { ETag: '"current"' } });
    }
    return new Response(JSON.stringify({ decision_id: "decision-1" }), { status: 202, headers: { ETag: '"next"' } });
  });
  const app = createRelay({
    upstreamUrl: "https://api.example.test/base/",
    token: "server-only-token",
    fetchImpl: upstream as unknown as typeof fetch
  });
  const server = app.listen(0, "127.0.0.1");
  const origin = await listen(server);

  const notModified = await fetch(`${origin}/api/cogito/api/v1/workbench/runs`, {
    headers: { "If-None-Match": '"current"' }
  });
  const evidence = await fetch(
    `${origin}/api/cogito/api/v1/workbench/runs/run-123/evidence/plan?artifact_sha256=digest%26value`
  );
  const action = await fetch(`${origin}/api/cogito/api/v1/coordination/runs/run-123/actions/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "action-1" },
    body: JSON.stringify({ decision: "approve", artifact_sha256: "a".repeat(64) })
  });
  await new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()));

  expect(notModified.status).toBe(304);
  expect(notModified.headers.get("etag")).toBe('"current"');
  await expect(notModified.text()).resolves.toBe("");
  expect(evidence.status).toBe(404);
  await expect(evidence.json()).resolves.toEqual({ detail: "evidence not found" });
  expect(action.status).toBe(202);
  expect(action.headers.get("etag")).toBe('"next"');
  expect(await action.json()).toEqual({ decision_id: "decision-1" });
  expect(upstream).toHaveBeenNthCalledWith(
    1,
    new URL("https://api.example.test/api/v1/workbench/runs"),
    expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer server-only-token", "if-none-match": '"current"' }) })
  );
  expect(upstream).toHaveBeenNthCalledWith(
    2,
    new URL("https://api.example.test/api/v1/workbench/runs/run-123/evidence/plan?artifact_sha256=digest%26value"),
    expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer server-only-token" }) })
  );
  expect(upstream).toHaveBeenNthCalledWith(
    3,
    new URL("https://api.example.test/api/v1/coordination/runs/run-123/actions/plan"),
    expect.objectContaining({
      headers: expect.objectContaining({ authorization: "Bearer server-only-token", "idempotency-key": "action-1" })
    })
  );
});

test("refuses a static-token standalone server in production", () => {
  expect(() => createDevelopmentServer({
    upstreamUrl: "https://api.example.test",
    token: "server-only-token",
    environment: "production"
  })).toThrow("Production startup requires an OIDC session relay");
});

test("forwards only the fixed health and project inventory reads", async () => {
  const upstream = jest.fn(async (url: URL): Promise<Response> => new Response(JSON.stringify({ path: url.pathname }), { status: 200 }));
  const app = createRelay({
    upstreamUrl: "https://api.example.test",
    token: "server-only-token",
    fetchImpl: upstream as unknown as typeof fetch
  });
  const server = app.listen(0, "127.0.0.1");
  const origin = await listen(server);

  const health = await fetch(`${origin}/api/cogito/healthz`);
  const projects = await fetch(`${origin}/api/cogito/api/v1/workbench/projects`);
  const denied = await fetch(`${origin}/api/cogito/api/v1/workbench/projects/alpha`);
  await new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()));

  expect(health.status).toBe(200);
  expect(projects.status).toBe(200);
  expect(denied.status).toBe(404);
  expect(upstream).toHaveBeenNthCalledWith(1, new URL("https://api.example.test/healthz"), expect.anything());
  expect(upstream).toHaveBeenNthCalledWith(2, new URL("https://api.example.test/api/v1/workbench/projects"), expect.anything());
});

test("returns a sanitized 502 when the configured upstream is unreachable", async () => {
  const upstream = jest.fn(async (): Promise<Response> => { throw new TypeError("fetch failed"); });
  const app = createRelay({
    upstreamUrl: "http://127.0.0.1:8000",
    token: "server-only-token",
    fetchImpl: upstream as unknown as typeof fetch
  });
  const server = app.listen(0, "127.0.0.1");
  const origin = await listen(server);

  const response = await fetch(`${origin}/api/cogito/api/v1/workbench/runs`);
  await new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()));

  expect(response.status).toBe(502);
  await expect(response.json()).resolves.toEqual({
    detail: "Workbench relay cannot reach the configured API. Verify the local API URL and port-forward."
  });
});
