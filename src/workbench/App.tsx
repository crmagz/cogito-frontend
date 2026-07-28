import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiClient, type ApiClient, type Artifact, type Project, type Run } from "./client";
import { DecisionControls } from "./DecisionControls";

type View = "mission" | "workflow" | "dossier";
type ShellDialog = "help" | "settings" | "account" | null;
type Theme = "system" | "dark" | "light";
type Health = "checking" | "connected" | "unavailable";

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function statusTone(status: string) {
  if (status.includes("reject") || status.includes("fail")) return "err";
  if (status.includes("await") || status.includes("revision")) return "warn";
  if (status.includes("complete") || status.includes("approve")) return "run";
  return "idle";
}

function Pill({ status, label = statusLabel(status) }: { status: string; label?: string }) {
  return <span className={`pill ${statusTone(status)}`}><i />{label}</span>;
}

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
    flow: "M5 5v6h6M19 19v-6h-6M11 11l2 2M13 11l-2 2",
    node: "M12 3v18M3 12h18M5 5l14 14M19 5 5 19",
    database: "M4 6c0 2 16 2 16 0s-16-2-16 0Zm0 0v6c0 2 16 2 16 0V6m-16 6v6c0 2 16 2 16 0v-6",
    settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-5v2m0 14v2m9-9h-2M5 12H3m15.4-6.4-1.4 1.4M7 17l-1.4 1.4m12.8 0L17 17M7 7 5.6 5.6",
    help: "M9.5 9a2.5 2.5 0 1 1 4.3 1.7c-1 .7-1.8 1.1-1.8 2.8M12 18h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20",
    bolt: "m13 2-9 12h7l-1 8 9-12h-7z"
  };
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name] ?? paths.grid} /></svg>;
}

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 15) return "now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function stageType(stage: string) {
  return stage.endsWith("_approval") ? "gate" : stage === "plan" || stage === "implementation" ? "queue" : "agent";
}

function isActiveStage(stage: string, activeGate: Run["active_gate"]) {
  return activeGate !== null && (stage === activeGate || stage === `${activeGate}_approval`);
}

function stageArtifact(run: Run, stage: string) {
  const kind = stage === "planning" ? "source" : stage === "plan" ? "plan" : stage === "implementation" ? "implementation" : null;
  return kind ? run.artifacts.find((artifact) => artifact.kind === kind) ?? null : null;
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return <div className="kpi"><p>{label}</p><b>{value}</b></div>;
}

function ShellDialog({ dialog, onClose, theme, setTheme, selected }: {
  dialog: ShellDialog;
  onClose: () => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  selected: Run | null;
}) {
  if (!dialog) return null;
  const title = dialog === "help" ? "Workbench help" : dialog === "settings" ? "Display settings" : "Operator account";
  return <div className="dialog-backdrop" role="presentation"><section className="shell-dialog" role="dialog" aria-modal="true" aria-labelledby="shell-dialog-title">
    <header><h2 id="shell-dialog-title">{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}>×</button></header>
    {dialog === "help" && <p>The Workbench shows only project-scoped, server-authoritative run state. Select a workflow to inspect verified evidence or act on an active approval gate.</p>}
    {dialog === "account" && <dl><dt>Current project</dt><dd>{selected?.project_id ?? "No project selected"}</dd><dt>Access</dt><dd>Server-authorized Workbench session</dd></dl>}
    {dialog === "settings" && <fieldset><legend>Theme</legend>{(["system", "dark", "light"] as Theme[]).map((option) => <label key={option}><input type="radio" name="theme" checked={theme === option} onChange={() => setTheme(option)} /> {option}</label>)}</fieldset>}
  </section></div>;
}

