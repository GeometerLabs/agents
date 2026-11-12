// Item 11d on the panel's shop page: the shop's booking page (its link and the QR code for the counter), the MCP endpoint for AI assistants, and the owner's private
// approvals link (make it, see when it was made, switch it off). And the page that shows a new owner's link once. Plain forms and links, no script. The words are in four
// languages here; Hindi, Malayalam and Kannada are machine-written and wait for a native reader, like the rest of the panel's.
import type { Language } from "../../modules/language/languages.ts";
import { html, raw } from "./html.ts";
import type { Raw } from "./html.ts";
import { layout } from "./views.ts";
import type { Ctx } from "./views.ts";
import type { ChannelsView } from "./channels.ts";

interface Words {
  heading: string; page: string; pageNote: string; qr: string; mcp: string; mcpNote: string; owner: string; ownerNote: string; ownerOn: (at: string) => string; ownerOff: string;
  make: string; remake: string; revoke: string; madeTitle: string; madeNote: string; back: string;
}
const WORDS: Record<Language, Words> = {
  en: {
    heading: "Booking page, AI assistants and the owner's link", page: "Booking page", pageNote: "Customers book and pay the deposit here without WhatsApp, under the same limits, holds and record as a WhatsApp booking. Print the QR code for the counter.",
    qr: "QR code of the booking page", mcp: "For AI assistants (MCP)", mcpNote: "An assistant that supports MCP can list services and free times, hold a time, give the payment details, show and cancel a booking. It cannot mark a payment received or approve a refund.",
    owner: "The owner's approvals link", ownerNote: "A private page where the owner marks UPI payments received, answers refunds and sees the coming bookings, without WhatsApp. Give it to the owner once; anyone with it can answer for them.",
    ownerOn: (at) => `On, made ${at}.`, ownerOff: "Off.", make: "Make the owner's link", remake: "Make a new link (the old one stops)", revoke: "Switch the link off",
    madeTitle: "The owner's approvals link", madeNote: "This link is shown only now: copy it and give it to the owner (in person, or on their own phone). It works within a minute. To stop it, switch it off on the shop's page.", back: "Back to the shop",
  },
  hi: {
    heading: "बुकिंग पेज, AI सहायक और मालिक का लिंक", page: "बुकिंग पेज", pageNote: "ग्राहक यहाँ WhatsApp के बिना बुक करते हैं और अग्रिम राशि देते हैं, उन्हीं सीमाओं, रोक और रिकॉर्ड के साथ जो WhatsApp बुकिंग में हैं। काउंटर के लिए QR कोड छापिए।",
    qr: "बुकिंग पेज का QR कोड", mcp: "AI सहायकों के लिए (MCP)", mcpNote: "MCP वाला सहायक सेवाएँ और खाली समय देख सकता है, समय रोक सकता है, पेमेंट की जानकारी दे सकता है, बुकिंग दिखा और रद्द कर सकता है। वह पेमेंट मिला हुआ नहीं मान सकता और रिफ़ंड मंज़ूर नहीं कर सकता।",
    owner: "मालिक का मंज़ूरी लिंक", ownerNote: "एक निजी पेज जहाँ मालिक WhatsApp के बिना UPI पेमेंट मिला हुआ मानते हैं, रिफ़ंड का जवाब देते हैं और आने वाली बुकिंग देखते हैं। इसे मालिक को एक बार दीजिए; जिसके पास यह है वह उनकी ओर से जवाब दे सकता है।",
    ownerOn: (at) => `चालू, ${at} को बना।`, ownerOff: "बंद।", make: "मालिक का लिंक बनाइए", remake: "नया लिंक बनाइए (पुराना बंद हो जाएगा)", revoke: "लिंक बंद कीजिए",
    madeTitle: "मालिक का मंज़ूरी लिंक", madeNote: "यह लिंक सिर्फ़ अभी दिखेगा: इसे कॉपी करके मालिक को दीजिए (सामने, या उनके अपने फ़ोन पर)। यह एक मिनट में काम करने लगेगा। रोकने के लिए दुकान के पेज पर इसे बंद कीजिए।", back: "दुकान पर वापस",
  },
  ml: {
    heading: "ബുക്കിംഗ് പേജ്, AI സഹായികൾ, ഉടമയുടെ ലിങ്ക്", page: "ബുക്കിംഗ് പേജ്", pageNote: "കസ്റ്റമർമാർ WhatsApp ഇല്ലാതെ ഇവിടെ ബുക്ക് ചെയ്ത് അഡ്വാൻസ് അടയ്ക്കുന്നു, WhatsApp ബുക്കിംഗിന്റെ അതേ പരിധികളും പിടിയും രേഖയുമായി. കൗണ്ടറിനായി QR കോഡ് പ്രിന്റ് ചെയ്യൂ.",
    qr: "ബുക്കിംഗ് പേജിന്റെ QR കോഡ്", mcp: "AI സഹായികൾക്ക് (MCP)", mcpNote: "MCP പിന്തുണയുള്ള സഹായിക്ക് സേവനങ്ങളും ഒഴിവുസമയങ്ങളും കാണാനും, സമയം പിടിക്കാനും, പേയ്‌മെന്റ് വിവരം നൽകാനും, ബുക്കിംഗ് കാണിക്കാനും റദ്ദാക്കാനും കഴിയും. പേയ്‌മെന്റ് കിട്ടിയെന്ന് രേഖപ്പെടുത്താനോ റീഫണ്ട് അംഗീകരിക്കാനോ കഴിയില്ല.",
    owner: "ഉടമയുടെ അംഗീകാര ലിങ്ക്", ownerNote: "WhatsApp ഇല്ലാതെ ഉടമ UPI പേയ്‌മെന്റ് കിട്ടിയെന്ന് രേഖപ്പെടുത്തുകയും, റീഫണ്ടുകൾക്ക് മറുപടി നൽകുകയും, വരുന്ന ബുക്കിംഗുകൾ കാണുകയും ചെയ്യുന്ന ഒരു സ്വകാര്യ പേജ്. ഇത് ഉടമയ്ക്ക് ഒരിക്കൽ നൽകൂ; ഇത് കൈയിലുള്ള ആർക്കും അവർക്കുവേണ്ടി മറുപടി നൽകാം.",
    ownerOn: (at) => `ഓൺ, ${at}-ന് ഉണ്ടാക്കി.`, ownerOff: "ഓഫ്.", make: "ഉടമയുടെ ലിങ്ക് ഉണ്ടാക്കൂ", remake: "പുതിയ ലിങ്ക് ഉണ്ടാക്കൂ (പഴയത് നിൽക്കും)", revoke: "ലിങ്ക് ഓഫാക്കൂ",
    madeTitle: "ഉടമയുടെ അംഗീകാര ലിങ്ക്", madeNote: "ഈ ലിങ്ക് ഇപ്പോൾ മാത്രമേ കാണിക്കൂ: കോപ്പി ചെയ്ത് ഉടമയ്ക്ക് നൽകൂ (നേരിട്ട്, അല്ലെങ്കിൽ അവരുടെ സ്വന്തം ഫോണിൽ). ഒരു മിനിറ്റിനുള്ളിൽ ഇത് പ്രവർത്തിക്കും. നിർത്താൻ കടയുടെ പേജിൽ ഇത് ഓഫാക്കൂ.", back: "കടയിലേക്ക് തിരികെ",
  },
  kn: {
    heading: "ಬುಕಿಂಗ್ ಪುಟ, AI ಸಹಾಯಕರು ಮತ್ತು ಮಾಲೀಕರ ಲಿಂಕ್", page: "ಬುಕಿಂಗ್ ಪುಟ", pageNote: "ಗ್ರಾಹಕರು WhatsApp ಇಲ್ಲದೆ ಇಲ್ಲಿ ಬುಕ್ ಮಾಡಿ ಮುಂಗಡ ಪಾವತಿಸುತ್ತಾರೆ, WhatsApp ಬುಕಿಂಗ್‌ನ ಅದೇ ಮಿತಿಗಳು, ಹಿಡಿತ ಮತ್ತು ದಾಖಲೆಯೊಂದಿಗೆ. ಕೌಂಟರ್‌ಗಾಗಿ QR ಕೋಡ್ ಮುದ್ರಿಸಿ.",
    qr: "ಬುಕಿಂಗ್ ಪುಟದ QR ಕೋಡ್", mcp: "AI ಸಹಾಯಕರಿಗೆ (MCP)", mcpNote: "MCP ಬೆಂಬಲಿಸುವ ಸಹಾಯಕ ಸೇವೆಗಳು ಮತ್ತು ಖಾಲಿ ಸಮಯ ನೋಡಬಹುದು, ಸಮಯ ಹಿಡಿದಿಡಬಹುದು, ಪಾವತಿ ವಿವರ ನೀಡಬಹುದು, ಬುಕಿಂಗ್ ತೋರಿಸಿ ರದ್ದುಗೊಳಿಸಬಹುದು. ಪಾವತಿ ಬಂದಿದೆ ಎಂದು ಗುರುತಿಸಲು ಅಥವಾ ರೀಫಂಡ್ ಅನುಮೋದಿಸಲು ಆಗದು.",
    owner: "ಮಾಲೀಕರ ಅನುಮೋದನೆ ಲಿಂಕ್", ownerNote: "WhatsApp ಇಲ್ಲದೆ ಮಾಲೀಕರು UPI ಪಾವತಿ ಬಂದಿದೆ ಎಂದು ಗುರುತಿಸುವ, ರೀಫಂಡ್‌ಗಳಿಗೆ ಉತ್ತರಿಸುವ ಮತ್ತು ಮುಂದಿನ ಬುಕಿಂಗ್‌ಗಳನ್ನು ನೋಡುವ ಖಾಸಗಿ ಪುಟ. ಇದನ್ನು ಮಾಲೀಕರಿಗೆ ಒಮ್ಮೆ ಕೊಡಿ; ಇದು ಇರುವ ಯಾರಾದರೂ ಅವರ ಪರವಾಗಿ ಉತ್ತರಿಸಬಹುದು.",
    ownerOn: (at) => `ಚಾಲೂ, ${at} ರಂದು ಮಾಡಲಾಗಿದೆ.`, ownerOff: "ಬಂದ್.", make: "ಮಾಲೀಕರ ಲಿಂಕ್ ಮಾಡಿ", remake: "ಹೊಸ ಲಿಂಕ್ ಮಾಡಿ (ಹಳೆಯದು ನಿಲ್ಲುತ್ತದೆ)", revoke: "ಲಿಂಕ್ ನಿಲ್ಲಿಸಿ",
    madeTitle: "ಮಾಲೀಕರ ಅನುಮೋದನೆ ಲಿಂಕ್", madeNote: "ಈ ಲಿಂಕ್ ಈಗ ಮಾತ್ರ ಕಾಣುತ್ತದೆ: ಇದನ್ನು ನಕಲಿಸಿ ಮಾಲೀಕರಿಗೆ ಕೊಡಿ (ಎದುರಿಗೆ, ಅಥವಾ ಅವರ ಸ್ವಂತ ಫೋನ್‌ನಲ್ಲಿ). ಒಂದು ನಿಮಿಷದಲ್ಲಿ ಇದು ಕೆಲಸ ಮಾಡುತ್ತದೆ. ನಿಲ್ಲಿಸಲು ಅಂಗಡಿಯ ಪುಟದಲ್ಲಿ ಇದನ್ನು ಬಂದ್ ಮಾಡಿ.", back: "ಅಂಗಡಿಗೆ ಹಿಂದಿರುಗಿ",
  },
};

