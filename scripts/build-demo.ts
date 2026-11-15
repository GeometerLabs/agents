// Builds the hosted demo: one folder that the Operator server's Caddy serves at https://streetlist.in/demo (plan: release-flow-gaps.md, problem 2, batch 2b). It holds
//
//   demo.html                  the list: the three demo shops, each with its four languages            -> /demo
//   demo/bookings.html         one page per template (a path of its own, the language in ?lang=)       -> /demo/bookings, /demo/orders, /demo/fees
//   demo/orders.html  demo/fees.html
//   demo/demo.css  demo/page.js   the one stylesheet and the one script every page uses (no inline style or script: the pages domain allows files of its own only)
//   demo/<template>/...        the template's own code made for the browser (plain ES modules): the REAL agent on the in-memory stand-ins, run in the visitor's page
//
// Nothing here is a server. Every visit builds its own shop in the visitor's browser, so strangers share nothing, a reload starts fresh, no request reaches a shop or any
// real service, and there is nothing for the door's rate limits to limit. `geometer home pack <streetlist> --demo <this folder>` puts the folder into the home pack.
//   node scripts/build-demo.ts <out>
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildWebDemo } from "../templates/commerce/bookings/scripts/build-web-demo.ts";
import { QUICK_LANGUAGE_NAMES } from "../modules/demo/quick-strings.ts";
import { LANGUAGES } from "../modules/language/languages.ts";
import type { Language } from "../modules/language/languages.ts";
import { collectModules, outPath } from "./web-modules.ts";

const REPO = resolve(import.meta.dirname, "..");
/** The three demos: the folder of the template, what its page is called in each language, and (Orders, Fees) the adapter's exported function. */
export const DEMOS = [
  { id: "bookings", root: "templates/commerce/bookings", names: { en: "Bookings", hi: "बुकिंग", ml: "ബുക്കിംഗ്", kn: "ಬುಕಿಂಗ್" }, about: { en: "A salon, clinic or class that takes bookings with a deposit", hi: "बुकिंग और जमा राशि लेने वाला सैलून, क्लिनिक या क्लास", ml: "അഡ്വാൻസോടെ ബുക്കിംഗ് എടുക്കുന്ന സലൂൺ, ക്ലിനിക്ക് അല്ലെങ്കിൽ ക്ലാസ്", kn: "ಮುಂಗಡದೊಂದಿಗೆ ಬುಕಿಂಗ್ ತೆಗೆದುಕೊಳ್ಳುವ ಸಲೂನ್, ಕ್ಲಿನಿಕ್ ಅಥವಾ ತರಗತಿ" } },
  { id: "orders", root: "templates/commerce/orders", maker: "ordersShop", names: { en: "Orders", hi: "ऑर्डर", ml: "ഓർഡറുകൾ", kn: "ಆರ್ಡರ್‌ಗಳು" }, about: { en: "A kitchen or shop that takes orders with an advance", hi: "एडवांस के साथ ऑर्डर लेने वाली रसोई या दुकान", ml: "അഡ്വാൻസോടെ ഓർഡർ എടുക്കുന്ന അടുക്കളയോ കടയോ", kn: "ಮುಂಗಡದೊಂದಿಗೆ ಆರ್ಡರ್ ತೆಗೆದುಕೊಳ್ಳುವ ಅಡುಗೆಮನೆ ಅಥವಾ ಅಂಗಡಿ" } },
  { id: "fees", root: "templates/education/fees", maker: "feesShop", names: { en: "Fees", hi: "फ़ीस", ml: "ഫീസ്", kn: "ಶುಲ್ಕ" }, about: { en: "A tuition centre or school that collects fees", hi: "फ़ीस लेने वाला ट्यूशन सेंटर या स्कूल", ml: "ഫീസ് പിരിക്കുന്ന ട്യൂഷൻ സെന്ററോ സ്കൂളോ", kn: "ಶುಲ್ಕ ಸಂಗ್ರಹಿಸುವ ಟ್ಯೂಷನ್ ಕೇಂದ್ರ ಅಥವಾ ಶಾಲೆ" } },
] as const;

