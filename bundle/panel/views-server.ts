// The pages of the panel's first run on a builder's server (plan item 14b, part 2): "This server" (the model and its key, the backup bucket and its test
// write, Google) and the backup key's secret half, shown until the builder confirms it is somewhere else. Plain forms, no JavaScript, like every panel page.
// Who uses it: server.ts's /server routes. The words are English only for now: these pages are a builder's, set up once (Hindi, Malayalam and Kannada wait:
// panel/Deferred.md). Nothing secret is ever put back into a page except the backup key's secret half on its own page, on purpose, until it is confirmed.
import { html, raw } from "./html.ts";
import type { Raw } from "./html.ts";
import type { Problem } from "./server-contract.ts";
import { CONFIRM_CHARS } from "./server-setup.ts";
import type { ServerSetupView } from "./server-setup.ts";
import { layout, when } from "./views.ts";
import type { Ctx } from "./views.ts";

const csrf = (c: Ctx) => html`<input type="hidden" name="_csrf" value="${c.csrf}">`;
const field = (label: string, name: string, o: { value?: string; type?: string; help?: string; placeholder?: string; mode?: string; autocomplete?: string } = {}) =>
  html`<label class="field"><span>${label}</span><input name="${name}" type="${o.type ?? "text"}" value="${o.value ?? ""}" ${o.placeholder ? html`placeholder="${o.placeholder}"` : ""} ${o.mode ? html`inputmode="${o.mode}"` : ""} autocomplete="${o.autocomplete ?? "off"}" autocapitalize="none" spellcheck="false">${o.help ? html`<p class="help">${o.help}</p>` : ""}</label>`;
const radio = (name: string, value: string, label: string, checked: boolean, help?: string) =>
  html`<label class="choice"><input type="radio" name="${name}" value="${value}" ${checked ? raw("checked") : ""}><span><b>${label}</b>${help ? html`<small>${help}</small>` : ""}</span></label>`;

/** One step's line: done, waiting for the deployer, refused (with the deployer's own sentence), or not started. */
function stateLine(c: Ctx, o: { done?: string; pending?: boolean; refused?: { message: string; at: string }; todo: string }): Raw {
  if (o.pending) return html`<p class="state attention">Waiting for the server to apply it (it looks every few seconds; if this stays, the deployer is not running: geometer server status).</p>`;
  if (o.refused) return html`<ul class="errors" role="alert"><li>${o.refused.message} <small>(${when(o.refused.at, c.lang)})</small></li></ul>`;
  return o.done ? html`<p><span class="state">Done</span> ${o.done}</p>` : html`<p><span class="state unknown">To do</span> ${o.todo}</p>`;
}

