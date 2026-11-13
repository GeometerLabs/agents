// Every word the panel says, in English, with the shape every other language must have. The Hindi, Malayalam and Kannada sets are in
// words.hi.ts, words.ml.ts and words.kn.ts and are MACHINE-WRITTEN: they carry a review marker, the sentences are appended to REVIEW-ml.md and
// REVIEW-kn.md (bundle/panel/review.ts makes that section), and a native speaker must read them before a real shop sees them.
//
// Two kinds of line are not written here, so each has one source:
//  - the limits in one benefit sentence each are the lines of docs/product/gtm-and-revenue.md ("Lead with their advantage", the table that is
//    the one source in four languages);
//  - the go-live certificate's "Held N of M ..." line and "Show what we did" come from templates/commerce/bookings/report/strings.ts.
// The form labels the demo already has (the shop's name, a service, a price, hours) come from the demo's own words (demo/strings.ts) in English and
// Hindi, so the demo and the panel say the same thing; Malayalam and Kannada say them in their own files.
import { uiFor } from "../../templates/commerce/bookings/demo/strings.ts";
import type { Why, LiveCode, PlanName } from "./contract.ts";
import type { CheckCode } from "./checks.ts";
import { latestPriceList } from "./cost.ts";
import type { Caveat, LineId, Payer } from "./cost.ts";

const demo = uiFor("en");

export type JoinProblem = "invite-unknown" | "invite-used" | "invite-expired" | "handle-bad" | "handle-taken" | "name-bad" | "company-bad" | "language-bad" | "short" | "long" | "same-as-handle";

