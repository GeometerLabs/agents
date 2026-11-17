// The words of "keep this chat", "open my chat", "I have a new phone", "delete my chat" and a parent's chat (W2, 17 Nov 2026), in four languages, and the two WhatsApp utility
// templates that carry a link to a customer's own number. Hindi, Malayalam and Kannada are machine-written and wait for a native reader: they are on the review sheets
// (bundle/panel/review.ts chatIdentityFlat), and the two templates are in chat-link-templates.json for Meta's submission.
//
// Plain and short, for a person who has only ever used WhatsApp: never "passkey", "sign in", "login", "session", "error" or "retry"; the phone's own key is "your fingerprint or
// screen lock". It never promises anything it cannot do: what a delete removes and what it keeps (the booking or payment the law needs) are said in one line each.
import { META_LANGUAGE, metaBody } from "../language/meta-templates.ts";
import type { MetaSubmission } from "../language/meta-templates.ts";
import { LANGUAGES } from "../language/languages.ts";
import type { Language } from "../language/languages.ts";

export interface IdentityWords {
  /** Keep this chat on this phone (offered after a booking or an order, or when the guest has a thread worth keeping). */
  keepHead: string; keepBody: string; keepButton: string; keepDone: string;
  /** A phone with no screen lock: said plainly, and the chat goes on as a guest. */
  keepNoLock: string; keepFailed: string;
  /** "Been here before?": opening the chat on a new phone with the fingerprint or screen lock, and the old phone's help, in one line. */
  beenBefore: string; openMine: string; otherPhoneLine: string; otherShop: string; openFailed: string; openDone: string;
  /** A new phone: the number the customer gave, and the link that goes there. */
  newPhone: string; newPhoneBody: string; numberLabel: string; sendLink: string; linkSent: string; wait: string; badNumber: string;
  /** The optional number, given on the keep box. */
  numberAsk: string; numberSave: string; numberSaved: string;
  /** The page the confirm link opens: "Tap to confirm this is your number". */
  confirmHead: string; confirmBody: string; confirmButton: string; confirmDone: string;
  /** The link's own page (opened from WhatsApp on the new phone). */
  backHead: string; backBody: string; backButton: string; backUsed: string; backExpired: string;
  /** "Send me my booking link", when the number is known. */
  sendMyLinks: string; myLinksSent: string; myLinksNone: string;
  /** Delete my chat: the button, the question, the two answers, what goes and what stays, and the result. */
  deleteButton: string; deleteAsk: string; deleteYes: string; deleteNo: string; deleteDone: string;
  /** A parent's chat on their private fee page. */
  parentNote: string; parentBack: string; parentAsk: string;
}

