// Adapted from upstream 046bc67e. Keep the package barrel/full Prism out of
// synchronous imports. This uses the existing dependency's own entry, not a
// new parser or a direct dependency on its transitive refractor package.
export function createPrismLoader(importLanguages: () => Promise<unknown>) {
  let loading: Promise<void> | null = null;
  return {
    load(): Promise<void> {
      loading ??= Promise.resolve().then(importLanguages).then(
        () => {},
        (error: unknown) => { loading = null; throw error; },
      );
      return loading;
    },
  };
}

const languages = createPrismLoader(() => import("react-syntax-highlighter/dist/esm/prism"));
export const loadPrismLanguages = languages.load;

export function needsPrismLanguage(language: string): boolean {
  return !["", "text", "plaintext", "plain", "txt"].includes(language.toLowerCase());
}
