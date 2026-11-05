// The WhatsApp templates to submit to Meta, one entry per template and language, in the body of Meta's create-template call
// (POST /{waba-id}/message_templates). The wording lives in src/language/meta-templates.ts (the booking messages) and report/whatsapp.ts (the owner's monthly
// report, two templates); this file only writes the list.
//
//   node templates/commerce/bookings/scripts/whatsapp-templates.ts            print the list
//   node templates/commerce/bookings/scripts/whatsapp-templates.ts --write    refresh whatsapp-templates.json (a test fails when it is out of date)
import { writeFileSync } from "node:fs";
import { glowSalon } from "../src/harness.ts";
import { metaSubmissions } from "../src/language/meta-templates.ts";
import { reportSubmissions } from "../report/whatsapp.ts";

const json = JSON.stringify([...metaSubmissions(glowSalon()), ...reportSubmissions()], null, 2) + "\n";
if (process.argv.includes("--write")) {
  writeFileSync(new URL("../whatsapp-templates.json", import.meta.url), json);
  console.log("Wrote templates/commerce/bookings/whatsapp-templates.json");
} else {
  process.stdout.write(json);
}