export interface Words {
  appName: string;
  languageName: string;
  draftNote: string;
  nav: { shops: string; setUp: string; invite: string; signOut: string };
  common: { back: string; next: string; save: string; counts: string };
  login: { title: string; handle: string; passphrase: string; button: string; wrong: string; wait(seconds: number): string; byInvitation: string };
  join: { title(role: string): string; intro: string; name: string; company: string; companyHelp: string; handle: string; handleHelp: string; passphrase: string; passphraseHelp: string; language: string; button: string; problems: Record<JoinProblem, string> };
  roles: { builder: string; partner: string };
  invite: { title: string; role: string; note: string; button: string; made: string; copy: string; hostedOnly: string };
  shops: { title: string; titleAll: string; empty: string; setUp: string; version(v: string): string; limits(proven: number, of: number): string; limitsUnknown: string; setUpBy(name: string): string; setUpOnServer: string };
  live: Record<LiveCode, string>;
  why: Record<Why, string>;
  shop: {
    status: string; versions(pathway: string, bundle: string): string; lastDeploy(at: string): string; neverDeployed: string;
    limitsHeading: string; unprovable(list: string): string;
    backups: string; backupCopy(at: string): string; backupNone: string; backupDrill(at: string, matched: boolean): string; backupDrillNone: string;
    settings: string; settingsEdit: string; summaryServices: string; summaryHours: string; hoursRange(open: string, close: string): string; summaryClosed: string; summaryDeposit(amount: string, minutes: number): string;
    summaryCancel(hours: number, limit: string): string; summaryLanguages: string; summaryOwner: string;
    activity: string; activityNote: string; noRecord: string; waiting(n: number): string; needBuilder(n: number): string;
    made: string; cancelled: string; moved: string; deposits: string; refunds: string; saidNo: string;
    approvals: string; approvalsLine(asked: number, approved: number, denied: number): string;
    bookingStates: Record<string, string>;
    /** A Fees centre's fees by state, and the two headings of its settings (its limits are the certificate's lines, in plain words). */
    feeStates: Record<string, string>; summaryFees: string; summaryRules: string;
    papers: string; goLive: string; goLiveNone: string; monthly: string; makeReport(month: string): string; reportNoRecord: string; reportMade: string;
    stop: string; stopTitle(name: string): string; stopText: string; stopConfirm: string; stopAsked(at: string): string; stopOnly: string;
    details: string; detailsDeploy: string; detailsPins: string; detailsPrices(date: string): string; detailsNothing: string; detailsStatusFile: string;
  };
  /** A Fees centre's shop page: its batches, this month's counts, and the messages its rules allow. The rest of the page is the shop page's. */
  feesShop: {
    studentsIn(n: number): string;
    activity: { opened: string; paidInFull: string; partlyPaid: string; stillOpen: string; collected: string; stillToCollect: string; reminders: string };
    messages: { heading: string; ceiling(students: number, most: number, total: number): string; included(n: number): string; note: string };
  };
  /** An Orders shop's page: its menu and slots, this month's counts, and the messages its rules allow. The rest of the page is the shop page's. */
  ordersShop: {
    summaryMenu: string; summaryRules: string; perDay(n: number): string; pickup: string; delivery: string; noDelivery: string;
    states: Record<string, string>;
    activity: { taken: string; completed: string; cancelled: string; holdsRanOut: string; collected: string; toCollect: string; pickup: string; delivery: string };
    messages: { heading: string; ceiling(perDay: number, perOrder: number, total: number): string; included(n: number): string; note: string };
  };
  cost: {
    heading: string; early: string; fromRecord(n: number): string; assumption(n: number): string;
    lines: Record<LineId, string>; payer: Record<Payer, string>;
    unknown: string; total: string; subtotal(unknownItems: number): string; priceList(date: string): string;
    caveats: Record<Exclude<Caveat, "early-estimate" | "no-gateway-fee">, string>;
  };
  /** The shop's plan (B48): what fleet says about it, with its price. The warning codes are fleet's (apps/fleet/README.md, "What fleet tells each shop"). */
  plan: {
    heading: string; none: string; names: Record<PlanName, string>; is(name: string): string; included(n: number): string;
    price(price: string): string; priceBuilder(price: string): string; builderLicence: string; priceNote: string; innovator: string;
    buttons: string; buttonsWhy: Record<"overage_unfunded" | "other", string>;
    warn: Record<"allowance_80" | "balance_80" | "whatsapp_unsettled" | "ai_cap", string>;
  };
  /**
   * The shop's licence (B13), from the signed lease the server keeps: where it stands and what that means for customers, its dates, fleet's renew link, and a note
   * when the lease has not been refreshed for a while. Said to a builder or partner, never to the shop's customers.
   */
  licence: {
    heading: string; states: Record<"active" | "reminder" | "warning" | "wind_down" | "stopped" | "none", string>; means: Record<"active" | "reminder" | "warning" | "wind_down" | "stopped" | "none", string>;
    paidThrough(day: string): string; windDownOn(day: string): string; extended(day: string): string; stopOn(day: string): string; exportUntil(day: string): string;
    renew: string; stale(day: string): string;
    /** Decision 39: the builder's trial's LAST DAY, for a shop it covers (fleet's `trial_ends`; new work pauses from the day after). */
    trial(day: string): string;
  };
  setup: {
    title: string; chooseTemplate: string; templateNames: Record<string, string>; templateElsewhere: string; start: string; progress(n: number, of: number): string;
    steps: { business: string; deposit: string; languages: string; accounts: string; character: string; checks: string };
    problemsTitle: string; fallback(english: string): string;
    /** Item 11i: the Character step (views-character.ts) and the shop page's character block. The moods' words are modules/assistant/character.ts FACE_WORDS. */
    character: {
      intro: string; styleLegend: string; stripLegend: string; stripHelp: string; faceLabel(n: number, of: number): string; roll: string;
      colourLegend: string; auto: string; autoLabel: string; colourLabel(n: number): string; moodsTitle: string; moodsHelp: string; name: string; nameHelp: string;
      personalityLegend: string; personalityHelp: string; personalities: { warm: string; cheerful: string; brief: string }; saysLabel: string; chosenMark: string;
      problems: { name: string; style: string; face: string; colour: string; personality: string };
      shopTitle: string; shopNone: string; shopNotDrawn: string; profileTitle: string; profileHelp: string; download: string;
    };
    business: { name: string; services: string; serviceName: string; also: string; price: string; minutes: string; opens: string; closes: string; openOn: string; hint: string; dayNames: string[] };
    depositStep: { amount: string; window: string; windowHint: string; whatThisMeans: string };
    limits: {
      price: string; hours: string; deposit(amount: string, minutes: number): string; refund(hours: number, limit: string): string; booked: string; language: string; charge: string;
    };
    /**
     * The Fees template's own form (a centre, its batches and fees, its students, and the rules of the month). The same five steps, so the steps' titles for it are here.
     * Everything else the phone setup says (languages, accounts, checks) is shared, and the centre's limits in plain words are the Fees certificate's own lines
     * (templates/education/fees/report/strings.ts), so they are said once.
     */
    fees: {
      steps: { business: string; rules: string };
      business: { name: string; address: string; batches: string; batchesHint: string; batchName: string; batchFee: string; students: string; studentsHelp: string };
      rules: {
        dueDay: string; graceDays: string; lateFee: string; reminderDays: string; reminderDaysHelp: string; reminderHour: string; reminderMost: string; partAllowed: string; partMin: string;
        waiver: string; waiverHelp: string; refund: string; refundHelp: string;
      };
      problems: {
        noBatch: string; batchNameEmpty(row: number): string; feeBad(row: number): string; noStudents: string; studentBad(row: number): string; studentNumber(row: number): string;
        studentBatch(row: number, batch: string): string; tooMany(max: number): string; dueBad: string; graceBad: string; lateBad(max: string): string; daysBad: string; hourBad: string;
        mostBad: string; partBad(max: string): string; waiverBad(max: string): string; refundBad: string;
      };
    };
    /** The Orders template's own form (a shop, its menu, and the rules: cut-off, slots, advance and limits). The same five steps. The limits in plain words are the Orders certificate's own lines. */
    orders: {
      steps: { business: string; rules: string };
      business: { name: string; address: string; menu: string; menuHelp: string };
      rules: {
        cutoffDays: string; cutoffTime: string; cutoffHelp: string; pickup: string; slotsHelp: string; delivery: string; deliveryHelp: string; area: string; areaHelp: string;
        advance: string; advancePart: string; advanceFull: string; percent: string; hold: string; perDay: string; perOrder: string; daysAhead: string; window: string;
        refund: string; refundHelp: string; approveOver: string; approveHelp: string;
      };
      problems: {
        noItems: string; itemBad(row: number): string; priceBad(row: number): string; stockBad(row: number): string; itemTwice(row: number, name: string): string; tooManyItems(max: number): string;
        cutoffDaysBad: string; cutoffTimeBad: string; noPickup: string; pickupBad(row: number): string; deliveryBad(row: number): string; tooManySlots(max: number): string;
        deliveryNeedsArea: string; areaNeedsSlots: string; percentBad: string; holdBad: string; perDayBad: string; perOrderBad: string; daysAheadBad: string; windowBad: string;
        refundBad: string; approveBad: string; orderTooBig(total: string, cap: string): string;
      };
    };
    languagesStep: {
      main: string; also: string; hint: string; ownerLanguage: string; ownerNumber: string; ownerNumberHelp: string;
      /** B37: other people who approve refunds, and the amount above which two must. */
      approversTitle: string; approversHelp: string; approverNumber(n: number): string; approverLanguage: string; twoAbove: string; twoAboveHelp: string;
    };
    problems: {
      nameEmpty: string; noService: string; priceBad(row: number): string; depositBad: string; depositTooBig(deposit: string, cheapest: string): string; windowBad: string;
      hoursBad: string; noDay: string; noLanguage: string; ownerNumberBad: string; sameNumber: string; serviceNameEmpty(row: number): string;
      approverNumberBad(n: number): string; approverNumberTaken(n: number): string; twoAboveBad: string; twoAboveAlone: string;
      expectedBad: string; numberIdBad: string; businessNumberBad: string; appNameBad: string; secretMissing(what: string): string; secretShape(what: string): string; calendarIdBad: string; jsonBad: string; modeBad: string;
    };
    accounts: {
      intro: string; received(at: string): string; keepEmpty: string; neverShown: string;
      whatsapp: { title: string; intro: string; steps: string[]; number: string; numberId: string; token: string; appSecret: string;
        /** Item 11c: the shop's own Gupshup account (self-serve): the choice, the links, the short checklist and the write-only fields. */
        selfServe: { choiceMeta: string; choiceGupshup: string; title: string; intro: string; signup: string; guide: string; steps: string[]; appName: string; apiKey: string; pathToken: string; callback: string } };
      calendar: { title: string; intro: string; steps: string[]; shareAddress: string; noAddress: string; id: string; json: string; jsonHelp: string; /** B72: the shop's own booking list (default) and the choice to also use Google Calendar. */ useOwn: string; useGoogle: string };
    };
    checks: {
      saveFirst: string; saveButton: string; saved: string; runButton: string; waiting: string; settingsOk: string; handCheck: string; handNotRun: string;
      deploy: string; deployApplied(at: string): string; deployNot: string; limitsProven(proven: number, of: number): string; limitsNot: string;
      guardNotSet: string; readOnly: string;
      /** `gupshupConfirmed` and `gupshupNotFound`: a shop on Gupshup, whose check is Gupshup's app read: it confirms the app, never the number (checks.ts checkGupshup). */
      whatsapp: { title: string; confirmed(number: string): string; differs(ending: string): string; notFound: string; gupshupConfirmed(appId: string): string; selfServeConfirmed(appName: string, approved: number, listed: number): string; gupshupNotFound(said: string): string };
      calendar: { title: string; confirmed(name: string): string; differs: string; notFound: string; notWritable(role: string): string };
      generic: Record<Exclude<CheckCode, "confirmed" | "account_mismatch" | "wrong_mode" | "not_writable" | "not_found">, string>;
      guardWords(detail: string): string;
      bookingsExpected: string; readyButton: string; ready: string; notReady(n: number): string; certificate: string; switchOn: string;
    };
  };
  /**
   * The unfinished-work inbox (B31). `kinds` holds one sentence for each kind of obligation (modules/unfinished): it is given the case's id, the amount (already written as rupees),
   * the hours waited and a noun from `variants`, and uses the ones it needs. A kind with no sentence here is still listed, under `fallback`. The UPI module adds its kinds here.
   */
  inbox: {
    nav: string; title: string; intro: string; empty: string; count(n: number): string; asOf(at: string): string; notShared: string; since(at: string): string; failedKinds: string;
    kinds: Record<string, (id: string, amount: string, hours: number, variant: string) => string>;
    fallback(kind: string, id: string): string;
    variants: Record<string, string>;
    actions: Record<string, string>; actionNote: string;
    recover: { sent: string; refused: string };
    help: string;
  };
  /** Taking a shop's files out (B38): a copy of everything that is the shop's, in plain files, that works even when the plan has lapsed. */
  takeOut: { heading: string; text: string; button: string; notIn: string; check: string };
  /** Moving a shop to another partner or builder (B38), with the owner's agreement from their own phone. */
  handover: {
    heading: string; button: string; intro: string; moves: string; stays: string; never: string;
    who: string; whoHelp: string; why: string; reasons: Record<"stopped_paying" | "stopped_serving" | "owner_request", string>; start: string;
    askTitle: string; ask(code: string): string; askNote: string; waiting(to: string): string; check: string; cancel: string; done(to: string): string; expired: string; cancelled: string;
    problems: Record<"who" | "same" | "geometer" | "reason" | "waiting", string>;
    history: string; historyLine(from: string, to: string, at: string, why: string): string;
  };
  errors: { notFound: string; notAllowed: string; csrf: string; tooBig: string; wrongMethod: string; tryAgain: string };
  /** UPI as the way customers pay (B33): the setup choice, its refusals in plain words, and the cost note. The inbox sentences for UPI are under `inbox.kinds`. */
  upi: {
    setup: { heading: string; intro: string; optionUpi: string; upiTitle: string; upiIntro: string; upiId: string; upiIdHelp: string; payee: string; payeeHelp: string; noCheck: string };
    problems: { idEmpty: string; idNoAt(id: string): string; idShape(id: string): string; payeeEmpty: string; payeeOneLine: string; payeeLong: string };
    noGatewayFee: string;
  };
}

