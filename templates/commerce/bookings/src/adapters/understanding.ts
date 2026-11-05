// Understanding a customer's message in three steps, cheapest first: the router (modules/understanding/router.ts) with Bookings' reading (reading.ts)
// given to it. What each step is and how it is paid for is explained in the router's header.
import { createRouter as createGenericRouter } from "../../../../../modules/understanding/router.ts";
import type { RouterOptions } from "../../../../../modules/understanding/router.ts";
import type { Intent, IntentParser, ParseContext, ParseOptions, ParseResult } from "./model.ts";
import { bookingsReading } from "./reading.ts";

/** The router over Bookings' intents. */
export function createRouter(options: Omit<RouterOptions<Intent, ParseContext, ParseOptions>, "reading">): IntentParser & { parseDetailed(text: string, context: ParseContext, options?: ParseOptions): Promise<ParseResult> } {
  return createGenericRouter({ ...options, reading: bookingsReading });
}
