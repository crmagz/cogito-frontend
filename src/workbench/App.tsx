import { useCallback, useEffect, useState } from "react";

import { apiClient, type ApiClient, type Artifact, type Run } from "./client";
import { DecisionControls } from "./DecisionControls";

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function MissionControl({ runs, selected, onSelect }: { runs: Run[]; selected: string | null; onSelect: (run: Run) => void }) {
  return (
    <section className="relay-panel mission" aria-labelledby="mission-control-title">
      <div className="panel-heading"><p>Authoritative inventory</p><h1 id="mission-control-title">Mission Control</h1></div>
      <table>
        <thead><tr><th>Run</th><th>Status</th><th>Gate</th><th>Submitted</th></tr></thead>
        <tbody>
          {runs.map((run) => <tr key={run.run_id} className={selected === run.run_id ? "selected" : ""}>
            <td><button className="run-link" onClick={() => onSelect(run)}>{run.run_id.slice(0, 8)}</button></td>
            <td><span className="status">{statusLabel(run.status)}</span></td>
            <td>{run.active_gate ?? "—"}</td><td>{new Date(run.submitted_at).toLocaleString()}</td>
          </tr>)}
        </tbody>
      </table>
    </section>
  );
}

function Workflow({ run }: { run: Run | null }) {
  return <section className="relay-panel workflow" aria-labelledby="workflow-title">
    <div className="panel-heading"><p>Server-projected stages</p><h2 id="workflow-title">Workflow relay</h2></div>
    {run ? <ol className="stage-grid">{run.workflow.map((stage, index) => <li key={stage} className={stage.endsWith("approval") ? "gate" : ""}><span>{String(index + 1).padStart(2, "0")}</span>{statusLabel(stage)}</li>)}</ol> : <p>Select a run to inspect its authoritative workflow.</p>}
  </section>;
}

function Dossier({ client, run }: { client: ApiClient; run: Run | null }) {
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [evidence, setEvidence] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setArtifact(null); setEvidence(""); setError(null); }, [run?.run_id]);
  async function openEvidence(next: Artifact) {
    if (!run) return;
    setArtifact(next); setError(null);
    try { setEvidence((await client.getEvidence(run.run_id, next)).content); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Evidence is unavailable."); }
  }
  return <section className="relay-panel dossier" aria-labelledby="dossier-title">
    <div className="panel-heading"><p>Scoped immutable evidence</p><h2 id="dossier-title">Dossier</h2></div>
    {!run ? <p>Select a run to inspect evidence.</p> : <>
      <div className="artifact-list">{run.artifacts.map((item) => <button key={item.kind} className={artifact?.kind === item.kind ? "selected" : ""} onClick={() => void openEvidence(item)}>{item.kind}<small>{item.sha256.slice(0, 12)}</small></button>)}</div>
      {error && <p role="alert">{error}</p>}
      {evidence && <pre aria-label="Verified evidence">{evidence}</pre>}
    </>}
  </section>;
}

export function App({ client = apiClient }: { client?: ApiClient }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<Run | null>(null);
  const [etag, setEtag] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const result = await client.listRuns(etag);
      if (!result.unchanged) { setRuns(result.runs); setSelected((current) => result.runs.find((item) => item.run_id === current?.run_id) ?? result.runs[0] ?? null); }
      setEtag(result.etag ?? undefined); setError(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Mission Control is temporarily unavailable."); }
  }, [client, etag]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { const onFocus = () => void refresh(); window.addEventListener("focus", onFocus); return () => window.removeEventListener("focus", onFocus); }, [refresh]);
  return <main>
    <aside><p className="brand">COGITO</p><nav aria-label="Workbench navigation"><a href="#mission">Mission Control</a><a href="#workflow">Workflow</a><a href="#dossier">Dossier</a><span aria-disabled="true">Telemetry — coming soon</span><span aria-disabled="true">Logs — coming soon</span></nav></aside>
    <div className="workbench"><header><p>Operator workbench / project-scoped</p><button onClick={() => void refresh()}>Refresh authoritative state</button></header>
      {error && <p role="alert">{error}</p>}
      <MissionControl runs={runs} selected={selected?.run_id ?? null} onSelect={setSelected} />
      <div className="lower"><Workflow run={selected} /><Dossier client={client} run={selected} /></div>
      {selected && <DecisionControls client={client} run={selected} onComplete={refresh} />}
    </div>
  </main>;
}
