// Adapted from upstream 1a94341c: scan growing files from a validated checkpoint.
// Sampling is not prefix integrity verification: same-inode edits outside the
// header/boundary sample followed by growth can retain stale metadata. A full
// hash would defeat the saved I/O. Cold summaries still scan archive markers.
import { createHash } from "node:crypto";
import fs, { existsSync, readFileSync } from "node:fs";
import type { Dirent, Stats } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { basename, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { SESSION_ARCHIVE_TYPE } from "./session-archive";
import { SESSION_SPAWN_TYPE, readSessionSpawn } from "./session-spawn";

export interface ScannedSessionInfo {
	path: string;
	id: string;
	cwd: string;
	name?: string;
	created: Date;
	modified: Date;
	messageCount: number;
	firstMessage: string;
	archived?: boolean;
	parentSessionPath?: string;
	spawnedBy?: string;
	/** Transcript details are pending; archive state has already been resolved. */
	detailsPending?: boolean;
}

interface Fingerprint {
	size: number;
	mtimeMs: number;
	ctimeMs: number;
	dev: number;
	ino: number;
}

interface ResumePoint {
	/** Just after the last LF-terminated run; incomplete bytes are reread. */
	offset: number;
	headerEnd: number;
	check: string;
	hasFirstMessage: boolean;
	lastActivityTime?: number;
}

interface IndexEntry {
	fp: Fingerprint;
	info: ScannedSessionInfo;
	resume?: ResumePoint;
}

type RawEntry = Record<string, unknown>;
const SUMMARY_HEADER_MAX_BYTES = 64 * 1024;
const RESUME_SAMPLE_BYTES = 512;
// Bump whenever parsing/folding changes: resumed totals retain the old rules.
const INDEX_FORMAT_VERSION = 2;
const INDEX_PERSIST_DELAY_MS = 5_000;
const MAX_CONCURRENT_SCANS = 10;

interface PendingIndexSave {
	path: string;
	entries: Array<[string, IndexEntry]>;
	timer: NodeJS.Timeout;
}

declare global {
	var __brabblerScanIndex: Map<string, IndexEntry> | undefined;
	var __brabblerScanIndexLoaded: boolean | undefined;
	var __brabblerScanIndexDir: string | undefined;
	var __brabblerScanIndexSave: PendingIndexSave | undefined;
	var __brabblerScanQueue: Promise<void> | undefined;
	var __brabblerScanFingerprints: WeakMap<ScannedSessionInfo, Readonly<Fingerprint>> | undefined;
}

function isRecord(value: unknown): value is RawEntry {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseLine(line: string): RawEntry | null {
	if (!line.trim()) return null;
	try {
		const entry: unknown = JSON.parse(line);
		return isRecord(entry) ? entry : null;
	} catch {
		return null;
	}
}

function fingerprint(stats: Stats): Fingerprint {
	return { size: stats.size, mtimeMs: stats.mtimeMs, ctimeMs: stats.ctimeMs, dev: stats.dev, ino: stats.ino };
}

function sameFingerprint(a: Fingerprint, b: Fingerprint): boolean {
	return a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs
		&& a.dev === b.dev && a.ino === b.ino;
}

/** Process-validated metadata evidence, never filesystem/operation authority. */
export function getValidatedSessionScanFingerprint(info: ScannedSessionInfo): Readonly<Fingerprint> | undefined {
	if (globalThis.__brabblerScanIndexDir !== getAgentDir()
		|| globalThis.__brabblerScanIndex?.get(info.path)?.info !== info) return undefined;
	return globalThis.__brabblerScanFingerprints?.get(info);
}

export function matchesSessionScanFingerprint(expected: Readonly<Fingerprint>, stats: Stats): boolean {
	return stats.isFile() && sameFingerprint(expected, fingerprint(stats));
}

function validateScanEntry(entry: IndexEntry): void {
	const evidence = globalThis.__brabblerScanFingerprints ??= new WeakMap();
	if (!evidence.has(entry.info)) evidence.set(entry.info, Object.freeze({ ...entry.fp }));
}

function revokeScanEntry(entry: IndexEntry | undefined): void {
	if (entry) globalThis.__brabblerScanFingerprints?.delete(entry.info);
}

function hasGrown(cached: IndexEntry | undefined, fp: Fingerprint): cached is IndexEntry {
	return Boolean(cached?.resume && fp.ino > 0 && cached.fp.dev === fp.dev
		&& cached.fp.ino === fp.ino && fp.size > cached.fp.size);
}

async function readSessionHeaderSummary(filePath: string): Promise<RawEntry | null> {
	const handle = await open(filePath, "r");
	try {
		const buffer = Buffer.allocUnsafe(SUMMARY_HEADER_MAX_BYTES);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		for (const line of buffer.subarray(0, bytesRead).toString("utf8").split("\n")) {
			const entry = parseLine(line.replace(/\r$/, ""));
			if (entry) return entry.type === "session" ? entry : null;
		}
		return null;
	} finally {
		await handle.close();
	}
}

async function deferredSessionInfo(filePath: string, fp: Fingerprint): Promise<ScannedSessionInfo | null> {
	const header = await readSessionHeaderSummary(filePath);
	if (!header || typeof header.id !== "string" || typeof header.cwd !== "string"
		|| typeof header.timestamp !== "string") return null;
	const created = new Date(header.timestamp);
	if (!Number.isFinite(created.getTime())) return null;
	return {
		path: filePath, id: header.id, cwd: header.cwd, created,
		modified: new Date(fp.mtimeMs), messageCount: 0, firstMessage: "",
		...(typeof header.parentSession === "string" ? { parentSessionPath: header.parentSession } : {}),
		// Deliberately scan the whole transcript: an archive marker can be anywhere.
		archived: await readArchiveState(filePath),
		detailsPending: true,
	};
}

function extractTextContent(message: RawEntry): string {
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.filter((block): block is { type: string; text: string } =>
		isRecord(block) && block.type === "text" && typeof block.text === "string")
		.map((block) => block.text).join(" ");
}

function activityTimeOf(entry: RawEntry): number | undefined {
	const message = entry.message;
	if (!isRecord(message) || !("content" in message)
		|| (message.role !== "user" && message.role !== "assistant")) return undefined;
	const time = typeof message.timestamp === "number"
		? message.timestamp : new Date(entry.timestamp as string).getTime();
	return Number.isFinite(time) ? time : undefined;
}

interface ScanTotals {
	name?: string;
	messageCount: number;
	firstMessage: string;
	lastActivityTime?: number;
	archived: boolean;
	spawnedBy?: string;
}

function archiveState(entry: RawEntry): boolean | undefined {
	if (entry.type !== "custom" || entry.customType !== SESSION_ARCHIVE_TYPE || !isRecord(entry.data)) return undefined;
	return entry.data.version === 1 && typeof entry.data.archived === "boolean" ? entry.data.archived : undefined;
}

function foldEntry(totals: ScanTotals, entry: RawEntry, sessionId: string): void {
	const archived = archiveState(entry);
	if (archived !== undefined) totals.archived = archived;
	if (entry.type === "custom" && entry.customType === SESSION_SPAWN_TYPE) {
		totals.spawnedBy ??= readSessionSpawn(entry.data, sessionId)?.creatorSessionId;
	}
	if (entry.type === "session_info") {
		totals.name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : undefined;
	}
	if (entry.type !== "message") return;
	totals.messageCount++;
	const activity = activityTimeOf(entry);
	if (activity !== undefined) totals.lastActivityTime = Math.max(totals.lastActivityTime ?? 0, activity);
	if (!totals.firstMessage && isRecord(entry.message) && entry.message.role === "user") {
		totals.firstMessage = extractTextContent(entry.message);
	}
}

function sampleCheck(head: Buffer, tail: Buffer): string {
	return createHash("sha1").update(head).update(tail).digest("base64");
}

// Decode only whole LF-delimited byte runs, preserving split UTF-8 and raw
// U+2028/U+2029 in JSON strings (unlike Node 24 readline). Retain lone-CR behavior.
function linesOf(bytes: Buffer): string[] {
	const text = bytes.toString("utf8");
	return text.includes("\r") ? text.split("\r") : [text];
}

function keepLastBytes(parts: Buffer[]): Buffer[] {
	let total = parts.reduce((sum, part) => sum + part.length, 0);
	let first = 0;
	while (first < parts.length - 1 && total - parts[first].length >= RESUME_SAMPLE_BYTES) {
		total -= parts[first++].length;
	}
	return parts.slice(first);
}

interface LineScan { offset: number; sample: Buffer; rest: Buffer }

async function readLines(
	handle: FileHandle, filePath: string, start: number, size: number, sample: Buffer,
	onLine: (bytes: Buffer, end: number) => boolean,
): Promise<LineScan | null> {
	let offset = start;
	let pending: Buffer[] = [];
	let read = [sample];
	if (start < size) {
		// Bind validation and parsing to one descriptor and a finite observed size.
		// Share FileHandle ownership: early exit/error must not close an untracked
		// numeric descriptor that another worker could reuse before finally runs.
		const stream = fs.createReadStream(filePath, { fd: handle, autoClose: true, start, end: size - 1 });
		for await (const chunk of stream as AsyncIterable<Buffer>) {
			let newline = chunk.indexOf(0x0a);
			if (newline === -1) { pending.push(chunk); continue; }
			const carried = pending;
			let lineStart = 0;
			while (newline !== -1) {
				const piece = chunk.subarray(lineStart, newline);
				const bytes = pending.length ? Buffer.concat([...pending, piece]) : piece;
				pending = [];
				offset += bytes.length + 1;
				if (!onLine(bytes, offset)) return null;
				lineStart = newline + 1;
				newline = chunk.indexOf(0x0a, lineStart);
			}
			read = keepLastBytes([...read, ...carried, chunk.subarray(0, lineStart)]);
			if (lineStart < chunk.length) pending.push(chunk.subarray(lineStart));
		}
	}
	const joined = Buffer.concat(read);
	return { offset, sample: joined.subarray(Math.max(0, joined.length - RESUME_SAMPLE_BYTES)), rest: Buffer.concat(pending) };
}

async function readArchiveState(filePath: string): Promise<boolean> {
	const handle = await open(filePath, "r");
	try {
		let archived = false;
		const fold = (bytes: Buffer) => {
			for (const line of linesOf(bytes)) {
				if (!line.includes(SESSION_ARCHIVE_TYPE)) continue;
				const entry = parseLine(line);
				const state = entry ? archiveState(entry) : undefined;
				if (state !== undefined) archived = state;
			}
			return true;
		};
		const scan = await readLines(handle, filePath, 0, (await handle.stat()).size, Buffer.alloc(0), fold);
		if (scan?.rest.length) fold(scan.rest);
		return archived;
	} finally {
		await handle.close();
	}
}

async function readResumeSample(handle: FileHandle, resume: ResumePoint): Promise<{ head: Buffer; tail: Buffer } | null> {
	const tailStart = Math.max(0, resume.offset - RESUME_SAMPLE_BYTES);
	const head = Buffer.alloc(resume.headerEnd);
	const tail = Buffer.alloc(resume.offset - tailStart);
	const headRead = await handle.read(head, 0, head.length, 0);
	const tailRead = await handle.read(tail, 0, tail.length, tailStart);
	if (headRead.bytesRead !== head.length || tailRead.bytesRead !== tail.length) return null;
	return sampleCheck(head, tail) === resume.check ? { head, tail } : null;
}

async function scanSessionFile(filePath: string, previous?: IndexEntry): Promise<{ entry: IndexEntry; stable: boolean } | null> {
	let handle: FileHandle | undefined;
	try {
		handle = await open(filePath, "r");
		const stats = await handle.stat();
		const fp = fingerprint(stats);
		const resumed = hasGrown(previous, fp) && previous.resume
			? await readResumeSample(handle, previous.resume) : null;
		let header: RawEntry | null = null;
		let head: Buffer | undefined;
		let headerEnd = 0;
		let start = 0;
		let sample: Buffer = Buffer.alloc(0);
		const totals: ScanTotals = { messageCount: 0, firstMessage: "", archived: false };
		if (resumed && previous?.resume) {
			const { info, resume } = previous;
			start = resume.offset;
			sample = resumed.tail;
			header = { id: info.id, cwd: info.cwd, timestamp: info.created.toISOString(), parentSession: info.parentSessionPath };
			head = resumed.head;
			headerEnd = resume.headerEnd;
			Object.assign(totals, {
				name: info.name, messageCount: info.messageCount,
				firstMessage: resume.hasFirstMessage ? info.firstMessage : "",
				lastActivityTime: resume.lastActivityTime, archived: info.archived === true, spawnedBy: info.spawnedBy,
			});
		}
		let restCounted = false;
		const parseLines = (bytes: Buffer, end: number | null): boolean => {
			for (const line of linesOf(bytes)) {
				const entry = parseLine(line);
				if (!entry) continue;
				if (end === null) restCounted = true;
				if (!header) {
					if (entry.type !== "session" || typeof entry.id !== "string" || typeof entry.timestamp !== "string"
						|| !Number.isFinite(new Date(entry.timestamp).getTime())) return false;
					header = entry;
					// Unusual/oversized headers still scan fully, but never allocate a persisted-size buffer.
					if (end !== null && end === bytes.length + 1 && end <= SUMMARY_HEADER_MAX_BYTES) {
						head = Buffer.concat([bytes, Buffer.from("\n")]);
						headerEnd = end;
					}
					continue;
				}
				foldEntry(totals, entry, header.id as string);
			}
			return true;
		};
		const scan = await readLines(handle, filePath, start, fp.size, sample, parseLines);
		if (!scan || (scan.rest.length && !parseLines(scan.rest, null)) || !header) return null;
		const created = new Date(header.timestamp as string);
		const info: ScannedSessionInfo = {
			path: filePath, id: header.id as string, cwd: typeof header.cwd === "string" ? header.cwd : "",
			name: totals.name, parentSessionPath: typeof header.parentSession === "string" ? header.parentSession : undefined,
			created,
			modified: typeof totals.lastActivityTime === "number" && totals.lastActivityTime > 0
				? new Date(totals.lastActivityTime) : created,
			messageCount: totals.messageCount, firstMessage: totals.firstMessage || "(no messages)",
			...(totals.archived ? { archived: true } : {}),
			...(totals.spawnedBy ? { spawnedBy: totals.spawnedBy } : {}),
		};
		// The stream closes its FileHandle on exhaustion. Revalidate the pathname
		// against the descriptor's original identity/stat, not a reopened tail.
		const stable = sameFingerprint(fp, fingerprint(await stat(filePath)));
		return {
			stable,
			entry: {
				fp, info,
				resume: stable && head && headerEnd > 0 && !restCounted && fp.ino > 0
					? { offset: scan.offset, headerEnd, check: sampleCheck(head, scan.sample),
						hasFirstMessage: totals.firstMessage !== "",
						...(totals.lastActivityTime !== undefined ? { lastActivityTime: totals.lastActivityTime } : {}) }
					: undefined,
			},
		};
	} catch {
		return null;
	} finally {
		await handle?.close().catch(() => undefined);
	}
}

/** Full metadata scan; also used as an independent baseline for tail-scan tests. */
export async function scanSessionFileInfo(filePath: string): Promise<ScannedSessionInfo | null> {
	return (await scanSessionFile(filePath))?.entry.info ?? null;
}

async function enumerateSessionFiles(sessionsDir: string): Promise<string[]> {
	let dirs: Dirent[];
	try {
		dirs = (await readdir(sessionsDir, { withFileTypes: true })).filter((entry) => entry.isDirectory() || entry.isSymbolicLink());
	} catch { return []; }
	const files: string[] = [];
	for (const dir of dirs) {
		try {
			for (const file of await readdir(join(sessionsDir, dir.name))) {
				if (file.endsWith(".jsonl")) files.push(join(sessionsDir, dir.name, file));
			}
		} catch { /* Unreadable project directory: SDK skip-as-absent semantics. */ }
	}
	return files;
}

async function runPool<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
	let next = 0;
	const settled = await Promise.allSettled(Array.from({ length: Math.min(MAX_CONCURRENT_SCANS, items.length) }, async () => {
		while (next < items.length) await worker(items[next++]);
	}));
	const failed = settled.find((result) => result.status === "rejected");
	if (failed?.status === "rejected") throw failed.reason;
}

function getIndex(): Map<string, IndexEntry> {
	return globalThis.__brabblerScanIndex ??= new Map();
}

function indexFilePath(agentDir: string): string {
	return join(agentDir, "brabbler-session-index.json");
}

function readResumePoint(value: unknown, fp: Fingerprint): ResumePoint | undefined {
	if (!isRecord(value) || fp.ino <= 0) return undefined;
	const { offset, headerEnd, check, hasFirstMessage, lastActivityTime } = value;
	if (typeof headerEnd !== "number" || !Number.isSafeInteger(headerEnd) || headerEnd <= 0 || headerEnd > SUMMARY_HEADER_MAX_BYTES
		|| typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < headerEnd || offset > fp.size
		|| typeof check !== "string" || !/^[A-Za-z0-9+/]{27}=$/.test(check)
		|| typeof hasFirstMessage !== "boolean"
		|| (lastActivityTime !== undefined && (typeof lastActivityTime !== "number" || !Number.isFinite(lastActivityTime)))) return undefined;
	return { offset, headerEnd, check, hasFirstMessage, ...(lastActivityTime !== undefined ? { lastActivityTime } : {}) };
}

function loadPersistedIndex(agentDir: string): void {
	if (globalThis.__brabblerScanIndexDir !== agentDir) {
		persistIndex();
		globalThis.__brabblerScanIndex = new Map();
		globalThis.__brabblerScanFingerprints = new WeakMap();
		globalThis.__brabblerScanIndexLoaded = undefined;
		globalThis.__brabblerScanIndexDir = agentDir;
	}
	if (globalThis.__brabblerScanIndexLoaded) return;
	globalThis.__brabblerScanIndexLoaded = true;
	const path = indexFilePath(agentDir);
	if (!existsSync(path)) return;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isRecord(parsed) || parsed.version !== INDEX_FORMAT_VERSION || !isRecord(parsed.entries)) return;
		for (const [pathKey, entry] of Object.entries(parsed.entries)) {
			if (!isRecord(entry) || !isRecord(entry.fp) || !isRecord(entry.info)) continue;
			const { fp, info } = entry;
			if (typeof fp.size !== "number" || !Number.isSafeInteger(fp.size) || fp.size < 0
				|| typeof fp.mtimeMs !== "number" || !Number.isFinite(fp.mtimeMs)
				|| typeof fp.ctimeMs !== "number" || !Number.isFinite(fp.ctimeMs)
				|| typeof fp.dev !== "number" || !Number.isSafeInteger(fp.dev) || fp.dev < 0
				|| typeof fp.ino !== "number" || !Number.isSafeInteger(fp.ino) || fp.ino < 0
				|| info.path !== pathKey || typeof info.id !== "string" || typeof info.cwd !== "string"
				|| typeof info.firstMessage !== "string" || (info.name !== undefined && typeof info.name !== "string")
				|| (info.archived !== undefined && typeof info.archived !== "boolean")
				|| (info.parentSessionPath !== undefined && typeof info.parentSessionPath !== "string")
				|| (info.spawnedBy !== undefined && (typeof info.spawnedBy !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(info.spawnedBy)))
				|| typeof info.messageCount !== "number" || !Number.isSafeInteger(info.messageCount) || info.messageCount < 0
				|| typeof info.created !== "string" || typeof info.modified !== "string") continue;
			const created = new Date(info.created), modified = new Date(info.modified);
			if (!Number.isFinite(created.getTime()) || !Number.isFinite(modified.getTime())) continue;
			const restoredFp: Fingerprint = { size: fp.size, mtimeMs: fp.mtimeMs, ctimeMs: fp.ctimeMs, dev: fp.dev, ino: fp.ino };
			getIndex().set(pathKey, {
				fp: restoredFp,
				info: { path: pathKey, id: info.id, cwd: info.cwd, name: info.name,
					...(info.archived ? { archived: true } : {}), parentSessionPath: info.parentSessionPath,
					...(typeof info.spawnedBy === "string" ? { spawnedBy: info.spawnedBy } : {}),
					firstMessage: info.firstMessage, messageCount: info.messageCount, created, modified },
				resume: readResumePoint(entry.resume, restoredFp),
			});
		}
	} catch { /* Corrupt/old index: cold rebuild, never a caller error. */ }
}

