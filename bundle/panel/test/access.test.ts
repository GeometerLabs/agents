// Who can do what: accounts and invitations, the two roles, a partner seeing only their own shops, CSRF, the login rate limit, cookies,
// encryption at rest in hosted mode, and what the log and the pages never hold.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WORDS } from "../languages.ts";
import { ConfigError } from "../config.ts";
import { startPanel } from "../server.ts";
import { PASS, boot, tokenOf } from "./helpers.ts";

const idOf = (dir: string, handle: string): string => {
  const accounts = JSON.parse(readFileSync(join(dir, "panel", "data", "accounts.json"), "utf8")) as { accounts: { id: string; handle: string }[] };
  return accounts.accounts.find((a) => a.handle === handle)!.id;
};

test("no sign-up: a stranger has no way in but an invitation, and every shop page sends them to sign in", async () => {
  const b = await boot();
  try {
    const anon = b.browser();
    for (const path of ["/shops", "/setup", "/shops/glow-salon", "/invite"]) {
      const r = await anon.get(path);
      assert.deepEqual([r.status, r.location], [303, "/login"], path);
    }
    assert.equal((await anon.get("/join/not-a-real-invitation-token")).status, 404);
    assert.equal((await anon.get("/signup")).status, 404);
    assert.equal((await anon.req("POST", "/join", { token: "x".repeat(24), handle: "me", name: "Me", passphrase: PASS, language: "en" })).status, 403); // no form token
  } finally { await b.close(); }
});

test("a partner sees only their own shops; a builder sees every shop; a shop that is not yours is exactly like one that does not exist", async () => {
  const b = await boot({}, { standins: false });
  try {
    const divya = await b.account("divya", "partner");
    const meena = await b.account("meena", "partner");
    const arjun = await b.account("arjun", "builder");
    b.addShop("divya-shop", { ownerId: idOf(b.dir, "divya"), ownerName: "Divya", name: "Divya Salon" });
    b.addShop("meena-shop", { ownerId: idOf(b.dir, "meena"), ownerName: "Meena", name: "Meena Salon" });
    b.addShop("server-shop", { name: "Made On The Server" });

    const mine = (await divya.get("/shops")).text;
    assert.ok(mine.includes("Divya Salon") && !mine.includes("Meena Salon") && !mine.includes("Made On The Server"));
    const all = (await arjun.get("/shops")).text;
    for (const n of ["Divya Salon", "Meena Salon", "Made On The Server"]) assert.ok(all.includes(n), n);
    assert.ok(all.includes(WORDS.en.shops.titleAll));

    // Every route that takes a shop: the other partner's shop, and one nobody owns, answer 404 and name nothing.
    const same = (text: string, id: string) => text.replaceAll(id, "X").replace(/nonce="[^"]+"/gu, "").replace(/%2F[A-Za-z0-9%-]*/gu, "");
    const nothing = same((await divya.get("/shops/does-not-exist")).text, "does-not-exist");
    for (const other of ["meena-shop", "server-shop"]) {
      for (const path of [`/shops/${other}`, `/shops/${other}/stop`]) {
        const r = await divya.get(path);
        assert.equal(r.status, 404, path);
        assert.ok(!r.text.includes("Meena"), path);
        assert.equal(same(r.text, other), nothing, `${path} looks different from a shop that does not exist`);
      }
      assert.equal((await divya.get(`/shops/${other}/docs/go-live/go-live-certificate-en.html`)).status, 404);
      for (const path of [`/shops/${other}/stop`, `/shops/${other}/edit`, `/shops/${other}/report`]) {
        const token = tokenOf((await divya.get("/shops")).text.replace("</form>", "</form>") + (await divya.get("/setup")).text);
        const r = await divya.req("POST", path, { _csrf: token, month: "2026-11" });
        assert.equal(r.status, 404, path);
      }
    }
    assert.equal(existsSync(join(b.dir, "requests", "meena-shop.stop.json")), false, "nothing was written for a shop that is not theirs");
    // The builder is not locked out of anyone's shop; a partner has no invite page (it is a builder's).
    assert.equal((await arjun.get("/shops/meena-shop")).status, 200);
    assert.equal((await divya.get("/invite")).status, 404);
    // Names that try to leave the shops folder are not shops.
    assert.equal((await divya.get("/shops/%2e%2e")).location, "/shops", "the browser-style dot-dot is just the front page");
    for (const path of ["/shops/..%2f..%2fetc", "/shops/divya-shop%2f..%2fmeena-shop", "/shops/DIVYA-SHOP", "/shops/divya shop"]) assert.equal((await divya.get(path)).status, 404, path);
    assert.equal((await divya.post("/shops/divya-shop/stop", {}, "/shops/divya-shop/stop")).status, 303); // their own is fine
    // "Show what we did" is the builder's: a partner's page has the plain words and no engine details.
    assert.ok(!(await divya.get("/shops/divya-shop")).plain.includes("sha256 ") && (await arjun.get("/shops/divya-shop")).plain.includes("sha256 "));
  } finally { await b.close(); }
});

