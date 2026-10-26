import React from 'react';
import { I18nProvider, useI18n } from '../hooks/useI18n';
import { SessionToolbarActions, SessionStatsButton, MainFileToggle, MobileSessionIdentity, useTopPanelState, SubagentToolbarMarker } from './AppShellToolbar';
export { I18nProvider };
export * from './AppShellToolbar';
type WithoutTranslate<T> = Omit<T, 'translate'>;
export function ToolbarControls(props: WithoutTranslate<React.ComponentProps<typeof SessionToolbarActions>>) {
  const { t } = useI18n(); return <SessionToolbarActions {...props} translate={t} />;
}
export function ToolbarStats(props: Omit<React.ComponentProps<typeof SessionStatsButton>, 'translate' | 'locale'>) {
  const { t, locale } = useI18n(); return <SessionStatsButton {...props} locale={locale} translate={t} />;
}
export function ToolbarFiles(props: WithoutTranslate<React.ComponentProps<typeof MainFileToggle>>) {
  const { t } = useI18n(); return <MainFileToggle {...props} translate={t} />;
}
export function ToolbarMarker(props: WithoutTranslate<React.ComponentProps<typeof SubagentToolbarMarker>>) {
  const { t } = useI18n(); return <SubagentToolbarMarker {...props} translate={t} />;
}
export function ToolbarIdentity(props: WithoutTranslate<React.ComponentProps<typeof MobileSessionIdentity>>) {
  const { t } = useI18n(); return <MobileSessionIdentity {...props} translate={t} />;
}

export function ToolbarStateProbe({ controls, fullWidth, api, onSidebar }: {
  controls: WithoutTranslate<React.ComponentProps<typeof SessionToolbarActions>>;
  fullWidth: boolean; api: React.Ref<ReturnType<typeof useTopPanelState>>; onSidebar: (open: boolean) => void;
}) {
  const topBarRef = React.useRef<HTMLDivElement>(null);
  const setSidebarOpen = React.useCallback<React.Dispatch<React.SetStateAction<boolean>>>((open) => {
    if (typeof open !== 'boolean') throw new Error('Toolbar fixture owns only explicit sidebar values');
    onSidebar(open);
  }, [onSidebar]);
  const state = useTopPanelState({ sessionHasBranches: controls.sessionHasBranches,
    hasSubagentSessions: controls.hasSubagentSessions, rightPanelFullWidth: fullWidth,
    isMobile: controls.mobile, topBarRef, setSidebarOpen });
  React.useImperativeHandle(api, () => state);
  return <div ref={topBarRef}><ToolbarControls {...controls} topBarRef={topBarRef} activeTopPanel={state.activeTopPanel} toggleTopPanel={state.toggleTopPanel} /></div>;
}
