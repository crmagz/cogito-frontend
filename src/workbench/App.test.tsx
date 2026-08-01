import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, jest } from "@jest/globals";

import { App } from "./App";
import type { ApiClient, Run, TimelineEvent } from "./client";

const digest = "a".repeat(64);
const stages: Run["stages"] = [{ stage_id: "specification", label: "Specification", state: "completed", availability: "authoritative", reason: "Specification stored.", artifact_kind: "source" }, { stage_id: "planning", label: "Planning", state: "completed", availability: "authoritative", reason: "Plan generated.", artifact_kind: "plan" }, { stage_id: "plan_approval", label: "Plan approval", state: "awaiting_operator", availability: "authoritative", reason: "Decision required.", artifact_kind: "plan" }, { stage_id: "implementation", label: "Implementation", state: "unavailable", availability: "unavailable", reason: "Not started.", artifact_kind: null }, { stage_id: "implementation_approval", label: "Implementation approval", state: "unavailable", availability: "unavailable", reason: "Not started.", artifact_kind: null }];
const run: Run = {
  run_id: "run-12345678", project_id: "default", status: "awaiting_plan_approval", submitted_at: "2026-07-26T00:00:00Z", workflow_id: "planning-run-42-revision-1", active_gate: "plan",
  artifacts: [{ kind: "source", sha256: digest }, { kind: "plan", sha256: digest }], stages, workflow_graph: { nodes: stages.map((stage) => ({ ...stage, node_type: stage.stage_id.includes("approval") ? "gate" : stage.stage_id === "specification" ? "queue" : "agent" })), edges: [{ source_node_id: "specification", target_node_id: "planning", style: "solid", emphasis: "primary" }, { source_node_id: "planning", target_node_id: "plan_approval", style: "solid", emphasis: "primary" }, { source_node_id: "plan_approval", target_node_id: "implementation", style: "solid", emphasis: "primary" }, { source_node_id: "implementation", target_node_id: "implementation_approval", style: "solid", emphasis: "primary" }] }, abilities: ["view", "approve"], workflow: ["planning", "plan", "plan_approval"],
  budget: { max_cost_usd: 3, max_wall_clock_minutes: 45, max_review_rounds: 2, actual_cost_usd: null, turns_used: null }, approval_history_available: true, approval_history: [], execution: null, external_links: []
};
const events: TimelineEvent[] = [{ event_id: "event-1", event_type: "plan.awaiting_approval", occurred_at: "2026-07-26T00:00:00Z", gate: "plan", artifact_sha256: digest, decision: null, lifecycle_status: null, delivered: true, delivery_attempt_count: 1 }];

function client(overrides: Partial<ApiClient> = {}): ApiClient {
  return { listProjects: async () => [{ project_id: "default" }], getHealth: async () => true, listRuns: async () => ({ runs: [run], revision: "runs", etag: "runs", unchanged: false }), getRun: async () => run, getTimeline: async () => ({ events, revision: "timeline", etag: "timeline", unchanged: false }), getEvidence: async () => ({ content: '{"title":"verified"}', sha256: digest }), decide: async () => undefined, ...overrides };
}

beforeEach(() => { window.history.replaceState({}, "", "/"); window.localStorage.clear(); });

test("migrates the legacy stored theme preference", async () => {
  window.localStorage.setItem("cogito-workbench-theme", "dark");
  render(<App client={client()} />);

  expect(await screen.findByRole("heading", { name: "Mission Control" })).toBeVisible();
  expect(screen.getByRole("combobox", { name: "Theme" })).toHaveValue("dark");
  expect(window.localStorage.getItem("workbench-theme")).toBe("dark");
});

