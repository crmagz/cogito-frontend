import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiClient, type ApiClient, type Artifact, type Run } from "./client";
import { DecisionControls } from "./DecisionControls";

type View = "mission" | "workflow" | "dossier";
type DossierTab = "overview" | "log" | "configuration" | "dependencies" | "history";

const navItems = ["Mission Control", "Workflows", "Runs", "Agents", "Tools", "Datasets", "Secrets", "Policies", "Schedules", "Audit Log"] as const;
type NavItem = (typeof navItems)[number];

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
    runs: "M5 4h14v16H5zM8 8h8M8 12h8M8 16h5",
    node: "M12 3v18M3 12h18M5 5l14 14M19 5 5 19",
    database: "M4 6c0 2 16 2 16 0s-16-2-16 0Zm0 0v6c0 2 16 2 16 0V6m-16 6v6c0 2 16 2 16 0v-6",
    shield: "M12 3 5 6v5c0 4.5 3 7.5 7 10 4-2.5 7-5.5 7-10V6z",
    clock: "M12 5v7l4 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20",
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

function Sidebar({ setView, selected, activeItem, setActiveItem }: { setView: (view: View) => void; selected: Run | null; activeItem: NavItem; setActiveItem: (item: NavItem) => void }) {
  return <aside className="sidebar">
    <div className="brand-row"><div className="brand-mark">◆</div><div><strong>COGITO</strong><small>Operator Workbench</small></div><button className="icon-button" aria-label="Collapse sidebar">«</button></div>
    <button className="workspace-switcher"><span className="workspace-icon"><Icon name="flow" /></span><span><b>{selected?.project_id ?? "Cogito"}</b><small><i className="health-dot" />Operational</small></span><span>⌄</span></button>
    <p className="nav-label">Workspace</p>
    <nav aria-label="Workbench navigation">
      {navItems.map((item, index) => {
        const enabled = item === "Mission Control" || item === "Workflows" || item === "Runs";
        const active = item === activeItem;
        return <button key={item} className={active ? "active" : ""} aria-disabled={!enabled} onClick={() => { if (enabled) { setActiveItem(item); setView(item === "Mission Control" ? "mission" : "workflow"); } }}><Icon name={index === 0 ? "grid" : index === 1 ? "flow" : index === 2 ? "runs" : index === 5 ? "database" : index === 7 ? "shield" : index === 8 ? "clock" : "node"} /><span>{item}</span>{active && <i className="nav-dot" />}</button>;
      })}
    </nav>
    <div className="sidebar-bottom">
      <section className="quick-actions"><p className="nav-label">Quick actions</p><button disabled>New Workflow <b>+</b></button><button disabled>Trigger Run</button><button disabled>Create Agent</button><button onClick={() => { if (selected) { setActiveItem("Runs"); setView("dossier"); } }}>View Dossiers</button></section>
      <section className="system-status"><p className="nav-label">System status</p><b><i className="health-dot" />All Systems Operational</b><small>Authoritative relay connected</small></section>
      <footer><button className="icon-button" aria-label="Help"><Icon name="help" /></button><button className="icon-button" aria-label="Settings"><Icon name="settings" /></button><span className="avatar">CR<i /></span><button className="icon-button" aria-label="Expand sidebar">»</button></footer>
    </div>
  </aside>;
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return <div className="kpi"><p>{label}</p><b>{value}</b></div>;
}

function DossierKpi({ label, value }: { label: string; value: string | number }) {
  return <div className="d-kpi"><b>{value}</b><span>{label}</span></div>;
}

