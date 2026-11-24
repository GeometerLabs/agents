// The limits the owner of a parts shop may change by a tap (decision 65), for the deployer: every part's own declared limits (its template's src/chat-limits.ts), each under
// its part's own id and where it sits in the settings, exactly as the shop's Go program declares them (go/internal/parts kit.go Limits, runtime.LimitID): the id is the part's
// name with "_" for "-", "_", and the template's id ("orders_refund_limit"); the path is `parts.<part>.` and the template's path; the bounds are read from the part's own
// settings as its template reads them (settings.ts partSettings). Two parts' refund limits are two limits, each changed in its own part's block.
import type { ChatLimit } from "../../../../modules/limits/chat-limits.ts";
import { partSettings } from "./settings.ts";
import type { PartName } from "./settings.ts";

/** runtime.LimitID: a part's limit id in a parts shop. */
export const partLimitId = (part: string, id: string): string => `${part.replace(/-/gu, "_")}_${id}`;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);

/** Every part's limits, in the parts' order. */
export function partsLimits(byPart: Partial<Record<PartName, readonly ChatLimit[]>>): ChatLimit[] {
  const out: ChatLimit[] = [];
  for (const [part, limits] of Object.entries(byPart) as [PartName, readonly ChatLimit[]][]) {
    for (const l of limits) {
      out.push({
        ...l, id: partLimitId(part, l.id), path: `parts.${part}.${l.path}`,
        bounds: (settings: unknown) => {
          const raw = isObj(settings) ? settings : {};
          const block = isObj(raw.parts) && isObj(raw.parts[part]) ? raw.parts[part] : {};
          const own = partSettings(raw, part, block as Obj);
          return l.bounds(own.ok ? own.file : {});
        },
      });
    }
  }
  return out;
}
