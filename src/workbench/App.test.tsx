import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jest } from "@jest/globals";

import { App } from "./App";
import type { ApiClient, Run } from "./client";

const waitingRun: Run = {
  run_id: "run-12345678",
  project_id: "default",
  status: "awaiting_plan_approval",
  submitted_at: "2026-07-26T00:00:00Z",
  active_gate: "plan",
  artifacts: [{ kind: "plan", sha256: "a".repeat(64) }],
  abilities: ["view", "approve"],
  workflow: ["planning", "plan", "plan_approval"]
};

test("renders an accessible relay-grid workbench and rejects blank revision rationales", async () => {
  const user = userEvent.setup();
  const decide = jest.fn<(run: Run, decision: "approve" | "reject" | "request_revision", comment?: string) => Promise<void>>().mockResolvedValue(undefined);
  const client: ApiClient = {
    listRuns: async () => ({ runs: [waitingRun], revision: "first", etag: "first", unchanged: false }),
    getEvidence: async () => ({ content: "{}", sha256: waitingRun.artifacts[0].sha256 }),
    decide
  };

  render(<App client={client} />);
  expect(await screen.findByRole("button", { name: "Request revision" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Mission Control" })).toBeVisible();
  expect(screen.getByText("Telemetry — coming soon")).toHaveAttribute("aria-disabled", "true");

  await user.click(screen.getByRole("button", { name: "Request revision" }));

  expect(decide).not.toHaveBeenCalled();
  expect(screen.getByText("A rationale is required for this decision")).toBeVisible();
});

test("does not let a stale refresh overwrite a newer authoritative response", async () => {
  const user = userEvent.setup();
  let resolveFirst!: (value: { runs: Run[]; revision: string; etag: string; unchanged: false }) => void;
  let resolveSecond!: (value: { runs: Run[]; revision: string; etag: string; unchanged: false }) => void;
  const first = new Promise<{ runs: Run[]; revision: string; etag: string; unchanged: false }>((resolve) => { resolveFirst = resolve; });
  const second = new Promise<{ runs: Run[]; revision: string; etag: string; unchanged: false }>((resolve) => { resolveSecond = resolve; });
  const currentRun = { ...waitingRun, run_id: "run-current-123", status: "awaiting_implementation_approval" };
  const client: ApiClient = {
    listRuns: jest.fn<ApiClient["listRuns"]>().mockReturnValueOnce(first).mockReturnValueOnce(second),
    getEvidence: async () => ({ content: "{}", sha256: waitingRun.artifacts[0].sha256 }),
    decide: async () => undefined
  };

  render(<App client={client} />);
  await user.click(screen.getByRole("button", { name: "Refresh authoritative state" }));
  await act(async () => { resolveSecond({ runs: [currentRun], revision: "new", etag: "new", unchanged: false }); });
  expect(await screen.findByText("awaiting implementation approval")).toBeVisible();
  await act(async () => { resolveFirst({ runs: [waitingRun], revision: "old", etag: "old", unchanged: false }); });
  expect(screen.getByText("awaiting implementation approval")).toBeVisible();
});
