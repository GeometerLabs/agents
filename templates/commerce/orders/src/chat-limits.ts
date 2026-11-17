// The Orders limits the owner may change from their assistant or their app (modules/limits/chat-limits.ts): the amount above which an order waits for the owner
// (owner.approveOverInr, where 0 means never), the refund limit, and the most orders in a day (orders.maxPerDay). The hard bounds are the settings' own checks
// (settings.ts: orders a day 1 to 10,000) and a ceiling for a phone. Kept apart from settings.ts so the template's settings code is untouched.
import type { ChatLimit } from "../../../../modules/limits/chat-limits.ts";
import { bigOrderLimit, ordersPerDayLimit, refundLimit } from "../../../../modules/limits/chat-limit-kinds.ts";

export const CHAT_LIMITS: readonly ChatLimit[] = [
  bigOrderLimit("owner.approveOverInr", () => ({ min: 0, max: 100_000 })),
  refundLimit("refund.limitInr", () => ({ min: 0, max: 10_000 })),
  ordersPerDayLimit("orders.maxPerDay", () => ({ min: 1, max: 10_000 })),
];
