// The words of the client health and margin pages (B32) and the template vote (B56), in the four languages. English is the source. Hindi, Malayalam and
// Kannada are MACHINE-WRITTEN and WAIT FOR NATIVE REVIEW like the rest of the panel's: the pages carry the panel's draft note in those languages (languages.ts
// REVIEW_STATE), and every line is on the review sheets, section 7 (review.ts adds them under the ids "health.*").
//
// The site's banned words stay banned here (test/health.test.ts checks them in all four languages): the words are "margin", "what you keep", "your price"
// and "running cost". A sentence here says what the numbers are; it never says what anyone could make.
import type { Language } from "../../modules/language/languages.ts";

export interface HealthWords {
  nav: string; voteNav: string;
  title: string; intro: string; none: string; open: string; month(month: string): string;
  saved: string; problems: { price: string; setup: string; minutes: string; rate: string };
  attention: {
    heading: string; ok: string; needs(n: number): string; unfinished(n: number): string; kind: Record<string, string>; otherKind: string; notShared: string;
    heartbeat(at: string): string; heartbeatStale(at: string): string; heartbeatNone: string;
    drill(days: number): string; drillFailed(days: number): string; drillNone: string; buttons: string; todo: string;
  };
  cost: {
    heading: string; lines: { plan: string; whatsapp: string; model: string; support: string };
    unknown: string; minutes(n: number): string; total: string; subtotal(n: number): string;
    notes: { builderLicence: string; included: string; estimate: string; noRecord: string; noPlan: string; noPrice: string; noMinutes: string; noRate: string; floor(n: number): string };
  };
  charge: { heading: string; price: string; setup: string; minutes: string; rate: string; save: string; privacy: string; hint: string };
  margin: { heading: string; yourPrice: string; keep: string; unknownPrice: string; before(items: string): string; notFinal: string; setupOnce(amount: string): string; negative: string };
  all: { heading: string; shops(priced: number, n: number): string; keep: string; partial(priced: number, n: number): string; setup: string; unknown: string };
  vote: {
    title: string; intro: string; yours: string; none: string; button: string; change: string; saved: string; refused: string;
    results: string; hidden: string; votes(n: number): string; note: string; link: string;
  };
}

/** Sample values for the functions above, so the review sheet shows one real sentence per line. Paths are as review.ts names them ("health.attention.needs"). */
export const HEALTH_SAMPLE_ARGS: Record<string, unknown[]> = {
  "health.month": ["2026-11"],
  "health.attention.needs": [2], "health.attention.unfinished": [3], "health.attention.heartbeat": ["8 Nov 2026, 10:30"], "health.attention.heartbeatStale": ["3 Nov 2026, 10:30"],
  "health.attention.drill": [12], "health.attention.drillFailed": [12],
  "health.cost.minutes": [90], "health.cost.subtotal": [1], "health.cost.notes.floor": [4],
  "health.margin.before": ["Your support time"], "health.margin.setupOnce": ["₹2,000.00"],
  "health.all.shops": [2, 3], "health.all.partial": [2, 3],
  "health.vote.votes": [4],
};

