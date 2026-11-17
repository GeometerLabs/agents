// The Stock orders limits the owner may change from their assistant or their app (modules/limits/chat-limits.ts): the most one purchase order may be worth and the most
// the month's orders may add up to, both whole rupees where lower is tighter (the words in four languages are the shared ones in modules/limits/chat-limit-kinds.ts).
// The hard bounds keep the settings valid after any tap, because settings.ts refuses a shop whose dearest catalogue line is dearer than the cap, or whose cap is above
// the budget (a shop that would not start): the cap cannot go below the dearest line, and the budget cannot go below the cap in the settings file. Kept apart from
// settings.ts so the template's settings code is untouched.
import type { ChatLimit } from "../../../../modules/limits/chat-limits.ts";
import { monthlyBudgetLimit, orderCapLimit } from "../../../../modules/limits/chat-limit-kinds.ts";
import type { Settings } from "./settings.ts";

const s = (x: unknown): Settings => x as Settings;
const dearestLine = (x: unknown): number => Math.ceil(Math.max(1, ...(s(x).catalogue ?? []).map((l) => l.priceInr)));

export const CHAT_LIMITS: readonly ChatLimit[] = [
  orderCapLimit("limits.maxPerOrderInr", (x) => ({ min: dearestLine(x), max: Math.max(dearestLine(x), Math.floor(s(x).limits?.maxPerOrderInr ?? 0)) })),
  monthlyBudgetLimit("limits.monthlyBudgetInr", (x) => ({ min: Math.ceil(s(x).limits?.maxPerOrderInr ?? 1), max: Math.max(Math.ceil(s(x).limits?.maxPerOrderInr ?? 1), Math.floor(s(x).limits?.monthlyBudgetInr ?? 0)) })),
];