function Sidebar({ projects, selectedProject, onProjectChange, selected, activeView, onMission, onWorkflow, onDossier, health, collapsed, onToggleCollapsed, onDialog }: {
  projects: Project[];
  selectedProject: string | undefined;
  onProjectChange: (projectId: string | undefined) => void;
  selected: Run | null;
  activeView: View;
  onMission: () => void;
  onWorkflow: () => void;
  onDossier: () => void;
  health: Health;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onDialog: (dialog: Exclude<ShellDialog, null>) => void;
}) {
  const healthLabel = health === "connected" ? "Authoritative relay connected" : health === "checking" ? "Checking relay connection" : "Relay connection unavailable";
  return <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
    <div className="brand-row"><div className="brand-mark">◆</div><div><strong>COGITO</strong><small>Operator Workbench</small></div><button className="icon-button" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={onToggleCollapsed}>{collapsed ? "»" : "«"}</button></div>
    <div className="workspace-switcher">
      <span className="workspace-icon"><Icon name="flow" /></span>
      {projects.length > 1 ? <label><span className="sr-only">Active project</span><select aria-label="Active project" value={selectedProject ?? ""} onChange={(event) => onProjectChange(event.target.value || undefined)}><option value="">All authorized projects</option>{projects.map((project) => <option key={project.project_id} value={project.project_id}>{project.project_id}</option>)}</select></label> : <span><b>{projects[0]?.project_id ?? selected?.project_id ?? "Cogito"}</b><small><i className={`health-dot ${health}`} />{healthLabel}</small></span>}
    </div>
    <p className="nav-label">Workspace</p>
    <nav aria-label="Workbench navigation">
      <button className={activeView === "mission" ? "active" : ""} onClick={onMission}><Icon name="grid" /><span>Mission Control</span>{activeView === "mission" && <i className="nav-dot" />}</button>
      <button className={activeView !== "mission" ? "active" : ""} disabled={!selected} onClick={onWorkflow}><Icon name="flow" /><span>Workflows</span>{activeView !== "mission" && <i className="nav-dot" />}</button>
    </nav>
    <div className="sidebar-bottom">
      <section className="quick-actions"><p className="nav-label">Quick actions</p><button disabled={!selected} onClick={onWorkflow}>Open workflow</button><button disabled={!selected} onClick={onDossier}>View dossier</button><p className="control-note">Workflow submission and agent creation are not configured for this operator surface.</p></section>
      <section className="system-status"><p className="nav-label">System status</p><b><i className={`health-dot ${health}`} />{healthLabel}</b><small>Derived from the relay health check</small></section>
      <footer><button className="icon-button" aria-label="Open help" onClick={() => onDialog("help")}><Icon name="help" /></button><button className="icon-button" aria-label="Open display settings" onClick={() => onDialog("settings")}><Icon name="settings" /></button><button className="avatar" aria-label="Open operator account" onClick={() => onDialog("account")}>CR<i /></button></footer>
    </div>
  </aside>;
}

function MissionControl({ runs, onSelect, refresh, syncMessage, refreshing }: { runs: Run[]; onSelect: (run: Run) => void; refresh: () => Promise<void>; syncMessage: string; refreshing: boolean }) {
  const awaiting = runs.filter((run) => run.active_gate).length;
  const artifacts = runs.reduce((total, run) => total + run.artifacts.length, 0);
  return <section className="view mission-view" aria-labelledby="mission-control-title">
    <header className="flow-header"><div><h1 id="mission-control-title">Mission Control</h1><p>{runs.length} authoritative runs <span /> {awaiting} gates awaiting <span /> Relay-synced inventory</p></div><div className="kpis"><Kpi label="Active workflows" value={runs.length} /><Kpi label="Open gates" value={awaiting} /><Kpi label="Verified evidence" value={artifacts} /><Kpi label="Project scope" value={runs[0]?.project_id ?? "—"} /></div></header>
    <div className="sync-row" role="status" aria-live="polite">{syncMessage}</div>
    <div className="table-wrap"><table><thead><tr><th>Status</th><th>Workflow</th><th>Flow ID</th><th>Projection</th><th>Evidence</th><th>Gate</th><th>Last run</th></tr></thead><tbody>
      {runs.length === 0 ? <tr><td colSpan={7} className="empty">No project-scoped workflows are currently available.</td></tr> : runs.map((run) => <tr key={run.run_id} onClick={() => onSelect(run)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && onSelect(run)}><td><Pill status={run.status} /></td><td><b>{run.run_id.slice(0, 8)}</b><small>Cogito planning workflow</small></td><td className="mono">flow_{run.run_id.slice(0, 8)}</td><td>{run.workflow.length > 1 ? `${run.workflow.length} projected nodes` : "Single projected node"}</td><td className="mono">{run.artifacts.length} verified</td><td>{run.active_gate ? <Pill status="awaiting" label={`${run.active_gate} gate`} /> : "—"}</td><td className="mono">{relativeTime(run.submitted_at)}</td></tr>)}</tbody></table></div>
    <button className="refresh-button" aria-busy={refreshing} onClick={() => void refresh()}><Icon name="bolt" />{refreshing ? "Refreshing authoritative state…" : "Refresh authoritative state"}</button>
  </section>;
}

