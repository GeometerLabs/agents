// The words of Classes, per language: every message the add-on sends, as fixed templates written from the record (the facts), never from a model and never from a
// parent's words. Same rules as src/language/templates.ts, which spreads these sets into its own (TEMPLATES) so the outgoing check, the WhatsApp template list and the
// review sheets cover them with no extra wiring.
//
// A doubt's text and a roster of names are the only free values here. Each goes in as a "literal" the outgoing check masks (src/language/check.ts), so a doubt that
// holds a number (a maths question) is not mistaken for a wrong amount; and a doubt only ever goes to the teacher, never to a parent.
//
// This file imports only TYPES from templates.ts (and writes its own `need`), because templates.ts imports this file's sets at load: a runtime import back would make a loop.
// Hindi, Malayalam and Kannada are MACHINE-WRITTEN and wait for a native speaker (REVIEW-hi.md, REVIEW-ml.md, REVIEW-kn.md list every line).
import { formatDate, formatTime } from "../../../../../modules/language/format.ts";
import type { Language } from "../../../../../modules/language/languages.ts";
import { localParts } from "../../../../../modules/core/time.ts";
import type { MessageFacts } from "../language/templates.ts";

export type ClassTemplateId =
  // to the contact (a parent, or an adult student): the first question, the answers, the class link, the next class, a doubt, a missed class, the material
  | "class_consent_ask" | "class_consent_yes" | "class_consent_no" | "class_link" | "class_next" | "class_next_none" | "class_not_entitled"
  | "class_doubt_ask" | "class_doubt_thanks" | "class_missed_note" | "class_material_link" | "class_material_none"
  // to the teacher (the owner's number): attendance, the class link asked for and saved, doubts, and what the teacher can say
  | "owner_class_attendance" | "owner_class_roster" | "owner_class_marked" | "owner_class_no_link" | "owner_class_link_set"
  | "owner_class_doubts_waiting" | "owner_class_doubts" | "owner_class_nothing" | "owner_class_unknown" | "owner_class_shared";

type Template = (f: MessageFacts) => string;
type Set = Record<ClassTemplateId, Template>;

function need<K extends keyof MessageFacts>(f: MessageFacts, key: K): NonNullable<MessageFacts[K]> {
  const value = f[key];
  if (value === undefined) throw new Error(`The message needs "${String(key)}" from the record, and the record does not have it.`);
  return value as NonNullable<MessageFacts[K]>;
}

/** The class's date and its time, as the formatters write them (the outgoing check reads exactly these). */
export const classDate = (f: MessageFacts): string => formatDate(localParts(need(f, "classMs"), f.timeZone), f.language);
export const classTime = (f: MessageFacts): string => formatTime(localParts(need(f, "classMs"), f.timeZone), f.language);

/** "Aarav (class 10): Mon 9 Nov, 5:00 pm" for each student, joined by " | ": the same in every language, because the names, the date and the time carry the meaning. */
export const classLines = (f: MessageFacts): string => need(f, "classLines").map((l) => {
  const p = localParts(l.startMs, f.timeZone);
  return `${l.studentName} (${l.batchName}): ${formatDate(p, f.language)}, ${formatTime(p, f.language)}`;
}).join(" | ");

const student = (f: MessageFacts) => need(f, "studentName");
const batch = (f: MessageFacts) => need(f, "batchName");

