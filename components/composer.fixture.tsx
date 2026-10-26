import React, { useImperativeHandle, useState } from 'react';
import { I18nProvider } from '../hooks/useI18n';
import { useAudio } from '../hooks/useAudio';
import { useFontPreferences, type createFontPreferencesStore } from '../hooks/useFontPreferences';
import { useViewportHeight } from '../hooks/useViewportHeight';
import { useQuotedChatBranch } from '../hooks/useQuotedChatBranch';
import { ChatWindowView, initialChatScrollRestore, useChatCompletionNotification, type ChatWindowProps } from './ChatWindow';
import { useShellNotifications } from './useShellNotifications';
import type { BlockingExtensionUiRequest } from '../lib/types';
import type { useAgentSession } from '../hooks/useAgentSession';
import type { ComposerWork } from '../lib/client-completion';
export { ChatInput } from './ChatInput';
export { ModelSelector } from './ModelSelector';
// The actual default component is available to the existing hook/default owner;
// this re-export adds no hook factory, transport or replacement state.
export { ChatWindow, NoticeShelf, ProcessDetailsGroup } from './ChatWindow';
export { createComposerWork } from '../lib/client-completion';
export { createStreamingStore } from '../lib/streaming-message';
export { getDraft, setDraft, clearDraft } from '../lib/draft-store';
export { I18nProvider };
export * from '../hooks/useFontPreferences';
export { shouldUseVisualViewportHeight } from '../hooks/useViewportHeight';
export function ChatView(props: ChatWindowProps & { state: ReturnType<typeof useAgentSession>; work: ComposerWork }) {
  const restore = useState(initialChatScrollRestore(props));
  return <ChatWindowView {...props} restore={restore} />;
}
export function AudioProbe({ api, work }: { api: React.Ref<ReturnType<typeof useAudio>>; work?: ComposerWork }) {
  const audio = useAudio(work);
  useImperativeHandle(api, () => audio);
  return <button onClick={audio.onSoundToggle}>{String(audio.soundEnabled)}</button>;
}
export function FontProbe({ api, store }: { api: React.Ref<ReturnType<typeof useFontPreferences>>; store?: ReturnType<typeof createFontPreferencesStore> }) {
  const fonts = useFontPreferences(store);
  useImperativeHandle(api, () => fonts);
  return <output>{JSON.stringify({ ui: fonts.ui, mono: fonts.mono, uiWeight: fonts.uiWeight, monoWeight: fonts.monoWeight })}</output>;
}
export function CompletionProbe({ session, enabled, play, end, api }: {
  session: ChatWindowProps['session']; enabled: boolean; play: () => void; end?: () => void; api: React.Ref<() => void>;
}) {
  const complete = useChatCompletionNotification(session, enabled, play, end);
  useImperativeHandle(api, () => complete);
  return null;
}
export function QuoteBranchProbe({ selectedId, onForked, api }: {
  selectedId?: string; onForked: (id: string) => void; api: React.Ref<ReturnType<typeof useQuotedChatBranch>>;
}) {
  const branch = useQuotedChatBranch(selectedId, onForked);
  useImperativeHandle(api, () => branch);
  return <output>{branch.initialPrompt ?? ''}</output>;
}
export function QuoteBranchChatView({ branch, ...props }: ChatWindowProps & {
  state: ReturnType<typeof useAgentSession>; work: ComposerWork;
  branch: { selectedId?: string; onForked: (id: string) => void };
}) {
  const quote = useQuotedChatBranch(branch.selectedId, branch.onForked);
  return <ChatView {...props} onAskInNewChat={quote.onAskInNewChat}
    initialPrompt={quote.initialPrompt} onInitialPromptConsumed={quote.onInitialPromptConsumed} />;
}
// Real production-called policy; only its public inputs/events are supplied here.
export function ShellNotificationProbe({ selectedSession, request, onSelected, onSettled }: {
  selectedSession: ChatWindowProps['session']; request: BlockingExtensionUiRequest;
  onSelected: (session: NonNullable<ChatWindowProps['session']>) => void; onSettled: () => void;
}) {
  const notifiedAttentionRequestIdsRef = React.useRef(new Set<string>());
  const [revision, setExplorerRefreshKey] = useState(0);
  const { handleAgentEnd, handleAttentionNeeded } = useShellNotifications({
    selectedSession, handleSelectSession: onSelected, locale: 'en', handleSessionSettled: onSettled,
    setExplorerRefreshKey, translate: key => key, notifiedAttentionRequestIdsRef,
  });
  return <><output>{revision}</output><button onClick={handleAgentEnd}>Complete</button>
    <button onClick={() => handleAttentionNeeded(request)}>Attention</button></>;
}
export function ViewportProbe() {
  useViewportHeight();
  return <input aria-label="editable" />;
}