function WorkflowCanvas({ run, onBack, onDossier }: { run: Run; onBack: () => void; onDossier: (stage: string) => void }) {
  const [zoom, setZoom] = useState(100);
  const stages = run.workflow.length ? run.workflow : ["planning"];
  const baseWidth = Math.max(1020, stages.length * 290 + 130);
  const scale = zoom / 100;
  return <section className="view workflow-view" aria-labelledby="workflow-title">
    <div className="breadcrumb"><button onClick={onBack}>Mission Control</button><span>/</span><b>{run.run_id.slice(0, 8)}</b></div>
    <header className="flow-header"><div><div className="title-line"><h1 id="workflow-title">Workflow relay</h1><Pill status={run.status} /></div><p className="mono">flow_{run.run_id.slice(0, 8)} <span /> Started {relativeTime(run.submitted_at)} <span /> {stages.length} projected nodes</p></div><div className="kpis"><Kpi label="Nodes" value={stages.length} /><Kpi label="Evidence" value={run.artifacts.length} /><Kpi label="Active gate" value={run.active_gate ?? "none"} /><Kpi label="Scope" value={run.project_id} /></div></header>
    <div className="canvas-toolbar"><span>Projected path from authoritative run state</span><div><button aria-label="Zoom out" disabled={zoom === 50} onClick={() => setZoom((value) => Math.max(50, value - 10))}>−</button><span aria-live="polite">{zoom}%</span><button aria-label="Zoom in" disabled={zoom === 200} onClick={() => setZoom((value) => Math.min(200, value + 10))}>+</button><button aria-label="Fit graph" onClick={() => setZoom(100)}>⌗</button></div><span className="canvas-mode">Projected path</span></div>
    <div className="canvas-scroll"><div className="canvas-zoom" data-zoom={zoom} style={{ width: `${baseWidth * scale}px`, minHeight: `${480 * scale}px` }}><div className="relay-canvas" style={{ "--count": stages.length, width: `${baseWidth}px`, transform: `scale(${scale})` } as React.CSSProperties}><div className="relay-line" />{stages.map((stage) => {
      const active = isActiveStage(stage, run.active_gate);
      const artifact = stageArtifact(run, stage);
      return <button key={stage} className={`relay-node ${stageType(stage)} ${active ? "focused" : ""}`} onClick={() => onDossier(stage)}><span className="node-icon"><Icon name={stageType(stage) === "gate" ? "flow" : stageType(stage) === "queue" ? "database" : "node"} /></span><span className="node-copy"><b>{statusLabel(stage)}</b><small>{stageType(stage)}</small></span><i className={`node-status ${active ? "warn" : "idle"}`} /><span className="node-metric">{active ? "Awaiting operator decision" : artifact ? "Verified evidence available" : "Projected from run lifecycle"}</span></button>;
    })}</div></div></div>
  </section>;
}