const en: Set = {
  class_consent_ask: (f) => `Hello from ${f.businessName}. ${student(f)} is in ${batch(f)}. May we send class links and reading material for ${student(f)} to this number? Tap Yes to allow or No to refuse. We do not track, profile or advertise to students. Reply STOP at any time to stop all messages.`,
  class_consent_yes: (f) => `Thank you. ${f.businessName} will send ${student(f)}'s class links and reading material to this number. To ask the teacher a doubt, write "doubt". Reply STOP if you do not want these messages.`,
  class_consent_no: (f) => `Understood. ${f.businessName} will not send class links or reading material for ${student(f)} to this number.`,
  class_link: (f) => `Class reminder from ${f.businessName}. ${student(f)}'s class (${batch(f)}) is on ${classDate(f)} at ${classTime(f)}. Join here: ${need(f, "classLink")} Please do not share this link. Reply STOP if you do not want these messages.`,
  class_next: (f) => `Next classes at ${f.businessName}: ${classLines(f)}. The class link comes to this chat shortly before each class, while the fee is paid or within its grace days.`,
  class_next_none: (f) => `${f.businessName} has no class in the timetable yet for your children's batches. Please ask the teacher.`,
  class_not_entitled: (f) => `${student(f)}'s class link and reading material for ${batch(f)} are sent while the fee is paid or within its grace days. Please pay the fee, or talk to the owner.`,
  class_doubt_ask: () => "Please write your doubt in one message. I will hand it to the teacher. I cannot answer subject questions myself.",
  class_doubt_thanks: (f) => `Your doubt for ${student(f)} (${batch(f)}) is with the teacher. They will answer in class or message you here.`,
  class_missed_note: (f) => `Class note from ${f.businessName}. ${student(f)} was not marked present in the class (${batch(f)}) on ${classDate(f)} at ${classTime(f)}. If this is a mistake, please tell the owner. Reply STOP if you do not want these messages.`,
  class_material_link: (f) => `Reading material from ${f.businessName} for ${student(f)} (${batch(f)}): ${need(f, "materialLink")} It opens only while ${student(f)} is in this class and the fee is paid or within its grace days. Please do not share it. Reply STOP if you do not want these messages.`,

  class_material_none: (f) => `${student(f)}'s reading material for ${batch(f)} cannot be opened from here yet. Please ask the teacher.`,

  owner_class_attendance: (f) => `Attendance needed at ${f.businessName}: the class for ${batch(f)} on ${classDate(f)} at ${classTime(f)} is over. Reply "present" if everyone came, or reply "class" to mark who missed.`,
  owner_class_roster: (f) => `Attendance list for ${batch(f)}, ${classDate(f)} at ${classTime(f)}. Students: ${need(f, "roster")}. Tap Everyone came, or reply "absent" with the numbers of those who missed.`,
  owner_class_marked: (f) => `Attendance saved for ${batch(f)}, ${classDate(f)} at ${classTime(f)}: ${need(f, "presentCount")} present, ${need(f, "absentCount")} absent. Notes sent to the parents of those absent: ${need(f, "notedCount")}.`,
  owner_class_no_link: (f) => `Class link needed at ${f.businessName}: no link is set for the class for ${batch(f)} on ${classDate(f)} at ${classTime(f)}. Reply "link", the batch name and the full link.`,
  owner_class_link_set: (f) => `Done. The class link for ${batch(f)} is saved. It goes ${need(f, "leadMinutes")} minutes before each class to students whose fee is paid or within the grace days.`,
  owner_class_doubts_waiting: (f) => `Doubts waiting at ${f.businessName}: ${need(f, "waitingCount")} from ${batch(f)}. Reply "doubts" to read them.`,
  owner_class_doubts: (f) => `Doubts waiting: ${need(f, "doubtText")} Reply "answered" and the code of a doubt when you have answered it.`,
  owner_class_nothing: () => "Nothing waits: no class needs attendance and no doubt is open.",
  owner_class_unknown: () => `I could not read that class command. Try "link", the batch name and the full link; "present"; "absent" with the numbers; "doubts"; "class".`,
  owner_class_shared: (f) => `Material link for ${batch(f)}: sent to ${need(f, "sentCount")}, not sent to ${need(f, "heldCount")} (fee not paid or past its grace days, no agreement, or no page link).`,
};

