// What a person reads about Razorpay in the panel, in four languages: the payment choice, the accounts step, the connection check (B71: a provider's words are in
// its own folder, and the panel shows them by the shop's choice, never by name). Moved here word for word from bundle/panel/words*.ts on 10 Nov 2026; the
// Hindi, Malayalam and Kannada lines keep the panel's review state: MACHINE-WRITTEN, to be read by a native speaker before a real shop sees them
// (bundle/panel/languages.ts, REVIEW_STATE). Nothing here says a shop is safe or guaranteed.
import type { Language } from "../../../language/languages.ts";
import type { GatewayWords } from "../types.ts";

export const RAZORPAY_WORDS: Record<Language, GatewayWords> = {
  en: {
    option: "Razorpay: the shop has its own Razorpay account",
    accounts: {
      title: "Razorpay", intro: "Customers pay the deposit into the shop's own Razorpay account. The money goes straight to the shop's bank. Geometer never holds it.",
      steps: ["Sign in to the shop's own Razorpay account.", "Under Settings, API keys, make a key and copy the Key ID and the Key secret.", "Under Settings, Webhooks, add the web address shown below and choose a secret of your own. Type the same secret here."],
      mode: "Which key is this?", modeLive: "Live: real money", modeTest: "Practice: test money", keyId: "Key ID", keySecret: "Key secret", webhookSecret: "Webhook secret",
      webhookUrl: (u) => `Web address for the webhook: ${u}`,
    },
    checks: {
      title: "Razorpay", confirmed: (m) => `The key works (${m}).`, differs: "This is a different key from the one confirmed before. Nothing was changed.",
      wrongMode: "This key's mode is not the one chosen above. Use the key that matches.",
    },
    whose: "Razorpay does not say whose account a key belongs to. Open the first test payment link and look: the shop's name must be on it.",
  },
  hi: {
    option: "Razorpay: दुकान का अपना Razorpay अकाउंट है",
    accounts: {
      title: "Razorpay", intro: "ग्राहक जमा राशि दुकान के अपने Razorpay अकाउंट में देते हैं। पैसा सीधे दुकान के बैंक में जाता है। Geometer उसे कभी अपने पास नहीं रखता।",
      steps: ["दुकान के अपने Razorpay अकाउंट में साइन इन कीजिए।", "Settings, API keys में एक कुंजी बनाइए और Key ID व Key secret कॉपी कीजिए।", "Settings, Webhooks में नीचे दिखा वेब पता जोड़िए और अपनी पसंद का एक सीक्रेट चुनिए। वही सीक्रेट यहाँ भी लिखिए।"],
      mode: "यह कौन सी कुंजी है?", modeLive: "लाइव: असली पैसा", modeTest: "अभ्यास: टेस्ट पैसा", keyId: "कुंजी आईडी (Key ID)", keySecret: "कुंजी सीक्रेट (Key secret)", webhookSecret: "Webhook सीक्रेट (Webhook secret)",
      webhookUrl: (u) => `Webhook के लिए वेब पता: ${u}`,
    },
    checks: {
      title: "Razorpay की जाँच", confirmed: (m) => `कुंजी काम करती है (${m})।`, differs: "यह वह कुंजी नहीं है जो पहले पक्की हुई थी। कुछ भी बदला नहीं गया।",
      wrongMode: "इस कुंजी का मोड वह नहीं है जो ऊपर चुना गया है। जो कुंजी मेल खाए, वही इस्तेमाल कीजिए।",
    },
    whose: "Razorpay यह नहीं बताता कि कोई कुंजी किसके अकाउंट की है। पहला टेस्ट पेमेंट लिंक खोलकर देखिए: उस पर दुकान का नाम होना चाहिए।",
  },
  ml: {
    option: "Razorpay: കടയ്ക്ക് സ്വന്തം Razorpay അക്കൗണ്ട് ഉണ്ട്",
    accounts: {
      title: "Razorpay അക്കൗണ്ട്", intro: "ഉപഭോക്താക്കൾ ഡെപ്പോസിറ്റ് അടയ്ക്കുന്നത് കടയുടെ സ്വന്തം Razorpay അക്കൗണ്ടിലേക്കാണ്. പണം നേരെ കടയുടെ ബാങ്കിലേക്ക് പോകും. Geometer അത് ഒരിക്കലും കൈവശം വയ്ക്കില്ല.",
      steps: ["കടയുടെ സ്വന്തം Razorpay അക്കൗണ്ടിൽ ലോഗിൻ ചെയ്യൂ.", "Settings, API keys എന്നതിൽ ഒരു കീ ഉണ്ടാക്കി Key ID, Key secret എന്നിവ കോപ്പി ചെയ്യൂ.", "Settings, Webhooks എന്നതിൽ താഴെ കാണിച്ച വെബ് വിലാസം ചേർത്ത്, നിങ്ങളുടെ സ്വന്തം ഒരു സീക്രട്ട് തിരഞ്ഞെടുക്കൂ. അതേ സീക്രട്ട് ഇവിടെയും ടൈപ്പ് ചെയ്യൂ."],
      mode: "ഇത് ഏത് കീ ആണ്?", modeLive: "ലൈവ്: യഥാർത്ഥ പണം", modeTest: "പരിശീലനം: ടെസ്റ്റ് പണം", keyId: "കീ ഐഡി", keySecret: "കീ സീക്രട്ട്", webhookSecret: "വെബ്ഹുക്ക് സീക്രട്ട്",
      webhookUrl: (u) => `വെബ്ഹുക്കിനുള്ള വെബ് വിലാസം: ${u}`,
    },
    checks: {
      title: "Razorpay അക്കൗണ്ട്", confirmed: (m) => `കീ പ്രവർത്തിക്കുന്നു (${m}).`, differs: "ഇത് മുമ്പ് ഉറപ്പിച്ച കീയിൽ നിന്ന് വ്യത്യസ്തമായ കീ ആണ്. ഒന്നും മാറ്റിയിട്ടില്ല.",
      wrongMode: "ഈ കീയുടെ മോഡ് മുകളിൽ തിരഞ്ഞെടുത്തതല്ല. അതിന് ചേരുന്ന കീ ഉപയോഗിക്കൂ.",
    },
    whose: "ഒരു കീ ആരുടെ അക്കൗണ്ടിന്റേതാണെന്ന് Razorpay പറയില്ല. ആദ്യത്തെ ടെസ്റ്റ് പേയ്മെന്റ് ലിങ്ക് തുറന്ന് നോക്കൂ: അതിൽ കടയുടെ പേര് ഉണ്ടാകണം.",
  },
  kn: {
    option: "Razorpay: ಅಂಗಡಿಗೆ ಸ್ವಂತ Razorpay ಖಾತೆ ಇದೆ",
    accounts: {
      title: "Razorpay", intro: "ಗ್ರಾಹಕರು ಮುಂಗಡ ಹಣವನ್ನು ಅಂಗಡಿಯ ಸ್ವಂತ Razorpay ಖಾತೆಗೆ ಕಟ್ಟುತ್ತಾರೆ. ಹಣ ನೇರವಾಗಿ ಅಂಗಡಿಯ ಬ್ಯಾಂಕ್‌ಗೆ ಹೋಗುತ್ತದೆ. Geometer ಅದನ್ನು ಎಂದೂ ಇಟ್ಟುಕೊಳ್ಳುವುದಿಲ್ಲ.",
      steps: ["ಅಂಗಡಿಯ ಸ್ವಂತ Razorpay ಖಾತೆಗೆ ಸೈನ್ ಇನ್ ಮಾಡಿ.", "Settings, API keys ಅಡಿಯಲ್ಲಿ ಒಂದು ಕೀ ಮಾಡಿ, ಮತ್ತು Key ID ಹಾಗೂ Key secret ಕಾಪಿ ಮಾಡಿ.", "Settings, Webhooks ಅಡಿಯಲ್ಲಿ ಕೆಳಗೆ ತೋರಿಸಿದ ವೆಬ್ ಅಡ್ರೆಸ್ ಸೇರಿಸಿ, ಮತ್ತು ನಿಮ್ಮದೇ ಒಂದು ಸೀಕ್ರೆಟ್ ಆರಿಸಿ. ಅದೇ ಸೀಕ್ರೆಟ್ ಅನ್ನು ಇಲ್ಲಿ ಟೈಪ್ ಮಾಡಿ."],
      mode: "ಇದು ಯಾವ ಕೀ?", modeLive: "ಲೈವ್: ನಿಜವಾದ ಹಣ", modeTest: "ಅಭ್ಯಾಸ: ಟೆಸ್ಟ್ ಹಣ", keyId: "ಕೀ ID", keySecret: "ಕೀ ಸೀಕ್ರೆಟ್", webhookSecret: "ವೆಬ್‌ಹುಕ್ ಸೀಕ್ರೆಟ್",
      webhookUrl: (u) => `ವೆಬ್‌ಹುಕ್‌ಗಾಗಿ ವೆಬ್ ಅಡ್ರೆಸ್: ${u}`,
    },
    checks: {
      title: "Razorpay", confirmed: (m) => `ಕೀ ಕೆಲಸ ಮಾಡುತ್ತಿದೆ (${m}).`, differs: "ಇದು ಮೊದಲು ಖಚಿತಪಡಿಸಿದ ಕೀ ಅಲ್ಲ, ಬೇರೆ ಕೀ. ಏನನ್ನೂ ಬದಲಾಯಿಸಿಲ್ಲ.",
      wrongMode: "ಈ ಕೀಯ ಮೋಡ್ ಮೇಲೆ ಆರಿಸಿದ ಮೋಡ್ ಅಲ್ಲ. ಹೊಂದುವ ಕೀ ಬಳಸಿ.",
    },
    whose: "ಕೀ ಯಾರ ಖಾತೆಗೆ ಸೇರಿದ್ದು ಎಂದು Razorpay ಹೇಳುವುದಿಲ್ಲ. ಮೊದಲ ಟೆಸ್ಟ್ ಪಾವತಿ ಲಿಂಕ್ ತೆರೆದು ನೋಡಿ: ಅದರಲ್ಲಿ ಅಂಗಡಿಯ ಹೆಸರು ಇರಬೇಕು.",
  },
};
