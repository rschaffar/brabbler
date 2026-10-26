"use client";

/** Presentation only. Callers own source authorization, format admission and lifetime.
 * Ordinary Files keeps its existing native-PDF/default and sandboxed-DOCX behavior. */
export function NativeDocumentPreview({ src, title, pdf }: { src: string; title: string; pdf: boolean }) {
  return <iframe src={src} sandbox={pdf ? undefined : "allow-same-origin"} title={title}
    style={{ width: "100%", height: "100%", border: "none", background: pdf ? "var(--bg)" : "#eef1f5" }} />;
}