function MissionControl({ runs, onSelect, refresh }: { runs: Run[]; onSelect: (run: Run) => void; refresh: () => Promise<void> }) {
  const awaiting = runs.filter((run) => run.active_gate).length;
  const artifacts = runs.reduce((total, run) => total + run.artifacts.length, 0);
  return <section className="view mission-view" aria-labelledby="mission-control-title">
    <header className="flow-header"><div><h1 id="mission-control-title">Mission Control</h1><p>{runs.length} authoritative runs <span /> {awaiting} gates awaiting <span /> Relay-synced inventory</p></div><div className="kpis"><Kpi label="Active workflows" value={runs.length} /><Kpi label="Open gates" value={awaiting} /><Kpi label="Verified evidence" value={artifacts} /><Kpi label="Project scope" value={runs[0]?.project_id ?? "—"} /></div></header>
    <div className="table-wrap"><table><thead><tr><th>Status</th><th>Workflow</th><th>Flow ID</th><th>Type</th><th>Evidence</th><th>Gate</th><th>Last run</th></tr></thead><tbody>
      {runs.length === 0 ? <tr><td colSpan={7} className="empty">No project-scoped runs are currently available.</td></tr> : runs.map((run) => <tr key={run.run_id} onClick={() => onSelect(run)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && onSelect(run)}><td><Pill status={run.status} /></td><td><b>{run.run_id.slice(0, 8)}</b><small>Cogito planning run</small></td><td className="mono">flow_{run.run_id.slice(0, 8)}</td><td>{run.workflow.length > 1 ? `Pipeline · ${run.workflow.length} stages` : "Single stage"}</td><td className="mono">{run.artifacts.length} verified</td><td>{run.active_gate ? <Pill status="awaiting" label={`${run.active_gate} gate`} /> : "—"}</td><td className="mono">{relativeTime(run.submitted_at)}</td></tr>)}</tbody></table></div>
    <button className="refresh-button" onClick={() => void refresh()}><Icon name="bolt" />Refresh authoritative state</button>
  </section>;
}

function stageType(stage: string) { return stage.endsWith("_approval") ? "gate" : stage === "plan" || stage === "implementation" ? "queue" : "agent"; }
function isActiveStage(stage: string, activeGate: Run["active_gate"]) { return activeGate !== null && (stage === activeGate || stage === `${activeGate}_approval`); }

function WorkflowCanvas({ run, onBack, onDossier }: { run: Run; onBack: () => void; onDossier: (stage: string) => void }) {
  const stages = run.workflow.length ? run.workflow : ["planning"];
  return <section className="view workflow-view" aria-labelledby="workflow-title">
    <div className="breadcrumb"><button onClick={onBack}>Mission Control</button><span>/</span><b>{run.run_id.slice(0, 8)}</b></div>
    <header className="flow-header"><div><div className="title-line"><h1 id="workflow-title">Planning Relay</h1><Pill status={run.status} /></div><p className="mono">flow_{run.run_id.slice(0, 8)} <span /> Started {relativeTime(run.submitted_at)} <span /> {stages.length} projected stages</p></div><div className="kpis"><Kpi label="Stages" value={stages.length} /><Kpi label="Evidence" value={run.artifacts.length} /><Kpi label="Active gate" value={run.active_gate ?? "none"} /><Kpi label="Scope" value={run.project_id} /></div></header>
    <div className="canvas-toolbar"><span><i className="health-dot" /> Live projection</span><div><button aria-label="Zoom out">−</button><span>100%</span><button aria-label="Zoom in">+</button><button aria-label="Fit graph">⌗</button></div><button>View: State ⌄</button></div>
    <div className="canvas-scroll"><div className="relay-canvas" style={{ "--count": stages.length } as React.CSSProperties}><div className="relay-line" />{stages.map((stage) => <button key={stage} className={`relay-node ${stageType(stage)} ${isActiveStage(stage, run.active_gate) ? "focused" : ""}`} onClick={() => onDossier(stage)}><span className="node-icon"><Icon name={stageType(stage) === "gate" ? "flow" : stageType(stage) === "queue" ? "database" : "node"} /></span><span className="node-copy"><b>{statusLabel(stage)}</b><small>{stageType(stage)}</small></span><i className={`node-status ${statusTone(isActiveStage(stage, run.active_gate) ? "awaiting" : run.status)}`} /><span className="node-metric">{isActiveStage(stage, run.active_gate) ? "Awaiting decision" : "Authoritative"}</span><span className="node-bars"><i /><i /><i /><i className="off" /><i className="off" /></span></button>)}</div></div>
  </section>;
}

