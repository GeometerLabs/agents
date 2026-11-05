// The one page, as text: a small HTML shell with the style and the script inlined (no files to fetch, nothing from a CDN).
// The shell holds no shop or customer text, so there is nothing here to escape; the script draws everything it is told with textContent.
import { readFileSync } from "node:fs";

const read = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");
const css = read("./page.css");
const script = read("./page.js");

const shell = (nonce: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0f6b45">
<title>Geometer demo</title>
<style nonce="${nonce}">
${css}
</style>
</head>
<body>
<div class="geo-banner" id="banner" role="status">Demo · test money · nothing real is sent</div>
<div class="geo-body">
  <header class="geo-header">
    <div><span class="geo-shop-name" id="shopName"></span><span class="geo-clock" id="clock"></span></div>
    <div class="geo-header-actions">
      <button type="button" class="geo-button geo-button--small geo-button--quiet geo-setup" id="btnSetup">Set up for this shop</button>
      <button type="button" class="geo-button geo-button--small geo-button--quiet geo-reset" id="btnReset">Start again</button>
    </div>
  </header>
  <noscript><p>This demo needs JavaScript. Please turn it on in your browser.</p></noscript>

  <main>
    <section class="geo-panel geo-panel--chat" id="panel-customer" aria-labelledby="tabCustomer">
      <div class="geo-chat-head" id="customerName"></div>
      <div class="geo-chat" id="chat" aria-live="polite"></div>
      <div class="geo-chips-label" id="chipsLabel"></div>
      <div class="geo-chips" id="chips"></div>
      <form class="geo-composer" id="composer" autocomplete="off">
        <input id="msg" type="text" maxlength="300" enterkeyhint="send" dir="auto" aria-label="Message">
        <button type="submit" class="geo-button geo-send" id="btnSend">Send</button>
      </form>
      <div class="geo-actions">
        <button type="button" class="geo-button geo-button--primary geo-button--wide" id="btnPay"></button>
        <button type="button" class="geo-button" id="btnPay2"></button>
        <button type="button" class="geo-button" id="btnCancel"></button>
        <button type="button" class="geo-button" id="btnHour"></button>
        <button type="button" class="geo-button" id="btnDay"></button>
      </div>
    </section>

    <section class="geo-panel geo-panel--owner" id="panel-owner" aria-labelledby="tabOwner" hidden>
      <div id="waiting"></div>
      <h2 class="geo-heading" id="plainHeading"></h2>
      <ul class="geo-summary" id="plain"></ul>
      <h2 class="geo-heading" id="ownerChatHeading"></h2>
      <div class="geo-chat geo-chat--owner" id="ownerChat"></div>
    </section>

    <section class="geo-panel geo-panel--record" id="panel-record" aria-labelledby="tabRecord" hidden>
      <h2 class="geo-heading">Show what we did</h2>
      <div class="geo-box" id="workDone"></div>
      <div class="geo-box" id="standIns"></div>
      <div class="geo-record" id="rows"></div>
    </section>
  </main>

  <div class="geo-foot"><button type="button" class="geo-link" id="btnRecord">Show what we did ▸</button></div>
</div>

<nav class="geo-tabs" role="tablist">
  <button type="button" class="geo-tab geo-tab--customer" role="tab" id="tabCustomer" aria-selected="true">Customer</button>
  <button type="button" class="geo-tab geo-tab--owner" role="tab" id="tabOwner" aria-selected="false"><span id="tabOwnerText">Owner</span><span class="geo-badge" id="badge" hidden></span></button>
  <button type="button" class="geo-tab geo-tab--record" role="tab" id="tabRecord" aria-selected="false" hidden>What we did</button>
</nav>

<div class="geo-sheet" id="sheet" hidden role="dialog" aria-modal="true">
  <div class="geo-body"><form class="geo-form" id="sheetForm" autocomplete="off"><div id="sheetBody"></div></form></div>
</div>
<div class="geo-toast" id="toast" role="status" aria-live="polite" hidden></div>
<script nonce="${nonce}">
${script}
</script>
</body>
</html>
`;

/** The page, with this response's nonce on its two inline blocks (the Content-Security-Policy allows only those). */
export function renderPage(nonce: string): string {
  return shell(nonce);
}