const TITLES: Record<Language, string> = { en: "Demo shops", hi: "डेमो दुकानें", ml: "ഡെമോ ഷോപ്പുകൾ", kn: "ಡೆಮೊ ಅಂಗಡಿಗಳು" };
const LEADS: Record<Language, string> = {
  en: "Try a shop's assistant on your phone. It is a practice run: test money, and nothing real is sent to anyone. It starts fresh each time it is opened.",
  hi: "अपने फ़ोन पर किसी दुकान का असिस्टेंट आज़माइए। यह अभ्यास है: टेस्ट पैसा, और किसी को कुछ भी असली नहीं भेजा जाता। हर बार खोलने पर नए सिरे से शुरू होता है।",
  ml: "ഒരു കടയുടെ അസിസ്റ്റന്റിനെ നിങ്ങളുടെ ഫോണിൽ പരീക്ഷിച്ചുനോക്കൂ. ഇത് പരിശീലനമാണ്: ടെസ്റ്റ് പണം, ആർക്കും യഥാർത്ഥമായി ഒന്നും അയയ്ക്കില്ല. തുറക്കുമ്പോഴെല്ലാം പുതിയതായി തുടങ്ങും.",
  kn: "ನಿಮ್ಮ ಫೋನ್‌ನಲ್ಲಿ ಒಂದು ಅಂಗಡಿಯ ಅಸಿಸ್ಟೆಂಟ್ ಅನ್ನು ಪ್ರಯತ್ನಿಸಿ. ಇದು ಅಭ್ಯಾಸ: ಟೆಸ್ಟ್ ಹಣ, ಯಾರಿಗೂ ನಿಜವಾದದ್ದು ಏನೂ ಕಳುಹಿಸುವುದಿಲ್ಲ. ತೆರೆದಾಗಲೆಲ್ಲ ಹೊಸದಾಗಿ ಶುರುವಾಗುತ್ತದೆ.",
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const shell = (title: string, body: string, bodyAttrs = "") =>
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<meta name="robots" content="noindex">\n<title>${esc(title)}</title>\n<link rel="stylesheet" href="/demo/demo.css">\n</head>\n<body${bodyAttrs}>\n${body}\n</body>\n</html>\n`;

/** The list page: no script at all, only links. */
function landing(): string {
  const cards = DEMOS.map((d) => {
    const links = LANGUAGES.map((l) => `<a href="/demo/${d.id}?lang=${l}" lang="${l}">${esc(QUICK_LANGUAGE_NAMES[l])}</a>`).join("");
    const names = LANGUAGES.map((l) => `<span lang="${l}">${esc(d.names[l])}</span>`).join(" · ");
    return `<li class="gq-card"><strong>${names}</strong><span>${esc(d.about.en)}</span><div class="gq-langs">${links}</div></li>`;
  }).join("\n");
  const leads = LANGUAGES.map((l) => `<p lang="${l}">${esc(LEADS[l])}</p>`).join("\n");
  return shell("Demo shops", `<main class="gq-page">\n<h1>${LANGUAGES.map((l) => `<span lang="${l}">${esc(TITLES[l])}</span>`).join(" · ")}</h1>\n${leads}\n<ul class="gq-cards">\n${cards}\n</ul>\n</main>`);
}

/** One template's page: an empty element and the one script. */
const demoPage = (d: (typeof DEMOS)[number]) =>
  shell(`Demo · ${d.names.en}`, `<main id="demo" class="${d.id === "bookings" ? "gq-page" : ""}"></main>\n<script type="module" src="/demo/page.js"></script>`, ` data-demo="${d.id}"`);

const OWN = new Set(["demo", "demo.html"]);

export function buildDemo(outDir: string): { files: string[] } {
  const out = resolve(outDir);
  if (existsSync(out)) {
    const stray = readdirSync(out).filter((n) => !OWN.has(n));
    if (stray.length > 0) throw new Error(`${out} already holds ${stray.slice(0, 3).join(", ")}. The demo build writes only into an empty folder or its own earlier output.`);
  }
  rmSync(join(out, "demo"), { recursive: true, force: true });
  rmSync(join(out, "demo.html"), { force: true });
  mkdirSync(join(out, "demo"), { recursive: true });
  const put = (path: string, text: string) => { mkdirSync(dirname(join(out, path)), { recursive: true }); writeFileSync(join(out, path), text); };

  put("demo.html", landing());
  for (const d of DEMOS) put(`demo/${d.id}.html`, demoPage(d));
  put("demo/demo.css", readFileSync(join(REPO, "modules/demo/quick.css"), "utf8"));
  put("demo/page.js", readFileSync(join(import.meta.dirname, "demo-page.js"), "utf8"));

  buildWebDemo(join(out, "demo/bookings")); // the Bookings demo, built by its own script
  for (const d of DEMOS) {
    if (!("maker" in d)) continue;
    const INLINE = "../../../modules/demo/inline-files.js";
    const { modules, inlined } = collectModules({
      root: join(REPO, d.root), entry: ["demo/quick.ts", "../../../modules/demo/quick.ts"],
      shims: { "node:fs": "../../../modules/demo/shims/fs.ts", "node:crypto": "../../../modules/demo/shims/crypto.ts" }, generated: [INLINE],
    });
    modules.set(outPath(INLINE), `// Written by scripts/build-demo.ts: the files the template reads (its example settings). Do not edit: build again.\nexport const INLINE_FILES = ${JSON.stringify(Object.fromEntries(inlined), null, 2)};\n`);
    modules.set("package.json", `${JSON.stringify({ private: true, type: "module", description: "Built by scripts/build-demo.ts. Do not edit." }, null, 2)}\n`); // so Node, in the tests, reads the files as modules as a browser does
    modules.set("index.js", `export { createQuick, mountQuick } from "./${outPath("../../../modules/demo/quick.ts")}";\nexport { ${d.maker} as makeShop } from "./${outPath("demo/quick.ts")}";\n`);
    for (const [path, text] of modules) put(`demo/${d.id}/${path}`, text);
  }
  const files: string[] = [];
  const walk = (rel: string) => { for (const e of readdirSync(join(out, rel), { withFileTypes: true })) { const p = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walk(p); else files.push(p); } };
  walk("");
  return { files: files.sort() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) { console.error("Say where to write it: node scripts/build-demo.ts <folder>"); process.exit(2); }
  const r = buildDemo(process.argv[2]);
  console.log(`Built the hosted demo: ${r.files.length} files in ${resolve(process.argv[2])}.`);
  console.log("Put it in the home pack:  geometer home pack <streetlist folder> --demo <this folder>");
}
