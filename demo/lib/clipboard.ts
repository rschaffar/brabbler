export function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      if (!document.execCommand("copy")) throw new Error("Copy command was rejected");
    } finally {
      document.body.removeChild(ta);
    }
    return Promise.resolve();
  } catch {
    return Promise.reject(new Error("Could not copy text"));
  }
}
