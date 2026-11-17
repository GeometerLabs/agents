// Writes the two chat link templates for Meta's submission (modules/channels/chat-link-templates.json), from their words (words-chat-identity.ts).
//   node modules/channels/scripts/chat-link-templates.ts            writes the file
//   node modules/channels/scripts/chat-link-templates.ts --print    prints it instead
// Why a file of its own: every chat shop (Bookings, Orders, Fees) sends the same two utility templates, so they are listed once here, not three times in the templates' own lists.
import { writeFileSync } from "node:fs";
import { chatLinkSubmissions } from "../words-chat-identity.ts";

const text = `${JSON.stringify(chatLinkSubmissions(), null, 2)}\n`;
if (process.argv.includes("--print")) process.stdout.write(text);
else {
  writeFileSync(new URL("../chat-link-templates.json", import.meta.url), text);
  console.log(`Wrote ${text.split("\n").length - 1} lines to modules/channels/chat-link-templates.json`);
}