const csrf = (c: Ctx) => html`<input type="hidden" name="_csrf" value="${c.csrf}">`;
const day = (iso: string) => iso.slice(0, 10);

/** The shop page's block. Only for a shop whose template has a booking page (Bookings) and a panel that knows the server's public address. */
export function channelsBlock(c: Ctx, id: string, v: ChannelsView): Raw {
  const w = WORDS[c.lang];
  return html`<h2>${w.heading}</h2>
<ul class="plain">
  <li class="info"><span class="mark">·</span><span><b>${w.page}</b><br><a href="${v.bookingUrl}">${v.bookingUrl}</a><br><small class="note">${w.pageNote}</small></span></li>
</ul>
<figure class="qr">${raw(v.qrSvg)}<figcaption class="note">${w.qr}</figcaption></figure>
<ul class="plain">
  <li class="info"><span class="mark">·</span><span><b>${w.mcp}</b><br><code>${v.mcpUrl}</code><br><small class="note">${w.mcpNote}</small></span></li>
  <li class="${v.ownerLink ? "info" : "warn"}"><span class="mark">${v.ownerLink ? "✓" : "·"}</span><span><b>${w.owner}</b>: ${v.ownerLink ? w.ownerOn(day(v.ownerLink.createdAt)) : w.ownerOff}<br><small class="note">${w.ownerNote}</small></span></li>
</ul>
<form method="post" action="/shops/${id}/owner-link">${csrf(c)}<button class="btn" type="submit">${v.ownerLink ? w.remake : w.make}</button></form>
${v.ownerLink ? html`<form method="post" action="/shops/${id}/owner-link/revoke">${csrf(c)}<button class="btn danger" type="submit">${w.revoke}</button></form>` : ""}`;
}

/** The page that shows a new owner's link, once. */
export function ownerLinkMadePage(c: Ctx, id: string, link: string): string {
  const w = WORDS[c.lang];
  return layout(c, w.madeTitle, html`<h1>${w.madeTitle}</h1><p><code class="addr">${link}</code></p><div class="notice" role="note">${w.madeNote}</div><p><a href="/shops/${id}">${w.back}</a></p>`);
}