const en: HealthWords = {
  nav: "Health and margin", voteNav: "Vote",
  title: "Health and margin",
  intro: "For each shop: what needs a look, what it costs you to run, what you charge, and what you keep. Only you see the prices and minutes you type here.",
  none: "You have no shops yet.", open: "Open", month: (m) => `Running cost for ${m}`,
  saved: "Saved.",
  problems: { price: "Your price must be an amount in rupees, like 1500 or 1500.50.", setup: "The setup fee must be an amount in rupees, like 2000.", minutes: "Support minutes must be a whole number, like 90.", rate: "The value of your hour must be an amount in rupees, like 300." },
  attention: {
    heading: "What needs a look", ok: "Nothing needs a look right now.", needs: (n) => `${n} shops need a look`, unfinished: (n) => `${n} unfinished`,
    kind: {
      deposit_no_booking: "Deposit with no booking", payment_unrecorded: "Payment not recorded", approval_waiting_long: "Owner's answer waiting long", refund_waiting: "Refund waiting",
      refund_unknown: "Refund not confirmed", refund_failed: "Refund failed", upi_payment_unconfirmed: "UPI payment not confirmed", upi_refund_owed: "UPI refund owed",
    },
    otherKind: "Other", notShared: "This shop's record has not been shared yet, so its unfinished work cannot be counted.",
    heartbeat: (at) => `Geometer last heard from this shop on ${at}.`, heartbeatStale: (at) => `Geometer last heard from this shop on ${at}, more than 2 days ago. Check that the server is on and reaches Geometer.`,
    heartbeatNone: "Geometer has not answered about this shop yet.",
    drill: (d) => `Last restore drill: ${d} days ago.`, drillFailed: (d) => `The last restore drill, ${d} days ago, did not match. Look at it.`, drillNone: "No restore drill has been recorded yet.",
    buttons: "AI is paused for this shop. Customers get button menus.", todo: "Open the to-do list",
  },
  cost: {
    heading: "Running cost this month",
    lines: { plan: "Geometer's plan fee, before GST", whatsapp: "WhatsApp messages, at cost", model: "AI model", support: "Your support time" },
    unknown: "unknown", minutes: (n) => `${n} minutes`, total: "Running cost", subtotal: (n) => `Running cost so far (${n} not known yet)`,
    notes: {
      builderLicence: "Builder licence", included: "Included in the plan fee", estimate: "Estimate from this month's counts, before the free replies",
      noRecord: "No record shared yet", noPlan: "Fleet has not set a plan", noPrice: "No price in the list", noMinutes: "No minutes entered this month", noRate: "Enter what an hour of your time is worth",
      floor: (n) => `At least this much: ${n} calls had no price`,
    },
  },
  charge: {
    heading: "What you charge", price: "Your price a month (₹)", setup: "One-time setup fee (₹, optional)", minutes: "Support minutes this month", rate: "What an hour of your time is worth (₹)",
    save: "Save", privacy: "These stay on this panel. They are never sent to Geometer.", hint: "Leave a box empty if you do not know it. Empty means unknown, not zero.",
  },
  margin: {
    heading: "Margin", yourPrice: "Your price", keep: "What you keep a month", unknownPrice: "Unknown until you enter your price.",
    notFinal: "Before the costs that are not known yet.",
    before: (items) => `before: ${items}`, setupOnce: (a) => `Setup fee you charged once: ${a}`, negative: "Below zero: the running cost is more than your price.",
  },
  all: {
    heading: "All your shops", shops: (p, n) => `Price entered for ${p} of ${n} shops`, keep: "What you keep a month",
    partial: (p, n) => `Only the ${p} shops with a price are added up, out of ${n}.`, setup: "Setup fees charged once", unknown: "Unknown until a price is entered",
  },
  vote: {
    title: "Vote on the next template", intro: "As one of the first 100 innovators, you pick the next template Geometer builds. One vote each, and you can change it any time.",
    yours: "Your vote", none: "You have not voted yet.", button: "Save my vote", change: "Change my vote", saved: "Your vote is saved.", refused: "That choice is not on the list.",
    results: "Votes so far", hidden: "Vote to see how the others voted.", votes: (n) => `${n} votes`, note: "Counts only. Names are never shown. These are the votes counted on this panel so far.", link: "Vote on the next template",
  },
};

