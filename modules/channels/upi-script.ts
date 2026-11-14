// Money clarity (14 Nov 2026): the one small script of a customer's UPI payment page (a booking's or an order's page while its deposit is waiting). It runs by the
// response's nonce (front.ts customerPagePolicy), is the same on every page that has it, and does three things:
//   1. shows "Copy UPI ID" (the button is in the page hidden: without this script, or without a clipboard, it stays hidden);
//   2. shows "Open in Chrome" on Android only (an intent address; a phone's in-app browser often cannot open a UPI app from a page);
//   3. looks at the page itself every 15 seconds and reloads only when its `data-state` marker changed or is gone (a page that is no longer waiting for the payment has none; the owner marked the payment, a refund moved, the shop wrote).
//      The old way, a meta refresh every 15 seconds, redrew the page, QR code included, under a customer who was still scanning or typing. Without the script the meta
//      refresh still runs (layout in page.ts puts it in <noscript>).
// It reads nothing from the page but those attributes, sends nothing (a GET of the page's own address, which the content policy allows alone), and holds no secret.
export const UPI_SCRIPT = `(function(){
var ua=navigator.userAgent||"";
document.querySelectorAll("[data-copy]").forEach(function(b){
if(!navigator.clipboard)return;
b.hidden=false;
b.addEventListener("click",function(){navigator.clipboard.writeText(b.getAttribute("data-copy")).then(function(){b.textContent=b.getAttribute("data-done");}).catch(function(){});});
});
if(/Android/.test(ua))document.querySelectorAll("[data-chrome]").forEach(function(a){a.hidden=false;});
var p=document.querySelector("[data-poll]");
if(!p||!window.fetch)return;
var url=p.getAttribute("data-poll")+location.search,state=p.getAttribute("data-state");
setInterval(function(){
if(document.hidden)return;
fetch(url,{cache:"no-store",credentials:"same-origin"}).then(function(r){return r.ok?r.text():null;}).then(function(t){
if(t===null)return;
var m=/data-state="([^"]*)"/.exec(t);
if(!m||m[1]!==state)location.reload();
}).catch(function(){});
},15000);
})();`;
