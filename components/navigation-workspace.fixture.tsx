import { useRef, type ComponentProps, type RefObject } from "react";
import { NavigationHarness } from "./navigation-composition.fixture";
import { I18nProvider } from "@/hooks/useI18n";
import { NavigationWork, NavigationWorkContext } from "@/lib/navigation-work";
import { FileWorkspace, type FileWorkspaceHandle } from "./FileWorkspace";
export { FileEditSessions } from "@/lib/file-edit-sessions";
export { NavigationWork };

/** Real navigation/file binding AND real Workspace with its own unmodified
 * FileWorkspaceStore/FileEditSessions/Viewer. Only outer callbacks are supplied.
 * No fake readers, layouts, edit stores or child state decisions. */
export function NavigationWorkspaceComposition({ work, workspaceRef, onCommit, onWork, router }: {
  work: NavigationWork;
  workspaceRef: RefObject<FileWorkspaceHandle | null>;
  onCommit: ComponentProps<typeof NavigationHarness>["onCommit"];
  onWork: ComponentProps<typeof FileWorkspace>["onWork"];
  router: ComponentProps<typeof NavigationHarness>["router"];
}) {
  const onStatus = useRef<NonNullable<ComponentProps<typeof FileWorkspace>["onStatus"]>>(() => {});
  return <I18nProvider><NavigationWorkContext.Provider value={work}>
    <NavigationHarness router={router} onCommit={onCommit} renderWorkspace={(binding, panel) =>
      <section hidden={!panel.rightPanelOpen} data-navigation-files-panel>
        <FileWorkspace ref={workspaceRef} workspaceKey={binding.fileWorkspaceKey}
          active={panel.rightPanelOpen && panel.activeFileTabId === "files"} presented={panel.activeFileTabId === "files"}
          gitRefreshKey={0} onWork={onWork} onStatus={onStatus.current}
          onShowFiles={panel.showFiles} onEmpty={() => {}}
          onFocusWorkspace={key => binding.setParkedFileWorkspaceKey(key === binding.currentFileWorkspaceKey ? null : key)}
          onMentionLines={() => {}} onAtMention={() => {}} />
      </section>} />
  </NavigationWorkContext.Provider></I18nProvider>;
}
