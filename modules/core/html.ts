// Server-rendered HTML where escaping is the default, for every page the agents repo serves: the panel (bundle/panel) and a shop's public booking and owner pages
// (modules/channels). Every value put into a template is escaped unless it was marked as already-safe markup with raw() or came out of another html`` call, so a shop
// named <script>alert(1)</script>, or a customer who types one into a form, is text on every page.
import { esc } from "../report/page.ts";

// Marks a string as markup that is already escaped; html`` only skips escaping for this type, so plain strings can never become markup by accident.
export class Raw { readonly markup: string; constructor(markup: string) { this.markup = markup; } toString() { return this.markup; } }
// The deliberate escape hatch: use it only on markup built in this code, never on a typed or stored value.
export const raw = (markup: string): Raw => new Raw(markup);

const render = (v: unknown): string => {
  if (v instanceof Raw) return v.markup;
  if (Array.isArray(v)) return v.map(render).join("");
  if (v === null || v === undefined || v === false) return "";
  return esc(String(v));
};

// Template tag that escapes every interpolated value (arrays joined, null/undefined/false shown as nothing) so a hostile shop name stays text on every page.
export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new Raw(out);
}

export { esc };
