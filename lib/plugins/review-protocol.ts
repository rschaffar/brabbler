/** Client-safe review display protocol. No repository paths/revisions are inputs. */
export class ReviewReadError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}
export type ReviewView = "proposal" | "result";
export interface ReviewAvailability {
  view: ReviewView; label: string; available: boolean; reason?: string;
  before?: string; after?: string;
}
export interface ReviewOverview {
  defaultView: ReviewView; views: ReviewAvailability[];
  relation: "same" | "different" | "unknown";
  hasFiles: boolean; details: boolean;
}
export interface ReviewPage {
  files: Array<{ id: number; path: string; status: string }>;
  total: number; next: number | null;
}
export interface ReviewPreview { text: string; bytes: number; offset: number; next: number | null; complete: boolean }
export type ReviewQuery =
  | { op: "overview" }
  | { op: "page"; view: ReviewView; start: number }
  | { op: "preview"; view: ReviewView; file: number; offset: number }
  | { op: "context"; view: ReviewView; file: number }
  | { op: "patch"; view: ReviewView; file?: number }
  | { op: "details"; offset: number; download: boolean };
