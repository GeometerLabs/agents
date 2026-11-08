// The three papers for one shop, from its record (B28, B35, B36): a customer's statement, the record of one booking, the agent's identity paper, and the
// record as an evidence pack for geo-verify. The options are in modules/papers/cli.ts; --cases is the conversation store's bookings.
//   node templates/commerce/bookings/scripts/papers.ts statement --number +919800000001 --settings shop.json --record entries.json --cases bookings.json --out ./out --key key.pem
//   node templates/commerce/bookings/scripts/papers.ts dispute --case b-3 --settings shop.json --record entries.json --cases bookings.json --out ./out
import { runPapersCli } from "../../../../modules/papers/cli.ts";
import { main, readBookings, readSettings } from "../report/cli.ts";
import { BOOKINGS_PAPERS, bookingCase, fromGoLive, limitFacts } from "../report/papers.ts";

await main(() => runPapersCli(process.argv.slice(2), {
  papers: BOOKINGS_PAPERS,
  readSettings,
  readCases: (path, settings) => readBookings(path).map((b) => bookingCase(b, settings)),
  shop: (s) => ({ name: s.name, timeZone: s.timezone, ownerLanguage: s.owner.language }),
  limitFacts,
  fromGoLive,
}));
