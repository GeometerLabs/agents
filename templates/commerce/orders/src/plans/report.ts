// What the monthly report says about plans (17 Nov 2026): plans active at the month's end, plans started, renewals, meals delivered, days credited and what the credits came to (carried
// to a later payment, or refunded). Counted from the action record only, like every other number in the report, and each from one kind of entry written once: a plan's first payment
// and a renewal's payment (`plan_paid`), a meal (`deliver_meal`), a settled period (`plan_credit`), a cancellation (`plan_cancel`) and a renewal that was not paid (`plan_lapse`). The
// block is made only for a shop with plans, so every other shop's report, its digest and its signature are as they were. Its words are here (four languages, the Hindi, Malayalam and
// Kannada machine-written and on the review sheets), so the report's own strings are not widened for a shop that has no plans.
import type { RecordEntry } from "../../../../../modules/record/record.ts";
import type { Language } from "../../../../../modules/language/languages.ts";

export interface PlansReport {
  /** Plans paid at least once that were not cancelled or lapsed by the month's end. */
  active: number;
  started: number;
  renewals: number;
  mealsDelivered: number;
  /** Meal days not taken, in the periods settled this month, and what they came to in paise. */
  credits: { days: number; carriedPaise: number; refundedPaise: number };
  cancelled: number;
  lapsed: number;
}

export function plansReportOf(all: readonly RecordEntry[], month: readonly RecordEntry[]): PlansReport {
  const planOf = (e: RecordEntry) => e.refs.plan;
  const live = new Set<string>();
  for (const e of all) {
    if (e.action === "plan_paid" && e.outcome === "confirmed" && planOf(e)) live.add(planOf(e));
    if ((e.action === "plan_cancel" || (e.action === "plan_lapse" && e.refs.period !== "0")) && e.outcome === "confirmed") live.delete(planOf(e));
  }
  const paid = month.filter((e) => e.action === "plan_paid" && e.outcome === "confirmed");
  const credits = month.filter((e) => e.action === "plan_credit" && e.outcome === "confirmed");
  const sum = (kind: string, f: (e: RecordEntry) => number) => credits.filter((e) => e.refs.kind === kind).reduce((n, e) => n + f(e), 0);
  return {
    active: live.size,
    started: paid.filter((e) => e.refs.period === "0").length,
    renewals: paid.filter((e) => e.refs.period !== "0").length,
    mealsDelivered: month.filter((e) => e.action === "deliver_meal" && e.outcome === "confirmed").length,
    credits: { days: credits.reduce((n, e) => n + Number(e.refs.days ?? 0), 0), carriedPaise: sum("carried", (e) => Number(e.refs.amountPaise ?? 0)), refundedPaise: sum("refunded", (e) => Number(e.refs.amountPaise ?? 0)) },
    cancelled: month.filter((e) => e.action === "plan_cancel" && e.outcome === "confirmed").length,
    lapsed: month.filter((e) => e.action === "plan_lapse" && e.outcome === "confirmed" && e.refs.period !== "0").length,
  };
}

export interface PlanReportWords { heading: string; active: string; started: string; renewals: string; meals: string; creditDays: string; carried: string; refunded: string; cancelled: string; lapsed: string }

export const PLAN_REPORT_WORDS: Record<Language, PlanReportWords> = {
  en: { heading: "Monthly plans", active: "Plans running at the month's end", started: "Plans started", renewals: "Renewals paid", meals: "Meals delivered", creditDays: "Meal days not taken (credit)", carried: "Credit carried to a later payment", refunded: "Credit refunded", cancelled: "Plans cancelled", lapsed: "Renewals not paid in time" },
  hi: { heading: "मासिक प्लान", active: "महीने के अंत में चल रहे प्लान", started: "शुरू हुए प्लान", renewals: "चुकाए गए नवीनीकरण", meals: "भेजे गए भोजन", creditDays: "न लिए गए भोजन के दिन (क्रेडिट)", carried: "आगे के भुगतान में ले जाया गया क्रेडिट", refunded: "वापस किया गया क्रेडिट", cancelled: "रद्द किए गए प्लान", lapsed: "समय पर न चुकाए गए नवीनीकरण" },
  ml: { heading: "മാസ പ്ലാനുകൾ", active: "മാസാവസാനം നടക്കുന്ന പ്ലാനുകൾ", started: "തുടങ്ങിയ പ്ലാനുകൾ", renewals: "അടച്ച പുതുക്കലുകൾ", meals: "അയച്ച ഭക്ഷണം", creditDays: "എടുക്കാത്ത ഭക്ഷണ ദിവസങ്ങൾ (ക്രെഡിറ്റ്)", carried: "പിന്നീടുള്ള പണമടയ്ക്കലിലേക്ക് കൊണ്ടുപോയ ക്രെഡിറ്റ്", refunded: "തിരികെ നൽകിയ ക്രെഡിറ്റ്", cancelled: "റദ്ദാക്കിയ പ്ലാനുകൾ", lapsed: "സമയത്തിന് അടയ്ക്കാത്ത പുതുക്കലുകൾ" },
  kn: { heading: "ತಿಂಗಳ ಪ್ಲಾನ್‌ಗಳು", active: "ತಿಂಗಳ ಕೊನೆಯಲ್ಲಿ ನಡೆಯುತ್ತಿರುವ ಪ್ಲಾನ್‌ಗಳು", started: "ಶುರುವಾದ ಪ್ಲಾನ್‌ಗಳು", renewals: "ಪಾವತಿಸಿದ ನವೀಕರಣಗಳು", meals: "ಕಳುಹಿಸಿದ ಊಟ", creditDays: "ತೆಗೆದುಕೊಳ್ಳದ ಊಟದ ದಿನಗಳು (ಕ್ರೆಡಿಟ್)", carried: "ಮುಂದಿನ ಪಾವತಿಗೆ ಒಯ್ದ ಕ್ರೆಡಿಟ್", refunded: "ಮರಳಿಸಿದ ಕ್ರೆಡಿಟ್", cancelled: "ರದ್ದಾದ ಪ್ಲಾನ್‌ಗಳು", lapsed: "ಸಮಯಕ್ಕೆ ಪಾವತಿಸದ ನವೀಕರಣಗಳು" },
};
