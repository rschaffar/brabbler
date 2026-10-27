"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { stepProse, type Evidence, type GuidedStep } from "@/lib/guided-review";
import { emptyQuestionDraft, draftAnswer, type QuestionDraft } from "@/lib/question-set";
import { freshReviewDraft, parseReviewDraft, validatePendingReviewWrite, REVIEW_DRAFT_BYTES, type NotebookReviewDraft, type PendingReviewWrite } from "@/lib/notebook-review-drafts";
import { batchPrompt, batches, currentAnswer, currentMark, feedbackItems, reviewedMissing, type Feedback, type FrozenBatch, type Material, type Outcome, type ReviewAnchor, type ReviewOperation, type ReviewTip } from "@/lib/notebook-review";
import type { EvidenceSelection, ReviewBatchDraft, ReviewChatDestination } from "@/lib/review-handoff";
import { FileMarkdownBody } from "./FileMarkdownBody";
import { QuestionFields } from "./QuestionFields";

const id = () => crypto.randomUUID();

export function NotebookReviewPanel({ indexPath, step, selection, destination, onDraftBatch, onResume, onWork, knownSteps, draftOwner, onStepAnchor, displayedAssets = [] }: {
  knownSteps?: { id: string; targets: string[] }[];
  draftOwner?: string; onStepAnchor?: () => void;
  displayedAssets?: { target: Evidence; contentDigest: string | null }[];
  indexPath: string; step: GuidedStep; selection: { target?: Evidence; selection?: EvidenceSelection } | null;
  destination?: ReviewChatDestination; onDraftBatch?: ReviewBatchDraft; onResume: (stepId: string) => void; onWork?: (work: Promise<unknown>) => void;
}) {
  const [tip, setTip] = useState<ReviewTip | null>(null), tipRef = useRef(tip); tipRef.current = tip;
  const [enabled, setEnabled] = useState(false), [inspected, setMaterial] = useState<Material | null>(null);
  const material = inspected?.stepId === step.id ? inspected : null;
  const [status, setStatus] = useState("Reading only — no writes enabled"), [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<NotebookReviewDraft>(freshReviewDraft), draftRef = useRef(draft); draftRef.current = draft;
  const [storage, setStorage] = useState(true), [hydrated, setHydrated] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [owner] = useState(() => draftOwner ?? id());
  const radioScope = useId();
  const [recoveries, setRecoveries] = useState<{ key: string; raw: string }[]>([]), [recoveryChoice, setRecoveryChoice] = useState("");
  const [corruptDraft, setCorruptDraft] = useState<string | null>(null), recoveryBlocked = useRef(false);
  const alive = useRef(true), generation = useRef(0), pendingWork = useRef(false), stepRef = useRef(step.id); stepRef.current = step.id;
  const observer = useRef(onWork); observer.current = onWork;
  const recoveryPrefix = `pi-notebook-review-draft-v2:${encodeURIComponent(indexPath)}:`;
  const key = `${recoveryPrefix}${encodeURIComponent(owner)}`;
  useEffect(() => {
    alive.current = true;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        try { const value = parseReviewDraft(raw); draftRef.current = value; setDraft(value); if (value.pending) setStatus("Recoverable unsaved/possibly committed operation — reload record to reconcile before retry"); }
        catch { recoveryBlocked.current = true; setCorruptDraft(raw.slice(0, REVIEW_DRAFT_BYTES)); setStorage(false); setStatus("Malformed/oversized browser recovery record preserved, not applied. Export it before explicitly discarding it."); }
      }
    } catch { setStorage(false); }
    setHydrated(true);
    const navigationGeneration = generation;
    return () => { alive.current = false; ++navigationGeneration.current; };
  }, [key]);
  useEffect(() => { if (!hydrated || recoveryBlocked.current) return; try { const raw = JSON.stringify(draft); parseReviewDraft(raw); localStorage.setItem(key, raw); } catch { setStorage(false); } }, [draft, key, hydrated]);
  const endpoint = `/api/review-data?${new URLSearchParams({ index: indexPath })}`;
  const request = useCallback(async <T,>(body?: unknown): Promise<T> => {
    const response = await fetch(endpoint, { method: body ? "POST" : "GET", cache: "no-store", ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    const value = await response.json();
    if (!response.ok) throw Object.assign(new Error(`${value.possiblyCommitted ? "Possibly committed — " : response.status === 409 ? "Conflict — " : ""}${value.error ?? response.status}`), { reviewResponse: true });
    return value as T;
  }, [endpoint]);
  const observe = (work: Promise<unknown>) => { observer.current?.(work); return work; };
  const inspect = useCallback(async (stepId: string) => {
    const gen = ++generation.current; setMaterial(null);
    try { const m = await request<Material>({ action: "inspect", stepId }); if (alive.current && generation.current === gen && stepRef.current === stepId) setMaterial(m); }
    catch (e) { if (alive.current && generation.current === gen) setStatus(`Unavailable: ${e instanceof Error ? e.message : e}`); }
  }, [request]);
  const loaded = tip !== null;
  useEffect(() => { if (loaded) { const work = inspect(step.id); observer.current?.(work); } }, [step.id, loaded, inspect]);

  const save = async (pending: PendingReviewWrite): Promise<boolean> => {
    if (pendingWork.current || !tipRef.current) return false;
    try { validatePendingReviewWrite(pending); } catch (error) { setStatus(`Invalid retained operation: ${error instanceof Error ? error.message : error}`); return false; }
    pendingWork.current = true; setBusy(true); setStatus("Saving…");
    const retained = { ...draftRef.current, pending }; draftRef.current = retained; setDraft(retained);
    // Persist intent synchronously BEFORE admission; storage denial never changes server authority.
    try { if (!recoveryBlocked.current) { const raw = JSON.stringify(retained); parseReviewDraft(raw); localStorage.setItem(key, raw); } } catch { setStorage(false); }
    try {
      const value = await request<ReviewTip>({ ...pending, expected: { sequence: tipRef.current.sequence, digest: tipRef.current.digest } });
      if (alive.current) { tipRef.current = value; setTip(value); setDraft(d => ({ ...d, pending: null })); setStatus(`Saved · revision ${value.sequence}`); }
      return alive.current;
    } catch (e) { if (alive.current) setStatus(`${e instanceof Error && "reviewResponse" in e ? "" : "Possibly committed / no acknowledgement — "}${e instanceof Error ? e.message : e} — draft retained. Reload record before retry; no automatic overwrite.`); return false; }
    finally { pendingWork.current = false; if (alive.current) setBusy(false); }
  };
  const append = (operation: ReviewOperation) => save({ action: "append", operation, submissionId: id() });
  const load = async (enable: boolean) => {
    if (pendingWork.current) return;
    pendingWork.current = true; setBusy(true);
    const originatingStep = stepRef.current;
    try {
      const value = await request<ReviewTip>(); if (!alive.current) return;
      tipRef.current = value; setTip(value);
      const pending = draftRef.current.pending;
      const committed = pending && value.state.events.find(e => e.submissionId === pending.submissionId);
      if (committed) {
        if (pending.action === "append" && JSON.stringify(committed.operation) !== JSON.stringify(pending.operation)) throw new Error("Submission identity conflict; retained draft differs from history");
        if (pending.action === "import") {
          if (committed.operation.kind !== "import" || committed.operation.batchId !== pending.batchId) throw new Error("Reply submission/batch identity conflict; retained draft differs from history");
          if (pending.text !== undefined) {
            const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pending.text));
            const digest = Array.from(new Uint8Array(bytes)).map(byte => byte.toString(16).padStart(2, "0")).join("");
            if (digest !== committed.operation.digest) throw new Error("Reply submission bytes differ from the immutable imported digest");
            if (!alive.current) return;
          }
        }
        setDraft(d => ({ ...d, pending: null })); setStatus("Saved — reconciled exact submission ID in history");
      } else setStatus(pending ? "Unsaved operation retained; inspect history then explicitly retry or discard it" : value.sequence ? `Saved · revision ${value.sequence} · reading record` : "No saved review record; reading only");
      const resume = value.state.events.findLast(e => e.operation.kind === "resume")?.operation;
      if (resume?.kind === "resume" && stepRef.current === originatingStep) onResume(resume.stepId);
      setEnabled(enable);
      pendingWork.current = false; setBusy(false);
      if (enable && !value.sequence && !pending) await append({ kind: "enable" });
    } catch (e) { if (alive.current) setStatus(`Review record unavailable: ${e instanceof Error ? e.message : e}`); }
    finally { pendingWork.current = false; if (alive.current) setBusy(false); }
  };
  // Coalesce navigation while another write owns admission. Resume is separate from review marks.
  useEffect(() => {
    if (!enabled || !tip || busy || draft.pending) return;
    const last = tip.state.events.findLast(e => e.operation.kind === "resume")?.operation;
    if (last?.kind === "resume" && last.stepId === step.id) return;
    const work = append({ kind: "resume", stepId: step.id }); observer.current?.(work);
    // append owns current refs; this effect deliberately follows settled revision and selected step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, tip, busy, step.id, draft.pending]);
  const state = tip?.state ?? { events: [] }, items = feedbackItems(state), batchList = batches(state);
  const preview = batchList.find(b => b.id === draft.previewBatchId) ?? null;
  const replyText = preview ? draft.replies.find(r => r.batchId === preview.id)?.text ?? "" : "";
  const writable = enabled && !busy && !draft.pending;
  const normalizeProse = (s: string) => stepProse(s).replace(/\r\n?/g, "\n").split("\n").map(l => l.trimEnd()).join("\n").trim();
  const displayMatches = !!material && material.title === step.title && material.prose === normalizeProse(step.markdown) && JSON.stringify(material.targets.map(t => t.definition)) === JSON.stringify(step.targets) && JSON.stringify(material.questions.map(q => q.definition)) === JSON.stringify(step.questions ?? []);
  const displayBytesMatch = !!material && displayedAssets.every(asset => !!asset.contentDigest && material.targets.some(t => JSON.stringify(t.definition) === JSON.stringify(asset.target) && t.contentDigest === asset.contentDigest));
  const canRecordGuidance = writable && displayMatches;
  const canRecordMaterial = canRecordGuidance && displayBytesMatch && !!material?.fingerprint;
  const mark = currentMark(state, step.id, material?.fingerprint ?? null);
  const captureAnchor = (): ReviewAnchor | null => {
    if (!material?.fingerprint) return null;
    const t = selection?.target && material.targets.find(t => t.definition.id === selection.target!.id);
    if (selection?.target && !t?.fingerprint) return null;
    return { stepId: step.id, fingerprint: material.fingerprint, ...(t ? { target: t.definition, targetFingerprint: t.fingerprint! } : {}), ...(selection?.selection ? { selection: selection.selection } : {}) };
  };
  const prepare = async () => {
    if (!destination || !tip) return;
    const batch: FrozenBatch = { id: id(), items: items.filter(i => selected.includes(i.id)), materials: [], destination: { ...destination }, replyPath: `${tip.directory}/replies/PLACEHOLDER.json` };
    batch.replyPath = `${tip.directory}/replies/${batch.id}.json`;
    for (const item of batch.items) {
      const material = state.events.findLast(e => e.material?.stepId === item.anchor.stepId && (item.anchor.basis === "guidance" ? e.material?.guidanceFingerprint : e.material?.fingerprint) === item.anchor.fingerprint)?.material;
      if (material && !batch.materials.some(m => m.guidanceFingerprint === material.guidanceFingerprint && m.fingerprint === material.fingerprint && m.stepId === material.stepId)) batch.materials.push(material);
    }
    if (await append({ kind: "prepare", batch })) setDraft(d => ({ ...d, previewBatchId: batch.id }));
  };
  const draftBatch = async () => {
    if (!preview || !onDraftBatch || pendingWork.current || draftRef.current.pending || !enabled) return;
    try {
      onDraftBatch(preview.destination, batchPrompt(preview)); // Current shell validates captured session BEFORE insertion.
      setStatus("Added to chat draft, NOT sent. Use normal chat Send as a second explicit action.");
      await append({ kind: "drafted", batchId: preview.id });
    } catch (e) { setStatus(`${e instanceof Error ? e.message : e} — preview retained`); }
  };
  return <section className="notebook-review-panel" aria-label="Review recording">
    <h3>Reviewer record</h3>
    <p>Notebook: <code>{indexPath}</code><br />Review data: <code>{tip?.directory ?? `${indexPath.slice(0, indexPath.lastIndexOf("/"))}/review-data`}</code></p>
    <p>Local files only. Never automatically staged, committed or published. Reading, answering and agent replies are not review approval.</p>
    <div className="guided-target-controls"><button type="button" disabled={busy} onClick={() => observe(load(false))}>Load saved review record</button>
      <button type="button" disabled={busy || enabled} onClick={() => observe(load(true))}>Enable review recording</button>
      {tip && <button type="button" disabled={busy} onClick={() => observe(inspect(step.id))}>Refresh current step identities</button>}
    </div>
    <p role="status">{status}</p>{!storage && <p role="alert">Browser draft recovery unavailable. Copy the recovery JSON before leaving.</p>}
    {draft.pending && <div><button type="button" disabled={busy || !tip || !enabled} onClick={() => observe(save(draft.pending!))}>Retry retained operation after reload</button><button type="button" disabled={busy} onClick={() => setDraft(d => ({ ...d, pending: null }))}>Discard pending operation (keeps field drafts)</button></div>}
    {corruptDraft !== null && <details open><summary>Preserved malformed browser recovery (preview up to 2 MiB; original browser key unchanged)</summary><textarea readOnly rows={6} value={corruptDraft} /><button type="button" onClick={() => {
      try {
        // Replace the rejected record only after validating and persisting the
        // current fields. Clearing a ref/warning alone does not rerun autosave.
        const raw = JSON.stringify(draftRef.current); parseReviewDraft(raw); localStorage.setItem(key, raw);
        recoveryBlocked.current = false; setCorruptDraft(null); setStorage(true);
      } catch { setStorage(false); }
    }}>Discard malformed browser recovery only (keeps current fields)</button></details>}
    <details><summary>Recover drafts from another pane or previous activation</summary><p>Each file view owns a separate browser recovery record. Loading a copy here never changes the other pane&apos;s record.</p><button type="button" onClick={() => {
      try { const entries: { key: string; raw: string }[] = []; const count = localStorage.length;
        if (count > 256) throw new Error("More than 256 browser storage keys; use browser storage export (no keys removed)");
        for (let i = 0; i < count; i++) { const candidate = localStorage.key(i)!; if (candidate !== key && (candidate.startsWith(recoveryPrefix) || candidate === `pi-notebook-review-draft-v1:${indexPath}`)) { const raw = localStorage.getItem(candidate); if (raw !== null) entries.push({ key: candidate, raw: raw.slice(0, REVIEW_DRAFT_BYTES) }); } }
        setRecoveries(entries); setRecoveryChoice("");
      } catch (e) { setStatus(`Recovery inventory unavailable: ${e instanceof Error ? e.message : e}`); }
    }}>List other recovery records</button><label>Recovery record<select value={recoveryChoice} onChange={e => setRecoveryChoice(e.target.value)}><option value="">Choose a preserved record</option>{recoveries.map(r => <option key={r.key} value={r.key}>{r.key}</option>)}</select></label>
      {recoveryChoice && <><textarea readOnly rows={5} aria-label="Selected recovery preview" value={recoveries.find(r => r.key === recoveryChoice)?.raw ?? ""} /><button type="button" onClick={() => {
        try { const value = parseReviewDraft(localStorage.getItem(recoveryChoice) ?? ""); setDraft(value); setStatus("Recovery copy loaded into this pane; original preserved. Pending writes require reload reconciliation and explicit activation."); setEnabled(false); }
        catch (e) { setStatus(`Recovery preserved but not applied: ${e instanceof Error ? e.message : e}`); }
      }}>Copy selected recovery here (replaces these local fields; original retained)</button></>}
    </details>
    <details><summary>Recoverable drafts and full saved history (including deleted anchors)</summary><label>Copy/export recovery JSON<textarea readOnly value={JSON.stringify({ indexPath, draft, history: state }, null, 2)} rows={8} /></label></details>
    {tip && <>
      {material && <p>Current dependency identity: <code>{material.fingerprint ?? "Unavailable"}</code></p>}
      {material && !displayMatches && <p role="alert">Guide changed on disk. The old reader has NOT been rebound. Return to the document and reload the notebook before recording new decisions; historical feedback remains editable.</p>}
      {material && !displayBytesMatch && <p role="alert">Displayed mutable evidence does not match the inspected bytes (or is still loading). Reload displayed evidence and refresh identities before recording; old snapshots are not silently rebound.</p>}
      <details><summary>All review history — including deleted steps/questions</summary><ol>{state.events.map(e => <li key={e.submissionId}><details><summary>{e.operation.kind} · {e.material?.title ?? ("stepId" in e.operation ? e.operation.stepId : "batch/item history")} · {e.submissionId}</summary><pre>{JSON.stringify(e, null, 2)}</pre></details></li>)}</ol></details>
      <details><summary>Step answer and mark history</summary>{state.events.filter(e => (e.operation.kind === "answer" || e.operation.kind === "mark") && e.operation.stepId === step.id).map(e => <p key={e.submissionId}>{e.operation.kind === "answer" ? `${e.operation.questionId}: ${JSON.stringify(e.operation.outcome)}` : e.operation.kind === "mark" ? e.operation.mark : ""} · {"fingerprint" in e.operation ? e.operation.fingerprint : ""}</p>)}</details>
      <p>Step state: <strong>{mark.mark}</strong>{mark.stale && (mark.unavailableContext ? " · Guidance-only record — fresh material review needed" : " · Changed — re-review needed (old mark retained)")}{material?.fingerprint === null && " · Unavailable (not a content-change claim)"}</p>
      <div className="guided-target-controls">{(["Not reviewed", "In progress", "Needs attention", "Reviewed"] as const).map(value => <button key={value} type="button" disabled={value === "Reviewed" ? !canRecordMaterial || reviewedMissing(state, material!).length > 0 : !canRecordGuidance} onClick={() => observe(append({ kind: "mark", stepId: step.id, fingerprint: canRecordMaterial ? material!.fingerprint! : material!.guidanceFingerprint, mark: value, ...(!canRecordMaterial ? { basis: "guidance" as const } : {}) }))}>{value}</button>)}</div>
      {!!material && reviewedMissing(state, material).length > 0 && <p>Reviewed needs a current recorded outcome for: {reviewedMissing(state, material).map(q => q.definition.shortLabel).join(", ")}. Back/Next remain free; unsure, not-applicable and skip count.</p>}
      {material?.fingerprint === null && <p>Reviewed and affirmative answers require available, matching evidence. You can still record guidance-only progress, step questions/guide issues, and explicit unsure/not-applicable/skip outcomes. These do not claim missing bytes were inspected.</p>}
      {material?.unavailable.map(message => <p role="alert" key={message}>{message}</p>)}
      {(material?.questions ?? []).map(q => {
        const recordKey = JSON.stringify([step.id, q.definition.id, q.fingerprint]);
        const local = draft.questions.find(d => d.key === recordKey), saved = currentAnswer(state, step.id, q.definition.id, q.fingerprint);
        const outcome = local?.outcome ?? saved?.outcome.kind ?? "answer";
        const answer = saved?.outcome.kind === "answer" ? saved.outcome.answer : null;
        const fields = local?.draft ?? (answer ? { ...emptyQuestionDraft(q.definition), writing: answer.kind === "freeform", text: answer.kind === "freeform" ? answer.text : "", selections: answer.kind === "selection" ? answer.selections : [], comment: "comment" in answer ? answer.comment ?? "" : "" } : emptyQuestionDraft(q.definition));
        const update = (patch: Partial<QuestionDraft>, kind = outcome) => setDraft(d => ({ ...d, questions: [...d.questions.filter(r => r.key !== recordKey), { key: recordKey, draft: { ...fields, skipped: false, ...patch }, outcome: kind }] }));
        const normalized = draftAnswer(q.definition, fields);
        return <section key={recordKey} aria-label={`Authored question: ${q.definition.shortLabel}`}><h4>{q.definition.question}</h4>
          <QuestionFields question={q.definition} draft={fields} name={`${radioScope}:${recordKey}`} update={p => update(p, "answer")} disabled={!enabled || busy || !material?.fingerprint} allowSkip={false} renderContext={context => <FileMarkdownBody markdown={context} images={false} reviewCards={false} onWork={onWork} />} />
          <label>Recorded outcome<select value={outcome} disabled={!enabled || busy} onChange={e => update({}, e.target.value as Outcome["kind"])}><option value="answer">Answer</option><option value="unsure">Unsure</option><option value="not-applicable">Not applicable</option><option value="skip">Skip</option></select></label>
          <button type="button" disabled={outcome === "answer" ? !canRecordMaterial || !normalized : !(canRecordMaterial || canRecordGuidance && material?.fingerprint === null)} onClick={() => observe(append({ kind: "answer", stepId: step.id, questionId: q.definition.id, fingerprint: q.fingerprint, outcome: outcome === "answer" ? { kind: "answer", answer: normalized! } : { kind: outcome } }))}>Record outcome</button>
          <p>{saved ? `Recorded: ${saved.outcome.kind}` : "No current recorded outcome"}{local ? " · local draft retained" : ""}</p>
          {q.definition.explanation && <details><summary>Reveal author explanation (not grading)</summary><p>Author guidance: {q.definition.explanation}</p></details>}
        </section>;
      })}
      <section aria-label="New feedback"><h4>{draft.editing ? `Edit feedback ${draft.editing.id}` : "Questions, findings and guide issues"}</h4>
        <p>Current anchor: {selection?.target ? `target ${selection.target.title}` : "step"}{selection?.selection ? " · selected text/lines" : " · target-level only for images/PDF/web (no region coordinates)"}</p>
        <button type="button" disabled={!canRecordGuidance || !!draft.editing} onClick={() => { onStepAnchor?.(); setDraft(d => ({ ...d, anchor: { stepId: step.id, fingerprint: canRecordMaterial ? material!.fingerprint! : material!.guidanceFingerprint, ...(!canRecordMaterial ? { basis: "guidance" as const } : {}) } })); }}>Anchor to this step</button>
        <button type="button" disabled={!canRecordMaterial || !!draft.editing} onClick={() => setDraft(d => ({ ...d, anchor: captureAnchor() }))}>Capture current anchor</button>
        <label>Feedback kind<select value={draft.kind} onChange={e => setDraft(d => ({ ...d, kind: e.target.value as Feedback["kind"] }))}><option value="question">Question</option><option value="finding">Finding</option><option value="guide-issue">Guide issue</option></select></label>
        <label>Feedback text<textarea value={draft.text} maxLength={20_000} rows={3} onChange={e => setDraft(d => ({ ...d, text: e.target.value }))} /></label>
        {draft.anchor && <pre>{JSON.stringify(draft.anchor, null, 2)}</pre>}
        {draft.anchor?.basis === "guidance" && draft.kind === "finding" && <p role="note">Guidance-only anchors support questions or guide issues, not findings. Choose one to save; these local draft fields remain recoverable.</p>}
        <button type="button" disabled={!writable || !draft.text.trim() || !draft.anchor || draft.anchor.basis === "guidance" && draft.kind === "finding" || !draft.editing && !(draft.anchor?.basis === "guidance" ? canRecordGuidance && draft.kind !== "finding" : canRecordMaterial)} onClick={() => observe((async () => {
          const item: Feedback = { id: draft.editing?.id ?? id(), version: (draft.editing?.version ?? 0) + 1, kind: draft.kind, text: draft.text, anchor: draft.anchor!, resolved: draft.editing?.resolved ?? false };
          const submittedFields = JSON.stringify([draft.text, draft.kind, draft.anchor, draft.editing]);
          if (await append({ kind: "feedback", item })) setDraft(d => JSON.stringify([d.text, d.kind, d.anchor, d.editing]) === submittedFields ? { ...d, text: "", editing: null, anchor: null } : d);
        })())}>Save feedback</button><button type="button" onClick={() => setDraft(d => ({ ...d, editing: null, anchor: null }))}>New item / keep text</button>
      </section>
      <section aria-label="Cross-chapter review tray"><h4>Review tray · all chapters</h4>{items.map(item => <article key={item.id}>
        <label><input type="checkbox" checked={selected.includes(item.id)} onChange={e => setSelected(s => e.target.checked ? [...s, item.id] : s.filter(i => i !== item.id))} />Select {item.kind} · {item.anchor.stepId} · v{item.version} · {item.resolved ? "Resolved" : "Open"}</label>
        <p>{item.text}</p>
        {knownSteps && (!knownSteps.some(s => s.id === item.anchor.stepId) || item.anchor.target && !knownSteps.some(s => s.id === item.anchor.stepId && s.targets.includes(item.anchor.target!.id))) && <p>Orphan/deleted step or target — original anchor retained</p>}
        {material?.stepId === item.anchor.stepId && material.fingerprint && material.fingerprint !== item.anchor.fingerprint && <p>Changed context — original anchor retained, never rebased</p>}
        <details><summary>Exact immutable anchor / history</summary><pre>{JSON.stringify(item.anchor, null, 2)}</pre><ol>{state.events.flatMap(e => e.operation.kind === "feedback" && e.operation.item.id === item.id ? [<li key={e.submissionId}>v{e.operation.item.version} · {e.operation.item.kind}: {e.operation.item.text}</li>] : e.operation.kind === "resolve" && e.operation.id === item.id ? [<li key={e.submissionId}>v{e.operation.version + 1} · Reviewer {e.operation.resolved ? "resolved" : "reopened"}</li>] : [])}</ol></details>
        <button type="button" disabled={!writable} onClick={() => setDraft(d => ({ ...d, editing: item, text: item.text, kind: item.kind, anchor: item.anchor }))}>Edit item</button>
        <button type="button" disabled={!writable} onClick={() => observe(append({ kind: "resolve", id: item.id, version: item.version, resolved: !item.resolved }))}>{item.resolved ? "Reopen" : "Resolve"} (reviewer only)</button>
        {state.events.flatMap(e => e.operation.kind === "import" ? e.operation.reply.items.filter(r => r.id === item.id).map(r => <aside key={`${e.submissionId}:${r.id}`}><strong>Agent reply · investigated v{r.version}{r.version !== item.version ? " · historical/stale item version" : ""}</strong><p>{r.response}</p><p>Evidence: {r.evidence}</p><p>Proposed changes: {r.proposedChanges}</p></aside>) : [])}
      </article>)}
      <p>Destination: {destination ? `${destination.label} · ${destination.id}` : "No existing selected chat. Select one; this workflow never starts a session."} Selection sends nothing.</p>
      <button type="button" disabled={!writable || !selected.length || !destination || !onDraftBatch} onClick={() => observe(prepare())}>Prepare in chat</button>
      {batchList.map(batch => <div key={batch.id} data-review-batch={batch.id}><button type="button" onClick={() => setDraft(d => ({ ...d, previewBatchId: batch.id }))}>Preview batch {batch.id}</button><span> · {state.events.some(e => e.operation.kind === "drafted" && e.operation.batchId === batch.id) ? "Drafted in chat, not confirmed sent" : "Prepared, not drafted"}</span>
        {state.events.filter(e => e.operation.kind === "import" && e.operation.batchId === batch.id).map(e => e.operation.kind === "import" && <p key={e.submissionId}>Imported {e.operation.reply.items.length}/{batch.items.length} items · {e.operation.reply.items.length < batch.items.length ? "Incomplete/partial reply" : "Complete item coverage (not resolution)"} · immutable bytes {e.operation.digest}</p>)}
      </div>)}
      </section>
      {preview && <section aria-label="Frozen batch preview"><h4>Exact batch preview — {preview.destination.label} · {preview.destination.id}</h4><p>Reply destination: {preview.replyPath}</p><pre>{batchPrompt(preview)}</pre>
        <button type="button" disabled={!writable || !onDraftBatch} onClick={() => observe(draftBatch())}>Add batch to chat draft</button><p>Preserves existing unsent text/images, appends a delimited batch. Nothing sent or executed; normal chat Send is a second action.</p>
        <button type="button" disabled={!writable} onClick={() => observe(save({ action: "import", batchId: preview.id, submissionId: id() }))}>Import agent reply file</button>
        <label>JSON reply import fallback<textarea rows={5} value={replyText} maxLength={256 * 1024} onChange={e => setDraft(d => ({ ...d, replies: [...d.replies.filter(r => r.batchId !== preview.id), { batchId: preview.id, text: e.target.value }] }))} /></label><button type="button" disabled={!writable || !replyText} onClick={() => observe(save({ action: "import", batchId: preview.id, text: replyText, submissionId: id() }))}>Import pasted JSON reply</button>
      </section>}
    </>}
  </section>;
}