const hi: Set = {
  class_consent_ask: (f) => `नमस्ते, ${f.businessName} की ओर से। ${student(f)} ${batch(f)} की क्लास में है। क्या हम ${student(f)} के लिए क्लास के लिंक और पढ़ने की सामग्री इसी नंबर पर भेज सकते हैं? अनुमति के लिए हाँ दबाएँ, मना करने के लिए नहीं। हम विद्यार्थियों पर नज़र नहीं रखते, उनकी प्रोफ़ाइल नहीं बनाते और विज्ञापन नहीं भेजते। सारे संदेश बंद करने के लिए कभी भी STOP लिखें।`,
  class_consent_yes: (f) => `धन्यवाद। ${f.businessName} ${student(f)} की क्लास के लिंक और पढ़ने की सामग्री इसी नंबर पर भेजेगा। शिक्षक से कोई डाउट पूछना हो तो "doubt" लिखें। ये संदेश नहीं चाहिए तो STOP लिखें।`,
  class_consent_no: (f) => `ठीक है। ${f.businessName} ${student(f)} की क्लास के लिंक या पढ़ने की सामग्री इस नंबर पर नहीं भेजेगा।`,
  class_link: (f) => `क्लास की याद: ${f.businessName}। ${student(f)} की ${batch(f)} की क्लास ${classDate(f)} को ${classTime(f)} है। यहाँ से जुड़ें: ${need(f, "classLink")} कृपया यह लिंक किसी से साझा न करें। ये संदेश नहीं चाहिए तो STOP लिखें।`,
  class_next: (f) => `${f.businessName} की अगली क्लास: ${classLines(f)}। फीस भरी हो, या छूट के दिनों के भीतर हो, तो क्लास का लिंक हर क्लास से कुछ देर पहले इसी चैट में आता है।`,
  class_next_none: (f) => `${f.businessName} की समय सारणी में आपके बच्चों के बैच की अभी कोई क्लास नहीं है। कृपया शिक्षक से पूछें।`,
  class_not_entitled: (f) => `${student(f)} की ${batch(f)} की क्लास का लिंक और पढ़ने की सामग्री तब मिलती है जब फीस भरी हो या छूट के दिनों के भीतर हो। कृपया फीस भरें, या मालिक से बात करें।`,
  class_doubt_ask: () => "कृपया अपना डाउट एक ही संदेश में लिखें। मैं उसे शिक्षक तक पहुँचा दूँगा। विषय के सवालों के जवाब मैं खुद नहीं दे सकता।",
  class_doubt_thanks: (f) => `${student(f)} की ${batch(f)} की क्लास का आपका डाउट शिक्षक के पास है। वे क्लास में या यहीं संदेश भेजकर जवाब देंगे।`,
  class_missed_note: (f) => `क्लास की सूचना: ${f.businessName}। ${student(f)} को ${classDate(f)} को ${classTime(f)} की ${batch(f)} की क्लास में उपस्थित नहीं लिखा गया। अगर यह गलती है तो कृपया मालिक को बताएँ। ये संदेश नहीं चाहिए तो STOP लिखें।`,
  class_material_link: (f) => `पढ़ने की सामग्री: ${f.businessName}। ${student(f)} की ${batch(f)} की सामग्री यहाँ खोलें: ${need(f, "materialLink")} यह तभी खुलती है जब ${student(f)} इस क्लास में हो और फीस भरी हो या छूट के दिनों के भीतर हो। कृपया इसे साझा न करें। ये संदेश नहीं चाहिए तो STOP लिखें।`,

  class_material_none: (f) => `${student(f)} की ${batch(f)} की पढ़ने की सामग्री यहाँ से अभी नहीं खुल सकती। कृपया शिक्षक से पूछें।`,

  owner_class_attendance: (f) => `उपस्थिति चाहिए: ${f.businessName} में ${batch(f)} की ${classDate(f)} को ${classTime(f)} की क्लास खत्म हो गई। सब आए हों तो "present" लिखें, या किसने क्लास छोड़ी यह चुनने के लिए "class" लिखें।`,
  owner_class_roster: (f) => `क्लास ${batch(f)}, ${classDate(f)} को ${classTime(f)}। विद्यार्थी: ${need(f, "roster")}। सब आए हों तो "सब आए" दबाएँ, या जो नहीं आए उनके नंबर के साथ "absent" लिखें।`,
  owner_class_marked: (f) => `${batch(f)}, ${classDate(f)} को ${classTime(f)} की उपस्थिति सेव हो गई: ${need(f, "presentCount")} उपस्थित, ${need(f, "absentCount")} अनुपस्थित। अनुपस्थित बच्चों के अभिभावकों को भेजे गए नोट: ${need(f, "notedCount")}।`,
  owner_class_no_link: (f) => `क्लास लिंक चाहिए: ${f.businessName} में ${batch(f)} की ${classDate(f)} को ${classTime(f)} की क्लास का कोई लिंक नहीं है। "link", बैच का नाम और पूरा लिंक लिखकर भेजें।`,
  owner_class_link_set: (f) => `हो गया। ${batch(f)} की क्लास का लिंक सेव हो गया। यह हर क्लास से ${need(f, "leadMinutes")} मिनट पहले उन विद्यार्थियों को जाता है जिनकी फीस भरी है या छूट के दिनों के भीतर है।`,
  owner_class_doubts_waiting: (f) => `डाउट इंतज़ार में: ${f.businessName}, ${batch(f)} की क्लास से ${need(f, "waitingCount")}। पढ़ने के लिए "doubts" लिखें।`,
  owner_class_doubts: (f) => `इंतज़ार में डाउट: ${need(f, "doubtText")} जवाब देने के बाद "answered" और उस डाउट का कोड लिखें।`,
  owner_class_nothing: () => "कुछ इंतज़ार में नहीं है: किसी क्लास की उपस्थिति बाकी नहीं है और कोई डाउट खुला नहीं है।",
  owner_class_unknown: () => `मैं यह क्लास कमांड नहीं समझा। इन्हें आज़माएँ: "link", बैच का नाम और पूरा लिंक; "present"; "absent" और नंबर; "doubts"; "class"।`,
  owner_class_shared: (f) => `${batch(f)} की सामग्री का लिंक: ${need(f, "sentCount")} को भेजा गया, ${need(f, "heldCount")} को नहीं भेजा गया (फीस न भरी हो या छूट के दिन खत्म हों, सहमति न हो, या पेज लिंक न हो)।`,
};

