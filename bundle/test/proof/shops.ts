// The proof's shops, in one place: their names, numbers, calendars and the secrets handed in for each. run.ts makes the shops from these; standins.ts tells the
// shops apart by the same values (each shop's Guards add that shop's own Razorpay key, WhatsApp token and Google token), so each shop has stand-ins of its own,
// as each real shop has its own Razorpay account, WhatsApp number and calendar. Test values only: no real account is behind any of them.

/**
 * The proof's agent someone else wrote (B51): number 90, a number no proof shop reaches. It is told apart by the same values as a shop, so the stand-ins give it a set
 * of its own (its webhooks to /c/proof-agent) and its Guards' keys name it, with nothing changed in standins.ts.
 */
export const AGENT_INDEX = 90;
export const AGENT_NAME = "proof-agent";
export const shopName = (i: number): string => (i === 1 ? "glow-salon" : i === AGENT_INDEX ? AGENT_NAME : `shop-${String(i).padStart(2, "0")}`);
export const shopIndex = (name: string): number | undefined => (name === "glow-salon" ? 1 : name === AGENT_NAME ? AGENT_INDEX : /^shop-(\d{2})$/u.exec(name) ? Number(name.slice(5)) : undefined);
export const phoneOf = (i: number): string => `10000000000${String(i).padStart(4, "0")}`;
export const calendarOf = (i: number): string => `${shopName(i)}@group.calendar.google.com`;
/** The owner's number in the example settings every proof shop is made from. */
export const OWNER = "+919000000000";

export const razorpayKeyId = (i: number): string => `rzp_test_proof${i}abcdef`;
export const secretsOf = (i: number) => ({
  razorpay_key: `${razorpayKeyId(i)}:secretproof${i}abcdef123`,
  whatsapp_token: `EAAproof${i}tokentokentokentoken`,
  razorpay_webhook_secret: `webhook-secret-${i}-0123456789`,
  whatsapp_app_secret: `meta-app-secret-${i}-0123456789`,
  whatsapp_verify_token: `verify-token-${i}-0123456789`,
});

/** Which shop a call is for, from the credential its Guard added: Razorpay's Basic key id, WhatsApp's token, or the Google token the stand-in issued for the shop. */
export function shopOfAuthorization(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const basic = /^Basic\s+(\S+)$/u.exec(header);
  if (basic) { const m = /^rzp_test_proof(\d+)abcdef:/u.exec(Buffer.from(basic[1], "base64").toString("utf8")); return m ? shopName(Number(m[1])) : undefined; }
  const wa = /^Bearer\s+EAAproof(\d+)token/u.exec(header);
  if (wa) return shopName(Number(wa[1]));
  const google = /^Bearer\s+ya29\.proof-([a-z0-9-]+)-\d+-0123456789$/u.exec(header);
  return google ? google[1] : undefined;
}