function Dossier({ client, run, stage, onBack, onRefresh }: { client: ApiClient; run: Run; stage: string; onBack: () => void; onRefresh: () => Promise<void> }) {
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [evidence, setEvidence] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<DossierTab>("overview");
  useEffect(() => { setArtifact(null); setEvidence(""); setError(null); }, [run.run_id, stage]);
  async function openEvidence(next: Artifact) { setArtifact(next); setError(null); try { setEvidence((await client.getEvidence(run.run_id, next)).content); } catch (reason) { setError(reason instanceof Error ? reason.message : "Evidence is unavailable."); } }
  const tabs: { id: DossierTab; label: string }[] = [{ id: "overview", label: "Overview" }, { id: "log", label: "Execution log" }, { id: "configuration", label: "Configuration" }, { id: "dependencies", label: "Dependencies" }, { id: "history", label: "History" }];
  return <section className="view dossier-view" aria-labelledby="dossier-title">
    <div className="breadcrumb"><button onClick={onBack}>Mission Control</button><span>/</span><button onClick={onBack}>Planning Relay</button><span>/</span><b>{statusLabel(stage)}</b></div>
    <header className="dossier-head">
      <div><h1 id="dossier-title" className="dossier-title">{statusLabel(stage)}</h1><div className="dossier-meta"><span>node_{stage.replaceAll("_", "-")}</span><span>{stageType(stage)}</span><Pill status={isActiveStage(stage, run.active_gate) ? "awaiting" : run.status} /></div></div>
      <div className="d-kpis"><DossierKpi label="Evidence" value={run.artifacts.length} /><DossierKpi label="Gate" value={run.active_gate ?? "—"} /><DossierKpi label="Project" value={run.project_id} /></div>
    </header>
    <div className="subtabs" role="tablist">{tabs.map((item) => <button key={item.id} className="subtab" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>
    <div className="dossier-content">
      {tab === "overview" && <div className="dossier-grid"><section className="card dossier-summary"><p className="eyebrow">Description</p><p className="dossier-description">This stage is projected by Cogito from the persisted planning run. Decisions and evidence remain server-authoritative.</p><div className="dossier-details"><div><span>Project</span><b>{run.project_id}</b></div><div><span>Workflow state</span><b>{statusLabel(run.status)}</b></div><div><span>Active gate</span><b>{run.active_gate ?? "None"}</b></div><div><span>Submitted</span><b>{new Date(run.submitted_at).toLocaleString()}</b></div></div></section><section className="card dossier-events"><h2 className="panel-title">Recent events</h2><div className="timeline"><div className="tl-item"><i /><div><b>Run submitted to planning workflow</b><small>{relativeTime(run.submitted_at)}</small></div></div><div className="tl-item"><i /><div><b>Current state projected as {statusLabel(run.status)}</b><small>now</small></div></div>{run.artifacts.map((item) => <button key={item.kind} className={`tl-item evidence-event ${artifact?.kind === item.kind ? "selected" : ""}`} onClick={() => void openEvidence(item)}><i /><span><b>{statusLabel(item.kind)} evidence verified</b><small>{item.sha256.slice(0, 12)}</small></span></button>)}</div>{error && <p className="evidence-error" role="alert">{error}</p>}{evidence && <pre aria-label="Verified evidence">{evidence}</pre>}</section></div>}
      {tab === "log" && <section className="card log-card"><p><span>{new Date(run.submitted_at).toISOString()}</span> <b>[relay]</b> Run submitted to authoritative planning workflow</p><p><span>{new Date().toISOString()}</span> <b>[projection]</b> Stage {stage} rendered from server state</p></section>}
      {tab === "configuration" && <section className="codeblock"><pre>{JSON.stringify({ run_id: run.run_id, project_id: run.project_id, stage, workflow: run.workflow, artifacts: run.artifacts.map((item) => ({ kind: item.kind, sha256: item.sha256 })) }, null, 2)}</pre></section>}
      {tab === "dependencies" && <section className="dependency-list">{run.workflow.map((item) => <div key={item}><span><b>{statusLabel(item)}</b><small>{stageType(item)}</small></span><Pill status={isActiveStage(item, run.active_gate) ? "awaiting" : run.status} /></div>)}</section>}
      {tab === "history" && <section className="card timeline"><div className="tl-item"><i /><div><b>Run submitted</b><small>{relativeTime(run.submitted_at)}</small></div></div><div className="tl-item"><i /><div><b>Current projection loaded</b><small>now</small></div></div></section>}
      {run.active_gate && <DecisionControls client={client} run={run} onComplete={onRefresh} />}
    </div>
  </section>;
}

export function App({ client = apiClient }: { client?: ApiClient }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<Run | null>(null);
  const [view, setView] = useState<View>("mission");
  const [activeNavItem, setActiveNavItem] = useState<NavItem>("Mission Control");
  const [stage, setStage] = useState("planning");
  const [etag, setEtag] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const [pollDelay, setPollDelay] = useState(15_000);
  const refreshGeneration = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current; activeRequest.current?.abort(); const controller = new AbortController(); activeRequest.current = controller;
    try { const result = await client.listRuns(etag, controller.signal); if (generation !== refreshGeneration.current) return; if (!result.unchanged) { setRuns(result.runs); setSelected((current) => result.runs.find((item) => item.run_id === current?.run_id) ?? result.runs[0] ?? null); } setEtag(result.etag ?? undefined); setError(null); setPollDelay(15_000); }
    catch (reason) { if (reason instanceof DOMException && reason.name === "AbortError") return; if (generation === refreshGeneration.current) { setError(reason instanceof Error ? reason.message : "Mission Control is temporarily unavailable."); setPollDelay((delay) => Math.min(delay * 2, 120_000)); } }
    finally { if (activeRequest.current === controller) activeRequest.current = null; }
  }, [client, etag]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { const interval = window.setInterval(() => void refresh(), pollDelay); return () => window.clearInterval(interval); }, [pollDelay, refresh]);
  useEffect(() => { const onFocus = () => void refresh(); window.addEventListener("focus", onFocus); return () => window.removeEventListener("focus", onFocus); }, [refresh]);
  useEffect(() => () => activeRequest.current?.abort(), []);
  const openWorkflow = (run: Run) => { setSelected(run); setStage(run.workflow[0] ?? "planning"); setActiveNavItem("Runs"); setView("workflow"); };
  const selectedRun = selected ?? runs[0] ?? null;
  const content = useMemo(() => {
    if (view === "workflow" && selectedRun) return <WorkflowCanvas run={selectedRun} onBack={() => { setActiveNavItem("Mission Control"); setView("mission"); }} onDossier={(nextStage) => { setStage(nextStage); setView("dossier"); }} />;
    if (view === "dossier" && selectedRun) return <Dossier client={client} run={selectedRun} stage={stage} onBack={() => setView("workflow")} onRefresh={refresh} />;
    return <MissionControl runs={runs} onSelect={openWorkflow} refresh={refresh} />;
  }, [client, refresh, runs, selectedRun, stage, view]);
  return <main className="app-shell"><Sidebar setView={setView} selected={selectedRun} activeItem={activeNavItem} setActiveItem={setActiveNavItem} /><div className="main-content">{error && <p className="app-error" role="alert">{error}</p>}{content}</div></main>;
}