function Dossier({ client, run, stage, onBack, onRefresh, decisionNotice, onDecisionComplete }: { client: ApiClient; run: Run; stage: string; onBack: () => void; onRefresh: () => Promise<void>; decisionNotice: string | null; onDecisionComplete: () => void }) {
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [evidence, setEvidence] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const selectedArtifact = stageArtifact(run, stage);
  useEffect(() => { setArtifact(null); setEvidence(""); setError(null); }, [run.run_id, stage]);
  async function openEvidence(next: Artifact) { setArtifact(next); setError(null); try { setEvidence((await client.getEvidence(run.run_id, next)).content); } catch (reason) { setError(reason instanceof Error ? reason.message : "Evidence is unavailable."); } }
  return <section className="view dossier-view" aria-labelledby="dossier-title">
    <div className="breadcrumb"><button onClick={onBack}>Workflow relay</button><span>/</span><b>{statusLabel(stage)}</b></div>
    <header className="dossier-head"><div><h1 id="dossier-title" className="dossier-title">{statusLabel(stage)}</h1><div className="dossier-meta"><span>projected node</span><span>{stageType(stage)}</span><Pill status={isActiveStage(stage, run.active_gate) ? "awaiting" : "idle"} label={isActiveStage(stage, run.active_gate) ? "awaiting decision" : "projected"} /></div></div><div className="d-kpis"><Kpi label="Run state" value={statusLabel(run.status)} /><Kpi label="Gate" value={run.active_gate ?? "—"} /></div></header>
    <div className="dossier-content">{decisionNotice && <p className="sync-row" role="status">{decisionNotice}</p>}<div className="dossier-grid"><section className="card dossier-summary"><p className="eyebrow">Authoritative run context</p><p className="dossier-description">This is a projected workflow node. Its own lifecycle is shown only when Cogito persists it; the run state remains {statusLabel(run.status)}.</p><div className="dossier-details"><div><span>Project</span><b>{run.project_id}</b></div><div><span>Run state</span><b>{statusLabel(run.status)}</b></div><div><span>Active gate</span><b>{run.active_gate ?? "None"}</b></div><div><span>Submitted</span><b>{new Date(run.submitted_at).toLocaleString()}</b></div></div></section><section className="card dossier-events"><h2 className="panel-title">Verified evidence</h2><div className="timeline">{selectedArtifact ? <button className={`tl-item evidence-event ${artifact?.kind === selectedArtifact.kind ? "selected" : ""}`} onClick={() => void openEvidence(selectedArtifact)}><i /><span><b>{selectedArtifact.kind} evidence</b><small>{selectedArtifact.sha256.slice(0, 12)}</small></span></button> : <p className="control-note">No immutable evidence is associated with this projected node.</p>}</div>{error && <p className="evidence-error" role="alert">{error}</p>}{evidence && <pre aria-label="Verified evidence">{evidence}</pre>}</section></div><div className="dossier-grid workbench-facts"><section className="card"><h2 className="panel-title">Execution summary</h2>{run.execution ? <dl><dt>Phases</dt><dd>{run.execution.succeeded_phase_count} passed / {run.execution.failed_phase_count} failed / {run.execution.phase_count} recorded</dd><dt>Verification</dt><dd>{run.execution.verification_passed} passed / {run.execution.verification_failed} failed</dd><dt>Review</dt><dd>{run.execution.review_status ?? "Unavailable"}</dd><dt>Validation</dt><dd>{run.execution.validation_status ?? "Unavailable"}</dd></dl> : <p className="control-note">Execution facts are unavailable until a verified implementation artifact is recorded.</p>}<dl><dt>Cost limit</dt><dd>${run.budget.max_cost_usd.toFixed(2)}</dd><dt>Actual cost</dt><dd>{run.budget.actual_cost_usd === null ? "Unavailable" : `$${run.budget.actual_cost_usd.toFixed(2)}`}</dd><dt>Turns used</dt><dd>{run.budget.turns_used ?? "Unavailable"}</dd></dl></section><section className="card"><h2 className="panel-title">Approval history</h2>{run.approval_history_available ? run.approval_history.length ? <div className="timeline">{run.approval_history.map((approval) => <div className="tl-item" key={approval.decision_id}><i /><span><b>{approval.gate} {approval.decision}</b><small>{approval.actor_id} · {new Date(approval.created_at).toLocaleString()} · {approval.delivered ? "delivered" : "pending delivery"}</small></span></div>)}</div> : <p className="control-note">No operator decisions have been recorded.</p> : <p className="control-note">Approval history is available to approvers.</p>}{run.external_links.length > 0 && <div className="external-links">{run.external_links.map((link) => <a key={`${link.kind}:${link.url}`} href={link.url} target="_blank" rel="noreferrer">{link.label}</a>)}</div>}</section></div>{run.active_gate && <DecisionControls client={client} run={run} onComplete={onRefresh} onSuccess={onDecisionComplete} />}</div>
  </section>;
}

function readStoredTheme(): Theme {
  try { const value = window.localStorage.getItem("cogito-workbench-theme"); return value === "light" || value === "dark" || value === "system" ? value : "system"; } catch { return "system"; }
}