test("an invitation works once, runs out, and is never in the log or in any page; a builder on their own server can invite, but not on a hosted one", async () => {
  const b = await boot();
  try {
    const link = b.invite("partner");
    const token = new URL(link).pathname.slice("/join/".length);
    const first = b.browser();
    const form = await first.get(`/join/${token}`);
    assert.equal(form.status, 200);
    assert.ok(!form.text.includes("ignore") && form.text.includes(token), "the token is in the form's hidden field, nowhere else is needed");
    const made = await first.req("POST", "/join", { _csrf: tokenOf(form.text), token, name: "Divya", handle: "divya", passphrase: PASS, language: "ml" });
    assert.deepEqual([made.status, made.location], [303, "/shops"]);
    const again = b.browser();
    assert.equal((await again.get(`/join/${token}`)).status, 410);
    const used = await again.req("POST", "/join", { _csrf: tokenOf((await again.get("/login")).text), token, name: "Other", handle: "other", passphrase: PASS, language: "en" });
    assert.equal(used.status, 410);
    assert.ok(b.logs.some((l) => l.startsWith("GET /join/[invite]")));
    assert.ok(!b.logs.join("\n").includes(token), "the log never holds an invitation token");
    const shopsPage = (await first.get("/shops")).text;
    assert.ok(!shopsPage.includes(token));
    // The new partner's language was kept: Malayalam pages.
    assert.ok(shopsPage.includes('lang="ml"') && shopsPage.includes(WORDS.ml.shops.title));

    const arjun = await b.account("arjun", "builder");
    const page = await arjun.get("/invite");
    const made2 = await arjun.post("/invite", { role: "partner", note: "for Meena" }, "/invite");
    assert.equal(made2.status, 200);
    assert.match(made2.text, /\/join\/[A-Za-z0-9_-]{20,}/u);
    assert.ok(page.text.includes(WORDS.en.invite.button));
  } finally { await b.close(); }
  const hosted = await boot({}, { mode: "hosted" });
  try {
    const arjun = await hosted.account("arjun", "builder");
    const page = await arjun.get("/invite");
    assert.ok(page.text.includes(WORDS.en.invite.hostedOnly) && !page.text.includes('action="/invite"'));
    assert.equal((await arjun.post("/invite", { role: "partner", note: "" }, "/shops")).status, 404);
  } finally { await hosted.close(); }
});

test("CSRF: a form without its token, with another session's token, or from another site is refused, and nothing happens", async () => {
  const b = await boot();
  try {
    const divya = await b.account("divya", "partner");
    b.addShop("divya-shop", { ownerId: idOf(b.dir, "divya"), name: "Divya Salon" });
    const other = await b.account("meena", "partner");
    const token = tokenOf((await divya.get("/shops/divya-shop/stop")).text);
    const otherToken = tokenOf((await other.get("/setup")).text);
    for (const [label, form, extra] of [
      ["no token", {}, {}], ["another session's token", { _csrf: otherToken }, {}], ["an empty token", { _csrf: "" }, {}],
      ["the right token from another site", { _csrf: token }, { origin: "https://evil.example" }],
    ] as const) {
      const r = await divya.req("POST", "/shops/divya-shop/stop", { ...form }, { ...extra });
      assert.equal(r.status, 403, label);
    }
    assert.equal(existsSync(join(b.dir, "requests", "divya-shop.stop.json")), false, "no stop request was written");
    assert.equal((await divya.req("POST", "/logout", {})).status, 403);
    // The sign-in form has its own anonymous token.
    const anon = b.browser();
    assert.equal((await anon.req("POST", "/login", { handle: "divya", passphrase: PASS })).status, 403);
    assert.equal((await anon.req("POST", "/login", { _csrf: "made-up", handle: "divya", passphrase: PASS })).status, 403);
    // The right token from the same site works.
    assert.equal((await divya.req("POST", "/shops/divya-shop/stop", { _csrf: token }, { origin: b.panel.url })).status, 303);
    // Only forms are accepted, and not big ones.
    assert.equal((await divya.req("POST", "/shops/divya-shop/stop", undefined, { "content-type": "application/json" })).status, 400);
    const huge = await fetch(`${b.panel.url}/login`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `x=${"a".repeat(70_000)}` });
    assert.equal(huge.status, 413);
  } finally { await b.close(); }
});

