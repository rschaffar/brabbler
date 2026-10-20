export interface TextareaEdit {
  start: number;
  end: number;
  text: string;
}

interface ListItemPrefix {
  indent: string;
  marker: string;
  number: string | null;
  delimiter: string;
  spacing: string;
  task: boolean;
  length: number;
}

const BULLET_ITEM = /^([ \t]*)([-*+])([ \t]+)(\[[ xX]\](?:[ \t]+|$))?/;
const ORDERED_ITEM = /^([ \t]*)(\d{1,9})([.)])([ \t]+)(\[[ xX]\](?:[ \t]+|$))?/;
// Short numbers distinguish Chinese enumeration from dates such as 2020、2021年.
const CJK_ORDERED_ITEM = /^([ \t]*)(\d{1,3})(、)([ \t]*)/;
const THEMATIC_BREAK = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const CODE_FENCE = /^[ \t]*(`{3,}|~{3,})/;

function parseListItemPrefix(line: string): ListItemPrefix | null {
  if (THEMATIC_BREAK.test(line)) return null;
  const bullet = BULLET_ITEM.exec(line);
  if (bullet) {
    return {
      indent: bullet[1], marker: bullet[2], number: null, delimiter: "",
      spacing: bullet[3], task: bullet[4] !== undefined, length: bullet[0].length,
    };
  }
  const ordered = ORDERED_ITEM.exec(line) ?? CJK_ORDERED_ITEM.exec(line);
  if (!ordered) return null;
  return {
    indent: ordered[1], marker: "", number: ordered[2], delimiter: ordered[3],
    spacing: ordered[4], task: ordered[5] !== undefined, length: ordered[0].length,
  };
}

function isInsideFencedCode(textBeforeLine: string): boolean {
  let openFence: string | null = null;
  for (const line of textBeforeLine.split("\n")) {
    let candidate = line;
    if (openFence === null) {
      let prefix;
      while ((prefix = parseListItemPrefix(candidate))) candidate = candidate.slice(prefix.length);
    }
    const fence = CODE_FENCE.exec(candidate)?.[1];
    if (!fence) continue;
    if (openFence === null) openFence = fence;
    else if (fence[0] === openFence[0] && fence.length >= openFence.length && line.trim() === fence) openFence = null;
  }
  return openFence !== null;
}

function indentWidth(indent: string): number {
  let width = 0;
  for (const char of indent) width += char === "\t" ? 4 - width % 4 : 1;
  return width;
}

function isIndentedCode(indent: string, textBeforeLine: string): boolean {
  const width = indentWidth(indent);
  if (width < 4) return false;
  // A deeply indented marker is a nested item only beneath a shallower item.
  // Otherwise it is code, and native newline behavior is safer than rewriting it.
  for (const line of textBeforeLine.trimEnd().split("\n").reverse()) {
    if (!line.trim()) continue;
    const previousIndent = /^[ \t]*/.exec(line)![0];
    if (indentWidth(previousIndent) < width) {
      const parent = parseListItemPrefix(line);
      if (!parent) return true;
      const marker = parent.number === null ? parent.marker : parent.number + parent.delimiter;
      const contentColumn = indentWidth(parent.indent + marker + parent.spacing);
      return width >= contentColumn + 4;
    }
  }
  return true;
}

function nextListItemPrefix(item: ListItemPrefix): string {
  const marker = item.number === null
    ? item.marker
    : `${String(Number(item.number) + 1).padStart(item.number.length, "0")}${item.delimiter}`;
  return `${item.indent}${marker}${item.spacing}${item.task ? "[ ] " : ""}`;
}

/** Plan an undoable native edit, or return null to retain the ordinary newline. */
export function getMarkdownListContinuation(value: string, selectionStart: number, selectionEnd: number): TextareaEdit | null {
  if (selectionStart !== selectionEnd) return null;
  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const newlineIndex = value.indexOf("\n", selectionStart);
  const lineEnd = newlineIndex === -1 ? value.length : newlineIndex;
  const line = value.slice(lineStart, lineEnd);
  const item = parseListItemPrefix(line);
  if (!item || selectionStart - lineStart < item.length) return null;
  const before = value.slice(0, lineStart);
  if (isInsideFencedCode(before) || isIndentedCode(item.indent, before)) return null;
  if (line.slice(item.length).trim() === "") return { start: lineStart, end: lineEnd, text: "" };
  return { start: selectionStart, end: selectionStart, text: `\n${nextListItemPrefix(item)}` };
}
