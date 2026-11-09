/** Presentation bounds only; paging never narrows analysis or grants acceptance. */
export interface NotebookPageOptions { offset?: number; limit?: number }
export interface NotebookPage { offset: number; limit: number; total: number; nextOffset: number | null }
export const NOTEBOOK_REPORT_BYTES = 48 * 1024;
export function notebookPage<T, R>(items: T[], options: NotebookPageOptions, render: (items: T[], page: NotebookPage) => R): R {
  const offset = options.offset ?? 0, limit = options.limit ?? 32;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > items.length || !Number.isSafeInteger(limit) || limit < 1 || limit > 32) throw new Error("Use a notebook page offset within the result and a limit of 1–32");
  const selected: T[] = [];
  const page = (): NotebookPage => ({ offset, limit, total: items.length, nextOffset: offset + selected.length < items.length ? offset + selected.length : null });
  let result = render(selected, page());
  if (Buffer.byteLength(JSON.stringify(result)) > NOTEBOOK_REPORT_BYTES) throw new Error("Notebook report header exceeds the page byte limit");
  for (const item of items.slice(offset, offset + limit)) {
    selected.push(item);
    const candidate = render([...selected], page());
    if (Buffer.byteLength(JSON.stringify(candidate)) > NOTEBOOK_REPORT_BYTES) {
      selected.pop();
      if (!selected.length) throw new Error("Notebook report item exceeds the page byte limit; request compact detail and inspect the step");
      break;
    }
    result = candidate;
  }
  return result;
}
