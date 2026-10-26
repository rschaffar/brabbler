// Real General + audio + ThinkingBlock, one physical application React/store graph.
// Only inline thinking is selected; no deferred content/read or media success double.
export { I18nProvider } from '@/hooks/useI18n';
export { SettingsWorkContext } from './SettingsUi';
export { GeneralSettings } from './SettingsPanel';
export { useAudio } from '@/hooks/useAudio';
export { ThinkingBlock } from './MessageView';
export { isThinkingExpandedByDefault } from '@/lib/thinking-expansion-preference';
