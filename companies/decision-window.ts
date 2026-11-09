// What Guard's list of recent decisions can and cannot show, in one place. Guard lists at most its 500 most recent decisions, newest first, with no way to ask
// "since". A reader that comes back later therefore keeps the newest time it has read (its mark) and, when the list is full and its oldest decision is newer than
// the mark, knows that calls fell out of the list unread. Two readers use this one function, so they cannot disagree about it: the company export
// (companies/export-record.ts) and the record of "bring your own agent" (bundle/agent/record.ts).
//
// It lives here, with no imports, because the companies kit is a folder a company's engineer can read and run on its own, and `bundle/` already reaches into the
// monorepo for everything else. Putting it in `modules/` would have tied the kit to the monorepo's layout (Explanation.md, "Why the shared function is here").

/** The most decisions Guard lists at once (`GET /admin/decisions?limit=` is capped at 500). */
export const WINDOW = 500;

export interface DecisionWindow {
  /** How many decisions the list held. */
  count: number;
  /** The list is as long as Guard allows, so older decisions may exist that it does not show. */
  full: boolean;
  oldestAtMs?: number;
  newestAtMs?: number;
}

/** What one reading of Guard's list covered. `at_ms` is the time Guard wrote on each decision. */
export function windowOf(decisions: { at_ms?: unknown }[], limit: number = WINDOW): DecisionWindow {
  const times = decisions.map((d) => Number(d.at_ms)).filter(Number.isFinite);
  return { count: decisions.length, full: decisions.length >= limit, ...(times.length > 0 ? { oldestAtMs: Math.min(...times), newestAtMs: Math.max(...times) } : {}) };
}

export interface Gap {
  /** The newest time the reader had read before. */
  fromMs: number;
  /** The oldest decision the list showed this time. */
  toMs: number;
  /** In words, for the record and for the person reading it. */
  message: string;
}

/**
 * One reading against the reader's mark. `gap` is set when the list was full and its oldest decision is newer than the mark (calls between the two were never read).
 * `mark` is the mark to keep: the newest time seen so far, never going back. `who` is the subject of the sentence ("Guard", "razorpay's Guard"). A reader with no mark
 * yet (its first reading) has no gap: it cannot know what came before.
 */
export function readWindow(mark: number | undefined, w: DecisionWindow, who: string): { gap?: Gap; mark: number | undefined } {
  const next = w.newestAtMs !== undefined ? Math.max(mark ?? 0, w.newestAtMs) : mark;
  if (w.full && mark !== undefined && w.oldestAtMs !== undefined && w.oldestAtMs > mark) {
    const message = `${who} lists only its ${w.count} most recent decisions, and the oldest it showed (${new Date(w.oldestAtMs).toISOString()}) is newer than the last this record had read (${new Date(mark).toISOString()}), so some calls fell out of the list before they were read and are missing from the record.`;
    return { gap: { fromMs: mark, toMs: w.oldestAtMs, message }, mark: next };
  }
  return { mark: next };
}