function persistIndex(): void {
	const pending = globalThis.__brabblerScanIndexSave;
	if (!pending) return;
	clearTimeout(pending.timer);
	globalThis.__brabblerScanIndexSave = undefined;
	try {
		writePrivateFileAtomicSync(pending.path, JSON.stringify({ version: INDEX_FORMAT_VERSION, entries: Object.fromEntries(pending.entries) }));
	} catch { /* Best-effort cache; a lost save only costs a rescan. */ }
}

function queueIndexPersist(agentDir: string): void {
	const path = indexFilePath(agentDir), entries = [...getIndex()];
	const pending = globalThis.__brabblerScanIndexSave;
	if (pending?.path === path) { pending.entries = entries; return; }
	persistIndex();
	const timer = setTimeout(persistIndex, INDEX_PERSIST_DELAY_MS);
	timer.unref?.();
	globalThis.__brabblerScanIndexSave = { path, entries, timer };
}

async function listSessionsInOrder(agentDir: string, deferDetails: boolean): Promise<ScannedSessionInfo[]> {
	loadPersistedIndex(agentDir);
	const files = await enumerateSessionFiles(join(agentDir, "sessions"));
	const index = getIndex(), present = new Set(files);
	let dirty = false;
	for (const known of index.keys()) {
		if (!present.has(known)) { revokeScanEntry(index.get(known)); index.delete(known); dirty = true; }
	}
	const fingerprints = await Promise.all(files.map(async (filePath) => {
		try { return fingerprint(await stat(filePath)); } catch { return null; }
	}));
	const results: Array<{ info: ScannedSessionInfo; mtimeMs: number } | null> = new Array(files.length).fill(null);
	await runPool(files.map((filePath, i) => ({ filePath, i })), async ({ filePath, i }) => {
		const fp = fingerprints[i], cached = index.get(filePath);
		if (!fp) { revokeScanEntry(cached); dirty = index.delete(filePath) || dirty; return; }
		if (cached && sameFingerprint(cached.fp, fp)) {
			validateScanEntry(cached);
			results[i] = { info: cached.info, mtimeMs: fp.mtimeMs };
			return;
		}
		// A pending summary retains the complete accumulator, not its eligibility.
		revokeScanEntry(cached);
		if (deferDetails) {
			try {
				const info = await deferredSessionInfo(filePath, fp);
				if (info) results[i] = { info, mtimeMs: fp.mtimeMs };
				else dirty = index.delete(filePath) || dirty;
			} catch { dirty = index.delete(filePath) || dirty; }
			// Never replace a complete accumulator with a pending row.
			return;
		}
		const scanned = await scanSessionFile(filePath, hasGrown(cached, fp) ? cached : undefined);
		dirty = true;
		if (scanned) {
			if (scanned.stable) { index.set(filePath, scanned.entry); validateScanEntry(scanned.entry); }
			else index.delete(filePath); // External writer raced us: do not persist mixed totals/checkpoints.
			results[i] = { info: scanned.entry.info, mtimeMs: scanned.entry.fp.mtimeMs };
		} else index.delete(filePath);
	});
	if (dirty) queueIndexPersist(agentDir);
	return results.flatMap((row) => row ? [row] : [])
		.sort((a, b) => b.info.modified.getTime() - a.info.modified.getTime()
			|| b.mtimeMs - a.mtimeMs || basename(b.info.path).localeCompare(basename(a.info.path)))
		.map(({ info }) => info);
}

/** Serialize index owners, including summaries and generation-invalidated scans. */
export function listSessionsIncremental(options: { deferDetails?: boolean } = {}): Promise<ScannedSessionInfo[]> {
	const agentDir = getAgentDir();
	const operation = (globalThis.__brabblerScanQueue ?? Promise.resolve())
		.then(() => listSessionsInOrder(agentDir, options.deferDetails ?? false));
	globalThis.__brabblerScanQueue = operation.then(() => undefined, () => undefined);
	return operation;
}

/** Test seam: persist without waiting for the coalescing window. */
export function flushSessionScanIndexForTests(): void { persistIndex(); }

/** Test seam: call only after outstanding listings settle. */
export function resetSessionScanIndexForTests(): void {
	clearTimeout(globalThis.__brabblerScanIndexSave?.timer);
	globalThis.__brabblerScanIndex = undefined;
	globalThis.__brabblerScanFingerprints = undefined;
	globalThis.__brabblerScanIndexLoaded = undefined;
	globalThis.__brabblerScanIndexDir = undefined;
	globalThis.__brabblerScanIndexSave = undefined;
	globalThis.__brabblerScanQueue = undefined;
}
