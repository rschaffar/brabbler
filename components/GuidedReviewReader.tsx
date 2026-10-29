"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { parseNotebookIndex, stepProse, type Evidence, type GuidedNotebook, type GuidedStep } from "@/lib/guided-review";
import { getFileDirectory } from "@/lib/file-paths";
import type { OpenFileLink } from "@/lib/file-links";
import type { DiffContext } from "@/lib/diff-context";
import { reviewExplorerUrl } from "@/lib/review-notebook";
import { createDiffReview } from "@/lib/git-diff-review";
import { GuidedReaderState, type NotebookTargetState } from "@/lib/guided-reader-state";
import { isNotebookAssetPath, notebookAssetMime } from "@/lib/guided-review-assets";
import { NotebookBinaryEvidence } from "./NotebookBinaryEvidence";
import { ActiveReviewBlock } from "./ReviewNotebookBlock";
import { CommittedPatchDiff } from "./CommittedPatchDiff";
import { FileMarkdownBody } from "./FileMarkdownBody";
import { CodeBlock, MermaidBlock } from "./MermaidBlock";
import { DelimitedTable } from "./DelimitedTable";
import { NotebookReviewPanel } from "./NotebookReviewPanel";
import { NotebookPaneDivider, NOTEBOOK_DEFAULT_SHARE } from "./NotebookPaneDivider";
import { useI18n } from "@/hooks/useI18n";
import type { EvidenceSelection, ReviewBatchDraft, ReviewChatDestination } from "@/lib/review-handoff";
export interface NotebookChatProps { reviewDraftOwner?: string; reviewDestination?: ReviewChatDestination; onReviewBatchDraft?: ReviewBatchDraft }

async function read<T>(url: string, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const response = await fetch(url, { signal, cache: "no-store" });
  const body = await response.json();
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body as T;
}
type WorkObserver = (work: Promise<unknown>) => void;

/** Ordinary Markdown stays ordinary; the only folder admission is this explicit action. */
export function GuidedReviewEntry({ markdown, ...props }: {
  markdown: string; filePath: string; cwd?: string; onOpenFile?: OpenFileLink; children: ReactNode; onWork?: WorkObserver;
} & NotebookChatProps) {
  const parsed = useMemo(() => {
    // Ordinary documents need no second Markdown parse or notebook size diagnostic.
    // This is negative admission only; any possible marker still uses the strict AST parser.
    if (!markdown.includes("brabbler-notebook")) return { index: null, error: null };
    try { return { index: parseNotebookIndex(markdown), error: null }; }
    catch (error) { return { index: null, error: error instanceof Error ? error.message : "Invalid notebook" }; }
  }, [markdown]);
  if (!parsed.index) return <>{parsed.error && <p role="note">Guided reading unavailable: {parsed.error}</p>}{props.children}</>;
  return <Entry key={`${props.filePath}:${markdown}`} {...props} />;
}
function Entry({ filePath, cwd, onOpenFile, children, onWork, ...chat }: { filePath: string; cwd?: string; onOpenFile?: OpenFileLink; children: ReactNode; onWork?: WorkObserver } & NotebookChatProps) {
  const [active, setActive] = useState(false), trigger = useRef<HTMLButtonElement>(null);
  return <>
    {!active && <button ref={trigger} type="button" className="git-diff-control" onClick={() => setActive(true)}>Start guided reading</button>}
    {active ? <GuidedReviewReader indexPath={filePath} cwd={cwd} onOpenFile={onOpenFile} onWork={onWork} {...chat} onClose={() => {
      setActive(false); queueMicrotask(() => trigger.current?.focus());
    }} /> : children}
  </>;
}

