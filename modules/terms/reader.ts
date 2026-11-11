// Reads client/terms.json for a running shop (B72), the way the licence is read (modules/runtime/config.ts licenceReader): again whenever the file changes, so a partner's
// change reaches the runtime with no restart. No file, or a file that does not check, means the terms feature is off for this shop.
// Used by: the three templates' server/start.ts, handed on to the agent as `terms`.
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { readTermsFile } from "./terms.ts";
import type { TermsFile } from "./terms.ts";

export function termsReader(folder: string): () => TermsFile | undefined {
  const file = join(resolve(folder), "terms.json");
  let last: TermsFile | undefined;
  let seen = -1;
  return () => {
    try {
      const modified = statSync(file).mtimeMs;
      if (modified !== seen) { last = readTermsFile(JSON.parse(readFileSync(file, "utf8"))); seen = modified; }
    } catch { last = undefined; seen = -1; /* the file is gone: the feature is off again */ }
    return last;
  };
}