// The "This server" page (model, backup, Google) with each part's request status; `problems` and `notice` show the result of the last form without putting any secret back into the page.
export function serverPage(c: Ctx, v: ServerSetupView, o: { problems?: Problem[]; notice?: string } = {}): string {
  const s = v.status;
  const m = v.model;
  const where = !m ? "" : m.selfHosted ? `a model you host at ${safeHost(m.selfHosted.url)}` : m.upstream ? `${m.provider ?? m.upstream}` : m.wire === "anthropic" ? "Anthropic" : "OpenAI";
  const kind = !m ? "openai" : m.selfHosted ? "own" : m.upstream ? "other" : m.wire;
  const modelRefused = s?.requests.model?.state === "refused" ? s.requests.model : undefined;
  const backupRefused = s?.requests.backup?.state === "refused" ? s.requests.backup : undefined;
  const waitingKeys = s?.inbox ?? [];
  const k = v.backupKey;
  return layout(c, "This server", html`<h1>This server${v.serverId ? html` <small class="note">${v.serverId}</small>` : ""}</h1>
<p>${v.done ? "Everything the server itself needs is in place. Shops are set up from Set up." : "Before the first shop, the server needs three things of its own: the model its shops' agents use, a place for the nightly backups, and (only if your shops use a calendar) a Google key. Each key goes in once, is moved to the one part of the server that uses it, and is never shown again."}</p>
${o.notice ? html`<div class="notice" role="status"><p>${o.notice}</p></div>` : ""}
${o.problems && o.problems.length > 0 ? html`<ul class="errors" role="alert">${o.problems.map((p) => html`<li>${p.message}</li>`)}</ul>` : ""}
${k?.held ? html`<div class="notice warn" role="alert"><p><b>The backup key's secret half is still on this server.</b> It is the only key that opens a backup. Save it somewhere else and confirm, and the server deletes its copy.</p><p><a class="btn primary" href="/server/backup-key">Save the backup key</a></p></div>` : ""}
${waitingKeys.length > 0 ? html`<ul class="errors" role="alert">${waitingKeys.map((w) => html`<li>${w.message}</li>`)}</ul>` : ""}

<section class="step" aria-labelledby="s-model">
<h2 id="s-model">1. The model your shops' agents use</h2>
${stateLine(c, { done: m ? `${m.model}, from ${where}.${s?.keys.model ? ` Its key is in place (${when(s.keys.model.at, c.lang)}).` : v.receipts.model_key ? " Its key was handed in; the server is putting it in place." : " Its key is still needed."}` : undefined, pending: Boolean(v.pending.model), ...(modelRefused ? { refused: modelRefused } : {}), todo: "Choose the model, and hand in its key." })}
<form method="post" action="/server/model" autocomplete="off">${csrf(c)}
  <fieldset class="field"><legend>Where the model is</legend>
    ${radio("kind", "openai", "OpenAI", kind === "openai")}
    ${radio("kind", "anthropic", "Anthropic", kind === "anthropic")}
    ${radio("kind", "other", "Another provider that speaks OpenAI's API", kind === "other", "Gemini's OpenAI endpoint, Sarvam, Groq, DeepInfra: fill in its address below.")}
    ${radio("kind", "own", "A model you host", kind === "own", "Your own model server, or Geometer's model gateway in front of it: fill in its address below.")}
  </fieldset>
  ${field("The model's name", "model", { value: m?.model ?? "", placeholder: "gpt-4o-mini", help: "Exactly as the provider writes it. Every shop on this server uses this one model; the model Guard refuses any other." })}
  ${field("The model's API key", "key", { type: "password", autocomplete: "new-password", help: m ? "Only to replace the key. It is never shown again." : "It goes to the model Guard only, and is never shown again." })}
  <details class="what"${kind === "other" ? raw(" open") : ""}><summary>Only for another provider</summary>
    ${field("Its address (host:port)", "upstream", { value: m?.upstream ?? "", placeholder: "generativelanguage.googleapis.com:443" })}
    ${field("Its chat path", "path", { value: m?.path ?? "", placeholder: "/v1beta/openai/chat/completions" })}
    ${field("Its name in the price table", "provider", { value: m?.selfHosted ? "" : m?.provider ?? "", placeholder: "deepinfra", help: "Lowercase, for the cost of each call. Leave it out if you do not know it." })}
  </details>
  <details class="what"${kind === "own" ? raw(" open") : ""}><summary>Only for a model you host</summary>
    ${field("Its address", "url", { value: m?.selfHosted?.url ?? "", type: "url", placeholder: "https://models.example.in/v1", help: "https, or plain http only to a private address on your own network (10.x, 172.16-31.x, 192.168.x)." })}
    <div class="row">${field("Your price in (US$ per million tokens)", "rateIn", { value: m?.selfHosted?.rate ? String(m.selfHosted.rate.inputUsdPerMillion) : "", mode: "decimal" })}${field("Your price out", "rateOut", { value: m?.selfHosted?.rate ? String(m.selfHosted.rate.outputUsdPerMillion) : "", mode: "decimal" })}</div>
  </details>
  <button class="btn primary wide" type="submit">Save the model</button>
</form>
</section>

<section class="step" aria-labelledby="s-backup">
<h2 id="s-backup">2. The nightly backups</h2>
${stateLine(c, { done: v.backup ? `Snapshots go to ${v.backup.url}${v.backup.endpoint ? ` (${v.backup.endpoint})` : ""}. ${s?.backupTest ? (s.backupTest.ok ? `Test write passed ${when(s.backupTest.at, c.lang)}: ${s.backupTest.detail}` : `Test write FAILED ${when(s.backupTest.at, c.lang)}: ${s.backupTest.detail}`) : s?.keys.backup ? "The test write is next." : "The bucket's key is still needed."}` : undefined, pending: Boolean(v.pending.backup), ...(backupRefused ? { refused: backupRefused } : {}), todo: "A bucket that is not on this server (Google Cloud Storage, Backblaze, Cloudflare R2, MinIO), and its key." })}
<form method="post" action="/server/backup" autocomplete="off">${csrf(c)}
  ${field("The bucket", "url", { value: v.backup?.url ?? "", placeholder: "s3://my-bucket/snapshots", help: "Set a lifecycle rule on it that deletes objects after 30 days or more." })}
  ${field("The storage service's address", "endpoint", { value: v.backup?.endpoint ?? "", type: "url", placeholder: "https://storage.googleapis.com", help: "Leave it out for Amazon S3." })}
  ${field("The region", "region", { value: v.backup?.region ?? "", placeholder: "auto", help: "Only if your service asks for one." })}
  ${field("The bucket's key", "bucketKey", { type: "password", autocomplete: "new-password", help: "access-key-id:secret, on one line. It must be able to write and read. It is never shown again." })}
  <fieldset class="field"><legend>The key the backups are locked with</legend>
    ${radio("age", "new", "Make one for me", !k?.own, k && !k.own ? `Made ${when(k.madeAt, c.lang)}${k.confirmedAt ? ", and you confirmed you have it" : ""}.` : "You save its secret half once; this server keeps only the public half.")}
    ${radio("age", "own", "I have an age key", k?.own === true, "Give only its public half (age1...). The secret half never comes here.")}
  </fieldset>
  ${field("Its public half (only for your own key)", "ageRecipient", { value: k?.own ? k.recipient : "", placeholder: "age1..." })}
  <button class="btn primary wide" type="submit">Save and test the bucket</button>
</form>
${v.backup ? html`<form method="post" action="/server/backup/test" class="mt">${csrf(c)}<button class="btn wide" type="submit">Test the bucket again</button></form>` : ""}
</section>

<section class="step" aria-labelledby="s-google">
<h2 id="s-google">3. Google, for calendars (optional)</h2>
${stateLine(c, { done: s?.keys.google ? `Shops share their calendar with ${s.keys.google.clientEmail}.` : v.receipts["google_service_account.json"] ? "Handed in; the server is putting it in place." : undefined, todo: "Only if your shops use a Google calendar and you want one key for all of them. A shop can still hand in its own." })}
<form method="post" action="/server/google" autocomplete="off">${csrf(c)}
  <label class="field"><span>The service account's key file (paste the whole JSON)</span><textarea name="google" rows="6" spellcheck="false" autocapitalize="none"></textarea></label>
  <button class="btn wide" type="submit">Save the Google key</button>
</form>
</section>

<section class="step" aria-labelledby="s-speech">
<h2 id="s-speech">4. Voice notes (optional)</h2>
${stateLine(c, { done: s?.keys.speech ? `The speech provider's key is in place (${when(s.keys.speech.at, c.lang)}).` : v.receipts.speech_key ? "Handed in; the server is putting it in place." : undefined, todo: "Only if your shops will listen to voice notes and answer by voice. It needs your own account with the speech provider (Sarvam), which charges you per minute listened and per 1,000 characters spoken. Each shop then has its own switch, off until you turn it on." })}
<form method="post" action="/server/speech" autocomplete="off">${csrf(c)}
  ${field("The speech provider's key", "speech", { type: "password", placeholder: "paste the key once" })}
  <button class="btn wide" type="submit">Save the speech key</button>
</form>
<p class="muted">The key goes to the speech Guard only and is never shown again.</p>
</section>`);
}

/** The backup key's secret half, on its own page, until the builder confirms they have it somewhere else. */
export function backupKeyPage(c: Ctx, o: { identity?: string; recipient?: string; error?: string; confirmedAt?: string }): string {
  if (!o.identity) return layout(c, "The backup key", html`<h1>The backup key</h1>
<p>${o.confirmedAt ? `You confirmed on ${when(o.confirmedAt, c.lang)} that the secret half is somewhere else, and this server deleted its copy.` : "This server holds no secret half of a backup key."} Only the public half is here${o.recipient ? html`: <code class="addr">${o.recipient}</code>` : "."}</p>
<p><a class="btn" href="/server">Back to this server</a></p>`);
  return layout(c, "Save the backup key", html`<h1>Save the backup key</h1>
<p class="big">This is the only key that opens your backups. Keep it somewhere that is not this server: a password manager, or a file on your laptop.</p>
<p>Without it a backup cannot be opened, and nobody (Geometer neither) can make it again. You bring it back only to restore, and for the monthly restore test on your own machine.</p>
<code class="addr secret">${o.identity}</code>
<p><a class="btn wide" href="/server/backup-key.txt" download>Download it as a file</a></p>
${o.error ? html`<ul class="errors" role="alert"><li>${o.error}</li></ul>` : ""}
<form method="post" action="/server/backup-key/confirm" autocomplete="off">${csrf(c)}
  <h2>When it is saved</h2>
  <label class="field"><span>Type the last ${CONFIRM_CHARS} characters of the key, from where you saved it</span><input name="last" maxlength="${CONFIRM_CHARS + 4}" autocomplete="off" autocapitalize="characters" spellcheck="false" required></label>
  <label class="choice"><input type="checkbox" name="off" value="yes" required><span>I have it somewhere that is not this server. Delete this server's copy.</span></label>
  <button class="btn primary wide" type="submit">Confirm, and delete it here</button>
</form>
<p class="note">After this the panel never shows the key again: only its public half stays here, which can lock backups but not open them.</p>`);
}

/** The text of the downloaded key file: the age identity with comments, as age's own key files are written. */
export const backupKeyFile = (identity: string, recipient: string, serverId: string, at: string): string =>
  `# Geometer: the key that opens this server's backups (${serverId || "this server"}), made ${at}.\n# Keep it off the server. Restore with: geometer restore <shop> --identity <this file>\n# public key: ${recipient}\n${identity.trim()}\n`;

const safeHost = (url: string): string => { try { return new URL(url).host; } catch { return url; } };
