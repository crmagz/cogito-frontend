import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { createDevelopmentServer } from "../../server.mjs";

const enabled = process.env.COGITO_KIND_E2E === "1";
const upstreamUrl = process.env.COGITO_E2E_UPSTREAM_URL;
const token = process.env.COGITO_E2E_UPSTREAM_TOKEN;
const runId = process.env.COGITO_E2E_RUN_ID;
const decision = process.env.COGITO_KIND_E2E_DECISION;

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
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test.skip(!enabled, "set COGITO_KIND_E2E=1 after the local Kind lifecycle has created a scoped run");

test("renders a real Kind-backed scoped Workbench run and verified evidence", async ({ page }) => {
  if (!upstreamUrl || !token || !runId) {
    throw new Error("COGITO_E2E_UPSTREAM_URL, COGITO_E2E_UPSTREAM_TOKEN, and COGITO_E2E_RUN_ID are required");
  }
  if (decision && decision !== "request_revision") {
    throw new Error("COGITO_KIND_E2E_DECISION may only be request_revision to avoid unintended live execution");
  }
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const app = createDevelopmentServer({
    upstreamUrl,
    token,
    staticDirectory: path.resolve(dirname, "../../dist")
  });
  const server = createServer(app);
  const origin = await listen(server);
  try {
    await page.goto(origin);
    await expect(page.getByRole("heading", { name: "Mission Control" })).toBeVisible();
    await page.getByText(runId.slice(0, 8), { exact: false }).first().click();
    await expect(page.getByRole("button", { name: "Focus Specification" })).toBeVisible();
    await page.getByRole("button", { name: "Focus Specification" }).click();
    await expect(page.getByRole("button", { name: "Focus Specification" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Selected stage details")).toContainText("Specification");
    await expect(page.locator(".embedded-dossier").getByRole("heading", { name: "Specification", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Configuration" }).click();
    await expect(page.getByLabel("Authoritative node display context")).toContainText("specification");
    if (decision) {
      await page.getByRole("button", { name: "Focus Plan approval" }).click();
      await page.getByLabel("Rationale for rejection or revision").fill("Browser Kind E2E revision validation");
      await page.getByRole("button", { name: "Request revision" }).click();
      await expect(page.getByText("Decision accepted; canonical state has been refreshed.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Request revision" })).toHaveCount(0);
    }
  } finally {
    await close(server);
  }
});
