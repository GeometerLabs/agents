// The one script every hosted demo page loads (scripts/build-demo.ts copies it to demo/page.js): it reads the language from the address (?lang=hi|ml|kn|en, English by
// default), loads that template's built demo from /demo/<template>/ and mounts it. It is a plain file with no imports of its own and no inline code anywhere on the page,
// because the pages domain allows scripts only from itself. Nothing is stored and nothing is sent: a demo lives in this page and is gone when it is closed.
const LANGUAGES = ["en", "hi", "ml", "kn"];
const kind = document.body.dataset.demo;
const asked = new URLSearchParams(location.search).get("lang");
const language = LANGUAGES.includes(asked) ? asked : "en";
const root = document.getElementById("demo");
document.documentElement.lang = language;

try {
  const built = await import(`/demo/${kind}/index.js`);
  if (kind === "bookings") {
    // the Bookings demo is the richer one, with its own page code and a shop form that can change its language; it opens on the chat
    // The example shop (Glow Salon) is closed on Sundays and the Malayalam and Kannada suggestions say "tomorrow", so on a Saturday the demo's clock starts on Monday
    // (10:00 shop time; India has no daylight saving). Every other day it starts on today's real date, as the demo always did.
    const nowMs = () => {
      const d = new Date(Date.now() + 330 * 60000);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + (d.getUTCDay() === 6 ? 2 : 0), 4, 30);
    };
    built.mountDemo(root, { language, startWith: "chat", nowMs });
  } else {
    // Orders and Fees: the page of modules/demo/quick.ts. Choosing another language starts a new demo in it (the address keeps the choice, so it can be sent on).
    await built.mountQuick(root, {
      language,
      make: (l) => built.makeShop(l),
      onLanguage: (l) => { location.search = `?lang=${l}`; },
    });
  }
} catch (e) {
  root.textContent = "This demo needs a newer browser. Open this address in Chrome.";
}
