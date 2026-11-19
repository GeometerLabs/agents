// The vector files of the packages that come after the shared core: every module listed here exports `files()` returning `[path under go/internal, value]` pairs. A module that does not
// exist yet is skipped, so each package's generator can be added on its own.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MODULES = ["razorpay", "refunds", "fakes", "upi", "messaging", "calendar", "qr", "terms"];

export async function all(): Promise<[string, unknown][]> {
  const out: [string, unknown][] = [];
  for (const m of MODULES) {
    if (!existsSync(fileURLToPath(new URL(`./${m}.ts`, import.meta.url)))) continue;
    out.push(...await (await import(`./${m}.ts`)).files());
  }
  return out;
}