const hi: HealthWords = {
  nav: "सेहत और मार्जिन", voteNav: "वोट",
  title: "सेहत और मार्जिन",
  intro: "हर दुकान के लिए: किस पर नज़र चाहिए, उसे चलाने में आपका कितना ख़र्च है, आप कितना लेते हैं, और आपके पास कितना बचता है। यहाँ लिखी कीमतें और मिनट सिर्फ़ आपको दिखते हैं।",
  none: "अभी आपकी कोई दुकान नहीं है।", open: "खोलें", month: (m) => `${m} का चालू ख़र्च`,
  saved: "सहेज लिया।",
  problems: { price: "आपकी कीमत रुपयों में होनी चाहिए, जैसे 1500 या 1500.50।", setup: "सेटअप शुल्क रुपयों में होना चाहिए, जैसे 2000।", minutes: "सपोर्ट के मिनट पूरी संख्या में होने चाहिए, जैसे 90।", rate: "आपके एक घंटे की क़ीमत रुपयों में होनी चाहिए, जैसे 300।" },
  attention: {
    heading: "किस पर नज़र चाहिए", ok: "अभी किसी पर नज़र की ज़रूरत नहीं है।", needs: (n) => `${n} दुकानों पर नज़र चाहिए`, unfinished: (n) => `${n} अधूरे`,
    kind: {
      deposit_no_booking: "डिपॉज़िट आया, बुकिंग नहीं", payment_unrecorded: "भुगतान दर्ज नहीं हुआ", approval_waiting_long: "मालिक के जवाब का लंबा इंतज़ार", refund_waiting: "रिफंड रुका है",
      refund_unknown: "रिफंड की पुष्टि नहीं", refund_failed: "रिफंड नहीं हुआ", upi_payment_unconfirmed: "UPI भुगतान की पुष्टि नहीं", upi_refund_owed: "UPI रिफंड देना बाकी",
    },
    otherKind: "अन्य", notShared: "इस दुकान का रिकॉर्ड अभी साझा नहीं हुआ है, इसलिए अधूरे काम गिने नहीं जा सकते।",
    heartbeat: (at) => `Geometer को इस दुकान की आख़िरी ख़बर ${at} को मिली।`, heartbeatStale: (at) => `Geometer को इस दुकान की आख़िरी ख़बर ${at} को मिली, यानी 2 दिन से ज़्यादा पहले। देखें कि सर्वर चालू है और Geometer तक पहुँचता है।`,
    heartbeatNone: "Geometer ने अभी तक इस दुकान के बारे में जवाब नहीं दिया है।",
    drill: (d) => `पिछला रीस्टोर अभ्यास: ${d} दिन पहले।`, drillFailed: (d) => `पिछला रीस्टोर अभ्यास, ${d} दिन पहले, मेल नहीं खाया। उसे देखें।`, drillNone: "अभी तक कोई रीस्टोर अभ्यास दर्ज नहीं हुआ है।",
    buttons: "इस दुकान के लिए AI रुका है। ग्राहकों को बटन वाले मेनू मिलते हैं।", todo: "करने की सूची खोलें",
  },
  cost: {
    heading: "इस महीने का चालू ख़र्च",
    lines: { plan: "Geometer का प्लान शुल्क, GST से पहले", whatsapp: "WhatsApp संदेश, लागत पर", model: "AI मॉडल", support: "आपका सपोर्ट समय" },
    unknown: "पता नहीं", minutes: (n) => `${n} मिनट`, total: "चालू ख़र्च", subtotal: (n) => `अब तक का चालू ख़र्च (${n} अभी पता नहीं)`,
    notes: {
      builderLicence: "बिल्डर लाइसेंस", included: "प्लान शुल्क में शामिल", estimate: "इस महीने की गिनती से अनुमान, मुफ़्त जवाबों से पहले",
      noRecord: "रिकॉर्ड अभी साझा नहीं हुआ", noPlan: "फ़्लीट ने प्लान तय नहीं किया", noPrice: "सूची में कीमत नहीं", noMinutes: "इस महीने के मिनट नहीं भरे", noRate: "अपने एक घंटे की क़ीमत भरें",
      floor: (n) => `कम से कम इतना: ${n} कॉल की कीमत नहीं थी`,
    },
  },
  charge: {
    heading: "आप क्या लेते हैं", price: "आपकी कीमत प्रति माह (₹)", setup: "एक बार का सेटअप शुल्क (₹, वैकल्पिक)", minutes: "इस महीने के सपोर्ट मिनट", rate: "आपके एक घंटे की क़ीमत (₹)",
    save: "सहेजें", privacy: "ये इसी पैनल पर रहते हैं। इन्हें Geometer को कभी नहीं भेजा जाता।", hint: "जो पता न हो, वह डिब्बा ख़ाली छोड़ें। ख़ाली का मतलब पता नहीं है, शून्य नहीं।",
  },
  margin: {
    heading: "मार्जिन", yourPrice: "आपकी कीमत", keep: "हर महीने आपके पास बचता है", unknownPrice: "आपकी कीमत भरने तक पता नहीं।",
    notFinal: "उन ख़र्चों से पहले जो अभी पता नहीं हैं।",
    before: (items) => `इनसे पहले: ${items}`, setupOnce: (a) => `एक बार लिया सेटअप शुल्क: ${a}`, negative: "शून्य से नीचे: चालू ख़र्च आपकी कीमत से ज़्यादा है।",
  },
  all: {
    heading: "आपकी सभी दुकानें", shops: (p, n) => `${n} में से ${p} दुकानों की कीमत भरी है`, keep: "हर महीने आपके पास बचता है",
    partial: (p, n) => `${n} में से सिर्फ़ कीमत वाली ${p} दुकानें जोड़ी गई हैं।`, setup: "एक बार लिए सेटअप शुल्क", unknown: "कीमत भरने तक पता नहीं",
  },
  vote: {
    title: "अगले टेम्पलेट पर वोट", intro: "पहले 100 इनोवेटरों में से एक के रूप में आप चुनते हैं कि Geometer अगला टेम्पलेट कौन-सा बनाए। हर किसी का एक वोट, और आप कभी भी बदल सकते हैं।",
    yours: "आपका वोट", none: "आपने अभी वोट नहीं दिया है।", button: "मेरा वोट सहेजें", change: "मेरा वोट बदलें", saved: "आपका वोट सहेज लिया गया।", refused: "यह विकल्प सूची में नहीं है।",
    results: "अब तक के वोट", hidden: "दूसरों ने कैसे वोट दिया, यह देखने के लिए वोट दें।", votes: (n) => `${n} वोट`, note: "सिर्फ़ गिनती। नाम कभी नहीं दिखाए जाते। ये इस पैनल पर अब तक गिने गए वोट हैं।", link: "अगले टेम्पलेट पर वोट दें",
  },
};

