/** @jest-environment node */

import type { Server } from "node:http";
import { jest } from "@jest/globals";

import { createRelay } from "../server.mjs";

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
  await new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()));

  expect(allowed.status).toBe(200);
  expect(denied.status).toBe(404);
  expect(upstream).toHaveBeenCalledWith(
    new URL("https://api.example.test/api/v1/workbench/runs"),
    expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer server-only-token" }) })
  );
});
