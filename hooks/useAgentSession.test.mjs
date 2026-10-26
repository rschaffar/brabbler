import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const jitiSource = async (url) => (await readFile(url, "utf8")).replace(/\r\n/g, "\n");
const source = await jitiSource(new URL("./useAgentSession.ts", import.meta.url));
const chatWindowSource = await jitiSource(new URL("../components/ChatWindow.tsx", import.meta.url));
const appShellSource = await jitiSource(new URL("../components/AppShell.tsx", import.meta.url));
const systemInfoSource = await jitiSource(new URL("./useSessionSystemInfo.ts", import.meta.url));
const systemButtonsSource = await jitiSource(new URL("../components/SessionSystemInfoButtons.tsx", import.meta.url));
const navigationSource = await jitiSource(new URL("./useSessionNavigation.ts", import.meta.url));
const chatBindingSource = await jitiSource(new URL("../components/session-navigation-chat.ts", import.meta.url));
const fileBindingSource = await jitiSource(new URL("./useSessionFileBinding.ts", import.meta.url));
const policyClockSource = await jitiSource(new URL("../lib/agent-session-policy-clock.ts", import.meta.url));
const shellNotificationsSource = await jitiSource(new URL("../components/useShellNotifications.ts", import.meta.url));

// Display-only boolean assertions: never pass a production body to assert's
// failure renderer. Existing regex predicates retain their test/negation sense.
// The default label is the precise literal predicate, not the source contents.
function match(actualSource, regex, label = regex.toString()) {
  assert.equal(regex.test(actualSource), true, `required wire: ${label.slice(0, 480)}`);
}
function doesNotMatch(actualSource, regex, label = regex.toString()) {
  assert.equal(regex.test(actualSource), false, `excluded wire: ${label.slice(0, 480)}`);
}

test("opening System or Tools lazily starts a dormant session without sending a prompt", () => {
  const loadSystemInfoSource = source.slice(
    source.indexOf("  const loadSystemInfo = useCallback"),
    source.indexOf("  const loadSlashCommands = useCallback"),
  );
  const loaderEffectSource = source.slice(
    source.indexOf("  useEffect(() => {\n    onSystemInfoLoaderChange"),
    source.indexOf("  useEffect(() => {\n    if (!onBranchDataChange) return;"),
  );

  match(loadSystemInfoSource, /sessionIdRef\.current \?\? await ensureNewSession\(\)/);
  doesNotMatch(loadSystemInfoSource, /promoteNewSession\(\)/);
  match(loadSystemInfoSource, /sendAgentCommand<AgentStateResponse>\(sid, \{ type: "get_state" \}\)/);
  match(loadSystemInfoSource, /loadTools\(sid\)/);
  doesNotMatch(loadSystemInfoSource, /type: "prompt"/);
  match(loadSystemInfoSource, /setSystemPrompt\(state\.systemPrompt \?\? ""\)/);
  match(loaderEffectSource, /onSystemInfoLoaderChange\?\.\(loadSystemInfo\)/);
  match(loaderEffectSource, /onSystemInfoLoaderChange\?\.\(null\)/);
  match(appShellSource, /import \{ SessionSystemInfoButtons \} from "\.\/SessionSystemInfoButtons"/, "AppShell imports the real toolbar leaf");
  match(appShellSource, /import \{ useSystemInfoState, useSystemInfoActions \} from "@\/hooks\/useSessionSystemInfo"/, "AppShell imports the actual system-info owners");
  match(appShellSource, /const systemInfo = useSystemInfoState\(\)/, "AppShell calls system-info state");
  match(appShellSource, /handleSystemInfoLoaderChange \} = systemInfo/, "AppShell receives the real loader registration callback");
  match(appShellSource, /handleSystemInfoToggle = useSystemInfoActions\(systemInfo, activeTopPanel, toggleTopPanel\)/, "AppShell calls real system-info actions with that state");
  match(appShellSource, /systemInfoControls=\{<SessionSystemInfoButtons[\s\S]*?handleSystemInfoToggle=\{handleSystemInfoToggle\}/, "actual toolbar slot forwards the real action");
  match(systemButtonsSource, /onClick=\{\(\) => handleSystemInfoToggle\("system"\)\}/, "SessionSystemInfoButtons System click");
  match(systemButtonsSource, /onClick=\{\(\) => handleSystemInfoToggle\("tools"\)\}/, "SessionSystemInfoButtons Tools click");
  match(systemInfoSource, /const load = systemInfoLoaderRef\.current/, "useSystemInfoActions consumes current loader");
  doesNotMatch(systemInfoSource, /systemPrompt !== null \|\| systemInfoLoading/, "system-info action has no cached-prompt admission shortcut");
  match(systemInfoSource, /const loadId = \+\+systemInfoLoadIdRef\.current/, "useSystemInfoActions generation admission");
  match(systemInfoSource, /systemInfoLoadIdRef\.current === loadId/, "useSystemInfoActions current-only finally");
  match(systemInfoSource, /handleSystemInfoLoaderChange[\s\S]*?systemInfoLoadIdRef\.current \+= 1;[\s\S]*?setSystemInfoLoading\(false\)/, "useSystemInfoState loader replacement invalidates generation/loading");
  match(appShellSource, /onSystemInfoLoaderChange=\{handleSystemInfoLoaderChange\}/, "actual ChatWindow loader-registration prop");
});