test("presents Mission Control with filterable authoritative workflow identity", async () => {
  const user = userEvent.setup();
  render(<App client={client()} />);

  expect(await screen.findByRole("heading", { name: "Mission Control" })).toBeVisible();
  expect(screen.getByText("COGITO")).toBeVisible();
  expect(screen.getByText("AI Orchestration")).toBeVisible();
  expect(await screen.findByText("planning-run-42-revision-1")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
  expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
  expect(screen.getAllByText(/Authoritative state updated/)).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Workflows" })).toBeDisabled();
  await user.click(screen.getByRole("tab", { name: /awaiting decision/i }));
  expect(screen.getByText("run-12345678")).toBeVisible();
  await user.type(screen.getByPlaceholderText("Run, workflow, project, status"), "unrelated");
  expect(screen.getByText("No scoped workflows match this Mission Control view.")).toBeVisible();
});

test("keeps a legacy run usable while workflow graph fields are rolling out", async () => {
  const legacyRun: Run = { ...run, workflow_id: undefined, stages: undefined, workflow_graph: undefined };
  const user = userEvent.setup();
  render(<App client={client({ listRuns: async () => ({ runs: [legacyRun], revision: "legacy", etag: "legacy", unchanged: false }), getRun: async () => legacyRun })} />);

  await user.click(await screen.findByText("run-12345678"));
  expect(await screen.findByText("No authoritative lifecycle graph is available for this run yet.")).toBeVisible();
});

test("renders an authoritative in-progress stage as active", async () => {
  const activeStages = stages.map((stage) => stage.stage_id === "planning" ? { ...stage, state: "in_progress" as const } : stage);
  const activeRun: Run = {
    ...run,
    status: "planning",
    active_gate: null,
    stages: activeStages,
    workflow_graph: { ...run.workflow_graph!, nodes: activeStages.map((stage) => ({ ...stage, node_type: stage.stage_id.includes("approval") ? "gate" : stage.stage_id === "specification" ? "queue" : "agent" })) }
  };
  const user = userEvent.setup();
  render(<App client={client({ listRuns: async () => ({ runs: [activeRun], revision: "active", etag: "active", unchanged: false }), getRun: async () => activeRun })} />);

  await user.click(await screen.findByText("run-12345678"));
  expect(screen.getByRole("button", { name: "Focus Planning" }).closest("li")).toHaveClass("active");
});

test("restores a cached timeline when a previously viewed run is not modified", async () => {
  const user = userEvent.setup();
  const secondRun: Run = { ...run, run_id: "run-87654321", workflow_id: "planning-run-43-revision-1" };
  const firstEvent: TimelineEvent = { ...events[0], event_id: "event-first", event_type: "plan.first_event" };
  const secondEvent: TimelineEvent = { ...events[0], event_id: "event-second", event_type: "plan.second_event" };
  const timelineCalls = new Map<string, number>();
  const getTimeline = jest.fn<ApiClient["getTimeline"]>(async (runId) => {
    const calls = (timelineCalls.get(runId) ?? 0) + 1;
    timelineCalls.set(runId, calls);
    if (runId === run.run_id && calls > 1) return { events: [], revision: "first", etag: "first", unchanged: true };
    return runId === run.run_id
      ? { events: [firstEvent], revision: "first", etag: "first", unchanged: false }
      : { events: [secondEvent], revision: "second", etag: "second", unchanged: false };
  });
  render(<App client={client({ listRuns: async () => ({ runs: [run, secondRun], revision: "runs", etag: "runs", unchanged: false }), getRun: async (runId) => runId === run.run_id ? run : secondRun, getTimeline })} />);

  await user.click(await screen.findByText(run.run_id));
  await user.click(screen.getAllByRole("button", { name: "Mission Control" })[0]);
  await user.click(await screen.findByText(secondRun.run_id));
  await user.click(screen.getAllByRole("button", { name: "Mission Control" })[0]);
  await user.click(await screen.findByText(run.run_id));
  await user.click(screen.getByRole("tab", { name: "History" }));

  expect(await screen.findByText("plan.first event")).toBeVisible();
  expect(screen.queryByText("plan.second event")).not.toBeInTheDocument();
});

test("keeps the selected-stage Dossier embedded in a deep-linkable Workflow Canvas", async () => {
  const user = userEvent.setup();
  render(<App client={client()} />);
  await user.click(await screen.findByText("run-12345678"));

  expect(await screen.findByRole("heading", { name: "planning-run-42-revision-1" })).toBeVisible();
  expect(window.location.pathname).toBe("/workflows/run-12345678");
  expect(screen.getAllByRole("heading", { name: /^Plan approval$/ })).toHaveLength(2);
  await user.click(screen.getByRole("tab", { name: "Dependencies" }));
  expect(screen.getAllByText("Planning", { exact: true }).length).toBeGreaterThan(0);
  expect(window.location.pathname).toBe("/workflows/run-12345678");
});

test("replaces the lifecycle bar with an interactive compact authoritative topology", async () => {
  const user = userEvent.setup();
  render(<App client={client()} />);
  await user.click(await screen.findByText("run-12345678"));

  await user.click(await screen.findByRole("button", { name: "Visualize workflow topology" }));
  expect(screen.getByText("Workflow topology")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Select Implementation" }));
  expect(screen.getByLabelText("Selected stage details")).toHaveTextContent("Implementation");
  await user.click(screen.getByRole("button", { name: "Lifecycle" }));
  expect(screen.getByText("Lifecycle")).toBeVisible();
});

test("uses the authoritative graph nodes for the lifecycle rail and focuses the selected section", async () => {
  const user = userEvent.setup();
  render(<App client={client()} />);
  await user.click(await screen.findByText("run-12345678"));

  expect(screen.getByText("Lifecycle")).toBeVisible();
  const planApproval = screen.getByRole("button", { name: "Focus Plan approval" });
  expect(planApproval).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByLabelText("Selected stage details")).toHaveTextContent("Decision required.");
  await user.click(screen.getByRole("button", { name: /^Focus Implementation$/ }));
  expect(screen.getByRole("button", { name: /^Focus Implementation$/ })).toHaveAttribute("aria-pressed", "true");
  expect(planApproval).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByLabelText("Selected stage details")).toHaveTextContent("Not started.");
  expect(screen.getByLabelText("Selected stage details").querySelector("button:not([aria-label='Collapse stage details'])")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Collapse stage details" }));
  expect(screen.getByLabelText("Selected stage details")).toHaveTextContent("Implementation");
  expect(screen.getByRole("button", { name: "Expand stage details" })).toHaveAttribute("aria-expanded", "false");
  await user.click(screen.getByRole("button", { name: "Focus Plan approval" }));
  expect(screen.getByLabelText("Selected stage details")).toHaveTextContent("Plan approval");
  expect(screen.getByRole("button", { name: "Expand stage details" })).toHaveAttribute("aria-expanded", "false");
  await user.click(screen.getByRole("button", { name: "Expand stage details" }));
  expect(screen.getByLabelText("Selected stage details")).toHaveTextContent("Decision required.");
});

test("keeps a stale approval conflict visible and never claims success", async () => {
  const user = userEvent.setup();
  const decide = jest.fn<ApiClient["decide"]>().mockRejectedValue(new Error("Authoritative API request failed (409)"));
  const getRun = jest.fn<ApiClient["getRun"]>().mockResolvedValue(run);
  render(<App client={client({ decide, getRun })} />);
  await user.click(await screen.findByText("run-12345678"));
  await user.click(screen.getByRole("button", { name: "Approve" }));

  expect(await screen.findByText("Authoritative API request failed (409)")).toBeVisible();
  expect(screen.queryByText("Decision accepted; canonical state has been refreshed.")).not.toBeInTheDocument();
  expect(getRun.mock.calls.length).toBeGreaterThanOrEqual(2);
});

test("shows a non-disclosing recovery state for an unavailable direct run link", async () => {
  window.history.pushState({}, "", "/runs/foreign-run/summary");
  const user = userEvent.setup();
  render(<App client={client({ listRuns: async () => ({ runs: [], revision: "empty", etag: "empty", unchanged: false }), getRun: async () => { throw new Error("not found"); } })} />);

  expect(await screen.findByRole("heading", { name: "Run unavailable" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Return to Mission Control" }));
  expect(await screen.findByRole("heading", { name: "Mission Control" })).toBeVisible();
  window.history.replaceState({}, "", "/");
});

test("recovers an invalid node deep link to its authoritative Workflow Canvas", async () => {
  window.history.pushState({}, "", "/workflows/run-12345678/nodes/unknown/overview");
  const user = userEvent.setup();
  render(<App client={client()} />);

  expect(await screen.findByRole("heading", { name: "Node unavailable" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Return to Workflow Canvas" }));
  expect(await screen.findByRole("heading", { name: "planning-run-42-revision-1" })).toBeVisible();
  expect(window.location.pathname).toBe("/workflows/run-12345678");
});

test("does not poll the inbox while a selected detail has its own canonical refresh", async () => {
  jest.useFakeTimers();
  try {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const listRuns = jest.fn<ApiClient["listRuns"]>().mockResolvedValue({ runs: [run], revision: "runs", etag: "runs", unchanged: false });
    const getRun = jest.fn<ApiClient["getRun"]>().mockResolvedValue(run);
    const getTimeline = jest.fn<ApiClient["getTimeline"]>().mockResolvedValue({ events, revision: "timeline", etag: "timeline", unchanged: false });
    render(<App client={client({ listRuns, getRun, getTimeline })} />);
    await user.click(await screen.findByText("run-12345678"));
    await act(async () => { await jest.advanceTimersByTimeAsync(15_000); });
    expect(listRuns).toHaveBeenCalledTimes(1);
    expect(getRun).toHaveBeenCalledTimes(2);
    expect(getTimeline).toHaveBeenCalledTimes(2);
  } finally { jest.useRealTimers(); }
});
