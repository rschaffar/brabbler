export type FontKind = "ui" | "mono";
// Leave emphasis (600/700) at least as heavy as the base, including xterm bold.
export const FONT_WEIGHT_OPTIONS = [
  { value: 100, label: "settings.fontWeightThin" },
  { value: 200, label: "settings.fontWeightExtraLight" },
  { value: 300, label: "settings.fontWeightLight" },
  { value: 400, label: "settings.fontWeightRegular" },
  { value: 500, label: "settings.fontWeightMedium" },
  { value: 600, label: "settings.fontWeightSemiBold" },
] as const;
export type FontWeight = (typeof FONT_WEIGHT_OPTIONS)[number]["value"];
export type FontPreferences = Record<FontKind, string> & Record<`${FontKind}Weight`, FontWeight>;
export const FONT_FAMILY_MAX_LENGTH = 500;
export const FONT_WEIGHT_DEFAULT: FontWeight = 400;
export const FONT_STORAGE_KEYS: Record<keyof FontPreferences, string> = {
  ui: "brabbler-ui-font-family", mono: "brabbler-mono-font-family",
  uiWeight: "brabbler-ui-font-weight", monoWeight: "brabbler-mono-font-weight",
};
export const DEFAULT_FONT_PREFERENCES: FontPreferences = {
  ui: "", mono: "", uiWeight: 400, monoWeight: 400,
};

export function readFontWeight(value: unknown): FontWeight {
  const weight = typeof value === "string" ? Number(value) : value;
  return FONT_WEIGHT_OPTIONS.find((option) => option.value === weight)?.value ?? FONT_WEIGHT_DEFAULT;
}

/** Preserve whitespace while typing, but bound browser-owned data. */
export function readFontPreference(value: unknown): string {
  return typeof value === "string" && value.length <= FONT_FAMILY_MAX_LENGTH ? value : "";
}

const GENERIC_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
  "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "math", "fangsong",
]);

/** CSS strings, not JSON strings: controls need CSS hex escapes, not JS escapes. */
function quoteFamily(name: string): string {
  return `"${Array.from(name, (char) => {
    if (char === '"' || char === "\\") return `\\${char}`;
    const code = char.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return `\\${(code === 0 ? 0xfffd : code).toString(16)} `;
    return char;
  }).join("")}"`;
}

/** Names only, never arbitrary CSS. Quoted commas and escaped quotes stay data. */
export function fontFamilyCss(value: unknown): string {
  const parts: string[] = [];
  let part = "", quote = "", escaped = false;
  for (const char of readFontPreference(value)) {
    if (escaped) { part += char; escaped = false; continue; }
    if (char === "\\") { part += char; escaped = true; continue; }
    if (quote) { part += char; if (char === quote) quote = ""; continue; }
    if ((char === '"' || char === "'") && !part.trim()) { part += char; quote = char; continue; }
    if (char === ",") { parts.push(part); part = ""; } else part += char;
  }
  parts.push(part);
  return parts.flatMap((raw) => {
    let name = raw.trim();
    const quoted = name.length >= 2 && (name[0] === '"' || name[0] === "'") && name.endsWith(name[0]);
    if (quoted) name = name.slice(1, -1).replace(/\\([\\"'])/g, "$1");
    if (!name) return [];
    return [!quoted && GENERIC_FAMILIES.has(name.toLowerCase()) ? name.toLowerCase() : quoteFamily(name)];
  }).join(", ");
}

export function fontFamilyOverride(kind: FontKind, value: unknown): string {
  const family = fontFamilyCss(value);
  return family ? `${family}, var(--font-${kind}-default)` : "";
}
