// The three papers for one centre, from its record (B28, B35, B36): a parent's statement, the record of one fee, the agent's identity paper, and the record
// as an evidence pack for geo-verify. The options are in modules/papers/cli.ts; --cases is the centre's fees (dues.json).
//   node templates/education/fees/scripts/papers.ts statement --number +919811100001 --settings centre.json --record entries.json --cases dues.json --out ./out --key key.pem
//   node templates/education/fees/scripts/papers.ts dispute --case f-2 --settings centre.json --record entries.json --cases dues.json --out ./out
import { runPapersCli } from "../../../../modules/papers/cli.ts";
import { main, readDues, readSettings } from "../report/cli.ts";
import { FEES_PAPERS, feeCase, fromGoLive, limitFacts } from "../report/papers.ts";

await main(() => runPapersCli(process.argv.slice(2), {
  papers: FEES_PAPERS,
  readSettings,
  readCases: (path, settings) => readDues(path).map((d) => feeCase(d, settings)),
  shop: (s) => ({ name: s.name, timeZone: s.timezone, ownerLanguage: s.owner.language }),
  limitFacts,
  fromGoLive,
}));
