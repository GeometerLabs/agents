// May this release skip the Docker proof? Compares the last full proof's results.json with the present tree (rule: test/proof/provenance.ts, runbook section 6).
//   GUARD_INPUT_DIGEST=<digest of R16-guard-unchanged> node bundle/test/proof/same-as-last.ts <last results.json> [--guard-image IMAGE]
// Prints the decision and the reason. Exit 0: skip; 10: run the core set (`run.ts --only <CORE_PHASES>`); 20: run the full proof.
import { readFileSync } from "node:fs";
import { collect, decide, CORE_PHASES } from "./provenance.ts";

const APP = new URL("../../../", import.meta.url).pathname.replace(/\/$/u, "");
const file = process.argv[2];
let last = null;
try { last = file ? JSON.parse(readFileSync(file, "utf8")) : null; } catch { last = null; }
const gi = process.argv.includes("--guard-image") ? process.argv[process.argv.indexOf("--guard-image") + 1] : "";
const now = collect(APP, { guardInputDigest: process.env.GUARD_INPUT_DIGEST ?? "", guardImage: gi, onlyPhases: null, shopSizes: [1, 5, 10] });
const d = decide(last, now);
console.log(`${["SKIP", "", "", "", "", "", "", "", "", "", "CORE", "", "", "", "", "", "", "", "", "", "FULL"][d.code]}: ${d.reason}`);
if (d.code === 10) console.log(`run: node bundle/test/proof/run.ts --shops 1 --only ${CORE_PHASES}`);
process.exit(d.code);
