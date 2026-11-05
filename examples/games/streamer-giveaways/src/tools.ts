// The streamer's actions, as plain functions. They call the promo service named by PROMO_URL. The campaign
// decides what a code is worth; a viewer gets one code per campaign (the service's own list is read first and
// again after a call that got no answer); only approved campaigns give codes; a giveaway worth more than
// GIVEAWAY_LIMIT in total waits for a person's approval id.
const env = process.env;

export const cfg = {
  url: env.PROMO_URL ?? "http://promo.example",
  limit: Number(env.GIVEAWAY_LIMIT ?? "100.00"),
  timeout: Number(env.TOOL_TIMEOUT_MS ?? "30000"),
};

/** One request: {status, body}, or null when no answer came. */
export async function call(method: string, path: string, body?: unknown, key?: string) {
  try {
    const r = await fetch(cfg.url + path, {
      method,
      headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.timeout),
    });
    return { status: r.status, body: (await r.json().catch(() => null)) as any };
  } catch {
    return null;
  }
}

/** The code this viewer already has from the campaign, or undefined. */
async function codeOf(campaign: string, viewer: string) {
  const r = await call("GET", `/v1/campaigns/${campaign}/codes`);
  return r?.status === 200 ? (r.body as any[]).find((c) => c.viewer === viewer) : undefined;
}

export async function lookupCampaign(campaign: string) {
  const r = await call("GET", `/v1/campaigns/${campaign}`);
  return r?.status === 200 ? r.body : "no such campaign";
}

export async function giveCode(campaign: string, viewer: string, quantity = 1, approval = "") {
  const r = await call("GET", `/v1/campaigns/${campaign}`);
  if (r?.status !== 200) return "no such campaign; no code was given";
  if (r.body.status !== "approved") return `the campaign is ${r.body.status}, not approved; no code was given`;
  const value = (Number(r.body.code_value) * quantity).toFixed(2);
  if (Number(value) > cfg.limit && !approval) return `held: a giveaway worth ${value} needs a person's approval id`;
  const done = await codeOf(campaign, viewer);
  if (done) return `already given: ${JSON.stringify(done)}`;
  const body = { campaign, viewer, quantity, value, approval };
  for (let attempt = 0; attempt < 2; attempt++) { // no answer: look whether it landed before trying once more
    const sent = await call("POST", `/v1/campaigns/${campaign}/codes`, body, `code-${campaign}-${viewer}`);
    if (sent) return sent.body;
    const seen = await codeOf(campaign, viewer);
    if (seen) return `given: ${JSON.stringify(seen)}`;
  }
  return "no answer from the promo service; whether the code was given is unknown.";
}

/** Operator-only: every code of a campaign. Kept out of the model's reach (see agent.ts). */
export async function exportCodes(campaign: string) {
  return (await call("POST", "/v1/admin/exports", { campaign }))?.body;
}
