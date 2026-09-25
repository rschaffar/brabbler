/** OAuth provider URLs are untrusted until their scheme is checked before linking or opening. */
export function safeAuthorizationUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url.toString();
    // Local callback/dev flows may use HTTP; a remote sign-in page must not.
    if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return url.toString();
    return null;
  } catch {
    return null;
  }
}