const ml: Set = {
  class_consent_ask: (f) => `ക്ലാസ് വിവരം: ${f.businessName}. ${student(f)} ${batch(f)} ക്ലാസിലാണ്. ${student(f)}-ന്റെ ക്ലാസ് ലിങ്കുകളും പഠന സാമഗ്രികളും ഈ നമ്പറിലേക്ക് അയയ്ക്കാമോ? അനുവദിക്കാൻ അതെ അമർത്തുക, വേണ്ടെങ്കിൽ അല്ല. ഞങ്ങൾ വിദ്യാർത്ഥികളെ നിരീക്ഷിക്കുകയോ പ്രൊഫൈൽ ഉണ്ടാക്കുകയോ പരസ്യം അയയ്ക്കുകയോ ചെയ്യില്ല. എല്ലാ സന്ദേശങ്ങളും നിർത്താൻ എപ്പോൾ വേണമെങ്കിലും STOP എന്ന് എഴുതുക.`,
  class_consent_yes: (f) => `നന്ദി. ${f.businessName} ${student(f)}-ന്റെ ക്ലാസ് ലിങ്കുകളും പഠന സാമഗ്രികളും ഈ നമ്പറിലേക്ക് അയയ്ക്കും. അധ്യാപകനോട് സംശയം ചോദിക്കാൻ "doubt" എന്ന് എഴുതുക. ഈ സന്ദേശങ്ങൾ വേണ്ടെങ്കിൽ STOP എന്ന് എഴുതുക.`,
  class_consent_no: (f) => `മനസ്സിലായി. ${f.businessName} ${student(f)}-ന്റെ ക്ലാസ് ലിങ്കുകളോ പഠന സാമഗ്രികളോ ഈ നമ്പറിലേക്ക് അയയ്ക്കില്ല.`,
  class_link: (f) => `ക്ലാസ് ഓർമ്മപ്പെടുത്തൽ: ${f.businessName}. ${student(f)}-ന്റെ ${batch(f)} ക്ലാസ് ${classDate(f)}, ${classTime(f)}-ന് ആണ്. ഇവിടെ ചേരുക: ${need(f, "classLink")} ദയവായി ഈ ലിങ്ക് ആരുമായും പങ്കുവയ്ക്കരുത്. ഈ സന്ദേശങ്ങൾ വേണ്ടെങ്കിൽ STOP എന്ന് എഴുതുക.`,
  class_next: (f) => `${f.businessName}-ലെ അടുത്ത ക്ലാസുകൾ: ${classLines(f)}. ഫീസ് അടച്ചിട്ടുണ്ടെങ്കിൽ, അല്ലെങ്കിൽ ഇളവ് ദിവസങ്ങൾക്കുള്ളിലാണെങ്കിൽ, ഓരോ ക്ലാസിനും അല്പം മുമ്പ് ക്ലാസ് ലിങ്ക് ഈ ചാറ്റിൽ വരും.`,
  class_next_none: (f) => `${f.businessName}-ന്റെ സമയപ്പട്ടികയിൽ നിങ്ങളുടെ കുട്ടികളുടെ ബാച്ചുകൾക്ക് ഇതുവരെ ക്ലാസ് ഇല്ല. ദയവായി അധ്യാപകനോട് ചോദിക്കൂ.`,
  class_not_entitled: (f) => `${student(f)}-ന്റെ ${batch(f)} ക്ലാസ് ലിങ്കും പഠന സാമഗ്രികളും ഫീസ് അടച്ചിട്ടുണ്ടെങ്കിൽ, അല്ലെങ്കിൽ ഇളവ് ദിവസങ്ങൾക്കുള്ളിലാണെങ്കിൽ മാത്രം അയയ്ക്കും. ദയവായി ഫീസ് അടയ്ക്കൂ, അല്ലെങ്കിൽ ഉടമയോട് സംസാരിക്കൂ.`,
  class_doubt_ask: () => "ദയവായി നിങ്ങളുടെ സംശയം ഒറ്റ സന്ദേശമായി എഴുതൂ. ഞാൻ അത് അധ്യാപകന് എത്തിക്കാം. വിഷയസംബന്ധമായ ചോദ്യങ്ങൾക്ക് ഞാൻ തന്നെ ഉത്തരം പറയില്ല.",
  class_doubt_thanks: (f) => `${student(f)}-ന്റെ ${batch(f)} ക്ലാസിലെ നിങ്ങളുടെ സംശയം അധ്യാപകന്റെ പക്കലുണ്ട്. ക്ലാസിൽ വച്ചോ ഇവിടെ സന്ദേശമായോ അവർ മറുപടി നൽകും.`,
  class_missed_note: (f) => `ക്ലാസ് അറിയിപ്പ്: ${f.businessName}. ${classDate(f)}, ${classTime(f)}-ന് നടന്ന ${batch(f)} ക്ലാസിൽ ${student(f)} ഹാജരായതായി രേഖപ്പെടുത്തിയിട്ടില്ല. ഇത് തെറ്റാണെങ്കിൽ ദയവായി ഉടമയെ അറിയിക്കൂ. ഈ സന്ദേശങ്ങൾ വേണ്ടെങ്കിൽ STOP എന്ന് എഴുതുക.`,
  class_material_link: (f) => `പഠന സാമഗ്രികൾ: ${f.businessName}. ${student(f)}-ന്റെ ${batch(f)}-നുള്ള സാമഗ്രികൾ ഇവിടെ തുറക്കുക: ${need(f, "materialLink")} ${student(f)} ഈ ക്ലാസിലുള്ളപ്പോഴും ഫീസ് അടച്ചിരിക്കുമ്പോഴോ ഇളവ് ദിവസങ്ങൾക്കുള്ളിലോ മാത്രമേ ഇത് തുറക്കൂ. ദയവായി ഇത് പങ്കുവയ്ക്കരുത്. ഈ സന്ദേശങ്ങൾ വേണ്ടെങ്കിൽ STOP എന്ന് എഴുതുക.`,

  class_material_none: (f) => `${student(f)}-ന്റെ ${batch(f)}-ലെ പഠന സാമഗ്രികൾ ഇവിടെ നിന്ന് ഇതുവരെ തുറക്കാനാവില്ല. ദയവായി അധ്യാപകനോട് ചോദിക്കൂ.`,

  owner_class_attendance: (f) => `ഹാജർ വേണം: ${f.businessName}-ൽ ${classDate(f)}, ${classTime(f)}-ന് ഉള്ള ${batch(f)} ക്ലാസ് കഴിഞ്ഞു. എല്ലാവരും വന്നെങ്കിൽ "present" എന്ന് എഴുതൂ, അല്ലെങ്കിൽ ആരൊക്കെ വന്നില്ല എന്ന് അടയാളപ്പെടുത്താൻ "class" എന്ന് എഴുതൂ.`,
  owner_class_roster: (f) => `ക്ലാസ് ${batch(f)}, ${classDate(f)}, ${classTime(f)}. വിദ്യാർത്ഥികൾ: ${need(f, "roster")}. എല്ലാവരും വന്നെങ്കിൽ "എല്ലാവരും വന്നു" അമർത്തൂ, അല്ലെങ്കിൽ വരാത്തവരുടെ നമ്പറുകളോടെ "absent" എന്ന് എഴുതൂ.`,
  owner_class_marked: (f) => `${batch(f)}, ${classDate(f)}, ${classTime(f)} ഹാജർ സേവ് ചെയ്തു: ${need(f, "presentCount")} പേർ ഹാജർ, ${need(f, "absentCount")} പേർ ഹാജരില്ല. ഹാജരില്ലാത്തവരുടെ രക്ഷിതാക്കൾക്ക് അയച്ച കുറിപ്പുകൾ: ${need(f, "notedCount")}.`,
  owner_class_no_link: (f) => `ക്ലാസ് ലിങ്ക് വേണം: ${f.businessName}-ൽ ${classDate(f)}, ${classTime(f)}-ന് ഉള്ള ${batch(f)} ക്ലാസിന് ലിങ്ക് ഒന്നും സജ്ജമാക്കിയിട്ടില്ല. "link", ബാച്ചിന്റെ പേര്, പൂർണ്ണ ലിങ്ക് എന്നിവ എഴുതി അയയ്ക്കൂ.`,
  owner_class_link_set: (f) => `ശരി. ${batch(f)} ക്ലാസിന്റെ ലിങ്ക് സേവ് ചെയ്തു. ഫീസ് അടച്ച അല്ലെങ്കിൽ ഇളവ് ദിവസങ്ങൾക്കുള്ളിലുള്ള വിദ്യാർത്ഥികൾക്ക് ഓരോ ക്ലാസിനും ${need(f, "leadMinutes")} മിനിറ്റ് മുമ്പ് ഇത് അയയ്ക്കും.`,
  owner_class_doubts_waiting: (f) => `സംശയങ്ങൾ കാത്തിരിക്കുന്നു: ${f.businessName}, ${batch(f)} ക്ലാസിൽ നിന്ന് ${need(f, "waitingCount")}. വായിക്കാൻ "doubts" എന്ന് എഴുതൂ.`,
  owner_class_doubts: (f) => `കാത്തിരിക്കുന്ന സംശയങ്ങൾ: ${need(f, "doubtText")} മറുപടി നൽകിയ ശേഷം "answered" എന്നും ആ സംശയത്തിന്റെ കോഡും എഴുതൂ.`,
  owner_class_nothing: () => "ഒന്നും കാത്തിരിക്കുന്നില്ല: ഒരു ക്ലാസിനും ഹാജർ ബാക്കിയില്ല, ഒരു സംശയവും തുറന്നുകിടക്കുന്നില്ല.",
  owner_class_unknown: () => `ആ ക്ലാസ് നിർദ്ദേശം എനിക്ക് മനസ്സിലായില്ല. ഇവ ശ്രമിക്കൂ: "link", ബാച്ചിന്റെ പേരും പൂർണ്ണ ലിങ്കും; "present"; "absent" എന്നും നമ്പറുകളും; "doubts"; "class".`,
  owner_class_shared: (f) => `${batch(f)}-ന്റെ സാമഗ്രി ലിങ്ക്: ${need(f, "sentCount")} പേർക്ക് അയച്ചു, ${need(f, "heldCount")} പേർക്ക് അയച്ചില്ല (ഫീസ് അടച്ചിട്ടില്ല അല്ലെങ്കിൽ ഇളവ് ദിവസം കഴിഞ്ഞു, സമ്മതമില്ല, അല്ലെങ്കിൽ പേജ് ലിങ്ക് ഇല്ല).`,
};