test("new-session promotion rekeys drafts before publishing the real session", () => {
  const promoteSource = source.slice(
    source.indexOf("  const promoteNewSession = useCallback"),
    source.indexOf("  const ensureNewSession = useCallback"),
  );

  match(promoteSource, /draftKeyAliasesRef\.current\.set\(provisionalDraftKey, sid\)/);
  match(promoteSource, /input\.rekeyDraft\(provisionalDraftKey, sid\)/);
  assert.ok(
    promoteSource.indexOf("input.rekeyDraft(provisionalDraftKey, sid)")
      < promoteSource.indexOf("onSessionCreated?.({"),
  );
  match(promoteSource, /}, provisionalDraftKey\)/);
  match(chatWindowSource, /draftKey=\{session\?\.id \?\? newSessionDraftKey \?\? undefined\}/);
});

test("only the session-mount load probes disk for external appends", () => {
  const loadSessionSource = source.slice(
    source.indexOf("  const loadSession = useCallback"),
    source.indexOf("  const loadContext = useCallback"),
  );
  const mountSource = source.slice(
    source.indexOf("// Load session on mount"),
    source.indexOf("sessionHookMountedRef.current = false"),
  );
  match(loadSessionSource, /options\?: \{ force\?: boolean; fresh\?: boolean \}/);
  match(loadSessionSource, /if \(options\?\.force\) params\.set\("force", "1"\)/);
  match(loadSessionSource, /d\.wrapperRebuilt[\s\S]*?eventConnectionRef\.current\?\.close\(\)[\s\S]*?maintain\(sid\)/);
  match(source, /const historyOnly = isHistoryOnlySession\(session\)/);
  match(mountSource, /loadSession\(session\.id, !cached, !historyOnly, \{ force: true \}\)/);
  match(source, /await loadSession\(sid\)/);
  assert.equal([...source.matchAll(/\{ force: true \}/g)].length, 1);
});

test("first user messages expose both branch actions and edit before their own entry", () => {
  const navigateSource = source.slice(
    source.indexOf("  const handleNavigate = useCallback"),
    source.indexOf("  const handleLeafChange = useCallback"),
  );

  match(chatWindowSource, /onFork=\{isNew \? undefined : handleFork\}/);
  match(chatWindowSource, /onNavigate=\{sessionBusy \? undefined : handleNavigate\}/);
  doesNotMatch(chatWindowSource, /idx === 0 && msg\.role === "user"/);
  doesNotMatch(chatWindowSource, /prevAssistantEntryId/);
  match(navigateSource, /type: "navigate_tree",\s*targetId: entryId/);
  match(navigateSource, /branchViewRevisionRef\.current \+= 1/);
  match(navigateSource, /loadFlightsRef\.current\.delete\(sid\);\s*await loadSession\(sid, true\)/);
});

