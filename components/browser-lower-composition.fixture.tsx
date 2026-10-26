// One physical production graph; no component/hook/decision doubles.
export { NavigationWork, NavigationWorkContext } from "@/lib/navigation-work";
export { I18nProvider } from "@/hooks/useI18n";
export { SessionSidebar } from "./SessionSidebar";
export { NavigationHarness } from "./navigation-composition.fixture";
export { createActivityClientController } from "@/lib/activity-client-controller";
export { SessionBulkMoveDialog } from "./SessionBulkMoveDialog";
export { SessionMoveDestinationPicker } from "./SessionMoveDestinationPicker";
export { WorktreeManager } from "./WorktreeManager";
export * from "@/lib/worktree-management-view";
export { createProjectOperationHost } from "@/lib/plugins/project-operation-host";
export { encodeFilePathForApi } from "@/lib/file-paths";