test("sign in: a wrong passphrase and an unknown name look the same; after five failures even the right passphrase waits; others are not locked out", async () => {
  const b = await boot();
  try {
    await b.account("divya", "partner");
    await b.account("meena", "partner");
    const wrong = b.browser();
    const a = await wrong.post("/login", { handle: "divya", passphrase: "not the passphrase" }, "/login");
    const u = await wrong.post("/login", { handle: "nobody.here", passphrase: "not the passphrase" }, "/login");
    assert.deepEqual([a.status, u.status], [401, 401]);
    assert.ok(a.text.includes(WORDS.en.login.wrong) && u.text.includes(WORDS.en.login.wrong));
    for (let i = 0; i < 4; i++) await wrong.post("/login", { handle: "divya", passphrase: "still wrong" }, "/login");
    const locked = await wrong.post("/login", { handle: "divya", passphrase: PASS }, "/login"); // the right one, after five wrong ones
    assert.equal(locked.status, 429);
    assert.ok(Number(locked.headers.get("retry-after")) > 0);
    assert.ok(locked.text.includes("Too many tries"));
    assert.equal((await wrong.get("/shops")).status, 303, "the right passphrase did not get in");
    // An address the visitor makes up in X-Forwarded-For is not believed unless the server sits behind its own proxy.
    const spoof = b.browser();
    spoof.headers["x-forwarded-for"] = "203.0.113.77";
    assert.equal((await spoof.post("/login", { handle: "divya", passphrase: PASS }, "/login")).status, 429);
    const fine = b.browser();
    const ok = await fine.post("/login", { handle: "meena", passphrase: PASS }, "/login");
    assert.deepEqual([ok.status, ok.location], [303, "/shops"]);
  } finally { await b.close(); }
});

