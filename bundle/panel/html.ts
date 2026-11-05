// Server-rendered HTML where escaping is the default: every value put into a template is escaped unless it was marked as already-safe markup
// with raw() or came out of another html`` call. A shop named <script>alert(1)</script> is text on every page.
import { esc } from "../../modules/report/page.ts";

export class Raw { readonly markup: string; constructor(markup: string) { this.markup = markup; } toString() { return this.markup; } }
export const raw = (markup: string): Raw => new Raw(markup);

const render = (v: unknown): string => {
  if (v instanceof Raw) return v.markup;
  if (Array.isArray(v)) return v.map(render).join("");
  if (v === null || v === undefined || v === false) return "";
  return esc(String(v));
};

export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new Raw(out);
}

export { esc };
