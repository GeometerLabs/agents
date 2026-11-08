// The three papers for one shop, from its record (B28, B35, B36): a customer's statement, the record of one order, the agent's identity paper, and the record
// as an evidence pack for geo-verify. The options are in modules/papers/cli.ts; --cases is the shop's orders (orders.json).
//   node templates/commerce/orders/scripts/papers.ts statement --number +919811100001 --settings shop.json --record entries.json --cases orders.json --out ./out --key key.pem
//   node templates/commerce/orders/scripts/papers.ts dispute --case o-3 --settings shop.json --record entries.json --cases orders.json --out ./out
import { runPapersCli } from "../../../../modules/papers/cli.ts";
import { main, readOrders, readSettings } from "../report/cli.ts";
import { ORDERS_PAPERS, orderCase, fromGoLive, limitFacts } from "../report/papers.ts";

await main(() => runPapersCli(process.argv.slice(2), {
  papers: ORDERS_PAPERS,
  readSettings,
  readCases: (path, settings) => readOrders(path).map((o) => orderCase(o, settings)),
  shop: (s) => ({ name: s.name, timeZone: s.timezone, ownerLanguage: s.owner.language }),
  limitFacts,
  fromGoLive,
}));
