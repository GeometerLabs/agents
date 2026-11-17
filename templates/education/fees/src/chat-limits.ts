// The Fees limits the owner may change from their assistant or their app (modules/limits/chat-limits.ts): the waiver limit and the refund limit, both amounts in rupees
// where lower is tighter (0 asks the owner about every one). The hard bounds are the settings' own: a waiver is never more than the cheapest monthly fee (settings.ts
// readLimit), a refund never more than ₹5,000 from a phone. Kept apart from settings.ts so the template's settings code is untouched.
import type { ChatLimit } from "../../../../modules/limits/chat-limits.ts";
import { refundLimit, waiverLimit } from "../../../../modules/limits/chat-limit-kinds.ts";
import type { Settings } from "./settings.ts";

const MOST_REFUND_RUPEES = 5_000;
const cheapestFee = (s: unknown): number => Math.min(...((s as Settings).batches ?? []).map((b) => b.monthlyFeeInr), MOST_REFUND_RUPEES);

export const CHAT_LIMITS: readonly ChatLimit[] = [
  waiverLimit("waiver.limitInr", (s) => ({ min: 0, max: cheapestFee(s) })),
  refundLimit("refund.limitInr", () => ({ min: 0, max: MOST_REFUND_RUPEES })),
];