test("independent forks stay available during prompts, shell commands, and compaction", () => {
  const forkSource = source.slice(
    source.indexOf("  const handleFork = useCallback"),
    source.indexOf("  const handleNavigate = useCallback"),
  );
  doesNotMatch(forkSource, /bashRunningRef|agentRunning|isCompacting|handleAbort/);
  match(forkSource, /type: "fork",\s*entryId/);
  match(chatWindowSource, /onAskInNewChat && quotedSelection\.sourceEntryId && \(/);
});

test("live model response retains its provider/id type shape (structural guard)", () => {
  match(source, /model\?: \{ provider: string; id: string \}/);
});

test("Send dependency exclusion retains preset-independent callback identity (memo guard)", () => {
  const sendSource = source.slice(
    source.indexOf("  const handleSend = useCallback"),
    source.indexOf("  const executeBash = useCallback"),
  );
  doesNotMatch(sendSource, /restoreSubmission, toolPreset\]\);/);
});

test("stale fresh-session completion cannot replace the active composer", () => {
  const cwdChangeSource = navigationSource.slice(
    navigationSource.indexOf("  const handleCwdChange = useCallback"),
    navigationSource.indexOf("  const handleSelectSession = useCallback"),
  );
  const newSessionSource = navigationSource.slice(
    navigationSource.indexOf("  const handleNewSession = useCallback"),
    navigationSource.indexOf("  const hydrateSelectedSession = useCallback"),
  );
  const createdSource = navigationSource.slice(
    navigationSource.indexOf("  const handleSessionCreated = useCallback"),
    navigationSource.indexOf("  const handleSessionForked = useCallback"),
  );

  match(appShellSource, /import \{ useNavigationState, useSessionNavigation \} from "@\/hooks\/useSessionNavigation"/, "AppShell imports actual navigation owners");
  match(appShellSource, /const navigationState = useNavigationState\(searchParams\)/, "AppShell owns navigation state");
  match(appShellSource, /const navigation = useSessionNavigation\(navigationState, \{[\s\S]*?setRightPanelOpen/, "AppShell calls real navigation with panel ownership");
  match(newSessionSource, /const draftKey = `new:\$\{sessionId\}:\$\{cwd\}`/, "useSessionNavigation explicit New namespace");
  match(newSessionSource, /activeNewSessionDraftKeyRef\.current = draftKey/, "useSessionNavigation synchronous New identity");
  match(createdSource, /activeNewSessionDraftKeyRef\.current !== sourceDraftKey/, "receiving sourceDraftKey functional filter KEPT");
  match(cwdChangeSource, /const currentFreshCwd = newSessionCwd \?\? activeCwd/, "navigation current fresh cwd");
  match(cwdChangeSource, /currentProject === newProject\s*&& \(selectedSession !== null \|\| currentFreshCwd === cwd\)/, "navigation same-project/fresh-cwd functional filter KEPT");
  match(cwdChangeSource, /if \(currentProject !== newProject\) \{[\s\S]*?setRightPanelOpen\(false\)/, "project switch hides but does not destroy Files owner");
  match(appShellSource, /import \{ useSessionFileBinding \} from "@\/hooks\/useSessionFileBinding"/, "AppShell imports the actual File binding");
  match(appShellSource, /useSessionFileBinding\(selectedSession, activeCwd\)/, "AppShell calls receiving File binding");
  match(fileBindingSource, /const currentFileWorkspaceKey = JSON\.stringify\(\[selectedSession\?\.id \?\? null, selectedSession\?\.cwd \?\? activeCwd \?\? null\]\)/, "File binding receiving session/cwd key");
  match(fileBindingSource, /const fileWorkspaceKey = parkedFileWorkspaceKey \?\? currentFileWorkspaceKey/, "File binding preserves parked owner");
  match(appShellSource, /workspaceKey=\{fileWorkspaceKey\}/, "AppShell forwards bound FileWorkspace key");
  match(navigationSource, /useLayoutEffect\(\(\) => \{\s*activeNewSessionDraftKeyRef\.current = newSessionDraftKey;/, "navigation layout synchronizes active draft key");
  assert.ok(
    createdSource.indexOf("activeNewSessionDraftKeyRef.current !== sourceDraftKey")
      < createdSource.indexOf("setSelectedSession(session)"),
    "navigation rejects wrong sourceDraftKey before selection publication",
  );
  match(appShellSource, /import \{ useSessionNavigationChatBinding \} from "\.\/session-navigation-chat"/, "AppShell imports the actual default chat binding");
  match(appShellSource, /const chatBinding = useSessionNavigationChatBinding\(navigationState, navigation, activityController\)/, "AppShell calls actual chat binding");
  match(chatBindingSource, /onSessionCreated: navigation\.handleSessionCreated/, "chat binding forwards actual receiving callback");
  match(chatBindingSource, /newSessionDraftKey: navigation\.newSessionDraftKey/, "chat binding forwards actual draft key");
  match(appShellSource, /<ChatWindow\s+key=\{sessionKey\}\s+\{\.\.\.chatBinding\}/, "actual default ChatWindow receives binding without a new adapter");
});

test("streaming queue owns no direct steer/follow_up command (structural exclusion)", () => {
  const queueSource = source.slice(
    source.indexOf("  // Let AgentSession.prompt decide atomically"),
    source.indexOf("  const handleAbortCompaction"),
  );

  doesNotMatch(queueSource, /type: "steer"/);
  doesNotMatch(queueSource, /type: "follow_up"/);
});

test("built-in clone switches to the independent child session", () => {
  const builtinSource = source.slice(
    source.indexOf("  const handleBuiltinSlashCommand"),
    source.indexOf("  // Let AgentSession.prompt decide atomically"),
  );

  match(builtinSource, /case "clone"/);
  match(builtinSource, /type: "clone",\s+leafId: activeLeafId/);
  match(builtinSource, /agentRunningRef\.current \|\| bashRunningRef\.current/);
  match(builtinSource, /onSessionForked\?\.\(result\.newSessionId\)/);
});

test("delegates event stream readiness and hides an empty agent phase", () => {
  const ensureSource = source.slice(
    source.indexOf("const ensureEventsConnected"),
    source.indexOf("const respondToExtensionUi"),
  );

  match(source, /new AgentEventConnection\(\{/);
  match(source, /shouldMaintain: \(sid\)[\s\S]*?sessionIdRef\.current === sid/);
  match(ensureSource, /eventConnectionRef\.current!\.ensureConnected\(sid\)/);
  match(ensureSource, /eventConnectionRef\.current!\.maintain\(sid\)/);
  match(chatWindowSource, /const hasStreamingContent = useStreamingSelector\(streamingStore, selectHasStreamingContent\)/);
  match(chatWindowSource, /isStreaming && hasStreamingContent && \(/);
  match(chatWindowSource, /agentRunning && !hasStreamingContent && agentPhase/);
  match(chatWindowSource, /return null;/);
});

test("keeps the selected session warm while idle and renews its lease", () => {
  match(source, /sessionRunning\?: boolean/);
  match(source, /const sid = session\?\.id;[\s\S]*?if \(!sid\) return;[\s\S]*?maintainEventsConnected\(sid\)/);
  match(source, /sessionPropIdRef\.current === sid/);
  match(source, /SESSION_LEASE_RENEW_INTERVAL_MS = 30_000/);
  match(source, /fetch\(`\/api\/agent\/\$\{encodeURIComponent\(sid\)\}\/lease`/);
  match(source, /const stopInterval = policyClock\.interval\("session-lease", SESSION_LEASE_RENEW_INTERVAL_MS, \(\) => \{ maintenanceWork\.observe\("lease-renewal", renewLease\(\)\); \}\)/, "hook registers actual named lease policy and observes full renewal");
  match(source, /disposed = true;\s*stopInterval\(\);\s*document\.removeEventListener\("visibilitychange", onVisible\)/, "lease effect cancels the returned policy handle and listener");
  match(policyClockSource, /const timer = setInterval\(callback, milliseconds\);\s*return \(\) => clearInterval\(timer\)/, "policy clock default delegates unchanged native interval/clear arguments");
  match(source, /result\.renewed === 0[\s\S]*?closeEvents\(\)[\s\S]*?maintainEventsConnected\(sid\)/);
  match(source, /if \(sessionPropIdRef\.current === sid\) \{[\s\S]*?cancelEventStreamGrace\(\);[\s\S]*?return;/);
  match(source, /maintainEventsConnected\(sid\)/);
  doesNotMatch(source, /void connectEvents\(/);
  match(chatWindowSource, /sessionRunning\?: boolean/);
  match(chatWindowSource, /function useChatWindowView\(\{ workObserver, session, sessionRunning,/, "actual shared view receives sessionRunning");
  match(chatWindowSource, /useAgentSession\(\{ \.\.\.props, onAgentEnd: wrappedOnAgentEnd,/, "actual default hook receives the original public options spread");
  match(chatBindingSource, /sessionRunning: Boolean\(state\.selectedSession && runningIds\.has\(state\.selectedSession\.id\)\)/, "chat binding forwards selected-ID running membership");
  match(chatBindingSource, /const \{ snapshot \} = useActivityController\(controller\)/, "chat binding subscribes to actual supplied controller");
  match(chatBindingSource, /return sessionNavigationChatBinding\(state, navigation, snapshot\.runningIds\)/, "chat binding derives running publication from actual snapshot");
  match(appShellSource, /const chatBinding = useSessionNavigationChatBinding\(navigationState, navigation, activityController\)/, "AppShell shares the same Activity controller with chat binding");
  match(appShellSource, /<ChatWindow\s+key=\{sessionKey\}\s+\{\.\.\.chatBinding\}/, "default ChatWindow receives selected running binding");
  // Structural bridge only, not new Activity-only Stop/native delivery proof.
  match(appShellSource, /const activityController = useActivityOwner\(\)/);
  match(appShellSource, /const \{ snapshot: activity \} = useActivityController\(activityController\)/);
  match(appShellSource, /const \{ runningIds: runningSessionIds,/);
});

test("opens the selected session's event stream even when Strict Mode re-runs effects", () => {
  // Strict replay/source-order constraints remain separate from runtime proof.
  const warmSource = source.slice(
    source.indexOf("  // Keep the selected session warm even while its agent is idle."),
    source.indexOf("    const renewLease = async () => {"),
  );
  match(warmSource, /sessionHookMountedRef\.current = true;\s*maintainEventsConnected\(sid\);/);
  assert.ok(
    warmSource.indexOf("sessionHookMountedRef.current = true;")
      < warmSource.indexOf("maintainEventsConnected(sid);"),
  );
  const mountSource = source.slice(
    source.indexOf("  useEffect(() => {\n    sessionHookMountedRef.current = true;"),
    source.indexOf("  useEffect(() => {\n    onSystemPromptChange?.(systemPrompt);"),
  );
  match(mountSource, /return \(\) => \{\s*sessionHookMountedRef\.current = false;/);
  match(mountSource, /closeEvents\(\);\s*\};\s*\/\/ eslint-disable-next-line react-hooks\/exhaustive-deps\s*\}, \[\]\);/);
});

test("single reducer store, typed wire and retired partial-reader declarations (structural guards)", () => {
  const streamSource = source.slice(
    source.indexOf('case "message_start"'),
    source.indexOf('case "message_end"'),
  );
  const messageEndSource = source.slice(
    source.indexOf('case "message_end"'),
    source.indexOf('case "tool_execution_start"'),
  );

  match(source, /createStreamingStore,[\s\S]*type ClientAssistantMessageEvent/);
  match(source, /const \[streamingStore\] = useState\(createStreamingStore\)/);
  doesNotMatch(source, /streamingMessageRef/);
  match(streamSource, /event\.assistantMessageEvent as ClientAssistantMessageEvent/);
  doesNotMatch(streamSource, /case "message_delta"/);
  match(messageEndSource, /const completed = event\.message as AgentMessage/);
  doesNotMatch(messageEndSource, /streamState\.streamingMessage/);
});

test("active shell result map retains StreamingReply forwarding and commit wire guards", () => {
  match(chatWindowSource, /const map = new Map\(activeToolResults\)/);
  match(chatWindowSource, /<StreamingReply store=\{streamingStore\} onCommit=\{followLiveOutput\} toolResults=\{toolResultsMap\}/);
});

test("plays the enabled sound once for each extension dialog", () => {
  match(chatWindowSource, /soundedExtensionDialogIdRef = useRef<string \| null>\(null\)/);
  match(chatWindowSource, /soundedExtensionDialogIdRef\.current === extensionDialog\.id/);
  match(chatWindowSource, /soundedExtensionDialogIdRef\.current = extensionDialog\.id/);
  match(chatWindowSource, /playDoneSoundRef\.current\(\)/);
});

test("suppresses sounds and browser attention for the active subagent session", () => {
  const completionSource = shellNotificationsSource.slice(
    shellNotificationsSource.indexOf("  const handleAgentEnd = useCallback"),
    shellNotificationsSource.indexOf("  const handleAttentionNeeded = useCallback"),
  );
  const attentionSource = shellNotificationsSource.slice(
    shellNotificationsSource.indexOf("  const handleAttentionNeeded = useCallback"),
    shellNotificationsSource.indexOf("  return { handleAgentEnd, handleAttentionNeeded };"),
  );
  const completionSoundSource = chatWindowSource.slice(
    chatWindowSource.indexOf("export function useChatCompletionNotification"),
    chatWindowSource.indexOf("export function ChatWindow("),
  );

  match(chatWindowSource, /completionNotificationsEnabled = session\?\.relation\?\.kind !== "subagent"/);
  match(completionSoundSource, /const notify = session\?\.relation\?\.kind !== "subagent"/, "completion adapter retains subagent sound exclusion");
  match(completionSoundSource, /if \(notify && enabledRef\.current\) soundRef\.current\(\)/, "completion adapter uses current enabled/playback refs");
  match(chatWindowSource, /wrappedOnAgentEnd = useChatCompletionNotification\(session, soundEnabled, playDoneSound, onAgentEnd\)/, "default ChatWindow calls actual completion adapter");
  match(chatWindowSource, /useAgentSession\(\{ \.\.\.props, onAgentEnd: wrappedOnAgentEnd,/, "real hook uses returned completion callback");
  match(chatWindowSource, /!completionNotificationsEnabled[\s\S]*?!extensionDialog/);
  match(completionSource, /selectedSession\?\.relation\?\.kind === "subagent"\) return/, "useShellNotifications completion family filter");
  match(attentionSource, /selectedSession\?\.relation\?\.kind === "subagent"\) return/, "useShellNotifications attention family filter");
  match(appShellSource, /import \{ useShellNotifications \} from "\.\/useShellNotifications"/, "AppShell imports actual notification owner");
  match(appShellSource, /const \{ handleAgentEnd, handleAttentionNeeded \} = useShellNotifications\(\{\s*selectedSession, handleSelectSession, locale, handleSessionSettled,/, "AppShell receives actual selected-session notification callbacks");
  match(appShellSource, /onAgentEnd=\{handleAgentEnd\}/, "actual default chat completion callback");
  match(appShellSource, /onAttentionNeeded=\{handleAttentionNeeded\}/, "actual default chat attention callback");
});

test("routes blocking extension requests through deduplicated browser attention notifications", () => {
  const completionSource = shellNotificationsSource.slice(
    shellNotificationsSource.indexOf("  const handleAgentEnd = useCallback"),
    shellNotificationsSource.indexOf("  const handleAttentionNeeded = useCallback"),
  );
  const extensionRequestSource = source.slice(
    source.indexOf("  const handleExtensionUiRequest = useCallback"),
    source.indexOf("  const settleUiStage = useCallback"),
  );
  const attentionSource = shellNotificationsSource.slice(
    shellNotificationsSource.indexOf("  const handleAttentionNeeded = useCallback"),
    shellNotificationsSource.indexOf("  return { handleAgentEnd, handleAttentionNeeded };"),
  );

  match(extensionRequestSource, /isBlockingExtensionUiRequest\(request\)[\s\S]*?onAttentionNeeded\?\.\(request\)/);
  match(chatWindowSource, /onAttentionNeeded\?: \(request: BlockingExtensionUiRequest\) => void/, "ChatWindow attention callback public type");
  match(chatWindowSource, /onSessionCreated\?: \(session: SessionInfo, sourceDraftKey: string\) => void/, "ChatWindow creation callback public sourceDraftKey type");
  match(chatWindowSource, /useAgentSession\(\{ \.\.\.props, onAgentEnd: wrappedOnAgentEnd,\s*deferInitialScroll: Boolean\(restore\[0\]\),\s*\}\)/, "default hook passes original attention/creation props without an override");
  match(completionSource, /if \(!shouldShowBrowserNotification\(\)\) return/);
  doesNotMatch(completionSource, /pushActive/);
  match(completionSource, /tag: targetSession \? `pi-session-complete:\$\{targetSession\.id\}`/);
  doesNotMatch(completionSource, /document\.visibilityState === "visible"/);
  match(attentionSource, /shouldShowBrowserNotification\(\)/);
  match(attentionSource, /claimExtensionAttentionNotification\(request, notifiedAttentionRequestIdsRef\.current\)/);
  match(attentionSource, /tag: `pi-extension-ui:\$\{request\.id\}`/);
  match(appShellSource, /const \{ handleAgentEnd, handleAttentionNeeded \} = useShellNotifications\(/, "AppShell consumes actual policy callbacks");
  match(shellNotificationsSource, /return \{ handleAgentEnd, handleAttentionNeeded \};/, "actual policy returns the checked callbacks");
  match(appShellSource, /onAttentionNeeded=\{handleAttentionNeeded\}/);
});

test("keeps live following cancellable when the user scrolls away from the tail", () => {
  const streamUpdateSource = source.slice(
    source.indexOf('case "message_start"'),
    source.indexOf('case "message_end"'),
  );
  const scrollHandlerSource = source.slice(
    source.indexOf("const handleScrollPositionChange"),
    source.indexOf("// Load session on mount"),
  );
  const scrollToBottomSource = source.slice(
    source.indexOf("const scrollToBottom"),
    source.indexOf("const currentModel"),
  );

  match(source, /const liveFollowFrameRef = useRef<number \| null>\(null\)/);
  match(source, /const previousScrollTopRef = useRef\(0\)/);
  match(source, /const wasAttached = isNearBottomRef\.current;[\s\S]*?const isAttached = getLiveFollowAttached\([\s\S]*?wasAttached,[\s\S]*?previousScrollTopRef\.current,[\s\S]*?scrollTop,[\s\S]*?clientHeight,[\s\S]*?scrollHeight/);
  match(scrollHandlerSource, /const isAgentRunning = agentRunningRef\.current;[\s\S]*?isAgentRunning\s*\? CHAT_SCROLL_REATTACH_TOLERANCE\s*:\s*CHAT_SCROLL_TAIL_TOLERANCE/);
  match(source, /previousScrollTopRef\.current = scrollTop/);
  match(scrollToBottomSource, /const container = scrollContainerRef\.current;\s*if \(!container\) return;/);
  match(scrollToBottomSource, /container\.scrollTo\(\{ top: container\.scrollHeight, behavior \}\);\s*previousScrollTopRef\.current = container\.scrollTop;/);
  doesNotMatch(scrollToBottomSource, /scrollIntoView/);
  match(streamUpdateSource, /liveFollowFrameRef\.current === null/);
  match(streamUpdateSource, /requestAnimationFrame\(\(\) => \{[\s\S]*?liveFollowFrameRef\.current = null;[\s\S]*?if \(isNearBottomRef\.current\) scrollToBottom\("auto"\)/);
  match(scrollHandlerSource, /!wasAttached && isAttached && isAgentRunning[\s\S]*?scrollToBottom\("auto"\)/);
  match(scrollHandlerSource, /cancelAnimationFrame\(liveFollowFrameRef\.current\)/);
  match(source, /previousScrollTopRef\.current = container\.scrollTop;\s*container\.addEventListener\("scroll", handleScrollPositionChange/);
  doesNotMatch(source, /SCROLL_BOTTOM_THRESHOLD|completionScrollAllowedRef|ignoreProgrammaticScrollUntilRef/);
});

test("restores an in-page session viewport without the default tail jump", () => {
  match(source, /const initialScrollDoneRef = useRef\(Boolean\(opts\.deferInitialScroll\)\)/);
  match(source, /const scrollToMessage = useCallback\(\(element: HTMLElement, viewportOffset = 16\)/);
  match(source, /container\.scrollTop\s+- viewportOffset/);
  match(chatWindowSource, /const restore = useState\(initialChatScrollRestore\(props\)\)/, "default restore tuple derives from actual public props");
  match(chatWindowSource, /deferInitialScroll: Boolean\(restore\[0\]\)/, "default hook defer consumes the same pending restore tuple");
  match(chatWindowSource, /return useChatWindowView\(\{ \.\.\.props, state, work, restore,/, "same-fiber view receives that tuple and real hook state");
  match(chatWindowSource, /const \[pendingScrollRestore, setPendingScrollRestore\] = restore/, "shared view aliases the SAME restore tuple, not a parallel owner");
  match(chatWindowSource, /const position = props\.searchTarget \? null : props\.initialScrollPosition/, "initial search suppresses saved restore baseline");
  match(chatWindowSource, /return position && !position\.atBottom \? position : null/, "initial restore retains the original non-tail guard");
  match(chatWindowSource, /isScrollAtTail\(container\.scrollTop, container\.clientHeight, container\.scrollHeight\)/);
  match(chatWindowSource, /findChatScrollAnchor\(/);
  match(chatWindowSource, /scrollToMessage\(element, position\.anchorOffset\)/);
  match(chatWindowSource, /visibility: pendingScrollRestore \? "hidden" : undefined/);
});

test("sending a prompt attaches to the real tail without a top anchor or spacer", () => {
  const scrollEffectSource = source.slice(
    source.indexOf("useLayoutEffect(() => {\n    if (messages.length > 0)"),
    source.indexOf("// Load the model list"),
  );
  match(source, /pendingScrollToBottomRef\.current = true/);
  match(scrollEffectSource, /pendingScrollToBottomRef\.current = false;\s*initialScrollDoneRef\.current = true;\s*isNearBottomRef\.current = true;\s*scrollToBottom\("instant"\)/);
  doesNotMatch(source + chatWindowSource, /scrollUserMsgToTop|promptAnchor|lastUserMsgRef/);
});

test("follows committed streaming chunks only while attached", () => {
  const followSource = source.slice(
    source.indexOf("const followLiveOutput"),
    source.indexOf("const currentModel"),
  );
  match(followSource, /!pendingScrollToBottomRef\.current && isNearBottomRef\.current/);
  match(followSource, /scrollToBottom\("auto"\)/);
  doesNotMatch(followSource, /set[A-Z]|isNearBottomRef\.current =/);
  match(chatWindowSource, /onCommit=\{followLiveOutput\}/);
  match(chatWindowSource, /useLayoutEffect\(onCommit, \[message, onCommit\]\)/);
});

test("keeps a detached viewport in place when streaming completes", () => {
  const scrollEffectSource = source.slice(
    source.indexOf("useLayoutEffect(() => {\n    if (messages.length > 0)"),
    source.indexOf("// Load the model list"),
  );

  match(scrollEffectSource, /else if \(isNearBottomRef\.current\)[\s\S]*?scrollToBottom\("auto"\)/);
  doesNotMatch(scrollEffectSource, /\|\|/);
  match(source, /addEventListener\("scroll", handleScrollPositionChange/);
});
