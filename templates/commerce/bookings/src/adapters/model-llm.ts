// The language-model parser for Bookings: the shared parser (modules/understanding/model-llm.ts) with Bookings' reading (reading.ts) given to it.
import { createModelParser as createParser } from "../../../../../modules/understanding/model-llm.ts";
import type { ModelConfig, ModelParser } from "../../../../../modules/understanding/model-llm.ts";
import type { Intent, ParseContext } from "./model.ts";
import { bookingsReading } from "./reading.ts";

/** Creates the parser. Creating it makes no call. `fetchFn` is how the eval script adds a key; the runtime leaves it alone, so the runtime sends none. */
export function createModelParser(config: ModelConfig, fetchFn: typeof fetch = globalThis.fetch): ModelParser<Intent, ParseContext> {
  return createParser(config, bookingsReading, fetchFn);
}