type ReaderProps = { indexPath: string; cwd?: string; onClose: () => void; onOpenFile?: OpenFileLink; onWork?: WorkObserver } & NotebookChatProps;
export function GuidedReviewReader(props: ReaderProps) {
  return <ActiveGuidedReviewReader key={JSON.stringify([props.indexPath, props.cwd])} {...props} />;
}
function ActiveGuidedReviewReader({ indexPath, cwd, onClose, onOpenFile, onWork, reviewDestination, onReviewBatchDraft, reviewDraftOwner }: ReaderProps) {
  const [notebook, setNotebook] = useState<GuidedNotebook | null>(null), [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState(0), [retry, setRetry] = useState(0);
  const { t } = useI18n(), layoutId = useId();
  const [panes, setPanes] = useState({ outline: true, explanation: true, evidence: true });
  const [share, setShare] = useState(NOTEBOOK_DEFAULT_SHARE);
  const revealEvidence = () => setPanes(p => p.evidence ? p : { ...p, evidence: true });
  const [readingState, setReadingState] = useState(() => new GuidedReaderState());
  const workObserver = useRef(onWork); workObserver.current = onWork;
  useEffect(() => {
    const controller = new AbortController();
    setNotebook(null); setError(null); setPosition(0);
    const work = read<GuidedNotebook>(`/api/review-notebook?${new URLSearchParams({ index: indexPath })}`, controller.signal)
      .then(value => { if (!controller.signal.aborted) setNotebook(value); })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Notebook unavailable"); });
    workObserver.current?.(work);
    return () => controller.abort();
  }, [indexPath, cwd, retry]);
  const steps = useMemo(() => notebook?.chapters.flatMap(chapter => chapter.steps.map(step => ({ chapter, step }))) ?? [], [notebook]);
  const current = steps[position];
  const [selection, setSelection] = useState<{ stepId: string; target?: Evidence; selection?: EvidenceSelection } | null>(null);
  const [displayed, setDisplayed] = useState<{ stepId: string; assets: { target: Evidence; contentDigest: string | null }[] } | null>(null);
  const onDisplayed = useCallback((stepId: string, assets: { target: Evidence; contentDigest: string | null }[]) => {
    setDisplayed({ stepId, assets });
    // A text quote belongs to the old displayed snapshot, not just its authored
    // file target. Keep the target-level fallback but require a fresh selection
    // after a body/generation change rather than rebinding old text to new bytes.
    setSelection(current => current?.stepId === stepId && current.target?.kind === "file" && current.selection
      ? { stepId, target: current.target } : current);
  }, []);
  const onSelection = useCallback((stepId: string, target?: Evidence, selection?: EvidenceSelection) => setSelection({ stepId, target, selection }), []);
  return <section className="guided-reader" aria-label="Guided reading">
    <div className="guided-reader-toolbar">
      <button type="button" className="git-diff-control" onClick={onClose}>Return to document</button>
      {notebook && <strong>{notebook.index.title}</strong>}
      <button type="button" className="git-diff-control" disabled={!current || position === 0} onClick={() => setPosition(p => p - 1)}>Back</button>
      <span>{current ? `${position + 1} / ${steps.length}` : ""}</span>
      <button type="button" className="git-diff-control" disabled={!current || position === steps.length - 1} onClick={() => setPosition(p => p + 1)}>Next</button>
    </div>
    {notebook && <div className="guided-layout-controls" role="group" aria-label={t("notebook.layout")}>
      {(["outline", "explanation", "evidence"] as const).map(pane => <button key={pane} type="button" className="git-diff-control"
        aria-pressed={panes[pane]} aria-controls={`${layoutId}-${pane}`} onClick={() => setPanes(p => ({ ...p, [pane]: !p[pane] }))}>{t(`notebook.${pane}`)}</button>)}
      <button type="button" className="git-diff-control" onClick={() => { setPanes({ outline: true, explanation: true, evidence: true }); setShare(NOTEBOOK_DEFAULT_SHARE); }}>{t("notebook.resetLayout")}</button>
    </div>}
    {error ? <p role="alert">{error} <button type="button" onClick={() => { setReadingState(new GuidedReaderState()); setRetry(p => p + 1); }}>Retry</button></p> : !notebook ? <p role="status">Loading declared chapters…</p> : <div className={`guided-reader-layout${panes.outline ? "" : " is-outline-hidden"}`}>
      <nav id={`${layoutId}-outline`} hidden={!panes.outline} aria-label="Chapters and steps" className="guided-outline">{notebook.chapters.map(chapter => <div key={chapter.id}>
        <strong>{chapter.title}</strong><ol>{chapter.steps.map(step => <li key={step.id}><button type="button"
          aria-current={step.id === current?.step.id ? "step" : undefined} onClick={() => setPosition(steps.findIndex(item => item.step.id === step.id))}>{step.title}</button></li>)}</ol>
      </div>)}</nav>
      {current && <StepReader key={`${indexPath}:${current.step.id}`} indexPath={indexPath} chapterPath={current.chapter.path} step={current.step}
        cwd={cwd} onOpenFile={onOpenFile} onWork={onWork} readingState={readingState} onSelection={onSelection} onDisplayed={onDisplayed}
        layout={{ id: layoutId, ...panes, share, setShare, revealEvidence }} />}
    </div>}
    {current && <NotebookReviewPanel draftOwner={reviewDraftOwner} displayedAssets={displayed?.stepId === current.step.id ? displayed.assets : current.step.targets.filter(t => t.kind === "file").map(target => ({ target, contentDigest: null }))} onStepAnchor={() => onSelection(current.step.id)} indexPath={indexPath} step={current.step} selection={selection?.stepId === current.step.id ? selection : null} destination={reviewDestination} onDraftBatch={onReviewBatchDraft} onWork={onWork} knownSteps={steps.map(s => ({ id: s.step.id, targets: s.step.targets.map(t => t.id) }))}
      onResume={stepId => { const p = steps.findIndex(s => s.step.id === stepId); if (p >= 0) setPosition(p); }} />}
  </section>;
}
type NotebookLayout = { id: string; explanation: boolean; evidence: boolean; share: number; setShare: (value: number) => void; revealEvidence: () => void };
function StepReader({ indexPath, chapterPath, step, cwd, onOpenFile, onWork, readingState, onSelection, onDisplayed, layout }: {
  indexPath: string; chapterPath: string; step: GuidedStep; cwd?: string; onOpenFile?: OpenFileLink; onWork?: WorkObserver; readingState: GuidedReaderState; onSelection: (stepId: string, target?: Evidence, selection?: EvidenceSelection) => void;
  onDisplayed: (stepId: string, assets: { target: Evidence; contentDigest: string | null }[]) => void;
  layout: NotebookLayout;
}) {
  const { t } = useI18n();
  const savedStep = readingState.step(step.id, step.targets[0]?.id ?? "");
  const [primary, setPrimary] = useState(savedStep.primary), [secondary, setSecondary] = useState(savedStep.secondary);
  const [snapshots, setSnapshots] = useState<{ key: string; contentDigest: string | null }[]>([]), [evidenceRevision, setEvidenceRevision] = useState(0);
  const [exploration, setExploration] = useState<Evidence | null>(null), heading = useRef<HTMLHeadingElement>(null);
  const stepRoot = useRef<HTMLDivElement>(null), initialExplanation = useRef(layout.explanation);
  useEffect(() => { (initialExplanation.current ? heading.current : stepRoot.current)?.focus(); }, []);
  const folder = getFileDirectory(indexPath), chapterDirectory = getFileDirectory(`${folder}/${chapterPath}`);
  const explore: OpenFileLink = (path, ...args) => {
    if (path.startsWith(`${folder}/`) && isNotebookAssetPath(path)) {
      layout.revealEvidence();
      setExploration({ version: 1, kind: "file", id: "exploration", title: "Exploring working file", path: path.slice(folder.length + 1) });
    }
    else onOpenFile?.(path, ...args);
  };
  const target = (id: string) => step.targets.find(target => target.id === id);
  useEffect(() => { onSelection(step.id, step.targets.find(t => t.id === primary)); }, [step, primary, onSelection]);
  const captureText = (element: HTMLElement, target?: Evidence) => {
    const selected = window.getSelection();
    if (!selected?.rangeCount || !element.contains(selected.anchorNode) || !element.contains(selected.focusNode)) return;
    const quote = selected.toString().slice(0, 8000);
    if (quote) onSelection(step.id, target, { quote, context: element.textContent?.slice(0, 8000) ?? "" });
  };
  const visibleEvidence = [exploration ?? target(primary), target(secondary)].filter((t): t is Evidence => !!t);
  const assets = visibleEvidence.filter(t => t.kind === "file").map(t => ({ generation: evidenceRevision, target: t, contentDigest: snapshots.find(s => s.key === `${evidenceRevision}:${JSON.stringify(t)}`)?.contentDigest ?? null }));
  const assetsKey = JSON.stringify(assets);
  useEffect(() => { onDisplayed(step.id, JSON.parse(assetsKey)); }, [step.id, assetsKey, onDisplayed]);
  return <div className="guided-step-container">
    <div className="guided-split-controls" hidden={!layout.explanation || !layout.evidence} role="group" aria-label={t("notebook.resize")}>
      <button type="button" className="git-diff-control" disabled={layout.share <= 20} onClick={() => layout.setShare(Math.max(20, layout.share - 10))}>{t("notebook.moreEvidence")}</button>
      <button type="button" className="git-diff-control" disabled={layout.share >= 80} onClick={() => layout.setShare(Math.min(80, layout.share + 10))}>{t("notebook.moreExplanation")}</button>
    </div>
    <div ref={stepRoot} tabIndex={-1} aria-label={step.title} className="guided-step" data-split={layout.explanation && layout.evidence}
      style={{ "--guided-prose-share": `${layout.share}fr`, "--guided-evidence-share": `${100 - layout.share}fr` } as CSSProperties}>
    {!layout.explanation && !layout.evidence && <p role="status">{t("notebook.hiddenPanes")}</p>}
    <article id={`${layout.id}-explanation`} hidden={!layout.explanation} className="guided-prose markdown-body" onMouseUp={event => captureText(event.currentTarget)} onKeyUp={event => captureText(event.currentTarget)}>
      <h2 ref={heading} tabIndex={-1}>{step.title}</h2>
      <FileMarkdownBody markdown={stepProse(step.markdown)} baseDir={chapterDirectory} relativeRoot={cwd ?? folder} onOpenFile={explore} images={false} reviewCards={false} onWork={onWork} />
      <button type="button" onMouseDown={event => event.preventDefault()} onClick={event => captureText(event.currentTarget.parentElement!)}>Anchor selected prose text</button>
      <button type="button" className="git-diff-control" onClick={() => { setExploration(null); heading.current?.focus(); }}>Return to current step</button>
    </article>
    <NotebookPaneDivider value={layout.share} onChange={layout.setShare} hidden={!layout.explanation || !layout.evidence}
      controls={`${layout.id}-explanation ${layout.id}-evidence`} />
    <div id={`${layout.id}-evidence`} hidden={!layout.evidence} className="guided-evidence-area">
      <div className="guided-target-controls">
        <label>Evidence <select aria-label="Evidence target" value={primary} onChange={event => { const next = event.target.value; setPrimary(next); savedStep.primary = next; if (secondary === next) { setSecondary(""); savedStep.secondary = ""; } setExploration(null); }}>
          {!step.targets.length && <option value="">No evidence targets</option>}{step.targets.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select></label>
        <button type="button" onClick={() => setEvidenceRevision(r => r + 1)}>Reload displayed evidence</button>
        <label>Compare with <select aria-label="Second evidence target" value={secondary} onChange={event => { setSecondary(event.target.value); savedStep.secondary = event.target.value; setExploration(null); }}>
          <option value="">None</option>{step.targets.filter(t => t.id !== primary).map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select></label>
      </div>
      <div className="guided-evidence-panes">
        {visibleEvidence.map((evidence, i) => <section key={`${evidenceRevision}:${i}:${JSON.stringify(evidence)}`}  className="guided-evidence" aria-label={`${i ? "Second" : "Primary"} evidence: ${evidence.title}`}>
          <h3>{evidence.title}</h3><div onMouseUp={event => { if (evidence.kind === "file" && !notebookAssetMime(evidence.path)) captureText(event.currentTarget, evidence); }}>
            <button type="button" onClick={() => onSelection(step.id, evidence)}>Anchor feedback to this target</button>
            <EvidenceReader target={evidence} indexPath={indexPath} onWork={onWork} onSnapshot={contentDigest => { const key = `${evidenceRevision}:${JSON.stringify(evidence)}`; setSnapshots(s => [...s.filter(e => e.key !== key), { key, contentDigest }].slice(-4)); }} readerState={readingState.target(JSON.stringify(evidence))} onReviewSelection={value => onSelection(step.id, evidence, value ?? undefined)} />
          </div>
        </section>)}
      </div>
    </div>
    </div>
  </div>;
}
export function EvidenceReader({ target, indexPath, onWork, readerState, onReviewSelection, onSnapshot }: { target: Evidence; indexPath: string; onSnapshot?: (contentDigest: string | null) => void; onWork?: WorkObserver; readerState?: NotebookTargetState; onReviewSelection?: (selection: EvidenceSelection | null) => void }) {
  if (target.kind === "source" || target.kind === "commit") return <ActiveReviewBlock block={target} activated onWork={onWork} readerState={readerState} onReviewSelection={onReviewSelection} />;
  if (target.kind === "web") return <p>External reference (link only): <a href={target.url} target="_blank" rel="noopener noreferrer">{target.title}</a></p>;
  if (target.kind === "compare") return <CompareEvidence target={target} onWork={onWork} readerState={readerState} onReviewSelection={onReviewSelection} />;
  if (notebookAssetMime(target.path)) return <NotebookBinaryEvidence indexPath={indexPath} path={target.path} title={target.title} onWork={onWork} onSnapshot={onSnapshot} />;
  return <FileEvidence target={target} indexPath={indexPath} onWork={onWork} onSnapshot={onSnapshot} />;
}
function FileEvidence({ target, indexPath, onWork, onSnapshot }: { target: Extract<Evidence, { kind: "file" }>; indexPath: string; onWork?: WorkObserver; onSnapshot?: (contentDigest: string | null) => void }) {
  const [content, setContent] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const scroll = useRef<HTMLDivElement>(null), observer = useRef(onWork); observer.current = onWork;
  const snapshotObserver = useRef(onSnapshot); snapshotObserver.current = onSnapshot;
  useEffect(() => {
    const controller = new AbortController(); setContent(null); setError(null); snapshotObserver.current?.(null);
    const work = read<{ content: string; contentDigest?: string }>(`/api/review-notebook?${new URLSearchParams({ index: indexPath, asset: target.path })}`, controller.signal)
      .then(body => { if (!controller.signal.aborted) { setContent(body.content); snapshotObserver.current?.(body.contentDigest && /^[a-f0-9]{64}$/.test(body.contentDigest) ? body.contentDigest : null); } })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "File unavailable"); });
    observer.current?.(work); return () => controller.abort();
  }, [indexPath, target.path]);
  return <div ref={scroll} className="guided-file-evidence"><p>Mutable working asset · {target.path} · snapshot read, no watching</p>
    {error ? <p role="alert">{error}</p> : content === null ? <p role="status">Loading evidence…</p> : /\.md$/i.test(target.path)
      ? <div className="markdown-body"><FileMarkdownBody markdown={content} images={false} reviewCards={false} onWork={onWork} /></div> : /\.mmd$/i.test(target.path)
      ? <MermaidBlock code={content} defaultPreview onWork={onWork} /> : /\.(csv|tsv)$/i.test(target.path)
      ? <DelimitedTable content={content} filePath={target.path} complete scrollRef={scroll} /> : <CodeBlock code={content} lang={/\.json$/i.test(target.path) ? "json" : "text"} onWork={onWork} />}
  </div>;
}
function CompareEvidence({ target, onWork, readerState, onReviewSelection }: { target: Extract<Evidence, { kind: "compare" }>; onWork?: WorkObserver; readerState?: NotebookTargetState; onReviewSelection?: (selection: EvidenceSelection | null) => void }) {
  const [material, setMaterial] = useState<{ head: string; identity: string; patch: string; hasBinaryChanges: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null), observer = useRef(onWork); observer.current = onWork;
  const url = useCallback((op: string, head: string, identity?: string) => `/api/git/explorer?${new URLSearchParams({ cwd: target.cwd, branch: target.branch, op, head, base: target.base, candidate: target.candidate,
    ...(identity ? { identity, path: target.path } : {}) })}`, [target]);
  useEffect(() => {
    const controller = new AbortController(); setMaterial(null); setError(null);
    const work = (async () => {
      const reference = { cwd: target.cwd, branch: target.branch, oid: target.candidate };
      const { head } = await read<{ head: string }>(reviewExplorerUrl(reference, "log"), controller.signal);
      const { identity } = await read<{ identity: string }>(url("compare", head), controller.signal);
      const patch = await read<{ patch: string; hasBinaryChanges: boolean }>(url("compare-patch", head, identity), controller.signal);
      if (!controller.signal.aborted) setMaterial({ ...patch, identity, head });
    })().catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Comparison unavailable"); });
    observer.current?.(work); return () => controller.abort();
  }, [target, url]);
  const model = useMemo(() => material ? readerState?.review(target.path, material.patch, material.identity) ?? createDiffReview(material.patch, JSON.stringify(target)) : undefined, [material, target, readerState]);
  return <div><p>Immutable feature range · {target.cwd} · {target.branch}<br />{target.base} → {target.candidate} · {target.path}</p>
    {error ? <p role="alert">{error}</p> : !material ? <p role="status">Loading comparison…</p> : <CommittedPatchDiff patch={material.patch} hasBinaryChanges={material.hasBinaryChanges}
      before={target.base.slice(0, 8)} after={target.candidate.slice(0, 8)} reviewModel={model} onReadWork={onWork} onReviewSelection={onReviewSelection}
      loadContext={signal => read<DiffContext>(url("compare-context", material.head, material.identity), signal)} />}
  </div>;
}
