import { act, render, screen, within } from "@testing-library/react";
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
  workflow: ["planning", "plan", "plan_approval"],
  budget: { max_cost_usd: 3, max_wall_clock_minutes: 45, max_review_rounds: 2, actual_cost_usd: null, turns_used: null },
  approval_history_available: true,
  approval_history: [],
  execution: null,
  external_links: []
};

test("renders the relay grid drill-down and rejects blank revision rationales", async () => {
  const user = userEvent.setup();
  const decide = jest.fn<(run: Run, decision: "approve" | "reject" | "request_revision", comment?: string) => Promise<void>>().mockResolvedValue(undefined);
  const client: ApiClient = {
    listProjects: async () => [{ project_id: "default" }],
    getHealth: async () => true,
    listRuns: async () => ({ runs: [waitingRun], revision: "first", etag: "first", unchanged: false }),
    getRun: async () => waitingRun,
    getEvidence: async () => ({ content: "{}", sha256: waitingRun.artifacts[0].sha256 }),
    decide
  };

  render(<App client={client} />);
  expect(await screen.findByRole("heading", { name: "Mission Control" })).toBeVisible();
  expect(screen.getByRole("navigation", { name: "Workbench navigation" })).toBeVisible();

  await user.click(await screen.findByText("run-1234"));
  expect(await screen.findByRole("heading", { name: "Workflow relay" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Workflows" })).toHaveClass("active");
  expect(screen.getByRole("button", { name: /planning agent projected from run lifecycle/i })).toHaveClass("agent");
  await user.click(screen.getByRole("button", { name: /plan queue awaiting operator decision/i }));
  expect(await screen.findByRole("button", { name: "Request revision" })).toBeVisible();

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
    listProjects: async () => [],
    getHealth: async () => true,
    listRuns: jest.fn<ApiClient["listRuns"]>().mockReturnValueOnce(first).mockReturnValueOnce(second),
    getRun: async () => waitingRun,
    getEvidence: async () => ({ content: "{}", sha256: waitingRun.artifacts[0].sha256 }),
    decide: async () => undefined
  };

  render(<App client={client} />);
  await user.click(screen.getByRole("button", { name: /authoritative state/ }));
  await act(async () => { resolveSecond({ runs: [currentRun], revision: "new", etag: "new", unchanged: false }); });
  expect(await screen.findByText("awaiting implementation approval")).toBeVisible();
  await act(async () => { resolveFirst({ runs: [waitingRun], revision: "old", etag: "old", unchanged: false }); });
  expect(screen.getByText("awaiting implementation approval")).toBeVisible();
});

test("operates workflow-only navigation, zoom, shell controls, and visible refresh outcomes", async () => {
  const user = userEvent.setup();
  const client: ApiClient = {
    listProjects: async () => [],
    getHealth: async () => false,
    listRuns: jest
      .fn<ApiClient["listRuns"]>()
      .mockResolvedValueOnce({ runs: [waitingRun], revision: "first", etag: "first", unchanged: false })
      .mockResolvedValue({ runs: [], revision: "first", etag: "first", unchanged: true }),
    getRun: async () => waitingRun,
    getEvidence: async () => ({ content: "{}", sha256: waitingRun.artifacts[0].sha256 }),
    decide: async () => undefined
  };

  render(<App client={client} />);
  await user.click(await screen.findByText("run-1234"));
  expect(screen.queryByRole("button", { name: "Runs" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(screen.getByText("110%")).toBeVisible();
  expect(document.querySelector(".canvas-zoom")).toHaveAttribute("data-zoom", "110");
  await user.click(screen.getByRole("button", { name: "Fit graph" }));
  expect(screen.getByText("100%")).toBeVisible();

  await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
  expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Open display settings" }));
  await user.click(screen.getByRole("radio", { name: "light" }));
  expect(screen.getByRole("main")).toHaveAttribute("data-theme", "light");
  await user.click(screen.getByRole("button", { name: "Close dialog" }));

  await user.click(within(screen.getByRole("navigation", { name: "Workbench navigation" })).getByRole("button", { name: "Mission Control" }));
  await user.click(screen.getByRole("button", { name: "Refresh authoritative state" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Authoritative state unchanged");
  expect(screen.getAllByText("Authoritative relay connected")).not.toHaveLength(0);
});

test("selects only authorized projects through the server-backed inventory", async () => {
  const user = userEvent.setup();
  const listRuns = jest.fn<ApiClient["listRuns"]>().mockResolvedValue({ runs: [waitingRun], revision: "first", etag: "first", unchanged: false });
  const client: ApiClient = {
    listProjects: async () => [{ project_id: "alpha" }, { project_id: "beta" }],
    getHealth: async () => true,
    listRuns,
    getRun: async () => waitingRun,
    getEvidence: async () => ({ content: "{}", sha256: waitingRun.artifacts[0].sha256 }),
    decide: async () => undefined
  };

  render(<App client={client} />);
  const selector = await screen.findByRole("combobox", { name: "Active project" });
  await user.selectOptions(selector, "beta");
  expect(await screen.findByText("Authoritative state updated", { exact: false })).toBeVisible();
  expect(listRuns).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: "beta" }));
});

test("does not poll before server-authorized project inventory resolves", async () => {
  let resolveProjects!: (projects: { project_id: string }[]) => void;
  const projects = new Promise<{ project_id: string }[]>((resolve) => { resolveProjects = resolve; });
  const listRuns = jest.fn<ApiClient["listRuns"]>().mockResolvedValue({ runs: [waitingRun], revision: "first", etag: "first", unchanged: false });
  const client: ApiClient = {
    listProjects: async () => projects,
    getHealth: async () => true,
    listRuns,
    getRun: async () => waitingRun,
    getEvidence: async () => ({ content: "{}", sha256: waitingRun.artifacts[0].sha256 }),
    decide: async () => undefined
  };

  render(<App client={client} />);
  expect(listRuns).not.toHaveBeenCalled();
  await act(async () => { resolveProjects([{ project_id: "default" }]); });
  expect(await screen.findByText("run-1234")).toBeVisible();
  expect(listRuns).toHaveBeenCalledWith(expect.objectContaining({ projectId: "default" }));
});

test("fails closed when the authorized project inventory cannot be loaded", async () => {
  const user = userEvent.setup();
  const listRuns = jest.fn<ApiClient["listRuns"]>();
  const client: ApiClient = {
    listProjects: async () => { throw new Error("project service unavailable"); },
    getHealth: async () => true,
    listRuns,
    getRun: async () => waitingRun,
    getEvidence: async () => ({ content: "{}", sha256: waitingRun.artifacts[0].sha256 }),
    decide: async () => undefined
  };

  render(<App client={client} />);
  expect(await screen.findByText("Unable to load authorized project inventory.")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Refresh authoritative state" }));
  expect(screen.getByRole("status")).toHaveTextContent("Project inventory is unavailable; no run request was sent.");
  expect(listRuns).not.toHaveBeenCalled();
});

test("does not poll or refetch details while a workflow is open", async () => {
  jest.useFakeTimers();
  try {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const listRuns = jest
      .fn<ApiClient["listRuns"]>()
      .mockResolvedValue({ runs: [waitingRun], revision: "first", etag: "first", unchanged: false });
    const getRun = jest.fn<ApiClient["getRun"]>().mockResolvedValue(waitingRun);
    const client: ApiClient = {
      listProjects: async () => [],
      getHealth: async () => true,
      listRuns,
      getRun,
      getEvidence: async () => ({ content: "{}", sha256: waitingRun.artifacts[0].sha256 }),
      decide: async () => undefined
    };

    render(<App client={client} />);
    await user.click(await screen.findByText("run-1234"));
    expect(await screen.findByRole("heading", { name: "Workflow relay" })).toBeVisible();
    await act(async () => {});
    await act(async () => { await jest.advanceTimersByTimeAsync(15_000); });

    expect(listRuns).toHaveBeenCalledTimes(1);
    expect(getRun).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

test("does not present approval history as empty when the scoped viewer cannot read it", async () => {
  const user = userEvent.setup();
  const viewerRun = {
    ...waitingRun,
    abilities: ["view"],
    approval_history_available: false,
    external_links: [{ kind: "repository", label: "Repository", url: "https://github.com/acme/api-gateway" }]
  };
  const client: ApiClient = {
    listProjects: async () => [{ project_id: "default" }],
    getHealth: async () => true,
    listRuns: async () => ({ runs: [viewerRun], revision: "viewer", etag: "viewer", unchanged: false }),
    getRun: async () => viewerRun,
    getEvidence: async () => ({ content: "{}", sha256: waitingRun.artifacts[0].sha256 }),
    decide: async () => undefined
  };

  render(<App client={client} />);
  await user.click(await screen.findByText("run-1234"));
  await user.click(screen.getByRole("button", { name: /plan queue/i }));

  expect(await screen.findByText("Approval history is available to approvers.")).toBeVisible();
  expect(screen.queryByText("No operator decisions have been recorded.")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Repository" })).toHaveAttribute("rel", "noopener noreferrer");
});
