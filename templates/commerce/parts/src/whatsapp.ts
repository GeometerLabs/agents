// The WhatsApp templates of a shop of several parts (decision 65), as the HAND CHECK's stand-in WhatsApp knows them: the union of its parts' Meta template catalogues
// (and the shop's assistant's), each once. What the shop SUBMITS to its WhatsApp account is the bundle's one template set, bundle/lib/wa-templates.ts (`shopParts` reads a
// parts shop's parts; `templateSet` merges same-name same-words entries and refuses different words): this file does not submit anything. The rule here is the same one:
//   a template is the same template when its name (and, for an entry, its language) is the same; the same name with other words in two parts is a CONFLICT, said in plain
//   words and never used (one number cannot have one template name meaning two messages).
import { META_TEMPLATES as FEES_META } from "../../../education/fees/src/language/meta-templates.ts";
import { REPORT_TEMPLATES as FEES_REPORT } from "../../../education/fees/report/whatsapp.ts";
import { META_TEMPLATES as ORDERS_META } from "../../orders/src/language/meta-templates.ts";
import { REPORT_TEMPLATES as ORDERS_REPORT } from "../../orders/report/whatsapp.ts";
import { META_TEMPLATES as STOCK_META } from "../../stock-orders/src/language/meta-templates.ts";
import { REPORT_TEMPLATES as STOCK_REPORT } from "../../stock-orders/report/whatsapp.ts";
import { assistantCatalogue } from "../../../../modules/assistant/templates.ts";
import type { PartName } from "./settings.ts";

/** Each part's own templates, as its template's stand-ins and generator know them. */
const OF: Record<PartName, readonly { name: string }[]> = {
  fees: [...FEES_META, ...FEES_REPORT],
  orders: [...ORDERS_META, ...ORDERS_REPORT],
  "stock-orders": [...STOCK_META, ...STOCK_REPORT],
};

const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));

/** The union of lists of templates, in order, each (name, language) once; a name whose words differ between two lists is a conflict. */
export function unionOfTemplates<T extends { name: string; language?: string }>(lists: readonly (readonly T[])[]): { templates: T[]; conflicts: string[] } {
  const seen = new Map<string, T>();
  const templates: T[] = [];
  const conflicts: string[] = [];
  for (const list of lists) {
    for (const t of list) {
      const key = `${t.name}\u0000${t.language ?? ""}`;
      const had = seen.get(key);
      if (!had) { seen.set(key, t); templates.push(t); continue; }
      if (canon(had) !== canon(t)) conflicts.push(`The WhatsApp template "${t.name}"${t.language ? ` (${t.language})` : ""} is in two parts with different words, so neither can be used on one number.`);
    }
  }
  return { templates, conflicts };
}

/**
 * The Meta templates a parts shop's number needs: its parts', each once, and with the shop's assistant (an "assistant" block) the assistant's own (the morning line, a closed
 * day), which belong to the shop and not to any part. What the hand check's stand-in serves. Throws on a conflict.
 */
export function partsMetaTemplates<T extends { name: string } = { name: string }>(parts: readonly PartName[], o: { assistant?: boolean } = {}): T[] {
  const u = unionOfTemplates([...parts.map((p) => OF[p]), ...(o.assistant ? [assistantCatalogue.templates] : [])]);
  if (u.conflicts.length > 0) throw new Error(u.conflicts.join(" "));
  return u.templates as T[];
}