const kn: Set = {
  class_consent_ask: (f) => `ತರಗತಿ ಮಾಹಿತಿ: ${f.businessName}. ${student(f)} ${batch(f)} ತರಗತಿಯಲ್ಲಿದ್ದಾರೆ. ${student(f)} ಅವರ ತರಗತಿ ಲಿಂಕ್‌ಗಳನ್ನು ಮತ್ತು ಓದುವ ಸಾಮಗ್ರಿಯನ್ನು ಈ ನಂಬರ್‌ಗೆ ಕಳುಹಿಸಬಹುದೇ? ಒಪ್ಪಿಗೆಗೆ ಹೌದು ಒತ್ತಿ, ಬೇಡವಾದರೆ ಇಲ್ಲ ಒತ್ತಿ. ನಾವು ವಿದ್ಯಾರ್ಥಿಗಳ ಮೇಲೆ ನಿಗಾ ಇಡುವುದಿಲ್ಲ, ಅವರ ಪ್ರೊಫೈಲ್ ಮಾಡುವುದಿಲ್ಲ, ಜಾಹೀರಾತು ಕಳುಹಿಸುವುದಿಲ್ಲ. ಎಲ್ಲ ಸಂದೇಶಗಳನ್ನು ನಿಲ್ಲಿಸಲು ಯಾವಾಗ ಬೇಕಾದರೂ STOP ಎಂದು ಬರೆಯಿರಿ.`,
  class_consent_yes: (f) => `ಧನ್ಯವಾದ. ${f.businessName} ${student(f)} ಅವರ ತರಗತಿ ಲಿಂಕ್‌ಗಳನ್ನು ಮತ್ತು ಓದುವ ಸಾಮಗ್ರಿಯನ್ನು ಈ ನಂಬರ್‌ಗೆ ಕಳುಹಿಸುತ್ತದೆ. ಶಿಕ್ಷಕರಿಗೆ ಸಂದೇಹ ಕೇಳಲು "doubt" ಎಂದು ಬರೆಯಿರಿ. ಈ ಸಂದೇಶಗಳು ಬೇಡವಾದರೆ STOP ಎಂದು ಬರೆಯಿರಿ.`,
  class_consent_no: (f) => `ಅರ್ಥವಾಯಿತು. ${f.businessName} ${student(f)} ಅವರ ತರಗತಿ ಲಿಂಕ್ ಅಥವಾ ಓದುವ ಸಾಮಗ್ರಿಯನ್ನು ಈ ನಂಬರ್‌ಗೆ ಕಳುಹಿಸುವುದಿಲ್ಲ.`,
  class_link: (f) => `ತರಗತಿಯ ನೆನಪು: ${f.businessName}. ${student(f)} ಅವರ ${batch(f)} ತರಗತಿ ${classDate(f)}, ${classTime(f)} ಕ್ಕೆ ಇದೆ. ಇಲ್ಲಿ ಸೇರಿ: ${need(f, "classLink")} ದಯವಿಟ್ಟು ಈ ಲಿಂಕ್ ಅನ್ನು ಯಾರೊಂದಿಗೂ ಹಂಚಿಕೊಳ್ಳಬೇಡಿ. ಈ ಸಂದೇಶಗಳು ಬೇಡವಾದರೆ STOP ಎಂದು ಬರೆಯಿರಿ.`,
  class_next: (f) => `${f.businessName} ನ ಮುಂದಿನ ತರಗತಿಗಳು: ${classLines(f)}. ಶುಲ್ಕ ಪಾವತಿಸಿದ್ದರೆ, ಅಥವಾ ರಿಯಾಯಿತಿ ದಿನಗಳ ಒಳಗಿದ್ದರೆ, ಪ್ರತಿ ತರಗತಿಗೆ ಸ್ವಲ್ಪ ಮೊದಲು ತರಗತಿ ಲಿಂಕ್ ಈ ಚಾಟ್‌ಗೆ ಬರುತ್ತದೆ.`,
  class_next_none: (f) => `${f.businessName} ನ ಸಮಯ ಪಟ್ಟಿಯಲ್ಲಿ ನಿಮ್ಮ ಮಕ್ಕಳ ಬ್ಯಾಚ್‌ಗಳಿಗೆ ಇನ್ನೂ ತರಗತಿ ಇಲ್ಲ. ದಯವಿಟ್ಟು ಶಿಕ್ಷಕರನ್ನು ಕೇಳಿ.`,
  class_not_entitled: (f) => `${student(f)} ಅವರ ${batch(f)} ತರಗತಿ ಲಿಂಕ್ ಮತ್ತು ಓದುವ ಸಾಮಗ್ರಿ ಶುಲ್ಕ ಪಾವತಿಸಿದ್ದರೆ ಅಥವಾ ರಿಯಾಯಿತಿ ದಿನಗಳ ಒಳಗಿದ್ದರೆ ಮಾತ್ರ ಕಳುಹಿಸಲಾಗುತ್ತದೆ. ದಯವಿಟ್ಟು ಶುಲ್ಕ ಪಾವತಿಸಿ, ಅಥವಾ ಮಾಲೀಕರೊಂದಿಗೆ ಮಾತನಾಡಿ.`,
  class_doubt_ask: () => "ದಯವಿಟ್ಟು ನಿಮ್ಮ ಸಂದೇಹವನ್ನು ಒಂದೇ ಸಂದೇಶದಲ್ಲಿ ಬರೆಯಿರಿ. ನಾನು ಅದನ್ನು ಶಿಕ್ಷಕರಿಗೆ ತಲುಪಿಸುತ್ತೇನೆ. ವಿಷಯದ ಪ್ರಶ್ನೆಗಳಿಗೆ ನಾನೇ ಉತ್ತರಿಸುವುದಿಲ್ಲ.",
  class_doubt_thanks: (f) => `${student(f)} ಅವರ ${batch(f)} ತರಗತಿಯ ನಿಮ್ಮ ಸಂದೇಹ ಶಿಕ್ಷಕರ ಬಳಿ ಇದೆ. ಅವರು ತರಗತಿಯಲ್ಲಿ ಅಥವಾ ಇಲ್ಲಿ ಸಂದೇಶ ಕಳುಹಿಸಿ ಉತ್ತರಿಸುತ್ತಾರೆ.`,
  class_missed_note: (f) => `ತರಗತಿ ಸೂಚನೆ: ${f.businessName}. ${classDate(f)}, ${classTime(f)} ಕ್ಕೆ ನಡೆದ ${batch(f)} ತರಗತಿಯಲ್ಲಿ ${student(f)} ಹಾಜರಾಗಿದ್ದಾರೆ ಎಂದು ಗುರುತಿಸಲಾಗಿಲ್ಲ. ಇದು ತಪ್ಪಾಗಿದ್ದರೆ ದಯವಿಟ್ಟು ಮಾಲೀಕರಿಗೆ ತಿಳಿಸಿ. ಈ ಸಂದೇಶಗಳು ಬೇಡವಾದರೆ STOP ಎಂದು ಬರೆಯಿರಿ.`,
  class_material_link: (f) => `ಓದುವ ಸಾಮಗ್ರಿ: ${f.businessName}. ${student(f)} ಅವರ ${batch(f)} ಸಾಮಗ್ರಿಯನ್ನು ಇಲ್ಲಿ ತೆರೆಯಿರಿ: ${need(f, "materialLink")} ${student(f)} ಈ ತರಗತಿಯಲ್ಲಿದ್ದು ಶುಲ್ಕ ಪಾವತಿಸಿದ್ದರೆ ಅಥವಾ ರಿಯಾಯಿತಿ ದಿನಗಳ ಒಳಗಿದ್ದರೆ ಮಾತ್ರ ಇದು ತೆರೆಯುತ್ತದೆ. ದಯವಿಟ್ಟು ಇದನ್ನು ಹಂಚಿಕೊಳ್ಳಬೇಡಿ. ಈ ಸಂದೇಶಗಳು ಬೇಡವಾದರೆ STOP ಎಂದು ಬರೆಯಿರಿ.`,

  class_material_none: (f) => `${student(f)} ಅವರ ${batch(f)} ಓದುವ ಸಾಮಗ್ರಿ ಇಲ್ಲಿಂದ ಇನ್ನೂ ತೆರೆಯಲು ಆಗುವುದಿಲ್ಲ. ದಯವಿಟ್ಟು ಶಿಕ್ಷಕರನ್ನು ಕೇಳಿ.`,

  owner_class_attendance: (f) => `ಹಾಜರಾತಿ ಬೇಕು: ${f.businessName} ನಲ್ಲಿ ${classDate(f)}, ${classTime(f)} ಕ್ಕೆ ನಡೆದ ${batch(f)} ತರಗತಿ ಮುಗಿದಿದೆ. ಎಲ್ಲರೂ ಬಂದಿದ್ದರೆ "present" ಎಂದು ಬರೆಯಿರಿ, ಅಥವಾ ಯಾರು ಬರಲಿಲ್ಲ ಎಂದು ಗುರುತಿಸಲು "class" ಎಂದು ಬರೆಯಿರಿ.`,
  owner_class_roster: (f) => `ತರಗತಿ ${batch(f)}, ${classDate(f)}, ${classTime(f)}. ವಿದ್ಯಾರ್ಥಿಗಳು: ${need(f, "roster")}. ಎಲ್ಲರೂ ಬಂದಿದ್ದರೆ "ಎಲ್ಲರೂ ಬಂದರು" ಒತ್ತಿ, ಅಥವಾ ಬರದವರ ನಂಬರ್‌ಗಳೊಂದಿಗೆ "absent" ಎಂದು ಬರೆಯಿರಿ.`,
  owner_class_marked: (f) => `${batch(f)}, ${classDate(f)}, ${classTime(f)} ಹಾಜರಾತಿ ಉಳಿಸಲಾಗಿದೆ: ${need(f, "presentCount")} ಹಾಜರು, ${need(f, "absentCount")} ಗೈರು. ಗೈರಾದವರ ಪೋಷಕರಿಗೆ ಕಳುಹಿಸಿದ ಟಿಪ್ಪಣಿಗಳು: ${need(f, "notedCount")}.`,
  owner_class_no_link: (f) => `ತರಗತಿ ಲಿಂಕ್ ಬೇಕು: ${f.businessName} ನಲ್ಲಿ ${classDate(f)}, ${classTime(f)} ಕ್ಕೆ ನಡೆಯುವ ${batch(f)} ತರಗತಿಗೆ ಲಿಂಕ್ ಹೊಂದಿಸಿಲ್ಲ. "link", ಬ್ಯಾಚ್‌ನ ಹೆಸರು ಮತ್ತು ಪೂರ್ಣ ಲಿಂಕ್ ಬರೆದು ಕಳುಹಿಸಿ.`,
  owner_class_link_set: (f) => `ಆಯಿತು. ${batch(f)} ತರಗತಿಯ ಲಿಂಕ್ ಉಳಿಸಲಾಗಿದೆ. ಶುಲ್ಕ ಪಾವತಿಸಿದ ಅಥವಾ ರಿಯಾಯಿತಿ ದಿನಗಳ ಒಳಗಿರುವ ವಿದ್ಯಾರ್ಥಿಗಳಿಗೆ ಪ್ರತಿ ತರಗತಿಗೆ ${need(f, "leadMinutes")} ನಿಮಿಷ ಮೊದಲು ಇದನ್ನು ಕಳುಹಿಸಲಾಗುತ್ತದೆ.`,
  owner_class_doubts_waiting: (f) => `ಸಂದೇಹಗಳು ಕಾಯುತ್ತಿವೆ: ${f.businessName}, ${batch(f)} ತರಗತಿಯಿಂದ ${need(f, "waitingCount")}. ಓದಲು "doubts" ಎಂದು ಬರೆಯಿರಿ.`,
  owner_class_doubts: (f) => `ಕಾಯುತ್ತಿರುವ ಸಂದೇಹಗಳು: ${need(f, "doubtText")} ಉತ್ತರಿಸಿದ ನಂತರ "answered" ಮತ್ತು ಆ ಸಂದೇಹದ ಕೋಡ್ ಬರೆಯಿರಿ.`,
  owner_class_nothing: () => "ಯಾವುದೂ ಕಾಯುತ್ತಿಲ್ಲ: ಯಾವ ತರಗತಿಗೂ ಹಾಜರಾತಿ ಬಾಕಿ ಇಲ್ಲ, ಯಾವ ಸಂದೇಹವೂ ತೆರೆದಿಲ್ಲ.",
  owner_class_unknown: () => `ಆ ತರಗತಿ ಆದೇಶ ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ. ಇವನ್ನು ಪ್ರಯತ್ನಿಸಿ: "link", ಬ್ಯಾಚ್‌ನ ಹೆಸರು ಮತ್ತು ಪೂರ್ಣ ಲಿಂಕ್; "present"; "absent" ಮತ್ತು ನಂಬರ್‌ಗಳು; "doubts"; "class".`,
  owner_class_shared: (f) => `${batch(f)} ಸಾಮಗ್ರಿ ಲಿಂಕ್: ${need(f, "sentCount")} ಜನರಿಗೆ ಕಳುಹಿಸಲಾಗಿದೆ, ${need(f, "heldCount")} ಜನರಿಗೆ ಕಳುಹಿಸಿಲ್ಲ (ಶುಲ್ಕ ಪಾವತಿಸಿಲ್ಲ ಅಥವಾ ರಿಯಾಯಿತಿ ದಿನ ಮುಗಿದಿದೆ, ಒಪ್ಪಿಗೆ ಇಲ್ಲ, ಅಥವಾ ಪುಟ ಲಿಂಕ್ ಇಲ್ಲ).`,
};

/** Every Classes message, by language. templates.ts spreads these into TEMPLATES. */
export const CLASS_TEMPLATES: Record<Language, Set> = { en, hi, ml, kn };

/** The Classes messages that go out on the agent's own, often outside the 24-hour window, and so are WhatsApp templates too (meta-templates.ts). */
export const CLASS_META_IDS = ["class_consent_ask", "class_link", "class_missed_note", "class_material_link", "owner_class_attendance", "owner_class_no_link", "owner_class_doubts_waiting"] as const satisfies readonly ClassTemplateId[];
