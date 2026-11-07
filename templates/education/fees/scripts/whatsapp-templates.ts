// Writes the list of WhatsApp templates to submit to Meta (whatsapp-templates.json), from the messages themselves (src/language/meta-templates.ts).
//   node templates/education/fees/scripts/whatsapp-templates.ts            writes templates/education/fees/whatsapp-templates.json
//   node templates/education/fees/scripts/whatsapp-templates.ts --print    prints it instead
import { writeFileSync } from "node:fs";
import { brightTuition } from "../src/harness.ts";
import { reportSubmissions } from "../report/whatsapp.ts";
import { metaSubmissions } from "../src/language/meta-templates.ts";

const text = `${JSON.stringify([...metaSubmissions(brightTuition()), ...reportSubmissions()], null, 2)}\n`;
if (process.argv.includes("--print")) process.stdout.write(text);
else {
  writeFileSync(new URL("../whatsapp-templates.json", import.meta.url), text);
  console.log(`Wrote ${text.split("\n").length - 1} lines to templates/education/fees/whatsapp-templates.json`);
}
