import assert from "node:assert/strict";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { createDevelopmentServer } from "../../server.mjs";

const digest = "a".repeat(64);
const now = "2026-07-27T00:00:00Z";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("test server did not bind a TCP address"));
      resolve(`http://127.0.0.1:${address.port}`);
    });
    server.once("error", reject);
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function send(response, code, body, headers = {}) {
  response.writeHead(code, { "content-type": "application/json", ...headers });
  response.end(body ? JSON.stringify(body) : "");
}

test("operator decision refreshes a browser-rendered authoritative workflow detail", async ({ page }) => {
  let approved = false;
  const actions = [];
  const run = (detail = false) => ({
    run_id: "run-browser-e2e",
    project_id: "default",
    status: approved ? "completed" : "awaiting_plan_approval",
    submitted_at: now,
    active_gate: approved ? null : "plan",
    artifacts: [{ kind: "source", sha256: digest }, { kind: "plan", sha256: digest }],
    abilities: ["view", "approve"],
    workflow: ["planning", "plan", "plan_approval"],
    budget: { max_cost_usd: 3, max_wall_clock_minutes: 45, max_review_rounds: 2, actual_cost_usd: detail ? 1.25 : null, turns_used: detail ? 42 : null },
    approval_history_available: true,
    approval_history: detail ? [{ decision_id: "decision-browser-e2e", gate: "plan", decision: "approve", artifact_sha256: digest, actor_id: "operator-browser", created_at: now, delivered: true }] : [],
    execution: detail ? { phase_count: 2, succeeded_phase_count: 2, failed_phase_count: 0, verification_passed: 2, verification_failed: 0, review_status: "converged", validation_status: "passed" } : null,
    external_links: detail ? [{ kind: "repository", label: "Repository", url: "https://github.com/acme/api-gateway" }] : []
  });
  const upstream = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, "Bearer browser-e2e-token");
    const requestUrl = new URL(request.url ?? "/", "http://upstream.test");
    if (requestUrl.pathname === "/healthz") return send(response, 200, { status: "ok" });
    if (requestUrl.pathname === "/api/v1/workbench/projects") return send(response, 200, { items: [{ project_id: "default" }] });
    if (requestUrl.pathname === "/api/v1/workbench/runs") {
      const etag = approved ? '"complete"' : '"waiting"';
      if (request.headers["if-none-match"] === etag) return send(response, 304, null, { etag });
      return send(response, 200, { items: [run()], revision: etag }, { etag });
    }
    if (request.url === "/api/v1/workbench/runs/run-browser-e2e") return send(response, 200, run(true));
    if (request.url?.startsWith(`/api/v1/workbench/runs/run-browser-e2e/evidence/plan?artifact_sha256=${digest}`)) {
      return send(response, 200, { kind: "plan", sha256: digest, content_type: "application/json", content: "{}" });
    }
    if (request.url === "/api/v1/coordination/runs/run-browser-e2e/actions/plan" && request.method === "POST") {
      let body = "";
      for await (const chunk of request) body += chunk;
      actions.push({ payload: JSON.parse(body), key: request.headers["idempotency-key"] });
      approved = true;
      return send(response, 202, { decision_id: "decision-browser-e2e" });
    }
    return send(response, 404, { detail: "not found" });
  });
  const upstreamOrigin = await listen(upstream);
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const app = createDevelopmentServer({
    upstreamUrl: upstreamOrigin,
    token: "browser-e2e-token",
    staticDirectory: path.resolve(dirname, "../../dist")
  });
  const frontend = createServer(app);
  const frontendOrigin = await listen(frontend);
  try {
    await page.goto(frontendOrigin);
    await expect(page.getByRole("heading", { name: "Mission Control" })).toBeVisible();
    await page.getByText("run-brow", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "Workflow relay" })).toBeVisible();
    await page.getByRole("button", { name: /plan queue awaiting operator decision/i }).click();
    await expect(page.getByRole("heading", { name: "Execution summary" })).toBeVisible();
    await expect(page.getByText("2 passed / 0 failed / 2 recorded")).toBeVisible();
    await expect(page.getByText("$1.25")).toBeVisible();
    await expect(page.getByRole("link", { name: "Repository" })).toHaveAttribute("href", "https://github.com/acme/api-gateway");

    await page.getByRole("button", { name: "Approve" }).click();
    await expect.poll(() => actions.length).toBe(1);
    assert.equal(actions[0].payload.decision, "approve");
    assert.equal(actions[0].payload.artifact_sha256, digest);
    assert.equal(typeof actions[0].key, "string");
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByText("plan approve")).toBeVisible();
  } finally {
    await close(frontend);
    await close(upstream);
  }
});
