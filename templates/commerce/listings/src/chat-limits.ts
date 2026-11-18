// The limits the owner may tighten from their assistant or app (modules/limits/chat-limits.ts). A listings-only shop has none: it takes no money and sends no message,
// so there is no cap or budget to tighten. The empty list is what lets the shop's assistant answer "I cannot change that" instead of looking for a limit.
import type { ChatLimit } from "../../../../modules/limits/chat-limits.ts";

export const CHAT_LIMITS: readonly ChatLimit[] = [];
