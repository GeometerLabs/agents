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
<div class="banner" id="banner" role="status">Demo · test money · nothing real is sent</div>
<div class="wrap">
  <header class="top">
    <div><span class="shop" id="shopName"></span><span class="clock" id="clock"></span></div>
    <div class="top-actions">
      <button type="button" class="btn small quiet" id="btnSetup">Set up for this shop</button>
      <button type="button" class="btn small quiet" id="btnReset">Start again</button>
    </div>
  </header>
  <noscript><p>This demo needs JavaScript. Please turn it on in your browser.</p></noscript>

  <main>
    <section class="panel" id="panel-customer" aria-labelledby="tabCustomer">
      <div class="chat-head" id="customerName"></div>
      <div class="chat" id="chat" aria-live="polite"></div>
      <div class="chips-label" id="chipsLabel"></div>
      <div class="chips" id="chips"></div>
      <form class="composer" id="composer" autocomplete="off">
        <input id="msg" type="text" maxlength="300" enterkeyhint="send" dir="auto" aria-label="Message">
        <button type="submit" class="btn primary" id="btnSend">Send</button>
      </form>
      <div class="actions">
        <button type="button" class="btn primary wide" id="btnPay"></button>
        <button type="button" class="btn" id="btnPay2"></button>
        <button type="button" class="btn" id="btnCancel"></button>
        <button type="button" class="btn" id="btnHour"></button>
        <button type="button" class="btn" id="btnDay"></button>
      </div>
    </section>

    <section class="panel" id="panel-owner" aria-labelledby="tabOwner" hidden>
      <div id="waiting"></div>
      <h2 id="plainHeading"></h2>
      <ul class="plain" id="plain"></ul>
      <h2 id="ownerChatHeading"></h2>
      <div class="chat short" id="ownerChat"></div>
    </section>

    <section class="panel" id="panel-record" aria-labelledby="tabRecord" hidden>
      <h2>Show what we did</h2>
      <div class="box" id="workDone"></div>
      <div class="box" id="standIns"></div>
      <div id="rows"></div>
    </section>
  </main>

  <div class="foot"><button type="button" class="link" id="btnRecord">Show what we did ▸</button></div>
</div>

<nav class="tabbar" role="tablist">
  <button type="button" class="tab" role="tab" id="tabCustomer" aria-selected="true">Customer</button>
  <button type="button" class="tab" role="tab" id="tabOwner" aria-selected="false"><span id="tabOwnerText">Owner</span><span class="badge" id="badge" hidden></span></button>
  <button type="button" class="tab" role="tab" id="tabRecord" aria-selected="false" hidden>What we did</button>
</nav>

<div class="sheet" id="sheet" hidden role="dialog" aria-modal="true">
  <div class="wrap"><form id="sheetForm" autocomplete="off"><div id="sheetBody"></div></form></div>
</div>
<div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
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
