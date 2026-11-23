// The credit book's part of a shop's saved state (the store's `credit` member): its SHAPE only. The runtime that reads and writes it is the Go program (go/internal/fees
// credit_state.go, decision 61); this type is what the panel, the bundle and server/snapshot.ts read, so a saved store keeps the member whole when TypeScript code carries it.
//
// The customers' numbers are here because the owner gave them to the shop (by a typed number), and they stay here: on the shop's own server, in its own file. The owner's page
// names an account by its `ref` ("c-1"), never by the number; the report counts accounts, it never lists them.

/** One person in the book: who they are to the owner, their number, and where the first question stands. */
export interface CreditAccount {
  /** "c-1": how the owner's page and the record name the account. */
  ref: string;
  /** The name the owner calls them by ("Ramesh K"): what the owner writes, and what the customer is greeted by. */
  name: string;
  /** Their WhatsApp number, with + and the country code. */
  phone: string;
  /** Where the first question stands: "" (not asked: nothing has gone to them), "asked" (after the owner's tap), "yes" (reminders may go). STOP is the customer's own `optedOut`. */
  consent: "" | "asked" | "yes";
  askedAtMs?: number;
  yesAtMs?: number;
  /** The calendar month ("2026-11") the reminder count is for, and how many reminders went in it: reminders.maxPerMonth is a cap per calendar month for a running account. */
  remindMonth?: string;
  remindCount?: number;
  /** Opened from the settings' `creditBook.people` (at setup), not from the owner's words. */
  fromSettings?: boolean;
}

/** An entry the owner wrote for a name the book does not know, waiting for that person's number ("Ramesh owes 2,400", then the number). Only the newest waits. */
export interface CreditWaiting { name: string; amountInr: number; atMs: number }

export interface CreditState {
  people: CreditAccount[];
  /** The next "c-N". */
  nextRef: number;
  waiting?: CreditWaiting;
}
