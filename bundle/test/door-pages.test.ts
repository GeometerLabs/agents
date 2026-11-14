// The door's own error pages in the shop's languages (release-flow batch 3, 14 Nov 2026): the language the visitor asks for, the old English text unchanged, the
// machine-written line for Hindi, Malayalam and Kannada, the partner's call and WhatsApp links when the door has seen them, and a header that is not a contact is ignored.
import { test } from "node:test";
import assert from "node:assert/strict";
import { doorPage, languageOf, parseContact } from "../services/door-pages.ts";

const res = (url: string, acceptLanguage?: string) => ({ req: { url, headers: acceptLanguage ? { "accept-language": acceptLanguage } : {} } }) as never;
const header = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");

test("the English page is the old text; the visitor's language comes from ?lang= then the browser", () => {
  const en = doorPage("notAnswering", res("/glow"));
  assert.match(en, /<h1>This shop's page is not answering<\/h1><p>Please try again in a few minutes\.<\/p>/u);
  assert.equal(languageOf((res("/glow?lang=ml") as { req: never }).req), "ml");
  assert.equal(languageOf((res("/glow", "kn-IN,en;q=0.8") as { req: never }).req), "kn");
  assert.equal(languageOf((res("/glow", "fr") as { req: never }).req), "en");
  const hi = doorPage("nothing", res("/x", "hi"));
  assert.match(hi, /lang="hi"/u); assert.match(hi, /class="machine"/u, "Hindi says it is machine-written");
  assert.doesNotMatch(en, /class="machine"/u);
});

test("a known partner is named with Call and WhatsApp; a header that is not a contact is ignored", () => {
  const contact = parseContact(header({ n: "Divya", p: "+919800000000" }))!;
  const page = doorPage("notAnswering", res("/glow", "ml"), contact);
  assert.match(page, /href="tel:\+919800000000"/u); assert.match(page, /href="https:\/\/wa\.me\/919800000000"/u); assert.match(page, /Divya/u);
  assert.equal(parseContact(header({ n: "Divya", p: "98" })), undefined);
  assert.equal(parseContact("not base64 json"), undefined);
  assert.equal(parseContact(header({ n: "<script>", p: "+919800000000" }))!.name, "<script>", "kept as text; the page escapes it");
  assert.doesNotMatch(doorPage("gone", res("/x"), parseContact(header({ n: "<script>", p: "+919800000000" }))), /<script>/u);
});
