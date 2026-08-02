import { useEffect, useRef, useState } from "react";

import type { ApiClient, Run } from "./client";

export function DecisionControls({ client, run, onComplete, onSuccess }: { client: ApiClient; run: Run; onComplete: () => Promise<void>; onSuccess?: () => void }) {
  const [comment, setComment] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const mounted = useRef(false);
  const artifact = run.active_gate ? run.artifacts.find((item) => item.kind === run.active_gate) : null;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function decide(decision: "approve" | "reject" | "request_revision") {
    if (decision !== "approve" && !comment.trim()) {
      setMessage("A rationale is required for this decision");
      return;
    }
    try {
      setPending(true);
      setMessage(null);
      await client.decide(run, decision, comment);
      await onComplete();
      onSuccess?.();
    } catch (error) {
      if (error instanceof Error && error.message.includes("(409)")) {
        try {
          await onComplete();
        } catch {
          // The conflict is still surfaced below if a canonical refresh is temporarily unavailable.
        }
      }
      if (mounted.current) setMessage(error instanceof Error ? error.message : "Decision could not be submitted.");
    } finally {
      if (mounted.current) setPending(false);
    }
  }

  if (!run.active_gate || !run.abilities.includes("approve")) return null;
  return (
    <section aria-label="Approval decision" className="decision-panel">
      <h3>{run.active_gate} approval gate</h3>
      <p className="decision-artifact">
        <span>Exact decision artifact SHA-256</span>
        <code aria-label={`Exact ${run.active_gate} decision artifact SHA-256`}>{artifact?.sha256 ?? "Unavailable"}</code>
      </p>
      {!artifact && <p className="evidence-error" role="alert">The authoritative decision artifact is unavailable; no action can be submitted.</p>}
      <label className="form-field" htmlFor="decision-comment"><span>Rationale for rejection or revision</span>
        <textarea className="form-textarea" id="decision-comment" value={comment} onChange={(event) => setComment(event.target.value)} />
      </label>
      <div className="form-actions decision-actions">
        <button className="button-primary" disabled={pending || !artifact} onClick={() => void decide("approve")}>Approve</button>
        <button className="button-secondary" disabled={pending || !artifact} onClick={() => void decide("request_revision")}>Request revision</button>
        <button className="button-secondary" disabled={pending || !artifact} onClick={() => void decide("reject")}>Reject</button>
      </div>
      <p aria-live="polite">{message}</p>
    </section>
  );
}