/**
 * A price from the list in force, in whole rupees as a sample sentence shows it ("₹299"). Prices are written only in prices/<date>.json, so the samples read
 * them too: a new list changes the review sheet's sentence, and the sheet's test says when it is behind (node bundle/panel/review-sheet.ts).
 */
const listRupees = (id: string): string => `₹${(latestPriceList().rates[id].micro! / 1_000_000).toLocaleString("en-IN")}`;

/** Sample arguments for the functions in a Words set, so the review sheet can show one real sentence per line. */
export const SAMPLE_ARGS: Record<string, unknown[]> = {
  "login.wait": [30], "join.title": ["partner"], "shops.version": ["bookings@0.1.0"], "shops.limits": [9, 9], "shops.setUpBy": ["Divya"],
  "shop.versions": ["0.1.0", "0.1.0"], "shop.hoursRange": ["10:00", "20:00"], "shop.lastDeploy": ["4 Nov 2026, 10:30"], "shop.unprovable": ["refund-limit"], "shop.backupCopy": ["4 Nov 2026, 10:30"], "shop.backupDrill": ["4 Nov 2026, 04:00", true],
  "shop.summaryDeposit": ["₹200", 15], "shop.summaryCancel": [24, "₹200"], "shop.waiting": [2], "shop.needBuilder": [1], "shop.approvalsLine": [3, 2, 1],
  "shop.makeReport": ["2026-11"], "shop.stopTitle": ["Glow Salon"], "shop.stopAsked": ["4 Nov 2026, 10:30"], "shop.detailsPrices": ["2026-11-03"],
  "cost.fromRecord": [38], "cost.assumption": [40], "cost.subtotal": [3], "cost.priceList": ["2026-11-03"],
  "plan.is": ["Business"], "plan.included": [3000],
  // Getters: the list is read when a sample is used (the review sheet, the words test), not whenever the panel loads its words.
  get "plan.price"() { return [listRupees("plan.business.fee")]; }, get "plan.priceBuilder"() { return [listRupees("licence.builder.fee")]; },
  "licence.paidThrough": ["8 Dec 2026"], "licence.windDownOn": ["7 Jan 2027"], "licence.extended": ["21 Dec 2026"], "licence.stopOn": ["6 Feb 2027"], "licence.exportUntil": ["7 May 2027"], "licence.stale": ["5 Dec 2026"], "licence.trial": ["10 Dec 2026"],
  "setup.character.faceLabel": [3, 8], "setup.character.colourLabel": [3],
  "setup.progress": [2, 5], "setup.fallback": ["The deposit is more than the cheapest service."],
  "setup.limits.deposit": ["₹200", 15], "setup.limits.refund": [24, "₹200"],
  "feesShop.studentsIn": [12], "feesShop.messages.ceiling": [40, 4, 200], "feesShop.messages.included": [3000],
  "setup.fees.problems.batchNameEmpty": [2], "setup.fees.problems.feeBad": [2], "setup.fees.problems.studentBad": [3], "setup.fees.problems.studentNumber": [3], "setup.fees.problems.studentBatch": [3, "Class 11"],
  "setup.fees.problems.tooMany": [300], "setup.fees.problems.lateBad": ["₹1,200"], "setup.fees.problems.partBad": ["₹1,200"], "setup.fees.problems.waiverBad": ["₹1,200"],
  "ordersShop.perDay": [12], "ordersShop.messages.ceiling": [8, 3, 744], "ordersShop.messages.included": [3000],
  "setup.orders.problems.itemBad": [2], "setup.orders.problems.priceBad": [2], "setup.orders.problems.stockBad": [2], "setup.orders.problems.itemTwice": [3, "Veg thali"], "setup.orders.problems.tooManyItems": [30],
  "setup.orders.problems.pickupBad": [2], "setup.orders.problems.deliveryBad": [2], "setup.orders.problems.tooManySlots": [8], "setup.orders.problems.orderTooBig": ["₹12,000", "₹50,000"],
  "setup.problems.priceBad": [2], "setup.problems.depositTooBig": ["₹500", "₹450"], "setup.problems.serviceNameEmpty": [2], "setup.problems.secretMissing": ["the access token"], "setup.problems.secretShape": ["the access token"],
  "setup.accounts.received": ["4 Nov 2026, 10:30"],
  "setup.checks.deployApplied": ["4 Nov 2026, 10:30"], "setup.checks.limitsProven": [9, 9], "setup.checks.guardWords": ["the route is not listed"], "setup.checks.notReady": [2],
  "inbox.count": [3], "inbox.asOf": ["4 Nov 2026, 10:30"], "inbox.since": ["4 Nov 2026, 10:30"], "inbox.fallback": ["upi_unconfirmed", "b-3"],
  "inbox.kinds.deposit_no_booking": ["b-3", "₹200"], "inbox.kinds.payment_unrecorded": ["f-3"], "inbox.kinds.approval_waiting_long": ["b-3", "", 14, "[what]"],
  "inbox.kinds.refund_waiting": ["b-3", "₹200", 0, "[who]"], "inbox.kinds.refund_unknown": ["b-3"], "inbox.kinds.refund_failed": ["b-3"], "inbox.kinds.refund_made_not_told": ["b-3", "₹200", 0, "[how]"],
  "inbox.kinds.message_unanswered": ["#12"], "inbox.kinds.message_not_delivered": ["b-3"], "inbox.kinds.whatsapp_token_renewal": ["WhatsApp", "", 6], "inbox.kinds.whatsapp_token_credential": ["WhatsApp", "", 120], "inbox.kinds.upi_payment_unconfirmed": ["b-3", "₹200"], "inbox.kinds.upi_refund_owed": ["b-3", "₹200"], "upi.problems.idNoAt": ["glowsalon"], "upi.problems.idShape": ["glow salon@"],
  "handover.ask": ["K7M2QX"], "handover.waiting": ["Meera"], "handover.done": ["Meera"], "handover.historyLine": ["Divya", "Meera", "4 Nov 2026, 10:30", "[reason]"],
  "setup.checks.whatsapp.confirmed": ["+91 98765 43210"], "setup.checks.whatsapp.differs": ["3210"],
  "setup.checks.whatsapp.selfServeConfirmed": ["Glow_Salon", 4, 5], "setup.checks.whatsapp.gupshupConfirmed": ["07c7c72d-20e3-4ff9-a5a1-14d1186eeec8"], "setup.checks.whatsapp.gupshupNotFound": ["Invalid App Details"],
  "setup.checks.calendar.confirmed": ["Glow Salon bookings"], "setup.checks.calendar.notWritable": ["reader"],
};

const t1 = (n: number, one: string, many: string) => (n === 1 ? one : many);
/**
 * When the server's Gupshup universal token ends, from the whole hours it has left (lib/renewals.ts rounds down, and says 0 once it has ended): in days from a day
 * on, in hours under a day, and at 0 neither "in 0 days" nor "in 0 hours", which would be false. Each language has its own copy of this, in its own words.
 */
const credentialEnds = (hours: number) => hours >= 24 ? `ends in ${t1(Math.floor(hours / 24), "1 day", `${Math.floor(hours / 24)} days`)}. Hand in a new one before then`
  : hours >= 1 ? `ends in ${t1(hours, "1 hour", `${hours} hours`)}. Hand in a new one before then` : "has less than an hour left, or has ended. Hand in a new one now";

