// Writes the list of WhatsApp templates to submit to Meta (whatsapp-templates.json), from the messages themselves (src/language/meta-templates.ts).
//   node templates/commerce/stock-orders/scripts/whatsapp-templates.ts            writes templates/commerce/stock-orders/whatsapp-templates.json
//   node templates/commerce/stock-orders/scripts/whatsapp-templates.ts --print    prints it instead
import { writeFileSync } from "node:fs";
import { glowSalon } from "../src/harness.ts";
import { metaSubmissions } from "../src/language/meta-templates.ts";
import { reportSubmissions } from "../report/whatsapp.ts";

const text = `${JSON.stringify([...metaSubmissions(glowSalon()), ...reportSubmissions()], null, 2)}\n`;
if (process.argv.includes("--print")) process.stdout.write(text);
else {
  writeFileSync(new URL("../whatsapp-templates.json", import.meta.url), text);
  console.log(`Wrote ${text.split("\n").length - 1} lines to templates/commerce/stock-orders/whatsapp-templates.json`);
}