const ml: HealthWords = {
  nav: "ആരോഗ്യവും മാർജിനും", voteNav: "വോട്ട്",
  title: "ആരോഗ്യവും മാർജിനും",
  intro: "ഓരോ കടയ്ക്കും: എന്തിൽ ശ്രദ്ധ വേണം, അത് നടത്താൻ നിങ്ങൾക്ക് എത്ര ചെലവ്, നിങ്ങൾ എത്ര ഈടാക്കുന്നു, നിങ്ങൾക്ക് എത്ര ബാക്കി. ഇവിടെ നൽകുന്ന വിലകളും മിനിറ്റുകളും നിങ്ങൾക്ക് മാത്രമേ കാണാൻ കഴിയൂ.",
  none: "നിങ്ങൾക്ക് ഇതുവരെ കടകളില്ല.", open: "തുറക്കുക", month: (m) => `${m}-ലെ പ്രവർത്തന ചെലവ്`,
  saved: "സേവ് ചെയ്തു.",
  problems: { price: "നിങ്ങളുടെ വില രൂപയിൽ ഒരു തുക ആയിരിക്കണം, ഉദാ. 1500 അല്ലെങ്കിൽ 1500.50.", setup: "സെറ്റപ്പ് ഫീസ് രൂപയിൽ ഒരു തുക ആയിരിക്കണം, ഉദാ. 2000.", minutes: "സപ്പോർട്ട് മിനിറ്റ് ഒരു പൂർണ്ണസംഖ്യ ആയിരിക്കണം, ഉദാ. 90.", rate: "നിങ്ങളുടെ ഒരു മണിക്കൂറിന്റെ മൂല്യം രൂപയിൽ ഒരു തുക ആയിരിക്കണം, ഉദാ. 300." },
  attention: {
    heading: "ശ്രദ്ധ വേണ്ടത്", ok: "ഇപ്പോൾ ഒന്നിനും ശ്രദ്ധ വേണ്ട.", needs: (n) => `${n} കടകളിൽ ശ്രദ്ധ വേണം`, unfinished: (n) => `${n} പൂർത്തിയാകാത്തത്`,
    kind: {
      deposit_no_booking: "ഡെപ്പോസിറ്റ് വന്നു, ബുക്കിംഗ് ഇല്ല", payment_unrecorded: "പണമടവ് രേഖപ്പെടുത്തിയിട്ടില്ല", approval_waiting_long: "ഉടമയുടെ മറുപടിക്കായി ദീർഘനേരം കാത്തിരിപ്പ്", refund_waiting: "റീഫണ്ട് കാത്തിരിക്കുന്നു",
      refund_unknown: "റീഫണ്ട് സ്ഥിരീകരിച്ചിട്ടില്ല", refund_failed: "റീഫണ്ട് നടന്നില്ല", upi_payment_unconfirmed: "UPI പണമടവ് സ്ഥിരീകരിച്ചിട്ടില്ല", upi_refund_owed: "UPI റീഫണ്ട് നൽകാനുണ്ട്",
    },
    otherKind: "മറ്റുള്ളവ", notShared: "ഈ കടയുടെ രേഖ ഇതുവരെ പങ്കിട്ടിട്ടില്ല, അതിനാൽ പൂർത്തിയാകാത്ത ജോലികൾ എണ്ണാൻ കഴിയില്ല.",
    heartbeat: (at) => `ഈ കടയിൽ നിന്ന് Geometer-ന് അവസാനം വിവരം കിട്ടിയത് ${at}-ന്.`, heartbeatStale: (at) => `ഈ കടയിൽ നിന്ന് Geometer-ന് അവസാനം വിവരം കിട്ടിയത് ${at}-ന്, 2 ദിവസത്തിലേറെ മുമ്പ്. സെർവർ ഓണാണെന്നും Geometer-ൽ എത്തുന്നുണ്ടെന്നും പരിശോധിക്കുക.`,
    heartbeatNone: "ഈ കടയെക്കുറിച്ച് Geometer ഇതുവരെ മറുപടി നൽകിയിട്ടില്ല.",
    drill: (d) => `അവസാന റീസ്റ്റോർ പരിശീലനം: ${d} ദിവസം മുമ്പ്.`, drillFailed: (d) => `${d} ദിവസം മുമ്പത്തെ അവസാന റീസ്റ്റോർ പരിശീലനം യോജിച്ചില്ല. അത് നോക്കുക.`, drillNone: "ഇതുവരെ റീസ്റ്റോർ പരിശീലനം രേഖപ്പെടുത്തിയിട്ടില്ല.",
    buttons: "ഈ കടയ്ക്ക് AI നിർത്തിവച്ചിരിക്കുന്നു. ഉപഭോക്താക്കൾക്ക് ബട്ടൺ മെനു കിട്ടും.", todo: "ചെയ്യാനുള്ള പട്ടിക തുറക്കുക",
  },
  cost: {
    heading: "ഈ മാസത്തെ പ്രവർത്തന ചെലവ്",
    lines: { plan: "Geometer പ്ലാൻ ഫീസ്, GST ഒഴികെ", whatsapp: "WhatsApp സന്ദേശങ്ങൾ, ചെലവ് വിലയിൽ", model: "AI മോഡൽ", support: "നിങ്ങളുടെ സപ്പോർട്ട് സമയം" },
    unknown: "അറിയില്ല", minutes: (n) => `${n} മിനിറ്റ്`, total: "പ്രവർത്തന ചെലവ്", subtotal: (n) => `ഇതുവരെയുള്ള പ്രവർത്തന ചെലവ് (${n} എണ്ണം ഇതുവരെ അറിയില്ല)`,
    notes: {
      builderLicence: "ബിൽഡർ ലൈസൻസ്", included: "പ്ലാൻ ഫീസിൽ ഉൾപ്പെടുന്നു", estimate: "ഈ മാസത്തെ എണ്ണത്തിൽ നിന്നുള്ള കണക്ക്, സൗജന്യ മറുപടികൾക്ക് മുമ്പ്",
      noRecord: "രേഖ ഇതുവരെ പങ്കിട്ടിട്ടില്ല", noPlan: "ഫ്ലീറ്റ് പ്ലാൻ നിശ്ചയിച്ചിട്ടില്ല", noPrice: "പട്ടികയിൽ വിലയില്ല", noMinutes: "ഈ മാസത്തെ മിനിറ്റ് നൽകിയിട്ടില്ല", noRate: "നിങ്ങളുടെ ഒരു മണിക്കൂറിന്റെ മൂല്യം നൽകുക",
      floor: (n) => `ഇത്രയെങ്കിലും: ${n} കോളുകൾക്ക് വിലയില്ലായിരുന്നു`,
    },
  },
  charge: {
    heading: "നിങ്ങൾ ഈടാക്കുന്നത്", price: "നിങ്ങളുടെ വില മാസം (₹)", setup: "ഒറ്റത്തവണ സെറ്റപ്പ് ഫീസ് (₹, ഐച്ഛികം)", minutes: "ഈ മാസത്തെ സപ്പോർട്ട് മിനിറ്റ്", rate: "നിങ്ങളുടെ ഒരു മണിക്കൂറിന്റെ മൂല്യം (₹)",
    save: "സേവ് ചെയ്യുക", privacy: "ഇവ ഈ പാനലിൽ തന്നെ നിൽക്കുന്നു. Geometer-ന് ഒരിക്കലും അയയ്ക്കില്ല.", hint: "അറിയാത്ത ഒന്ന് ശൂന്യമായി വിടുക. ശൂന്യം എന്നാൽ അറിയില്ല, പൂജ്യമല്ല.",
  },
  margin: {
    heading: "മാർജിൻ", yourPrice: "നിങ്ങളുടെ വില", keep: "മാസം നിങ്ങൾക്ക് ബാക്കി വരുന്നത്", unknownPrice: "നിങ്ങളുടെ വില നൽകുന്നത് വരെ അറിയില്ല.",
    notFinal: "ഇതുവരെ അറിയാത്ത ചെലവുകൾക്ക് മുമ്പുള്ളത്.",
    before: (items) => `ഇവയ്ക്ക് മുമ്പ്: ${items}`, setupOnce: (a) => `ഒരിക്കൽ ഈടാക്കിയ സെറ്റപ്പ് ഫീസ്: ${a}`, negative: "പൂജ്യത്തിന് താഴെ: പ്രവർത്തന ചെലവ് നിങ്ങളുടെ വിലയേക്കാൾ കൂടുതലാണ്.",
  },
  all: {
    heading: "നിങ്ങളുടെ എല്ലാ കടകളും", shops: (p, n) => `${n} കടകളിൽ ${p} എണ്ണത്തിന് വില നൽകി`, keep: "മാസം നിങ്ങൾക്ക് ബാക്കി വരുന്നത്",
    partial: (p, n) => `${n} കടകളിൽ വിലയുള്ള ${p} എണ്ണം മാത്രമേ കൂട്ടിയിട്ടുള്ളൂ.`, setup: "ഒരിക്കൽ ഈടാക്കിയ സെറ്റപ്പ് ഫീസുകൾ", unknown: "വില നൽകുന്നത് വരെ അറിയില്ല",
  },
  vote: {
    title: "അടുത്ത ടെംപ്ലേറ്റിന് വോട്ട്", intro: "ആദ്യത്തെ 100 ഇന്നൊവേറ്റർമാരിൽ ഒരാളായി, Geometer അടുത്തതായി ഉണ്ടാക്കുന്ന ടെംപ്ലേറ്റ് നിങ്ങൾ തിരഞ്ഞെടുക്കുന്നു. ഓരോരുത്തർക്കും ഒരു വോട്ട്, എപ്പോൾ വേണമെങ്കിലും മാറ്റാം.",
    yours: "നിങ്ങളുടെ വോട്ട്", none: "നിങ്ങൾ ഇതുവരെ വോട്ട് ചെയ്തിട്ടില്ല.", button: "എന്റെ വോട്ട് സേവ് ചെയ്യുക", change: "എന്റെ വോട്ട് മാറ്റുക", saved: "നിങ്ങളുടെ വോട്ട് സേവ് ചെയ്തു.", refused: "ആ തിരഞ്ഞെടുപ്പ് പട്ടികയിലില്ല.",
    results: "ഇതുവരെയുള്ള വോട്ടുകൾ", hidden: "മറ്റുള്ളവർ എങ്ങനെ വോട്ട് ചെയ്തെന്ന് കാണാൻ വോട്ട് ചെയ്യുക.", votes: (n) => `${n} വോട്ട്`, note: "എണ്ണം മാത്രം. പേരുകൾ ഒരിക്കലും കാണിക്കില്ല. ഈ പാനലിൽ ഇതുവരെ എണ്ണിയ വോട്ടുകളാണിവ.", link: "അടുത്ത ടെംപ്ലേറ്റിന് വോട്ട് ചെയ്യുക",
  },
};