export const IDENTITY: Record<Language, IdentityWords> = {
  en: {
    keepHead: "Keep this chat on your phone", keepBody: "Use your fingerprint or screen lock to keep this chat. No password.", keepButton: "Keep this chat", keepDone: "Done. This chat is kept on this phone.",
    keepNoLock: "This phone has no screen lock, so it cannot keep the chat. You can still chat as a guest, and your booking link keeps working.", keepFailed: "That did not work. You can try again, or carry on as a guest.",
    beenBefore: "Been here before?", openMine: "Open my chat with my fingerprint or screen lock", otherPhoneLine: "On a new phone, choose \"another phone\" when it asks, and hold your old phone next to this one.",
    otherShop: "That one is for another shop. Pick the one for this shop, or tap I have a new phone.", openFailed: "We could not open your chat. Try again, or tap I have a new phone.", openDone: "Your chat is open on this phone.",
    newPhone: "I have a new phone", newPhoneBody: "Type the WhatsApp number you gave us. We will send a link there.", numberLabel: "WhatsApp number", sendLink: "Send me a link",
    linkSent: "If we have that number, a link is on its way. It works once, for 15 minutes.", wait: "Please wait a little before asking again.", badNumber: "That does not look like a phone number.",
    numberAsk: "If you get a new phone, we can send a link to your WhatsApp. Add your number (you can skip this).", numberSave: "Save my number", numberSaved: "We sent a message to that number. Tap its link to confirm it is yours.",
    confirmHead: "Confirm your number", confirmBody: "Tap to confirm this is your number.", confirmButton: "Yes, this is my number", confirmDone: "Thank you. Your number is saved for this chat.",
    backHead: "Welcome back", backBody: "Open your chat on this phone?", backButton: "Open my chat here", backUsed: "This link was used already. Ask for a new one from the chat page.",
    backExpired: "This link has run out. Ask for a new one from the chat page.",
    sendMyLinks: "Send me my booking link", myLinksSent: "Sent to your WhatsApp.", myLinksNone: "There is no link to send yet.",
    deleteButton: "Delete my chat", deleteAsk: "Delete this chat? Your messages here are removed, and so is the key that keeps the chat on this phone. The shop keeps what the law needs for a booking or a payment.", deleteYes: "Yes, delete", deleteNo: "No, keep it",
    deleteDone: "Deleted. This chat is gone from this shop.",
    parentNote: "This chat is only for you. It opens from your private fee page, and it talks about your own fees. To pay, go back to your fee page.", parentBack: "Back to my fees", parentAsk: "Ask about this fee",
  },
  hi: {
    keepHead: "यह चैट अपने फ़ोन पर रखें", keepBody: "यह चैट रखने के लिए अपनी उँगली या स्क्रीन लॉक का इस्तेमाल करें। कोई पासवर्ड नहीं।", keepButton: "यह चैट रखें", keepDone: "हो गया। यह चैट इस फ़ोन पर रखी है।",
    keepNoLock: "इस फ़ोन में स्क्रीन लॉक नहीं है, इसलिए चैट रखी नहीं जा सकती। आप मेहमान की तरह चैट कर सकते हैं, और आपकी बुकिंग का लिंक चलता रहेगा।", keepFailed: "यह नहीं हो पाया। आप फिर कोशिश कर सकते हैं, या मेहमान की तरह चलते रहें।",
    beenBefore: "पहले आए हैं?", openMine: "अपनी उँगली या स्क्रीन लॉक से मेरी चैट खोलें", otherPhoneLine: "नए फ़ोन पर पूछे तो \"दूसरा फ़ोन\" चुनें, और अपना पुराना फ़ोन इसके पास रखें।",
    otherShop: "वह दूसरी दुकान का है। इस दुकान वाला चुनें, या \"मेरा नया फ़ोन है\" दबाएँ।", openFailed: "आपकी चैट खुल नहीं पाई। फिर कोशिश करें, या \"मेरा नया फ़ोन है\" दबाएँ।", openDone: "आपकी चैट इस फ़ोन पर खुल गई है।",
    newPhone: "मेरा नया फ़ोन है", newPhoneBody: "जो WhatsApp नंबर आपने हमें दिया था, वह लिखें। हम वहाँ एक लिंक भेजेंगे।", numberLabel: "WhatsApp नंबर", sendLink: "मुझे लिंक भेजें",
    linkSent: "अगर हमारे पास वह नंबर है तो लिंक भेजा जा रहा है। यह एक बार, 15 मिनट तक चलेगा।", wait: "दोबारा माँगने से पहले थोड़ा रुकिए।", badNumber: "यह फ़ोन नंबर जैसा नहीं लग रहा।",
    numberAsk: "नया फ़ोन लें तो हम आपके WhatsApp पर लिंक भेज सकते हैं। अपना नंबर जोड़ें (छोड़ भी सकते हैं)।", numberSave: "मेरा नंबर रखें", numberSaved: "उस नंबर पर संदेश भेजा है। उसका लिंक दबाकर बताइए कि यह आपका है।", confirmHead: "अपना नंबर पक्का करें", confirmBody: "दबाकर पक्का करें कि यह आपका नंबर है।", confirmButton: "हाँ, यह मेरा नंबर है", confirmDone: "धन्यवाद। आपका नंबर इस चैट के लिए रख लिया गया है।",
    backHead: "फिर से स्वागत है", backBody: "अपनी चैट इस फ़ोन पर खोलें?", backButton: "मेरी चैट यहाँ खोलें", backUsed: "यह लिंक पहले इस्तेमाल हो चुका है। चैट पेज से नया माँगिए।",
    backExpired: "यह लिंक चल नहीं रहा। चैट पेज से नया माँगिए।",
    sendMyLinks: "मुझे मेरी बुकिंग का लिंक भेजें", myLinksSent: "आपके WhatsApp पर भेज दिया।", myLinksNone: "अभी भेजने के लिए कोई लिंक नहीं है।",
    deleteButton: "मेरी चैट हटाएँ", deleteAsk: "यह चैट हटाएँ? यहाँ के आपके संदेश हट जाएँगे, और इस फ़ोन पर चैट रखने वाली चाबी भी। बुकिंग या भुगतान के लिए कानून जो माँगता है, दुकान वह रखती है।", deleteYes: "हाँ, हटाएँ", deleteNo: "नहीं, रहने दें",
    deleteDone: "हट गई। यह चैट अब इस दुकान के पास नहीं है।",
    parentNote: "यह चैट सिर्फ़ आपके लिए है। यह आपके निजी फ़ीस पेज से खुलती है और आपकी अपनी फ़ीस की बात करती है। भुगतान के लिए अपने फ़ीस पेज पर लौटें।", parentBack: "मेरी फ़ीस पर लौटें", parentAsk: "इस फ़ीस के बारे में पूछें",
  },
  ml: {
    keepHead: "ഈ ചാറ്റ് നിങ്ങളുടെ ഫോണിൽ സൂക്ഷിക്കൂ", keepBody: "ഈ ചാറ്റ് സൂക്ഷിക്കാൻ നിങ്ങളുടെ വിരലടയാളമോ സ്ക്രീൻ ലോക്കോ ഉപയോഗിക്കൂ. പാസ്‌വേഡ് വേണ്ട.", keepButton: "ഈ ചാറ്റ് സൂക്ഷിക്കൂ", keepDone: "കഴിഞ്ഞു. ഈ ചാറ്റ് ഈ ഫോണിൽ സൂക്ഷിച്ചിട്ടുണ്ട്.",
    keepNoLock: "ഈ ഫോണിൽ സ്ക്രീൻ ലോക്ക് ഇല്ല, അതുകൊണ്ട് ചാറ്റ് സൂക്ഷിക്കാൻ കഴിയില്ല. അതിഥിയായി ചാറ്റ് തുടരാം, നിങ്ങളുടെ ബുക്കിംഗ് ലിങ്ക് പ്രവർത്തിക്കുകയും ചെയ്യും.", keepFailed: "അത് നടന്നില്ല. വീണ്ടും ശ്രമിക്കാം, അല്ലെങ്കിൽ അതിഥിയായി തുടരാം.",
    beenBefore: "മുമ്പ് വന്നിട്ടുണ്ടോ?", openMine: "വിരലടയാളം അല്ലെങ്കിൽ സ്ക്രീൻ ലോക്ക് ഉപയോഗിച്ച് എന്റെ ചാറ്റ് തുറക്കൂ", otherPhoneLine: "പുതിയ ഫോണിൽ ചോദിക്കുമ്പോൾ \"മറ്റൊരു ഫോൺ\" തിരഞ്ഞെടുക്കൂ, പഴയ ഫോൺ ഇതിനടുത്ത് പിടിക്കൂ.",
    otherShop: "അത് മറ്റൊരു കടയുടേതാണ്. ഈ കടയുടേത് തിരഞ്ഞെടുക്കൂ, അല്ലെങ്കിൽ \"എനിക്ക് പുതിയ ഫോൺ ഉണ്ട്\" തൊടൂ.", openFailed: "നിങ്ങളുടെ ചാറ്റ് തുറക്കാനായില്ല. വീണ്ടും ശ്രമിക്കൂ, അല്ലെങ്കിൽ \"എനിക്ക് പുതിയ ഫോൺ ഉണ്ട്\" തൊടൂ.", openDone: "നിങ്ങളുടെ ചാറ്റ് ഈ ഫോണിൽ തുറന്നിരിക്കുന്നു.",
    newPhone: "എനിക്ക് പുതിയ ഫോൺ ഉണ്ട്", newPhoneBody: "നിങ്ങൾ ഞങ്ങൾക്ക് തന്ന WhatsApp നമ്പർ എഴുതൂ. അവിടേക്ക് ഒരു ലിങ്ക് അയയ്ക്കാം.", numberLabel: "WhatsApp നമ്പർ", sendLink: "എനിക്ക് ലിങ്ക് അയയ്ക്കൂ",
    linkSent: "ആ നമ്പർ ഞങ്ങളുടെ പക്കലുണ്ടെങ്കിൽ ഒരു ലിങ്ക് അയയ്ക്കുന്നുണ്ട്. ഇത് ഒരിക്കൽ മാത്രം, 15 മിനിറ്റ് പ്രവർത്തിക്കും.", wait: "വീണ്ടും ചോദിക്കുന്നതിനു മുമ്പ് അൽപം കാത്തിരിക്കൂ.", badNumber: "ഇത് ഫോൺ നമ്പർ പോലെ തോന്നുന്നില്ല.",
    numberAsk: "പുതിയ ഫോൺ വാങ്ങിയാൽ നിങ്ങളുടെ WhatsApp-ലേക്ക് ഒരു ലിങ്ക് അയയ്ക്കാം. നിങ്ങളുടെ നമ്പർ ചേർക്കൂ (വേണമെങ്കിൽ ഒഴിവാക്കാം).", numberSave: "എന്റെ നമ്പർ സൂക്ഷിക്കൂ", numberSaved: "ആ നമ്പറിലേക്ക് ഒരു സന്ദേശം അയച്ചിട്ടുണ്ട്. ഇത് നിങ്ങളുടേതാണെന്ന് ഉറപ്പിക്കാൻ അതിലെ ലിങ്ക് തൊടൂ.", confirmHead: "നിങ്ങളുടെ നമ്പർ ഉറപ്പിക്കൂ", confirmBody: "ഇത് നിങ്ങളുടെ നമ്പറാണെന്ന് ഉറപ്പിക്കാൻ തൊടൂ.", confirmButton: "അതെ, ഇത് എന്റെ നമ്പറാണ്", confirmDone: "നന്ദി. നിങ്ങളുടെ നമ്പർ ഈ ചാറ്റിനായി സൂക്ഷിച്ചിട്ടുണ്ട്.",
    backHead: "വീണ്ടും സ്വാഗതം", backBody: "നിങ്ങളുടെ ചാറ്റ് ഈ ഫോണിൽ തുറക്കട്ടെ?", backButton: "എന്റെ ചാറ്റ് ഇവിടെ തുറക്കൂ", backUsed: "ഈ ലിങ്ക് മുമ്പേ ഉപയോഗിച്ചു. ചാറ്റ് പേജിൽ നിന്ന് പുതിയത് ചോദിക്കൂ.",
    backExpired: "ഈ ലിങ്കിന്റെ സമയം കഴിഞ്ഞു. ചാറ്റ് പേജിൽ നിന്ന് പുതിയത് ചോദിക്കൂ.",
    sendMyLinks: "എന്റെ ബുക്കിംഗ് ലിങ്ക് അയയ്ക്കൂ", myLinksSent: "നിങ്ങളുടെ WhatsApp-ലേക്ക് അയച്ചു.", myLinksNone: "അയയ്ക്കാൻ ഇതുവരെ ലിങ്ക് ഒന്നുമില്ല.",
    deleteButton: "എന്റെ ചാറ്റ് ഇല്ലാതാക്കൂ", deleteAsk: "ഈ ചാറ്റ് ഇല്ലാതാക്കട്ടെ? ഇവിടത്തെ നിങ്ങളുടെ സന്ദേശങ്ങളും ഈ ഫോണിൽ ചാറ്റ് സൂക്ഷിക്കുന്ന താക്കോലും നീക്കും. ബുക്കിംഗിനോ പണമടയ്ക്കലിനോ നിയമം ആവശ്യപ്പെടുന്നത് കട സൂക്ഷിക്കും.", deleteYes: "അതെ, ഇല്ലാതാക്കൂ", deleteNo: "വേണ്ട, ഇരിക്കട്ടെ",
    deleteDone: "ഇല്ലാതാക്കി. ഈ ചാറ്റ് ഇനി ഈ കടയുടെ പക്കലില്ല.",
    parentNote: "ഈ ചാറ്റ് നിങ്ങൾക്ക് മാത്രമുള്ളതാണ്. ഇത് നിങ്ങളുടെ സ്വകാര്യ ഫീസ് പേജിൽ നിന്ന് തുറക്കുന്നു, നിങ്ങളുടെ സ്വന്തം ഫീസിനെക്കുറിച്ച് സംസാരിക്കുന്നു. അടയ്ക്കാൻ നിങ്ങളുടെ ഫീസ് പേജിലേക്ക് മടങ്ങൂ.", parentBack: "എന്റെ ഫീസിലേക്ക് മടങ്ങൂ", parentAsk: "ഈ ഫീസിനെക്കുറിച്ച് ചോദിക്കൂ",
  },
  kn: {
    keepHead: "ಈ ಚಾಟ್ ಅನ್ನು ನಿಮ್ಮ ಫೋನಿನಲ್ಲಿ ಇಟ್ಟುಕೊಳ್ಳಿ", keepBody: "ಈ ಚಾಟ್ ಇಟ್ಟುಕೊಳ್ಳಲು ನಿಮ್ಮ ಬೆರಳಚ್ಚು ಅಥವಾ ಸ್ಕ್ರೀನ್ ಲಾಕ್ ಬಳಸಿ. ಪಾಸ್‌ವರ್ಡ್ ಬೇಡ.", keepButton: "ಈ ಚಾಟ್ ಇಟ್ಟುಕೊಳ್ಳಿ", keepDone: "ಆಯಿತು. ಈ ಚಾಟ್ ಈ ಫೋನಿನಲ್ಲಿ ಇದೆ.",
    keepNoLock: "ಈ ಫೋನಿಗೆ ಸ್ಕ್ರೀನ್ ಲಾಕ್ ಇಲ್ಲ, ಆದ್ದರಿಂದ ಚಾಟ್ ಇಟ್ಟುಕೊಳ್ಳಲು ಆಗುವುದಿಲ್ಲ. ಅತಿಥಿಯಾಗಿ ಚಾಟ್ ಮುಂದುವರಿಸಬಹುದು, ನಿಮ್ಮ ಬುಕಿಂಗ್ ಲಿಂಕ್ ಕೆಲಸ ಮಾಡುತ್ತಲೇ ಇರುತ್ತದೆ.", keepFailed: "ಅದು ಆಗಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಬಹುದು, ಅಥವಾ ಅತಿಥಿಯಾಗಿ ಮುಂದುವರಿಸಬಹುದು.",
    beenBefore: "ಮೊದಲು ಬಂದಿದ್ದೀರಾ?", openMine: "ಬೆರಳಚ್ಚು ಅಥವಾ ಸ್ಕ್ರೀನ್ ಲಾಕ್‌ನಿಂದ ನನ್ನ ಚಾಟ್ ತೆರೆಯಿರಿ", otherPhoneLine: "ಹೊಸ ಫೋನಿನಲ್ಲಿ ಕೇಳಿದಾಗ \"ಇನ್ನೊಂದು ಫೋನ್\" ಆರಿಸಿ, ಹಳೆಯ ಫೋನನ್ನು ಇದರ ಪಕ್ಕದಲ್ಲಿ ಹಿಡಿಯಿರಿ.",
    otherShop: "ಅದು ಬೇರೆ ಅಂಗಡಿಯದು. ಈ ಅಂಗಡಿಯದನ್ನು ಆರಿಸಿ, ಅಥವಾ \"ನನಗೆ ಹೊಸ ಫೋನ್ ಇದೆ\" ಒತ್ತಿ.", openFailed: "ನಿಮ್ಮ ಚಾಟ್ ತೆರೆಯಲು ಆಗಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ, ಅಥವಾ \"ನನಗೆ ಹೊಸ ಫೋನ್ ಇದೆ\" ಒತ್ತಿ.", openDone: "ನಿಮ್ಮ ಚಾಟ್ ಈ ಫೋನಿನಲ್ಲಿ ತೆರೆದಿದೆ.",
    newPhone: "ನನಗೆ ಹೊಸ ಫೋನ್ ಇದೆ", newPhoneBody: "ನೀವು ನಮಗೆ ಕೊಟ್ಟ WhatsApp ನಂಬರ್ ಬರೆಯಿರಿ. ಅಲ್ಲಿಗೆ ಒಂದು ಲಿಂಕ್ ಕಳುಹಿಸುತ್ತೇವೆ.", numberLabel: "WhatsApp ನಂಬರ್", sendLink: "ನನಗೆ ಲಿಂಕ್ ಕಳುಹಿಸಿ",
    linkSent: "ಆ ನಂಬರ್ ನಮ್ಮ ಬಳಿ ಇದ್ದರೆ ಲಿಂಕ್ ಹೋಗುತ್ತಿದೆ. ಇದು ಒಮ್ಮೆ ಮಾತ್ರ, 15 ನಿಮಿಷ ಕೆಲಸ ಮಾಡುತ್ತದೆ.", wait: "ಮತ್ತೆ ಕೇಳುವ ಮೊದಲು ಸ್ವಲ್ಪ ಕಾಯಿರಿ.", badNumber: "ಇದು ಫೋನ್ ನಂಬರ್‌ನಂತೆ ಕಾಣುತ್ತಿಲ್ಲ.",
    numberAsk: "ಹೊಸ ಫೋನ್ ಬಂದರೆ ನಿಮ್ಮ WhatsApp ಗೆ ಲಿಂಕ್ ಕಳುಹಿಸಬಹುದು. ನಿಮ್ಮ ನಂಬರ್ ಸೇರಿಸಿ (ಬೇಡವಾದರೆ ಬಿಡಬಹುದು).", numberSave: "ನನ್ನ ನಂಬರ್ ಇಟ್ಟುಕೊಳ್ಳಿ", numberSaved: "ಆ ನಂಬರ್‌ಗೆ ಸಂದೇಶ ಕಳುಹಿಸಿದ್ದೇವೆ. ಅದು ನಿಮ್ಮದೇ ಎಂದು ಖಚಿತಪಡಿಸಲು ಅದರ ಲಿಂಕ್ ಒತ್ತಿ.", confirmHead: "ನಿಮ್ಮ ನಂಬರ್ ಖಚಿತಪಡಿಸಿ", confirmBody: "ಇದು ನಿಮ್ಮ ನಂಬರ್ ಎಂದು ಖಚಿತಪಡಿಸಲು ಒತ್ತಿ.", confirmButton: "ಹೌದು, ಇದು ನನ್ನ ನಂಬರ್", confirmDone: "ಧನ್ಯವಾದ. ನಿಮ್ಮ ನಂಬರ್ ಈ ಚಾಟ್‌ಗಾಗಿ ಇಟ್ಟುಕೊಂಡಿದ್ದೇವೆ.",
    backHead: "ಮತ್ತೆ ಸ್ವಾಗತ", backBody: "ನಿಮ್ಮ ಚಾಟ್ ಅನ್ನು ಈ ಫೋನಿನಲ್ಲಿ ತೆರೆಯಲೇ?", backButton: "ನನ್ನ ಚಾಟ್ ಇಲ್ಲಿ ತೆರೆಯಿರಿ", backUsed: "ಈ ಲಿಂಕ್ ಈಗಾಗಲೇ ಬಳಸಲಾಗಿದೆ. ಚಾಟ್ ಪುಟದಿಂದ ಹೊಸದನ್ನು ಕೇಳಿ.",
    backExpired: "ಈ ಲಿಂಕ್‌ನ ಸಮಯ ಮುಗಿದಿದೆ. ಚಾಟ್ ಪುಟದಿಂದ ಹೊಸದನ್ನು ಕೇಳಿ.",
    sendMyLinks: "ನನ್ನ ಬುಕಿಂಗ್ ಲಿಂಕ್ ಕಳುಹಿಸಿ", myLinksSent: "ನಿಮ್ಮ WhatsApp ಗೆ ಕಳುಹಿಸಿದ್ದೇವೆ.", myLinksNone: "ಕಳುಹಿಸಲು ಇನ್ನೂ ಲಿಂಕ್ ಇಲ್ಲ.",
    deleteButton: "ನನ್ನ ಚಾಟ್ ಅಳಿಸಿ", deleteAsk: "ಈ ಚಾಟ್ ಅಳಿಸಲೇ? ಇಲ್ಲಿನ ನಿಮ್ಮ ಸಂದೇಶಗಳನ್ನು ಮತ್ತು ಈ ಫೋನಿನಲ್ಲಿ ಚಾಟ್ ಇಟ್ಟುಕೊಳ್ಳುವ ಕೀಲಿಯನ್ನು ತೆಗೆಯುತ್ತೇವೆ. ಬುಕಿಂಗ್ ಅಥವಾ ಪಾವತಿಗೆ ಕಾನೂನು ಕೇಳುವುದನ್ನು ಅಂಗಡಿ ಇಟ್ಟುಕೊಳ್ಳುತ್ತದೆ.", deleteYes: "ಹೌದು, ಅಳಿಸಿ", deleteNo: "ಬೇಡ, ಇರಲಿ",
    deleteDone: "ಅಳಿಸಲಾಗಿದೆ. ಈ ಚಾಟ್ ಇನ್ನು ಈ ಅಂಗಡಿಯ ಬಳಿ ಇಲ್ಲ.",
    parentNote: "ಈ ಚಾಟ್ ನಿಮಗೆ ಮಾತ್ರ. ಇದು ನಿಮ್ಮ ಖಾಸಗಿ ಶುಲ್ಕ ಪುಟದಿಂದ ತೆರೆಯುತ್ತದೆ ಮತ್ತು ನಿಮ್ಮ ಸ್ವಂತ ಶುಲ್ಕದ ಬಗ್ಗೆ ಮಾತನಾಡುತ್ತದೆ. ಪಾವತಿಸಲು ನಿಮ್ಮ ಶುಲ್ಕ ಪುಟಕ್ಕೆ ಹಿಂತಿರುಗಿ.", parentBack: "ನನ್ನ ಶುಲ್ಕಕ್ಕೆ ಹಿಂತಿರುಗಿ", parentAsk: "ಈ ಶುಲ್ಕದ ಬಗ್ಗೆ ಕೇಳಿ",
  },
};