test("cookies: signed, HttpOnly, SameSite=Strict; over HTTPS they are __Host- and Secure; signing out ends the session; a forged cookie is nobody", async () => {
  const plain = await boot();
  const secure = await boot({ publicUrl: "https://shops.example.com" });
  try {
    for (const [b, name, isSecure] of [[plain, "geo", false], [secure, "__Host-geo", true]] as const) {
      const anon = b.browser();
      const first = await anon.get("/login");
      const pre = first.cookies.find((c) => c.startsWith(`${name}_pre=`))!;
      assert.ok(pre && /HttpOnly/u.test(pre) && /SameSite=Strict/u.test(pre), pre);
      const link = new URL(b.invite("builder")).pathname;
      const page = await anon.get(link);
      const joined = await anon.req("POST", "/join", { _csrf: tokenOf(page.text), token: link.slice(6), name: "A", handle: "arjun", passphrase: PASS, language: "en" }, isSecure ? { origin: "https://shops.example.com" } : {});
      assert.equal(joined.status, 303);
      const cookie = joined.cookies.find((c) => c.startsWith(`${name}=`))!;
      assert.ok(/HttpOnly/u.test(cookie) && /SameSite=Strict/u.test(cookie) && /Path=\//u.test(cookie), cookie);
      assert.equal(/; Secure/u.test(cookie), isSecure);
      assert.ok(!/Domain=/u.test(cookie));
      const forged = b.browser();
      forged.jar.set(name, cookie.split(";")[0].split("=")[1].replace(/\.[^.]*$/u, ".AAAA"));
      assert.equal((await forged.get("/shops")).status, 303);
      const token = tokenOf((await anon.get("/shops")).text);
      const out = await anon.req("POST", "/logout", { _csrf: token }, isSecure ? { origin: "https://shops.example.com" } : {});
      assert.equal(out.status, 303);
      assert.equal((await anon.get("/shops")).status, 303, "signed out");
    }
    assert.ok((await secure.browser().get("/login")).headers.get("strict-transport-security"));
    assert.equal((await plain.browser().get("/login")).headers.get("strict-transport-security"), null);
  } finally { await plain.close(); await secure.close(); }
});

test("pages: a CSP with no script at all, no framing, no referrer; a shop named <script> is text; secrets and tokens are not cached", async () => {
  const b = await boot();
  try {
    const divya = await b.account("divya", "partner");
    b.addShop("evil", { ownerId: idOf(b.dir, "divya"), name: "<script>alert(1)</script>" });
    const list = await divya.get("/shops");
    assert.ok(list.text.includes("&lt;script&gt;alert(1)&lt;/script&gt;") && !list.text.includes("<script>alert(1)"));
    const csp = list.headers.get("content-security-policy")!;
    assert.ok(csp.includes("default-src 'none'") && !csp.includes("script-src") && !csp.includes("unsafe-inline") && csp.includes("frame-ancestors 'none'"));
    assert.equal(list.headers.get("x-frame-options"), "DENY");
    assert.equal(list.headers.get("referrer-policy"), "no-referrer");
    assert.equal(list.headers.get("cache-control"), "no-store");
    assert.ok(!/<script/iu.test(list.text.replace(/&lt;script/gu, "")), "the page has no script element");
    const page = await divya.get("/shops/evil");
    assert.ok(page.text.includes("&lt;script&gt;") && !page.text.includes("<script>alert"));
  } finally { await b.close(); }
});

test("every page speaks the person's language, and the machine-written ones say so", async () => {
  const b = await boot();
  try {
    const anon = b.browser();
    for (const l of ["en", "hi", "ml", "kn"] as const) {
      const r = await anon.get("/login", { cookie: `geo_lang=${l}` });
      assert.ok(r.text.includes(`lang="${l}"`), l);
      assert.ok(r.text.includes(WORDS[l].login.title) && r.text.includes(WORDS[l].login.byInvitation), l);
      if (l !== "en") assert.ok(r.text.includes(WORDS[l].draftNote.slice(0, 30)), `${l}: the review note`);
      else assert.ok(!r.text.includes("machine"), "English is the source: no review note");
    }
    const viaHeader = await b.browser().get("/login", { "accept-language": "kn-IN,kn;q=0.9,en;q=0.5" });
    assert.ok(viaHeader.text.includes(WORDS.kn.login.title));
    const switched = await anon.get("/lang/hi?next=/login");
    assert.deepEqual([switched.status, switched.location], [303, "/login"]);
    assert.ok((await anon.get("/login")).text.includes(WORDS.hi.login.title));
    assert.equal((await anon.get("/lang/hi?next=//evil.example")).location, "/");
    assert.equal((await anon.get("/lang/xx")).status, 404);
  } finally { await b.close(); }
});

test("hosted mode keeps everything the panel itself holds encrypted, with the key outside it; no key, no start; a changed file is not trusted", async () => {
  const noKey = await boot().then((x) => x);
  await noKey.close();
  await assert.rejects(startPanel({ ...noKey.config, mode: "hosted", port: 0, dataKeyFile: undefined }), (e: Error) => e instanceof ConfigError && /data key/u.test(e.message));

  const h = await boot({}, { mode: "hosted" });
  try {
    const divya = await h.account("divya.marker", "partner");
    await divya.get("/shops");
    const files = readdirSync(join(h.dir, "panel"), { recursive: true, withFileTypes: true }).filter((e) => e.isFile());
    assert.ok(files.length >= 2);
    for (const e of files) {
      const text = readFileSync(join(e.parentPath, e.name), "utf8");
      if (e.name === "session-secret") continue;
      assert.ok(text.startsWith("geo1."), `${e.name} is sealed`);
      assert.ok(!/divya|DIVYA|scrypt|accounts/u.test(text), `${e.name} shows plain text`);
    }
    assert.ok(!existsSync(join(h.dir, "panel", "session-secret")), "the cookie secret comes from the data key; no second secret on disk");
    assert.ok(!h.config.dataKeyFile!.startsWith(join(h.dir, "panel")), "the key is outside the panel's folder");
    const accountsFile = join(h.dir, "panel", "data", "accounts.json");
    const text = readFileSync(accountsFile, "utf8");
    writeFileSync(accountsFile, text.slice(0, 30) + (text[30] === "A" ? "B" : "A") + text.slice(31));
    const again = h.browser();
    const r = await again.post("/login", { handle: "divya.marker", passphrase: PASS }, "/login");
    assert.notEqual(r.status, 303, "a tampered accounts file lets nobody in");
    assert.ok(h.logs.some((l) => /VaultError/u.test(l)));
  } finally { await h.close(); }
});
