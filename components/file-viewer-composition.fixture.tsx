import type { ComponentProps } from "react";
import { FileViewer } from "./FileViewer";
import { FileEditContext } from "../hooks/useFileEditSession";
import { FileEditSessions } from "../lib/file-edit-sessions";
import { I18nProvider } from "../hooks/useI18n";

export { FileEditSessions };
export type ViewerProps = ComponentProps<typeof FileViewer>;

// One physical import graph gives FileViewer and the provider the SAME context
// and store class. No child, hook, parser or state-machine doubles.
export function FileViewerComposition({ store, viewers, focusView = () => {} }: {
  store: FileEditSessions;
  viewers: (ViewerProps & { viewId: string })[];
  focusView?: (id: string) => void;
}) {
  return <I18nProvider>{viewers.map(({ viewId, ...props }) => (
    <section key={viewId} data-test-view={viewId}>
      <FileEditContext.Provider value={{ store, viewId, focusView }}>
        <FileViewer {...props} />
      </FileEditContext.Provider>
    </section>
  ))}</I18nProvider>;
}