export function App({ client = apiClient }: { client?: ApiClient }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string>();
  const [selected, setSelected] = useState<Run | null>(null);
  const [view, setView] = useState<View>("mission");
  const [stage, setStage] = useState("planning");
  const [error, setError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState("Authoritative state has not been refreshed yet.");
  const [refreshing, setRefreshing] = useState(false);
  const [health, setHealth] = useState<Health>("checking");
  const [pollDelay, setPollDelay] = useState(15_000);
  const [collapsed, setCollapsed] = useState(false);
  const [dialog, setDialog] = useState<ShellDialog>(null);
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  const [detailRevision, setDetailRevision] = useState(0);
  const [decisionNotice, setDecisionNotice] = useState<string | null>(null);
  const refreshGeneration = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const etags = useRef(new Map<string, string>());

  const refresh = useCallback(async () => {
    if (!projectsLoaded) {
      setSyncMessage("Project inventory is unavailable; no run request was sent.");
      return;
    }
    const generation = ++refreshGeneration.current;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const etagKey = selectedProject ?? "*";
    setRefreshing(true);
    setSyncMessage("Refreshing authoritative state…");
    try {
      const result = await client.listRuns({ projectId: selectedProject, etag: etags.current.get(etagKey), signal: controller.signal });
      if (generation !== refreshGeneration.current) return;
      if (!result.unchanged) {
        setRuns(result.runs);
        setSelected((current) => result.runs.find((item) => item.run_id === current?.run_id) ?? result.runs[0] ?? null);
        setDetailRevision((value) => value + 1);
        if (result.runs.length === 0) {
          setStage("planning");
          setView("mission");
        }
        setSyncMessage(`Authoritative state updated at ${new Date().toLocaleTimeString()}.`);
      } else {
        setSyncMessage(`Authoritative state unchanged at ${new Date().toLocaleTimeString()}.`);
      }
      if (result.etag) etags.current.set(etagKey, result.etag);
      setError(null);
      setHealth("connected");
      setPollDelay(15_000);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      if (generation === refreshGeneration.current) {
        setError(reason instanceof Error ? reason.message : "Mission Control is temporarily unavailable.");
        setSyncMessage("Authoritative state refresh failed; showing the last known inventory.");
        setHealth("unavailable");
        setPollDelay((delay) => Math.min(delay * 2, 120_000));
      }
    } finally {
      if (generation === refreshGeneration.current) setRefreshing(false);
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  }, [client, projectsLoaded, selectedProject]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    void client.listProjects(controller.signal).then((items) => {
      if (cancelled) return;
      setProjects(items);
      setSelectedProject((current) => current && items.some((item) => item.project_id === current) ? current : items.length === 1 ? items[0].project_id : undefined);
      setProjectsLoaded(true);
    }).catch(() => {
      if (!cancelled) {
        setError("Unable to load authorized project inventory.");
        setHealth("unavailable");
      }
    });
    void client.getHealth(controller.signal).then((ok) => setHealth(ok ? "connected" : "unavailable")).catch(() => setHealth("unavailable"));
    return () => { cancelled = true; controller.abort(); };
  }, [client]);
  useEffect(() => { if (projectsLoaded) void refresh(); }, [projectsLoaded, refresh]);
  useEffect(() => {
    if (!projectsLoaded) return;
    const interval = window.setInterval(() => void refresh(), pollDelay);
    return () => window.clearInterval(interval);
  }, [pollDelay, projectsLoaded, refresh]);
  useEffect(() => () => activeRequest.current?.abort(), []);
  useEffect(() => { try { window.localStorage.setItem("cogito-workbench-theme", theme); } catch { /* Storage denial only affects preference persistence. */ } }, [theme]);
  useEffect(() => {
    if (!selected || view === "mission") return;
    const controller = new AbortController();
    let cancelled = false;
    void client.getRun(selected.run_id, controller.signal).then((detail) => {
      if (!cancelled) setSelected((current) => current?.run_id === detail.run_id ? detail : current);
    }).catch((reason) => {
      if (!cancelled && !(reason instanceof DOMException && reason.name === "AbortError")) {
        setError("Unable to load the latest scoped workflow detail; showing the last known summary.");
      }
    });
    return () => { cancelled = true; controller.abort(); };
  }, [client, detailRevision, selected?.run_id, view]);

  const selectedRun = selected ?? runs[0] ?? null;
  const openWorkflow = (run = selectedRun) => { if (run) { setDecisionNotice(null); setSelected(run); setStage(run.workflow[0] ?? "planning"); setView("workflow"); } };
  const content = useMemo(() => {
    if (view === "workflow" && selectedRun) return <WorkflowCanvas run={selectedRun} onBack={() => setView("mission")} onDossier={(nextStage) => { setStage(nextStage); setView("dossier"); }} />;
    if (view === "dossier" && selectedRun) return <Dossier client={client} run={selectedRun} stage={stage} onBack={() => setView("workflow")} onRefresh={refresh} decisionNotice={decisionNotice} onDecisionComplete={() => setDecisionNotice("Decision accepted; the authoritative state has been refreshed.")} />;
    return <MissionControl runs={runs} onSelect={openWorkflow} refresh={refresh} syncMessage={syncMessage} refreshing={refreshing} />;
  }, [client, decisionNotice, refresh, refreshing, runs, selectedRun, stage, syncMessage, view]);
  return <main className="app-shell" data-theme={theme}><Sidebar projects={projects} selectedProject={selectedProject} onProjectChange={setSelectedProject} selected={selectedRun} activeView={view} onMission={() => setView("mission")} onWorkflow={() => openWorkflow()} onDossier={() => selectedRun && setView("dossier")} health={health} collapsed={collapsed} onToggleCollapsed={() => setCollapsed((value) => !value)} onDialog={setDialog} /><div className="main-content">{error && <p className="app-error" role="alert">{error}</p>}{content}</div><ShellDialog dialog={dialog} onClose={() => setDialog(null)} theme={theme} setTheme={setTheme} selected={selectedRun} /></main>;
}