export const en: Words = {
  appName: "Geometer",
  languageName: "English",
  draftNote: "",
  nav: { shops: "Shops", setUp: "Set up a shop", invite: "Invite someone", signOut: "Sign out" },
  common: { back: "Back", next: "Next", save: "Save", counts: "Counts only. No message is shown here." },
  login: {
    title: "Sign in", handle: "Your sign-in name", passphrase: "Passphrase", button: "Sign in", wrong: "That name or passphrase is not right.",
    wait: (s) => `Too many tries. Wait ${s} seconds and try again.`, byInvitation: "Accounts are made by invitation. Ask the person who runs this server for your link.",
  },
  join: {
    title: (role) => `Create your ${role} account`, intro: "Your invitation works once. Choose how you sign in.", name: "Your name", company: "Company or business name (optional)", companyHelp: "Shop owners read this after your name in their monthly report. Leave it empty and they read \"local partner\" or \"builder\" instead. Up to 60 characters.", handle: "Name to sign in with", handleHelp: "3 to 40 letters, digits, dots or dashes.",
    passphrase: "Passphrase", passphraseHelp: "At least 10 characters. A few words in a row is easy to remember and hard to guess.", language: "Your language", button: "Create account",
    problems: {
      "invite-unknown": "This link is not one we made. Ask for a new one.", "invite-used": "This link was already used. Ask for a new one.", "invite-expired": "This link has run out. Ask for a new one.",
      "handle-bad": "Use 3 to 40 letters, digits, dots or dashes for the sign-in name.", "handle-taken": "That sign-in name is taken. Choose another.", "name-bad": "Write your name.", "company-bad": "Write the company name on one line, up to 60 characters, or leave it empty.",
      "language-bad": "Choose a language from the list.", short: "The passphrase needs at least 10 characters.", long: "The passphrase is too long (200 characters at most).",
      "same-as-handle": "The passphrase cannot be the same as your sign-in name.",
    },
  },
  roles: { builder: "builder", partner: "partner" },
  invite: { title: "Invite someone", role: "They will be a", note: "Who is it for?", button: "Make a link", made: "Here is the link. It works once and runs out in 3 days.", copy: "Send it only to that person.", hostedOnly: "On this server, invitations are made by whoever runs the server." },
  shops: {
    title: "Your shops", titleAll: "All shops on this server", empty: "No shops yet.", setUp: "Set up a shop", version: (v) => `Version ${v}`,
    limits: (p, o) => `${p} of ${o} limits proven`, limitsUnknown: "Limits: not confirmed yet", setUpBy: (n) => `Set up by ${n}`, setUpOnServer: "Set up on the server",
  },
  live: {
    unknown: "Not confirmed yet", "setting-up": "Being set up", live: "Live", attention: "Needs a look",
    stopping: "Stop requested. Waiting for the server to confirm.", stopped: "Stopped. Nothing more goes out.",
  },
  why: {
    "no-status": "The server has not reported on this shop yet.", "status-unreadable": "The server's report could not be read.", "status-old": "The server has not reported for a while.",
    "deploy-failed": "The last update did not go through.", "limits-not-proven": "Not every limit has been proven to hold yet.", "runtime-unreachable": "The agent does not answer.",
    "runtime-not-ready": "The agent says it is not ready.", "refunds-need-builder": "A refund needs the builder, not the owner.",
  },
  shop: {
    status: "Status", versions: (p, b) => `Template ${p}, bundle ${b}`, lastDeploy: (at) => `Last update: ${at}`, neverDeployed: "Not updated yet.",
    limitsHeading: "Limits", unprovable: (l) => `These cannot be tested on their own: ${l}`,
    backups: "Backups", backupCopy: (at) => `Last copy off the server: ${at}`, backupNone: "No copy off the server yet.", backupDrill: (at, ok) => `Last restore check: ${at}, ${ok ? "it matched" : "it did not match"}`, backupDrillNone: "No restore check yet.",
    settings: "What the agent knows about this shop", settingsEdit: "Change settings", summaryServices: "Services", summaryHours: "Open", hoursRange: (o, c) => `${o} to ${c}`, summaryClosed: "closed",
    summaryDeposit: (a, m) => `Deposit ${a}; the slot is held ${m} minutes while it is paid`,
    summaryCancel: (h, l) => `Deposit goes back if cancelled at least ${h} hours before; it asks you before refunding more than ${l}`, summaryLanguages: "Customer languages", summaryOwner: "Owner's WhatsApp",
    activity: "This month", activityNote: "Counts only. No message is shown here.", noRecord: "The record has not been shared with the panel yet, so only what is live right now is shown.",
    waiting: (n) => `${n} ${t1(n, "refund waits", "refunds wait")} for the owner`, needBuilder: (n) => `${n} ${t1(n, "refund needs", "refunds need")} the builder`,
    made: "Bookings made", cancelled: "Cancelled", moved: "Moved", deposits: "Deposits received", refunds: "Refunds given", saidNo: "Requests it said no to",
    approvals: "Owner approvals", approvalsLine: (a, ap, d) => `Asked ${a} ${t1(a, "time", "times")}: approved ${ap}, denied ${d}.`,
    bookingStates: {
      enquiry: "Asking", confirming_details: "Checking details", awaiting_deposit: "Waiting for the deposit", needs_owner: "Waiting for the owner", confirmed: "Booked", expired: "Hold ran out", cancelled: "Cancelled", completed: "Done",
    },
    feeStates: { open: "Fees still open", paid: "Fees paid", closed: "Fees closed by you" }, summaryFees: "Monthly fees", summaryRules: "Due dates and limits",
    papers: "Papers for the owner", goLive: "Go-live certificate", goLiveNone: "Not made yet. It is made when the checks pass in setup.", monthly: "Monthly report", makeReport: (m) => `Make the report for ${m}`,
    reportNoRecord: "The record has not been shared with the panel yet, so a monthly report cannot be made.", reportMade: "The report is ready.",
    stop: "Stop this shop", stopTitle: (n) => `Stop ${n}?`, stopText: "This asks the server to stop the agent. Nothing more goes out once the server has stopped it. It can take a minute, and the server starts it again only when you ask.",
    stopConfirm: "Yes, stop it", stopAsked: (at) => `Stop requested at ${at}. Waiting for the server to confirm.`, stopOnly: "Only the server can say it has stopped.",
    details: "Show what we did ▸", detailsDeploy: "The server's last message", detailsPins: "Ids the checks confirmed", detailsPrices: (d) => `Price list of ${d}`, detailsNothing: "nothing yet", detailsStatusFile: "What the server reported",
  },
  feesShop: {
    studentsIn: (n) => `${n} ${t1(n, "student", "students")}`,
    activity: { opened: "Fees opened this month", paidInFull: "Paid in full", partlyPaid: "Part paid", stillOpen: "Still open", collected: "Collected", stillToCollect: "Still to collect", reminders: "Reminders sent" },
    messages: {
      heading: "Messages",
      ceiling: (students, most, total) => `Your rules allow at most ${total} reminders and receipts a month: ${students} ${t1(students, "student", "students")}, up to ${most} ${t1(most, "reminder", "reminders")} each, and a receipt.`,
      included: (n) => `Your plan includes ${n} messages a month.`,
      note: "Replies to parents' own messages come on top. This is a ceiling from your rules, not a bill.",
    },
  },
  ordersShop: {
    summaryMenu: "Menu and daily stock", summaryRules: "Cut-off times and limits", perDay: (n) => `${n} a day`, pickup: "Pickup", delivery: "Delivery", noDelivery: "No delivery",
    states: { enquiry: "Asking", awaiting_owner: "Waiting for the owner", awaiting_advance: "Waiting for the advance", confirmed: "Confirmed", expired: "Hold ran out", cancelled: "Cancelled", completed: "Done" },
    activity: { taken: "Orders taken", completed: "Done", cancelled: "Cancelled", holdsRanOut: "Holds that ran out", collected: "Advance received", toCollect: "Still to collect at pickup", pickup: "Pickup orders", delivery: "Delivery orders" },
    messages: {
      heading: "Messages",
      ceiling: (perDay, perOrder, total) => `Your rules allow up to ${perDay} orders a day. At about ${perOrder} messages for each order, plan for up to ${total} messages in a 31-day month.`,
      included: (n) => `Your plan includes ${n} messages a month.`,
      note: "Replies to customers' own messages come on top. This is a planning figure from your rules, not a bill.",
    },
  },
  cost: {
    heading: "What it costs to run, each month", early: "Early estimate: no real bookings are counted yet.", fromRecord: (n) => `Worked out from ${n} bookings in the record.`, assumption: (n) => `We assumed ${n} bookings a month.`,
    lines: { whatsapp: "WhatsApp messages (Meta's fee)", "whatsapp-provider": "WhatsApp provider's own fee", gateway: "{gateway}'s fee", geometer: "Geometer's plan", hosting: "Hosting share" },
    payer: {
      "builder-pays-whatsapp-provider": "paid by the builder or partner to their own WhatsApp provider", "shop-pays-gupshup-wallet": "an estimate, paid from the shop's own Gupshup wallet, not from Geometer's balance", "shop-pays-gateway": "paid by the shop to {gateway}",
      "builder-pays-geometer": "paid to Geometer by the builder or partner; the AI model is included",
      "builder-pays-licence": "paid to Geometer by the builder, once for each live client business; the AI key is the builder's own", hosting: "the server's cost, shared",
    },
    unknown: "unknown", total: "Total", subtotal: (n) => `Subtotal. ${n} ${t1(n, "item has", "items have")} no price yet, so this is not the whole cost.`, priceList: (d) => `Prices from the list of ${d}.`,
    caveats: {
      "assumed-exchange-rate": "Dollar and euro prices use an assumed rate (₹94 and ₹100). A real bill may differ.",
      "provider-not-chosen": "No WhatsApp provider is chosen yet, so its fee is unknown.",
      "provider-not-priced": "The price list has no price for this provider.",
      "fee-not-priced": "The price list has no price for Geometer's fee.",
      "hosting-not-measured": "The hosting share has not been measured yet.",
      "payment-link-fee-conflict": "{gateway}'s own pages disagree about the fee on payment links. The higher one (2%) is used.",
      "whatsapp-rate-second-hand": "The rupee rate for WhatsApp comes from a reseller's page, not Meta's. Check it on the first invoice.",
    },
  },
  plan: {
    heading: "Plan", none: "No plan is set for this shop yet.",
    names: { basic: "Basic", business: "Business", operations: "Operations" },
    is: (name) => `This shop is on the ${name} plan.`, included: (n) => `${n} customer messages a month are included.`,
    price: (price) => `Plan price: ${price} a month, before GST.`,
    priceBuilder: (price) => `Builder licence: ${price} a month for each live client business, whatever the plan, before GST.`, builderLicence: "Builder licence",
    priceNote: "A shop counts for a month when it was live on 15 or more days.", innovator: "Innovator",
    buttons: "AI is paused for this shop. Customers get button menus instead.",
    buttonsWhy: {
      overage_unfunded: "This shop has used more messages than its plan includes, and the recharge balance cannot cover more. Recharge to turn AI back on.",
      other: "Geometer asked for button menus for this shop.",
    },
    warn: {
      allowance_80: "80% of this month's included messages are used.",
      balance_80: "80% of the recharge balance is used. Recharge before it runs out.",
      whatsapp_unsettled: "Some WhatsApp charges are not paid from the balance yet. Recharge to settle them.",
      ai_cap: "This shop has used its AI allowance for the month. It keeps answering with rules and menus; the full AI comes back on the 1st.",
    },
  },
  licence: {
    heading: "Licence",
    states: { active: "Licence in order", reminder: "Licence payment due", warning: "Licence payment overdue", wind_down: "Paused: no new bookings or payment requests", stopped: "Stopped", none: "No licence yet: no new bookings or payment requests" },
    means: {
      active: "Nothing changes for customers.",
      reminder: "Nothing changes for customers yet.",
      warning: "Nothing changes for customers yet. If it stays unpaid, the shop takes no new bookings or payment requests.",
      wind_down: "Customers are told to contact the shop. Refunds, cancellations and what was already booked or paid still go through. Paying brings it back at once.",
      stopped: "Nothing more is sent from the shop. Open payment links are cancelled; the shop's own accounts and keys stay the shop's. Nothing is deleted. The owner was told the service has ended and can write to hello@geometer.dev to be connected with another local partner. Only you can download the shop's records.",
      none: "Geometer's lease does not cover this shop yet, so its Guards take no new work. Refunds, cancellations and reading what is there still go through. When the trial or a plan covers the shop, the lease lists it within a minute or two of its first deploy. If it does not, write to support. A person answers.",
    },
    paidThrough: (day) => `Next payment due: ${day}.`, windDownOn: (day) => `If it is not paid, new bookings pause on ${day}.`, extended: (day) => `Geometer's emergency extension covers it until ${day}.`,
    stopOn: (day) => `Final stop planned for ${day}.`, exportUntil: (day) => `You can download the shop's records until ${day}.`,
    renew: "Pay to renew", stale: (day) => `Licence not refreshed since ${day}. Check that this server reaches Geometer. Write to support. A person answers.`,
    trial: (day) => `Trial licence: the last day is ${day}. From the next day, new bookings pause until the shop is on a plan.`,
  },
  setup: {
    title: "Set up a shop", chooseTemplate: "What will it do?", templateNames: { bookings: "Bookings with a deposit", fees: "Fee collection for classes", orders: "Pre-orders with an advance" },
    templateElsewhere: "A builder sets this one up with the plugin. The phone setup does not have it yet.", start: "Start", progress: (n, o) => `Step ${n} of ${o}`,
    steps: { business: "The business", deposit: "Deposit and cancellation", languages: "Languages and your number", accounts: "Connect the shop's accounts", checks: "Checks", character: "The shop's assistant" },
    problemsTitle: "Please fix this:", fallback: (e) => `One thing needs fixing: ${e}`,
    character: {
      intro: "With the owner beside you, make the shop's assistant: a face, its colour, a name and how it talks. Customers see it on the shop's page. The owner sees its mood in their app and on WhatsApp.",
      styleLegend: "Style", stripLegend: "Pick a face", stripHelp: "Each face is drawn for this shop only. Roll for eight new ones.", faceLabel: (n, o) => `Face ${n} of ${o}`, roll: "Roll new faces",
      colourLegend: "Colour", auto: "Auto", autoLabel: "Auto: the style's own colour", colourLabel: (n) => `Colour ${n}`,
      moodsTitle: "Its five moods", moodsHelp: "The owner sees all five. Customers see only All well, Busy and Closed.",
      name: "Its name", nameHelp: "1 to 24 letters, in any language. For example Mithra or Golu.",
      personalityLegend: "How it talks", personalityHelp: "This changes only its greeting and the first and last words of the morning summary. Amounts, cards, approvals and limits stay the same.",
      personalities: { warm: "Warm", cheerful: "Cheerful", brief: "Brief" }, saysLabel: "It says:", chosenMark: "Picked",
      problems: { name: "Give the assistant a name: 1 to 24 letters, no digits.", style: "Pick one of the five styles.", face: "Pick a face from the row.", colour: "Pick one of the colours shown, or Auto.", personality: "Pick how it talks." },
      shopTitle: "The shop's assistant", shopNone: "This shop has no assistant yet. Make one in the setup's assistant step.", shopNotDrawn: "Its pictures are drawn on the server within a minute of saving.",
      profileTitle: "WhatsApp profile photo", profileHelp: "Put this picture on the shop's WhatsApp profile yourself, wherever the shop's number is managed: the WhatsApp Business app, Meta's WhatsApp Manager or Gupshup's dashboard. The panel can't set it for you yet.", download: "Download the picture (PNG)",
    },
    business: {
      name: demo.formName, services: demo.formServices, serviceName: demo.formServiceName, also: demo.formAlso, price: demo.formPrice, minutes: demo.formMinutes, opens: demo.formOpens, closes: demo.formCloses, openOn: demo.formDays,
      hint: "A service's price is also the lowest the agent will ever agree to.", dayNames: demo.dayNames,
    },
    depositStep: { amount: demo.formDeposit, window: "Cancel at least this many hours before", windowHint: "If a customer cancels at least this long before, the deposit goes back. Later than that, you decide.", whatThisMeans: "What this means for you" },
    limits: {
      price: "It can't go below your prices, and it asks you before any refund.",
      hours: "It never books outside your opening hours.",
      deposit: (a, m) => `The deposit is ${a}, never more than your cheapest price, and the slot is held ${m} minutes while it is paid.`,
      refund: (h, l) => `A customer who cancels at least ${h} hours before gets the deposit back; anything later, or any refund above ${l}, waits for your OK on WhatsApp.`,
      booked: "When it says booked, the slot is in your calendar and the deposit is in your account.",
      language: "Your customers are answered in their language, with the right price and date.",
      charge: "You stay in charge from your phone.",
    },
    fees: {
      steps: { business: "The centre and its fees", rules: "Due dates, late fee and limits" },
      business: {
        name: "The centre's name", address: "Address (optional)", batches: "Batches or classes", batchesHint: "One row for each batch. The fee is for one month, in whole rupees.",
        batchName: "Name of the batch", batchFee: "Monthly fee (₹)", students: "Students",
        studentsHelp: "One student on each line: the student's name, the parent's WhatsApp number, then the batch's name. For example: Rohan Mehta, 98765 43210, Class 10",
      },
      rules: {
        dueDay: "Day of the month the fee is due (1 to 28)", graceDays: "Grace days before a late fee", lateFee: "Late fee in rupees (0 for none)",
        reminderDays: "Reminder days from the due day", reminderDaysHelp: "Separate them with commas. A minus means before the due day: -3, 0, 5 is three days before, on the day, and five days after.",
        reminderHour: "Hour of the day reminders go (6 to 21)", reminderMost: "Most reminders for one fee in a month", partAllowed: "A parent may pay part of a fee", partMin: "The least a first part payment may be (₹)",
        waiver: "Most the agent may take off a student's month by itself (₹, 0 for none)", waiverHelp: "More than this always comes to you first.",
        refund: "Most the agent may refund by itself (₹)", refundHelp: "A refund above this waits for your OK on WhatsApp.",
      },
      problems: {
        noBatch: "Add at least one batch, with a name and a monthly fee.", batchNameEmpty: (n) => `Batch ${n} has no name.`, feeBad: (n) => `Batch ${n}: write the monthly fee as a whole number of rupees, like 1500.`,
        noStudents: "Add at least one student.", studentBad: (n) => `Line ${n}: write the student's name, the parent's number and the batch, with commas between them.`,
        studentNumber: (n) => `Line ${n}: that parent's WhatsApp number is not one we can message. Write it like 98765 43210.`, studentBatch: (n, b) => `Line ${n}: there is no batch called "${b}" above.`,
        tooMany: (max) => `That is more than ${max} students. Ask the person who runs the server how to add more.`,
        dueBad: "The due day must be a whole number from 1 to 28.", graceBad: "Grace days must be a whole number from 0 to 30.", lateBad: (max) => `The late fee must be a whole number of rupees, from 0 to ${max} (the cheapest monthly fee).`,
        daysBad: "Write the reminder days as whole numbers separated by commas, each between -14 and 60, like -3, 0, 5.", hourBad: "The reminder hour must be a whole number from 6 to 21.",
        mostBad: "The most reminders must be a whole number from 1 to 12.", partBad: (max) => `The least part payment must be a whole number of rupees from 1 to ${max} (the cheapest monthly fee).`,
        waiverBad: (max) => `The waiver limit must be a whole number of rupees from 0 to ${max} (the cheapest monthly fee).`, refundBad: "The refund limit must be a whole number of rupees, 0 or more.",
      },
    },
    orders: {
      steps: { business: "The shop and its menu", rules: "Cut-off, slots and limits" },
      business: {
        name: "The shop's name", address: "Address (optional)", menu: "Menu",
        menuHelp: "One item on each line: its name, its price in rupees, and the most you make in a day. For example: Veg thali, 120, 12",
      },
      rules: {
        cutoffDays: "Orders close this many days before (0 is the same day)", cutoffTime: "Closing time", cutoffHelp: "In 24-hour time, like 20:00.",
        pickup: "Pickup slots", slotsHelp: "One slot on each line: the times, then a name if you like. For example: 12:00-13:00, lunch",
        delivery: "Delivery slots (leave empty if you do not deliver)", deliveryHelp: "The same way, for example: 12:30-13:30, lunch",
        area: "Places you deliver to", areaHelp: "Separate them with commas. An address that names none of them is not delivered to.",
        advance: "What the customer pays to confirm", advancePart: "A part of the order", advanceFull: "All of the order", percent: "Part to pay (%)", hold: "Minutes an order is held for the advance",
        perDay: "Most orders for one day", perOrder: "Most items in one order", daysAhead: "How many days ahead an order may be (0 is today only)", window: "Cancel at least this many hours before the slot to get the advance back",
        refund: "Most the agent may refund by itself (₹)", refundHelp: "A refund above this waits for your OK on WhatsApp.",
        approveOver: "Orders above this total wait for your OK (₹, 0 for never)", approveHelp: "Such an order comes to you first, and the customer is asked to pay only after your OK.",
      },
      problems: {
        noItems: "Add at least one item to the menu.", itemBad: (n) => `Line ${n}: write the name, the price and the daily stock with commas between them, like Veg thali, 120, 12.`,
        priceBad: (n) => `Line ${n}: write the price as a whole number of rupees, from 1, like 120.`, stockBad: (n) => `Line ${n}: write the most you make in a day as a whole number, from 1, like 12.`,
        itemTwice: (n, name) => `Line ${n}: "${name}" is already on the menu above.`, tooManyItems: (max) => `That is more than ${max} items. Write to support. A person answers.`,
        cutoffDaysBad: "Write how many days before orders close as a whole number from 0 to 7.", cutoffTimeBad: "Write the closing time in 24-hour time, like 20:00.",
        noPickup: "Add at least one pickup slot.", pickupBad: (n) => `Pickup slot ${n}: write the times like 12:00-13:00, then a name if you like. It must end after it starts.`,
        deliveryBad: (n) => `Delivery slot ${n}: write the times like 12:30-13:30, then a name if you like. It must end after it starts.`, tooManySlots: (max) => `That is more than ${max} slots in one list.`,
        deliveryNeedsArea: "You have delivery slots but no places. Write where you deliver, or empty the delivery slots.", areaNeedsSlots: "You have places but no delivery slot. Add a delivery slot, or empty the places.",
        percentBad: "The part to pay must be a whole number from 1 to 99. To take all of the order, choose \"All of the order\".", holdBad: "The minutes an order is held must be a whole number from 5 to 1440.",
        perDayBad: "The most orders for one day must be a whole number from 1 to 10000.", perOrderBad: "The most items in one order must be a whole number from 1 to 100.",
        daysAheadBad: "How many days ahead must be a whole number from 0 to 60.", windowBad: "The cancellation hours must be a whole number from 0 to 336.",
        refundBad: "The refund limit must be a whole number of rupees, 0 or more.", approveBad: "The order total for your OK must be a whole number of rupees, 0 or more.",
        orderTooBig: (total, cap) => `One order could come to ${total} (the most items, all of your dearest item), which is more than the ${cap} that can be refunded in a day. Lower the most items in one order, or the price.`,
      },
    },
    languagesStep: {
      main: "Main language of your customers", also: "Also tick any others your customers write in", hint: "The agent starts in the main language and answers each customer in the one they write in.", ownerLanguage: "Your language for messages to you",
      ownerNumber: "Your own WhatsApp number", ownerNumberHelp: "Start with the country code, for example +91 98765 43210. The agent asks you here before any refund. It is your own number, not the shop's number that customers write to.",
      approversTitle: "Others who approve refunds (optional)", approversHelp: "A manager or a partner can approve refunds too, each from their own phone with their own code. When you ask for a refund yourself, one of them approves it, never you.",
      approverNumber: (n) => `Person ${n}: their WhatsApp number`, approverLanguage: "Their language",
      twoAbove: "Above this amount, two people must approve (₹, optional)", twoAboveHelp: "For example 5000. Up to it, one approval is enough. Any one person saying no stops the refund. Leave it empty for one approval at every amount.",
    },
    problems: {
      nameEmpty: "Write the shop's name.", noService: "Add at least one service with a price.", priceBad: (n) => `Service ${n}: write the price in whole rupees, for example 450.`, depositBad: "Write the deposit in whole rupees, for example 200.",
      depositTooBig: (d, c) => `The deposit (${d}) is more than your cheapest service (${c}). Make the deposit smaller.`, windowBad: "Write the hours as a whole number, for example 24.",
      hoursBad: "The shop must open before it closes. Write times like 10:00 and 20:00.", noDay: "Tick at least one day the shop is open.", noLanguage: "Tick at least one language.",
      ownerNumberBad: "Write your number with the country code, for example +91 98765 43210.", sameNumber: "Your number and the shop's WhatsApp number must be different. You answer from your own phone.",
      serviceNameEmpty: (n) => `Service ${n} has a price but no name.`,
      approverNumberBad: (n) => `Person ${n}: write their number with the country code, for example +91 98765 43210.`,
      approverNumberTaken: (n) => `Person ${n}: that number is already yours, the shop's or another person's. Each person answers from their own phone.`,
      twoAboveBad: "Write the two-person amount in whole rupees, for example 5000, or leave it empty.", twoAboveAlone: "Two people can only approve if you add at least one other person.",
      expectedBad: "Write the bookings a month as a whole number, for example 40, or leave it empty.", appNameBad: "The Gupshup app name is letters, digits and underscores, as Gupshup shows it (for example Glow_Salon).", numberIdBad: "The phone number ID is digits only (6 to 20 of them).", businessNumberBad: "Write the shop's WhatsApp number with the country code.",
      secretMissing: (w) => `Fill in ${w}.`, secretShape: (w) => `${w} has spaces or line breaks in it. Copy it again, without them.`,
      calendarIdBad: "Write the calendar's ID without spaces.", jsonBad: "That is not a Google service-account key file. Paste the whole file.", modeBad: "Choose live or practice.",
    },
    accounts: {
      intro: "Each account is the shop's own. Keys go to the server's key store, are never shown again, and are not kept in this panel.",
      received: (at) => `Received ${at}.`, keepEmpty: "Leave empty to keep it.", neverShown: "It is not shown again after you save.",
      whatsapp: {
        title: "WhatsApp", intro: "The shop keeps its own number and its WhatsApp Business app. Customers write to the same number as before.",
        steps: ["Keep using the WhatsApp Business app on the shop's phone, with the shop's number.", "Whoever connected the number to the helper gives you three things: the phone number ID, an access token and the app secret.", "Type them below."],
        number: "The shop's WhatsApp number", numberId: "Phone number ID", token: "Access token", appSecret: "App secret",
        selfServe: {
          choiceMeta: "Meta direct (the shop's own Meta app)", choiceGupshup: "Gupshup (the shop's own account)", title: "Gupshup (the shop's own account)",
          intro: "The shop signs up at Gupshup itself and keeps the account. The shop's own Gupshup wallet pays Meta's charges and Gupshup's fee; Geometer never holds that money.",
          signup: "Sign up at Gupshup", guide: "How to find the app name and API key",
          steps: ["The shop signs up at Gupshup and makes a WhatsApp app for its number.", "Add the partner as an admin of the Gupshup account.", "In the app, add our message templates and wait until Gupshup shows them as approved.", "Copy the app's name and API key from the Gupshup dashboard and type them below, with a secret word of your own for the callback address.", "In the app's Webhooks tab, add the address shown below, ending with that secret word."],
          appName: "Gupshup app name", apiKey: "Gupshup API key", pathToken: "Secret word for the callback address (16 or more letters, digits, _ or -)",
          callback: "Add this address in the Gupshup app's Webhooks tab, with your secret word in place of SECRET-WORD:",
        },
      },
      calendar: {
        title: "Calendar", intro: "Bookings go into the shop's own Google Calendar.",
        steps: ["Open Google Calendar on a computer, and open the calendar's settings.", "Under “Share with specific people”, add the address below and choose “Make changes to events”.", "Under “Integrate calendar”, copy the Calendar ID and type it below."],
        shareAddress: "Share the calendar with this address:", noAddress: "This server has no shared address. Paste the key file your builder gave you, below.", id: "Calendar ID", json: "Service-account key file", jsonHelp: "Only if your builder gave you one. Paste the whole file.", useOwn: "Keep the bookings in the shop's own list (no Google Calendar needed). The owner sends “today” on WhatsApp to see the day's bookings. A Google Calendar can be added later.", useGoogle: "Also use the shop's Google Calendar",
      },
    },
    checks: {
      saveFirst: "Save this shop to the server first.", saveButton: "Save and connect", saved: "Saved. The server will apply it, and this page shows when it has.", runButton: "Run the checks", waiting: "Waiting for the server to apply the shop.",
      settingsOk: "The settings are complete.", handCheck: "The tests on this shop's own prices and hours", handNotRun: "Not run yet.",
      deploy: "The server's update", deployApplied: (at) => `Applied ${at}.`, deployNot: "Not applied yet.", limitsProven: (p, o) => `${p} of ${o} limits proven to hold on the running agent.`, limitsNot: "Limits not proven yet.",
      guardNotSet: "This server has not told the panel where to check the accounts yet, so they cannot be checked here.",
      readOnly: "Checks only read. They never send a message, take a payment or make a booking, so sending and payments are not tested here.",
      whatsapp: {
        title: "WhatsApp", confirmed: (n) => `This is the shop's number (${n}).`, differs: (e) => `The number found ends in ${e}, not the shop's. Nothing was changed.`,
        notFound: "That phone number ID is not on this account.",
        selfServeConfirmed: (name, approved, listed) => `Gupshup answered for app ${name}: the key and the app name go together, and ${approved} of the ${listed} ${t1(listed, "template", "templates")} listed ${t1(approved, "is", "are")} approved. This check does not show which number the app sends from, and it sends nothing.`,
        gupshupConfirmed: (id) => `Gupshup answered for app ${id}. This check does not show which number the app sends from.`,
        gupshupNotFound: (said) => (said ? `Gupshup did not accept that app with this token (it said: ${said}).` : "Gupshup did not accept that app with this token."),
      },
      calendar: {
        title: "Calendar", confirmed: (n) => `Found “${n}”, and it can be changed.`, differs: "Google shows a different calendar from the one given. Nothing was changed.",
        notFound: "Not found. Check the ID, and that it is shared with the address above.", notWritable: (r) => `It is shared, but not with “Make changes to events” (it says ${r}).`,
      },
      generic: {
        not_allowed: "The account did not accept the check. Check the keys.", refused_by_guard: "The server's Guard did not let this check through.", unreachable: "Could not reach it. Try again in a minute.",
        rate_limited: "Too many checks just now. Try again in a minute.",
        unexpected_response: "The answer was not what this service gives, so it was not used.", not_configured: "Fill in the details above first.",
      },
      guardWords: (d) => `Guard said: ${d}`,
      bookingsExpected: "Bookings you expect each month (only used for the cost)", readyButton: "Ready to go live", ready: "Ready to go live. The go-live certificate is made.",
      notReady: (n) => `Not ready yet: ${n} ${t1(n, "thing needs", "things need")} fixing.`, certificate: "Open the go-live certificate", switchOn: "The server switches the shop on when it applies it.",
    },
  },
  inbox: {
    nav: "To do", title: "Unfinished work", intro: "Real jobs that need a person. Each line is worked out from the shop's record; nothing is added by hand.", empty: "Nothing needs a person right now.",
    count: (n) => `${n} to do`, asOf: (at) => `Read from the record of ${at}.`, notShared: "This shop's record has not been shared yet, so there is nothing to read.", since: (at) => `Since ${at}`,
    failedKinds: "One of the checks could not be read for this shop, so this list may be short.",
    kinds: {
      deposit_no_booking: (id, amount) => `Deposit of ${amount} received, booking ${id} is missing: review recovery`,
      payment_unrecorded: (id) => `A payment came for fee ${id} but the fee was not updated: check the payment again`,
      approval_waiting_long: (id, _amount, hours, what) => `Waiting ${hours} hours for the owner's answer on ${id} (${what}): ask again`,
      refund_waiting: (id, amount, _hours, who) => `The refund of ${amount} for ${id} is waiting ${who}`,
      refund_unknown: (id) => `Refund for ${id}: not sure it went through. Check it in {gateway}`,
      refund_failed: (id) => `The refund for ${id} did not go through: review it`,
      // 12 Nov 2026: the provider's list settled a refund whose outcome was unknown, and the customer's "it is confirmed" message was not accepted (yet)
      refund_made_not_told: (id, amount, _hours, how) => `Refund of ${amount} for ${id} is made, and the customer has not been told yet: ${how}`,
      message_unanswered: (id) => `Work for ${id} was not finished while a service's connection was down: check it and answer the customer`,
      // follow-up 2: the shop's Gupshup token (not a case: `id` is "WhatsApp"); `hours` is how long the token in use, or the server's universal token, has left
      whatsapp_token_renewal: (_id, _amount, hours) => `WhatsApp through Gupshup: this shop's token could not be renewed. The one in use ends in ${hours} hours, and then no message goes out. Check the server (geometer logs refresher) or hand in a new Gupshup universal token.`,
      whatsapp_token_credential: (_id, _amount, hours) => `WhatsApp through Gupshup: the server's Gupshup universal token ${credentialEnds(hours)} (geometer gupshup-token <file>).`,
      message_not_delivered: (id) => `A WhatsApp message for ${id} never reached the phone (WhatsApp reported it failed): reach the person another way`,
      upi_payment_unconfirmed: (id, amount) => `UPI payment of ${amount} for ${id} is not yet confirmed by the owner: ask the owner to check their UPI app`,
      upi_refund_owed: (id, amount) => `Refund of ${amount} for ${id} is owed by the owner and not yet marked done: remind the owner`,
    },
    fallback: (kind, id) => `${id} needs a person (${kind})`,
    variants: { guard_hold: "a refund", refund: "a refund", waiver: "a fee waiver", refund_request: "a refund request", calendar: "a calendar problem", owner: "for the owner's answer", agent: "to be sent again", big_order: "a big order", tell_retry: "the agent tries again by itself", tell_person: "tell them yourself" },
    actions: { recheck_payment: "Check the payment again", retry_booking: "Try to confirm the booking again", ask_owner_again: "Ask the owner again", recheck_refund: "Check the refund again" },
    actionNote: "These only look again or ask again. They go through Guard and the same limits as everything else.",
    recover: { sent: "Asked. The shop's agent will do it within a minute or two. The list changes after the next record update, which can take a quarter of an hour.", refused: "That does not fit this item, so nothing was sent." },
    help: "Write to support. A person answers.",
  },
  takeOut: {
    heading: "Take everything with you", text: "A copy of this shop's settings, limits, record, reports and certificates, as plain files that open without Geometer. It works even when the plan has lapsed.",
    button: "Download the export", notIn: "No key or secret is in it, and the shop's own WhatsApp, payment and calendar accounts stay the shop's. In the record, customers' numbers are codes only this shop's key can match; the settings file lists the shop's own people as written.", check: "To check the files, use the README inside.",
  },
  handover: {
    heading: "Move this shop to someone else", button: "Move this shop…",
    intro: "Give the running of this shop to another partner or builder on this server. The shop owner has to agree first, from their own phone.",
    moves: "What moves: who can see and change this shop here, and the name on the owner's monthly report.",
    stays: "What stays: the shop's own WhatsApp number, payment account and calendar do not move. Keys are not carried across: whoever serves the shop next enters them again.",
    never: "A shop can go to another partner or builder. It cannot go to Geometer.",
    who: "Their sign-in name", whoHelp: "The name they sign in to this panel with.", why: "Why is it moving?",
    reasons: { stopped_paying: "They stopped paying", stopped_serving: "They stopped serving the shop", owner_request: "The owner asked for it" },
    start: "Ask the owner to agree", askTitle: "Now the owner has to agree",
    ask: (code) => `Ask the owner to send this one message, from their own phone, to the shop's WhatsApp number: move ${code}`,
    askNote: "The code works once and runs out in 72 hours. It is shown only now. The shop must be running to receive it.",
    waiting: (to) => `Waiting for the owner. When the message arrives, ${to} takes over. This can take a quarter of an hour after the message.`, check: "Check again", cancel: "Cancel the move", done: (to) => `Done. ${to} now serves this shop.`,
    expired: "The code ran out before the owner replied. Start again.", cancelled: "The move was cancelled.",
    problems: { who: "Nobody signs in with that name on this server.", same: "That person already serves this shop.", geometer: "A shop cannot be moved to Geometer.", reason: "Choose why the shop is moving.", waiting: "A move is already waiting for the owner. Cancel it first to start another." },
    history: "Who has served this shop", historyLine: (from, to, at, why) => `${from} to ${to}, ${at}: ${why}`,
  },
  errors: { notFound: "There is nothing here.", notAllowed: "You cannot do that.", csrf: "That form was too old or did not come from this page. Go back and try again.", tooBig: "That was too much to send.", wrongMethod: "That is not how this page works.", tryAgain: "Something went wrong. Try again." },
  upi: {
    setup: {
      heading: "How customers pay", intro: "Choose how customers pay the deposit or the fee. UPI is the simplest: no payment-gateway account to open.",
      optionUpi: "UPI: customers pay the shop's own UPI ID",
      upiTitle: "Pay by UPI", upiIntro: "Customers pay the shop's own UPI ID from their UPI app. The owner taps Received on WhatsApp when the money arrives. There is no gateway fee, and Geometer never touches the money.",
      upiId: "The shop's UPI ID", upiIdHelp: "For example glowsalon@okicici", payee: "The name customers see in their UPI app", payeeHelp: "For example Glow Salon",
      noCheck: "A UPI ID cannot be checked without paying it, so nothing is checked here. Type it slowly, then read it back to the owner.",
    },
    problems: {
      idEmpty: "Add the shop's UPI ID, for example glowsalon@okicici.",
      idNoAt: (id) => `"${id}" is not a UPI ID: it needs an @ and the app's or bank's name after it, for example glowsalon@okicici.`,
      idShape: (id) => `"${id}" is not a UPI ID. Check the spelling: letters, digits, dots, dashes or underscores before the @, and the app's or bank's name after it.`,
      payeeEmpty: "Add the name customers should see in their UPI app, for example Glow Salon.", payeeOneLine: "The name must be on one line.",
      payeeLong: "That name is too long. Use the short name the shop's UPI app shows.",
    },
    noGatewayFee: "No gateway fee: customers pay the shop's own UPI ID.",
  },
};