const kn: HealthWords = {
  nav: "ಆರೋಗ್ಯ ಮತ್ತು ಮಾರ್ಜಿನ್", voteNav: "ಮತ",
  title: "ಆರೋಗ್ಯ ಮತ್ತು ಮಾರ್ಜಿನ್",
  intro: "ಪ್ರತಿ ಅಂಗಡಿಗೆ: ಯಾವುದರ ಮೇಲೆ ಗಮನ ಬೇಕು, ಅದನ್ನು ನಡೆಸಲು ನಿಮಗೆ ಎಷ್ಟು ಖರ್ಚು, ನೀವು ಎಷ್ಟು ಪಡೆಯುತ್ತೀರಿ, ನಿಮಗೆ ಎಷ್ಟು ಉಳಿಯುತ್ತದೆ. ಇಲ್ಲಿ ನೀವು ಬರೆಯುವ ಬೆಲೆ ಮತ್ತು ನಿಮಿಷಗಳು ನಿಮಗೆ ಮಾತ್ರ ಕಾಣುತ್ತವೆ.",
  none: "ನಿಮಗೆ ಇನ್ನೂ ಅಂಗಡಿಗಳಿಲ್ಲ.", open: "ತೆರೆಯಿರಿ", month: (m) => `${m} ರ ನಡೆಸುವ ಖರ್ಚು`,
  saved: "ಉಳಿಸಲಾಗಿದೆ.",
  problems: { price: "ನಿಮ್ಮ ಬೆಲೆ ರೂಪಾಯಿಗಳಲ್ಲಿ ಒಂದು ಮೊತ್ತವಾಗಿರಬೇಕು, ಉದಾ. 1500 ಅಥವಾ 1500.50.", setup: "ಸೆಟಪ್ ಶುಲ್ಕ ರೂಪಾಯಿಗಳಲ್ಲಿ ಒಂದು ಮೊತ್ತವಾಗಿರಬೇಕು, ಉದಾ. 2000.", minutes: "ಸಪೋರ್ಟ್ ನಿಮಿಷಗಳು ಪೂರ್ಣ ಸಂಖ್ಯೆಯಾಗಿರಬೇಕು, ಉದಾ. 90.", rate: "ನಿಮ್ಮ ಒಂದು ಗಂಟೆಯ ಮೌಲ್ಯ ರೂಪಾಯಿಗಳಲ್ಲಿ ಒಂದು ಮೊತ್ತವಾಗಿರಬೇಕು, ಉದಾ. 300." },
  attention: {
    heading: "ಗಮನ ಬೇಕಾದದ್ದು", ok: "ಈಗ ಯಾವುದಕ್ಕೂ ಗಮನ ಬೇಕಿಲ್ಲ.", needs: (n) => `${n} ಅಂಗಡಿಗಳ ಮೇಲೆ ಗಮನ ಬೇಕು`, unfinished: (n) => `${n} ಅರ್ಧಂಬರ್ಧ`,
    kind: {
      deposit_no_booking: "ಡೆಪಾಸಿಟ್ ಬಂದಿದೆ, ಬುಕಿಂಗ್ ಇಲ್ಲ", payment_unrecorded: "ಪಾವತಿ ದಾಖಲಾಗಿಲ್ಲ", approval_waiting_long: "ಮಾಲೀಕರ ಉತ್ತರಕ್ಕೆ ಬಹಳ ಕಾಯುವಿಕೆ", refund_waiting: "ರೀಫಂಡ್ ಕಾಯುತ್ತಿದೆ",
      refund_unknown: "ರೀಫಂಡ್ ದೃಢಪಟ್ಟಿಲ್ಲ", refund_failed: "ರೀಫಂಡ್ ಆಗಲಿಲ್ಲ", upi_payment_unconfirmed: "UPI ಪಾವತಿ ದೃಢಪಟ್ಟಿಲ್ಲ", upi_refund_owed: "UPI ರೀಫಂಡ್ ಕೊಡಬೇಕಿದೆ",
    },
    otherKind: "ಇತರೆ", notShared: "ಈ ಅಂಗಡಿಯ ದಾಖಲೆ ಇನ್ನೂ ಹಂಚಿಕೊಂಡಿಲ್ಲ, ಆದ್ದರಿಂದ ಅರ್ಧಂಬರ್ಧ ಕೆಲಸಗಳನ್ನು ಎಣಿಸಲಾಗುವುದಿಲ್ಲ.",
    heartbeat: (at) => `ಈ ಅಂಗಡಿಯಿಂದ Geometer ಗೆ ಕೊನೆಯ ಸುದ್ದಿ ಸಿಕ್ಕಿದ್ದು ${at}.`, heartbeatStale: (at) => `ಈ ಅಂಗಡಿಯಿಂದ Geometer ಗೆ ಕೊನೆಯ ಸುದ್ದಿ ಸಿಕ್ಕಿದ್ದು ${at}, 2 ದಿನಕ್ಕಿಂತ ಹೆಚ್ಚು ಹಿಂದೆ. ಸರ್ವರ್ ಆನ್ ಆಗಿದೆಯೇ ಮತ್ತು Geometer ತಲುಪುತ್ತಿದೆಯೇ ಎಂದು ನೋಡಿ.`,
    heartbeatNone: "ಈ ಅಂಗಡಿಯ ಬಗ್ಗೆ Geometer ಇನ್ನೂ ಉತ್ತರಿಸಿಲ್ಲ.",
    drill: (d) => `ಕೊನೆಯ ರಿಸ್ಟೋರ್ ಅಭ್ಯಾಸ: ${d} ದಿನ ಹಿಂದೆ.`, drillFailed: (d) => `${d} ದಿನ ಹಿಂದಿನ ಕೊನೆಯ ರಿಸ್ಟೋರ್ ಅಭ್ಯಾಸ ಹೊಂದಲಿಲ್ಲ. ಅದನ್ನು ನೋಡಿ.`, drillNone: "ಇನ್ನೂ ಯಾವುದೇ ರಿಸ್ಟೋರ್ ಅಭ್ಯಾಸ ದಾಖಲಾಗಿಲ್ಲ.",
    buttons: "ಈ ಅಂಗಡಿಗೆ AI ನಿಲ್ಲಿಸಲಾಗಿದೆ. ಗ್ರಾಹಕರಿಗೆ ಬಟನ್ ಮೆನು ಸಿಗುತ್ತದೆ.", todo: "ಮಾಡಬೇಕಾದ ಪಟ್ಟಿ ತೆರೆಯಿರಿ",
  },
  cost: {
    heading: "ಈ ತಿಂಗಳ ನಡೆಸುವ ಖರ್ಚು",
    lines: { plan: "Geometer ಪ್ಲಾನ್ ಶುಲ್ಕ, GST ಬಿಟ್ಟು", whatsapp: "WhatsApp ಸಂದೇಶಗಳು, ವೆಚ್ಚದ ಬೆಲೆಯಲ್ಲಿ", model: "AI ಮಾಡೆಲ್", support: "ನಿಮ್ಮ ಸಪೋರ್ಟ್ ಸಮಯ" },
    unknown: "ಗೊತ್ತಿಲ್ಲ", minutes: (n) => `${n} ನಿಮಿಷ`, total: "ನಡೆಸುವ ಖರ್ಚು", subtotal: (n) => `ಇಲ್ಲಿಯವರೆಗಿನ ನಡೆಸುವ ಖರ್ಚು (${n} ಇನ್ನೂ ಗೊತ್ತಿಲ್ಲ)`,
    notes: {
      builderLicence: "ಬಿಲ್ಡರ್ ಲೈಸೆನ್ಸ್", included: "ಪ್ಲಾನ್ ಶುಲ್ಕದಲ್ಲಿ ಸೇರಿದೆ", estimate: "ಈ ತಿಂಗಳ ಎಣಿಕೆಯಿಂದ ಅಂದಾಜು, ಉಚಿತ ಉತ್ತರಗಳ ಮೊದಲು",
      noRecord: "ದಾಖಲೆ ಇನ್ನೂ ಹಂಚಿಕೊಂಡಿಲ್ಲ", noPlan: "ಫ್ಲೀಟ್ ಪ್ಲಾನ್ ಹೊಂದಿಸಿಲ್ಲ", noPrice: "ಪಟ್ಟಿಯಲ್ಲಿ ಬೆಲೆ ಇಲ್ಲ", noMinutes: "ಈ ತಿಂಗಳ ನಿಮಿಷಗಳನ್ನು ನಮೂದಿಸಿಲ್ಲ", noRate: "ನಿಮ್ಮ ಒಂದು ಗಂಟೆಯ ಮೌಲ್ಯವನ್ನು ನಮೂದಿಸಿ",
      floor: (n) => `ಕನಿಷ್ಠ ಇಷ್ಟು: ${n} ಕರೆಗಳಿಗೆ ಬೆಲೆ ಇರಲಿಲ್ಲ`,
    },
  },
  charge: {
    heading: "ನೀವು ಪಡೆಯುವುದು", price: "ನಿಮ್ಮ ಬೆಲೆ ತಿಂಗಳಿಗೆ (₹)", setup: "ಒಮ್ಮೆಯ ಸೆಟಪ್ ಶುಲ್ಕ (₹, ಐಚ್ಛಿಕ)", minutes: "ಈ ತಿಂಗಳ ಸಪೋರ್ಟ್ ನಿಮಿಷಗಳು", rate: "ನಿಮ್ಮ ಒಂದು ಗಂಟೆಯ ಮೌಲ್ಯ (₹)",
    save: "ಉಳಿಸಿ", privacy: "ಇವು ಈ ಪ್ಯಾನೆಲ್‌ನಲ್ಲೇ ಇರುತ್ತವೆ. Geometer ಗೆ ಎಂದಿಗೂ ಕಳುಹಿಸುವುದಿಲ್ಲ.", hint: "ಗೊತ್ತಿಲ್ಲದ ಪೆಟ್ಟಿಗೆಯನ್ನು ಖಾಲಿ ಬಿಡಿ. ಖಾಲಿ ಎಂದರೆ ಗೊತ್ತಿಲ್ಲ, ಸೊನ್ನೆ ಅಲ್ಲ.",
  },
  margin: {
    heading: "ಮಾರ್ಜಿನ್", yourPrice: "ನಿಮ್ಮ ಬೆಲೆ", keep: "ತಿಂಗಳಿಗೆ ನಿಮಗೆ ಉಳಿಯುವುದು", unknownPrice: "ನಿಮ್ಮ ಬೆಲೆ ನಮೂದಿಸುವವರೆಗೆ ಗೊತ್ತಿಲ್ಲ.",
    notFinal: "ಇನ್ನೂ ಗೊತ್ತಿಲ್ಲದ ಖರ್ಚುಗಳ ಮೊದಲಿನದು.",
    before: (items) => `ಇವುಗಳ ಮೊದಲು: ${items}`, setupOnce: (a) => `ಒಮ್ಮೆ ಪಡೆದ ಸೆಟಪ್ ಶುಲ್ಕ: ${a}`, negative: "ಸೊನ್ನೆಗಿಂತ ಕೆಳಗೆ: ನಡೆಸುವ ಖರ್ಚು ನಿಮ್ಮ ಬೆಲೆಗಿಂತ ಹೆಚ್ಚಿದೆ.",
  },
  all: {
    heading: "ನಿಮ್ಮ ಎಲ್ಲ ಅಂಗಡಿಗಳು", shops: (p, n) => `${n} ಅಂಗಡಿಗಳಲ್ಲಿ ${p} ಕ್ಕೆ ಬೆಲೆ ನಮೂದಿಸಲಾಗಿದೆ`, keep: "ತಿಂಗಳಿಗೆ ನಿಮಗೆ ಉಳಿಯುವುದು",
    partial: (p, n) => `${n} ರಲ್ಲಿ ಬೆಲೆ ಇರುವ ${p} ಅಂಗಡಿಗಳನ್ನು ಮಾತ್ರ ಕೂಡಿಸಲಾಗಿದೆ.`, setup: "ಒಮ್ಮೆ ಪಡೆದ ಸೆಟಪ್ ಶುಲ್ಕಗಳು", unknown: "ಬೆಲೆ ನಮೂದಿಸುವವರೆಗೆ ಗೊತ್ತಿಲ್ಲ",
  },
  vote: {
    title: "ಮುಂದಿನ ಟೆಂಪ್ಲೇಟ್‌ಗೆ ಮತ", intro: "ಮೊದಲ 100 ಇನ್ನೋವೇಟರ್‌ಗಳಲ್ಲಿ ಒಬ್ಬರಾಗಿ, Geometer ಮುಂದೆ ಮಾಡುವ ಟೆಂಪ್ಲೇಟ್ ಅನ್ನು ನೀವು ಆರಿಸುತ್ತೀರಿ. ಪ್ರತಿಯೊಬ್ಬರಿಗೆ ಒಂದು ಮತ, ಯಾವಾಗ ಬೇಕಾದರೂ ಬದಲಿಸಬಹುದು.",
    yours: "ನಿಮ್ಮ ಮತ", none: "ನೀವು ಇನ್ನೂ ಮತ ಹಾಕಿಲ್ಲ.", button: "ನನ್ನ ಮತ ಉಳಿಸಿ", change: "ನನ್ನ ಮತ ಬದಲಿಸಿ", saved: "ನಿಮ್ಮ ಮತ ಉಳಿಸಲಾಗಿದೆ.", refused: "ಆ ಆಯ್ಕೆ ಪಟ್ಟಿಯಲ್ಲಿ ಇಲ್ಲ.",
    results: "ಇಲ್ಲಿಯವರೆಗಿನ ಮತಗಳು", hidden: "ಇತರರು ಹೇಗೆ ಮತ ಹಾಕಿದರು ಎಂದು ನೋಡಲು ಮತ ಹಾಕಿ.", votes: (n) => `${n} ಮತ`, note: "ಎಣಿಕೆ ಮಾತ್ರ. ಹೆಸರುಗಳನ್ನು ಎಂದಿಗೂ ತೋರಿಸುವುದಿಲ್ಲ. ಇವು ಈ ಪ್ಯಾನೆಲ್‌ನಲ್ಲಿ ಇಲ್ಲಿಯವರೆಗೆ ಎಣಿಸಿದ ಮತಗಳು.", link: "ಮುಂದಿನ ಟೆಂಪ್ಲೇಟ್‌ಗೆ ಮತ ಹಾಕಿ",
  },
};

export const HEALTH_WORDS: Record<Language, HealthWords> = { en, hi, ml, kn };
