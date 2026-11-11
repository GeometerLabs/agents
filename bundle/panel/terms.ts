// The shop terms agreed on WhatsApp, as the panel sees them (B72, 12 Nov 2026). The partner enters their name, number and the two prices; the deployer hands the runtime the
// file; the owner writes "terms" and then "I agree" to the shop's WhatsApp number; the agent records the agreement (modules/terms/owner.ts); this file finds that record entry in
// the shop's exported record and builds the copy the partner downloads.
//
// OFF unless geometer.json says `"panel": {"termsOnWhatsapp": true}` (read again each time, so the switch needs no restart). It has not had the owner's legal check: the page says
// signed paper is still what Geometer's sell guides tell a partner to use, and nothing here calls the copy legally sufficient.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { personLabel } from "../../modules/record/fingerprint.ts";
import { TERMS_AGREED_ACTION, TERMS_SENT_ACTION, TERMS_VERSION, readTermsFile, termsDigest, termsText } from "../../modules/terms/terms.ts";
import type { TermsFile } from "../../modules/terms/terms.ts";
import { termsSourceFile, readShopTerms } from "../lib/terms.ts";
import { writeAtomic } from "../lib/util.ts";
import { readExport } from "./activity.ts";
import type { MadePaper } from "./papers.ts";
import type { Shops } from "./shops.ts";

export type TermsState =
  | { state: "details" }                                          // the partner has not entered their name, number and prices yet
  | { state: "ready"; text: string; digest: string }              // the terms are set; the owner has not been sent them, or has not agreed
  | { state: "sent"; text: string; digest: string; at: string }   // sent to the owner, no agreement yet
  | { state: "agreed"; text: string; digest: string; at: string } // the owner agreed to exactly these terms
  | { state: "changed"; text: string; digest: string; at: string }; // the owner agreed to an older text: the terms must be sent and agreed again

/** Is the feature switched on in geometer.json? Read each time; anything unreadable is off. */
export function termsOn(serverDir: string): boolean {
  const file = join(resolve(serverDir), "geometer.json");
  if (!existsSync(file)) return false;
  try { return (JSON.parse(readFileSync(file, "utf8")) as { panel?: { termsOnWhatsapp?: unknown } }).panel?.termsOnWhatsapp === true; } catch { return false; }
}

export function createTerms(shops: Shops, serverDir: string) {
  const dir = resolve(serverDir);
  /** The owner's reply entries for this shop, newest last, from the exported record. The owner is found by the shop's own key, as the handover is. */
  function entriesFor(id: string) {
    const settings = shops.settings(id);
    const data = readExport(shops.paths.exports(id));
    const key = shops.personKey(id);
    if (!settings || !data || !key) return [];
    const owner = personLabel(key, "c", settings.owner.whatsapp);
    return data.entries.filter((e) => e.conversation === owner && (e.action === TERMS_SENT_ACTION || e.action === TERMS_AGREED_ACTION) && e.outcome === "confirmed");
  }

  const api = {
    on: (): boolean => termsOn(dir),
    file: (id: string): TermsFile | undefined => readShopTerms(dir, id),
    /** Save what the partner entered, or say what is wrong. */
    save(id: string, form: Record<string, string | undefined>): { ok: true } | { ok: false } {
      const parsed = readTermsFile({ schema: 1, partnerName: (form.partnerName ?? "").trim(), partnerPhone: (form.partnerPhone ?? "").trim(), monthlyInr: /^\d{1,8}$/u.test(form.monthlyInr ?? "") ? Number(form.monthlyInr) : NaN, setupInr: /^\d{1,8}$/u.test(form.setupInr ?? "") ? Number(form.setupInr) : NaN });
      if (!parsed) return { ok: false };
      writeAtomic(termsSourceFile(dir, id), `${JSON.stringify(parsed, null, 2)}\n`);
      return { ok: true };
    },
    status(id: string): TermsState {
      const settings = shops.settings(id);
      const file = api.file(id);
      if (!settings || !file) return { state: "details" };
      const text = termsText(settings.owner.language, settings.name, file);
      const digest = termsDigest(text);
      const mine = entriesFor(id);
      const agreedNow = [...mine].reverse().find((e) => e.action === TERMS_AGREED_ACTION && e.refs?.termsDigest === digest);
      if (agreedNow) return { state: "agreed", text, digest, at: agreedNow.time };
      const agreedBefore = [...mine].reverse().find((e) => e.action === TERMS_AGREED_ACTION);
      if (agreedBefore) return { state: "changed", text, digest, at: agreedBefore.time };
      const sent = [...mine].reverse().find((e) => e.action === TERMS_SENT_ACTION && e.refs?.termsDigest === digest);
      return sent ? { state: "sent", text, digest, at: sent.time } : { state: "ready", text, digest };
    },
    /** The copy the partner keeps: the exact text the owner agreed to, then the facts of the agreement. Only when the agreement is to the current text. */
    copy(id: string): MadePaper | undefined {
      const s = api.status(id);
      const settings = shops.settings(id);
      if (s.state !== "agreed" || !settings) return undefined;
      const entry = [...entriesFor(id)].reverse().find((e) => e.action === TERMS_AGREED_ACTION && e.refs?.termsDigest === s.digest);
      const lines = [
        s.text, "", "----------------------------------------",
        "Agreed on WhatsApp by the owner of this shop, from the owner's own number.",
        `Shop: ${settings.name}`, `Owner's number: ${settings.owner.whatsapp}`, `Agreed at: ${s.at}`,
        `Terms version: ${TERMS_VERSION}`, `Language: ${settings.owner.language}`, `Digest of the text above (sha256): ${s.digest}`,
        `WhatsApp message (fingerprint, as the shop's record keeps it): ${entry?.refs?.messageId ?? "not kept"}`,
        "", "This copy shows what the shop's record holds. It has not had a legal check; signed paper is still what Geometer's sell guides tell a partner to use.",
      ];
      return { file: `shop-terms-${id}-${TERMS_VERSION}.txt`, type: "text/plain; charset=utf-8", text: `${lines.join("\n")}\n` };
    },
  };
  return api;
}
export type Terms = ReturnType<typeof createTerms>;
