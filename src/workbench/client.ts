export type Artifact = { kind: "source" | "plan" | "implementation"; sha256: string };
export type Run = {
  run_id: string;
  project_id: string;
  status: string;
  submitted_at: string;
  active_gate: "plan" | "implementation" | null;
  artifacts: Artifact[];
  abilities: string[];
  workflow: string[];
};

export type ApiClient = {
  listRuns: (etag?: string, signal?: AbortSignal) => Promise<{ runs: Run[]; revision: string; etag: string | null; unchanged: boolean }>;
  getEvidence: (runId: string, artifact: Artifact) => Promise<{ content: string; sha256: string }>;
  decide: (run: Run, decision: "approve" | "reject" | "request_revision", comment?: string) => Promise<void>;
};

const base = "/api/cogito/api/v1";
const inFlightDecisionKeys = new Map<string, string>();

async function json(response: Response) {
  if (!response.ok) throw new Error(`Authoritative API request failed (${response.status})`);
  return response.json();
}

export const apiClient: ApiClient = {
  async listRuns(etag, signal) {
    const response = await fetch(`${base}/workbench/runs`, { headers: etag ? { "If-None-Match": etag } : {}, signal });
    if (response.status === 304) return { runs: [], revision: etag ?? "", etag: response.headers.get("etag") ?? etag ?? null, unchanged: true };
    const body = await json(response);
    return { runs: body.items, revision: body.revision, etag: response.headers.get("etag"), unchanged: false };
  },
  async getEvidence(runId, artifact) {
    const response = await fetch(
      `${base}/workbench/runs/${encodeURIComponent(runId)}/evidence/${artifact.kind}?artifact_sha256=${encodeURIComponent(artifact.sha256)}`
    );
    return json(response);
  },
  async decide(run, decision, comment) {
    if (!run.active_gate) throw new Error("This run is not awaiting an operator decision");
    if (decision !== "approve" && !comment?.trim()) throw new Error("A rationale is required for this decision");
    const artifact = run.artifacts.find((item) => item.kind === run.active_gate);
    if (!artifact) throw new Error("The authoritative decision artifact is unavailable");
    const fingerprint = `${run.run_id}:${run.active_gate}:${artifact.sha256}:${decision}`;
    const idempotencyKey = inFlightDecisionKeys.get(fingerprint) ?? crypto.randomUUID();
    inFlightDecisionKeys.set(fingerprint, idempotencyKey);
    const response = await fetch(`${base}/coordination/runs/${encodeURIComponent(run.run_id)}/actions/${run.active_gate}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ decision, artifact_sha256: artifact.sha256, comment })
    });
    if (!response.ok) {
      inFlightDecisionKeys.delete(fingerprint);
      throw new Error(`Authoritative API request failed (${response.status})`);
    }
    await json(response);
    // A transport/body failure before this point is ambiguous, so the key remains available for safe replay.
    inFlightDecisionKeys.delete(fingerprint);
  }
};
