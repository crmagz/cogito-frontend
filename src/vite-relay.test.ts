/** @jest-environment node */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer as createHttpServer, type Server } from "node:http";
import { once } from "node:events";

async function listen(server: Server): Promise<string> {
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind a TCP address");
  return `http://127.0.0.1:${address.port}`;
}

function startVite(upstreamUrl: string): Promise<{ child: ChildProcessWithoutNullStreams; origin: string }> {
  const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "0"], {
    cwd: process.cwd(),
    env: { ...process.env, COGITO_UPSTREAM_URL: upstreamUrl, COGITO_UPSTREAM_TOKEN: "vite-server-only-token" }
  });
  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      reject(error);
    };
    const timeout = setTimeout(() => fail(new Error(`Vite did not start: ${output}`)), 10_000);
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+\/)/);
      if (match && !settled) {
        settled = true;
        clearTimeout(timeout);
        resolve({ child, origin: match[1]!.replace(/\/$/, "") });
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.once("error", (error) => {
      fail(error);
    });
    child.once("exit", (code) => {
      if (!settled) fail(new Error(`Vite exited before starting (${code}): ${output}`));
    });
  });
}

async function stop(child: ChildProcessWithoutNullStreams | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await once(child, "exit");
}

test("mounts the constrained relay in the Vite development server", async () => {
  const upstream = createHttpServer((request, response) => {
    if (request.url === "/api/v1/workbench/runs" && request.headers["if-none-match"] === '"current"') {
      response.writeHead(304, { ETag: '"current"' });
      response.end();
      return;
    }
    if (request.url === "/api/v1/workbench/runs") {
      expect(request.headers.authorization).toBe("Bearer vite-server-only-token");
      response.writeHead(200, { "Content-Type": "application/json", ETag: '"fresh"' });
      response.end(JSON.stringify({ items: [], revision: "fresh" }));
      return;
    }
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ detail: "not found" }));
  });
  upstream.listen(0, "127.0.0.1");
  const upstreamOrigin = await listen(upstream);
  let vite: ChildProcessWithoutNullStreams | undefined;

  try {
    const started = await startVite(upstreamOrigin);
    vite = started.child;
    const { origin } = started;

    const listed = await fetch(`${origin}/api/cogito/api/v1/workbench/runs`);
    const unchanged = await fetch(`${origin}/api/cogito/api/v1/workbench/runs`, {
      headers: { "If-None-Match": '"current"' }
    });
    const denied = await fetch(`${origin}/api/cogito/api/v1/coordination/runs`);

    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toEqual({ items: [], revision: "fresh" });
    expect(listed.headers.get("etag")).toBe('"fresh"');
    expect(unchanged.status).toBe(304);
    await expect(unchanged.text()).resolves.toBe("");
    expect(denied.status).toBe(404);
  } finally {
    await stop(vite);
    await new Promise<void>((resolve, reject) => upstream.close((error?: Error) => error ? reject(error) : resolve()));
  }
});
