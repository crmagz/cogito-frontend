import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { createDevelopmentServer } from "../../server.mjs";

const enabled = process.env.COGITO_KIND_E2E === "1";
const upstreamUrl = process.env.COGITO_E2E_UPSTREAM_URL;
const token = process.env.COGITO_E2E_UPSTREAM_TOKEN;
const readOnlyRunId = process.env.COGITO_E2E_RUN_ID;
const waitingPlanRunId = process.env.COGITO_E2E_WAITING_PLAN_RUN_ID;
const planArtifactSha256 = process.env.COGITO_E2E_PLAN_SHA256;
const decision = process.env.COGITO_KIND_E2E_DECISION;

if (decision && decision !== "request_revision") {
  throw new Error("COGITO_KIND_E2E_DECISION may only be request_revision to avoid unintended live execution");
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Workbench browser test did not bind a TCP address"));
      resolve(`http://127.0.0.1:${address.port}`);
    });
    server.once("error", reject);
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections?.();
  });
}

async function startWorkbenchRelay() {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const app = createDevelopmentServer({
    upstreamUrl,
    token,
    staticDirectory: path.resolve(dirname, "../../dist")
  });
  const server = createServer(app);
  return { server, origin: await listen(server) };
}

test.skip(!enabled, "set COGITO_KIND_E2E=1 after the local Kind lifecycle has created a scoped run");

test("renders a real Kind-backed scoped Workbench run", async ({ page }) => {
  test.skip(!readOnlyRunId, "set COGITO_E2E_RUN_ID to exercise the read-only path");
  if (!upstreamUrl || !token) {
    throw new Error("COGITO_E2E_UPSTREAM_URL and COGITO_E2E_UPSTREAM_TOKEN are required");
  }
  const { server, origin } = await startWorkbenchRelay();
  try {
    await page.goto(origin);
    await expect(page.getByRole("heading", { name: "Mission Control" })).toBeVisible();
    await page.getByText(readOnlyRunId.slice(0, 8), { exact: false }).first().click();
    await expect(page.getByRole("button", { name: "Focus Specification" })).toBeVisible();
    await page.getByRole("button", { name: "Focus Specification" }).click();
    await expect(page.getByRole("button", { name: "Focus Specification" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Selected stage details")).toContainText("Specification");
    await expect(page.locator(".embedded-dossier").getByRole("heading", { name: "Specification", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Configuration" }).click();
    await expect(page.getByLabel("Authoritative node display context")).toContainText("specification");
  } finally {
    await close(server);
  }
});

test("records a non-executable note against a real source specification", async ({ page }) => {
  test.skip(!readOnlyRunId, "set COGITO_E2E_RUN_ID to exercise the product-owner feedback path");
  if (!upstreamUrl || !token) {
    throw new Error("COGITO_E2E_UPSTREAM_URL and COGITO_E2E_UPSTREAM_TOKEN are required");
  }
  const { server, origin } = await startWorkbenchRelay();
  try {
    await page.goto(`${origin}/workflows/${encodeURIComponent(readOnlyRunId)}`);
    await page.getByRole("button", { name: "Focus Specification" }).click();
    await expect(page.getByRole("button", { name: "Focus Specification" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("tab", { name: "Specifications" }).click();
    await expect(page.getByRole("heading", { name: "Verified immutable evidence" })).toBeVisible();
    await page.getByLabel("Context for reviewers").fill("Kind browser validation note.");
    await page.getByRole("button", { name: "Record context" }).click();
    await expect(page.getByText(/use Request revision when the work itself needs to change/)).toBeVisible();
    await expect(page.getByText(/Kind browser validation note\./)).toBeVisible();
  } finally {
    await close(server);
  }
});

test("verifies a waiting plan artifact and submits an explicit revision", async ({ page }) => {
  test.skip(decision !== "request_revision", "set COGITO_KIND_E2E_DECISION=request_revision to exercise the mutable waiting-gate path");
  if (!upstreamUrl || !token || !waitingPlanRunId || !planArtifactSha256) {
    throw new Error("COGITO_E2E_UPSTREAM_URL, COGITO_E2E_UPSTREAM_TOKEN, COGITO_E2E_WAITING_PLAN_RUN_ID, and COGITO_E2E_PLAN_SHA256 are required");
  }
  if (!/^[a-f0-9]{64}$/i.test(planArtifactSha256)) {
    throw new Error("COGITO_E2E_PLAN_SHA256 must be a SHA-256 digest");
  }
  const { server, origin } = await startWorkbenchRelay();
  try {
    await page.goto(`${origin}/runs/${encodeURIComponent(waitingPlanRunId)}/plan`);
    await expect(page.getByRole("heading", { name: "Run detail" })).toBeVisible();
    await expect(page.getByText(planArtifactSha256, { exact: true })).toBeVisible();
    await page.locator(".artifact-list").getByRole("button", { name: /plan/i }).click();
    await expect(page.getByLabel("Verified evidence")).toBeVisible();

    await page.goto(`${origin}/workflows/${encodeURIComponent(waitingPlanRunId)}`);
    await expect(page.getByRole("button", { name: "Focus Plan approval" })).toHaveAttribute("aria-pressed", "true");
    await page.getByLabel("Rationale for rejection or revision").fill("Browser Kind E2E revision validation");
    await page.getByRole("button", { name: "Request revision" }).click();
    await expect(page.getByText("Decision accepted; canonical state has been refreshed.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Request revision" })).toHaveCount(0);
  } finally {
    await close(server);
  }
});