// ---- the two WhatsApp utility templates (Meta's category UTILITY, one language per submission) -----------------------------------------------------------------

export interface ChatLinkTemplate { name: "chat_new_phone" | "chat_my_link" | "chat_confirm_number"; usedFor: string; bodies: Record<Language, string> }

/**
 * `chat_new_phone`: the one-use link that opens a customer's chat on a new phone. `chat_my_link`: a booking's or an order's own page link, sent again. {shop} and {link} are
 * the two values, in this order. A body neither starts nor ends with a value (Meta's review rule); neither is promotional.
 */
export const CHAT_LINK_TEMPLATES: readonly ChatLinkTemplate[] = [
  {
    name: "chat_new_phone", usedFor: "A customer who gave this number asked, on a new phone, to open their chat there",
    bodies: {
      en: "Your link to open your chat with {shop} on a new phone: {link} It works once, for 15 minutes. If you did not ask for it, ignore this message.",
      hi: "नए फ़ोन पर {shop} के साथ आपकी चैट खोलने का आपका लिंक: {link} यह एक बार, 15 मिनट तक चलेगा। अगर आपने यह नहीं माँगा, तो इस संदेश को छोड़ दीजिए।",
      ml: "പുതിയ ഫോണിൽ {shop}-മായുള്ള നിങ്ങളുടെ ചാറ്റ് തുറക്കാനുള്ള ലിങ്ക്: {link} ഇത് ഒരിക്കൽ മാത്രം, 15 മിനിറ്റ് പ്രവർത്തിക്കും. നിങ്ങൾ ചോദിച്ചതല്ലെങ്കിൽ ഈ സന്ദേശം അവഗണിക്കൂ.",
      kn: "ಹೊಸ ಫೋನಿನಲ್ಲಿ {shop} ಜೊತೆಗಿನ ನಿಮ್ಮ ಚಾಟ್ ತೆರೆಯುವ ಲಿಂಕ್: {link} ಇದು ಒಮ್ಮೆ ಮಾತ್ರ, 15 ನಿಮಿಷ ಕೆಲಸ ಮಾಡುತ್ತದೆ. ನೀವು ಕೇಳದಿದ್ದರೆ ಈ ಸಂದೇಶವನ್ನು ಬಿಟ್ಟುಬಿಡಿ.",
    },
  },
  {
    name: "chat_my_link", usedFor: "A customer who gave this number asked the chat to send their booking or order link again",
    bodies: {
      en: "Your link from {shop}: {link} If you did not ask for it, ignore this message.",
      hi: "आपका लिंक, {shop} से: {link} अगर आपने यह नहीं माँगा, तो इस संदेश को छोड़ दीजिए।",
      ml: "നിങ്ങളുടെ ലിങ്ക്, {shop}-ൽ നിന്ന്: {link} നിങ്ങൾ ചോദിച്ചതല്ലെങ്കിൽ ഈ സന്ദേശം അവഗണിക്കൂ.",
      kn: "ನಿಮ್ಮ ಲಿಂಕ್, {shop} ಇಂದ: {link} ನೀವು ಕೇಳದಿದ್ದರೆ ಈ ಸಂದೇಶವನ್ನು ಬಿಟ್ಟುಬಿಡಿ.",
    },
  },
  {
    name: "chat_confirm_number", usedFor: "A customer typed this number on the chat page to be reached on a new phone; the person at the number is asked to confirm it is theirs",
    bodies: {
      en: "Tap to confirm this is your number for your chat with {shop}: {link} It works once, for 15 minutes. If you did not ask for it, ignore this message.",
      hi: "यह आपका नंबर है, यह पक्का करने को दबाइए ({shop} के साथ आपकी चैट के लिए): {link} यह एक बार, 15 मिनट तक चलेगा। अगर आपने यह नहीं माँगा, तो इस संदेश को छोड़ दीजिए।",
      ml: "ഇത് നിങ്ങളുടെ നമ്പറാണെന്ന് ഉറപ്പിക്കാൻ തൊടൂ ({shop}-മായുള്ള നിങ്ങളുടെ ചാറ്റിന്): {link} ഇത് ഒരിക്കൽ മാത്രം, 15 മിനിറ്റ് പ്രവർത്തിക്കും. നിങ്ങൾ ചോദിച്ചതല്ലെങ്കിൽ ഈ സന്ദേശം അവഗണിക്കൂ.",
      kn: "ಇದು ನಿಮ್ಮ ನಂಬರ್ ಎಂದು ಖಚಿತಪಡಿಸಲು ಒತ್ತಿ ({shop} ಜೊತೆಗಿನ ನಿಮ್ಮ ಚಾಟ್‌ಗೆ): {link} ಇದು ಒಮ್ಮೆ ಮಾತ್ರ, 15 ನಿಮಿಷ ಕೆಲಸ ಮಾಡುತ್ತದೆ. ನೀವು ಕೇಳದಿದ್ದರೆ ಈ ಸಂದೇಶವನ್ನು ಬಿಟ್ಟುಬಿಡಿ.",
    },
  },
];

/** The example values Meta wants for each parameter (shop, link), in the order the body uses them. */
const EXAMPLE: string[] = ["Glow Salon", "https://streetlist.in/glow/chat/id/back/example"];

/** The list to submit to Meta: one entry per template and language, in the body of Meta's create-template call (modules/channels/chat-link-templates.json holds it). */
export function chatLinkSubmissions(): MetaSubmission[] {
  return CHAT_LINK_TEMPLATES.flatMap((t) => LANGUAGES.map((language) => ({
    name: t.name, language: META_LANGUAGE[language], category: "UTILITY" as const, parameter_format: "positional" as const,
    components: [{ type: "BODY" as const, text: metaBody(t.bodies[language]), example: { body_text: [EXAMPLE] } }],
  })));
}
