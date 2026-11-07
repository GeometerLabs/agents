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
import type { Caveat, LineId, Payer } from "./cost.ts";

const demo = uiFor("en");

export type JoinProblem = "invite-unknown" | "invite-used" | "invite-expired" | "handle-bad" | "handle-taken" | "name-bad" | "language-bad" | "short" | "long" | "same-as-handle";

export interface Words {
  appName: string;
  languageName: string;
  draftNote: string;
  nav: { shops: string; setUp: string; invite: string; signOut: string };
  common: { back: string; next: string; save: string; counts: string };
  login: { title: string; handle: string; passphrase: string; button: string; wrong: string; wait(seconds: number): string; byInvitation: string };
  join: { title(role: string): string; intro: string; name: string; handle: string; handleHelp: string; passphrase: string; passphraseHelp: string; language: string; button: string; problems: Record<JoinProblem, string> };
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
    papers: string; goLive: string; goLiveNone: string; monthly: string; makeReport(month: string): string; reportNoRecord: string; reportMade: string;
    stop: string; stopTitle(name: string): string; stopText: string; stopConfirm: string; stopAsked(at: string): string; stopOnly: string;
    details: string; detailsDeploy: string; detailsPins: string; detailsPrices(date: string): string; detailsNothing: string; detailsStatusFile: string;
  };
  cost: {
    heading: string; early: string; fromRecord(n: number): string; assumption(n: number): string;
    lines: Record<LineId, string>; payer: Record<Payer, string>;
    unknown: string; total: string; subtotal(unknownItems: number): string; priceList(date: string): string;
    caveats: Record<Exclude<Caveat, "early-estimate">, string>;
  };
  /** The shop's plan (B48): what fleet says about it, with the proposed price. The warning codes are fleet's (apps/fleet/README.md, "What fleet tells each shop"). */
  plan: {
    heading: string; none: string; names: Record<PlanName, string>; is(name: string): string; included(n: number): string;
    price(price: string): string; priceInnovator(price: string, yours: string): string; proposedNote: string; innovator: string;
    buttons: string; buttonsWhy: Record<"overage_unfunded" | "other", string>;
    warn: Record<"allowance_80" | "balance_80" | "whatsapp_unsettled", string>;
  };
  setup: {
    title: string; chooseTemplate: string; templateNames: Record<string, string>; templateElsewhere: string; start: string; progress(n: number, of: number): string;
    steps: { business: string; deposit: string; languages: string; accounts: string; checks: string };
    problemsTitle: string; fallback(english: string): string;
    business: { name: string; services: string; serviceName: string; also: string; price: string; minutes: string; opens: string; closes: string; openOn: string; hint: string; dayNames: string[] };
    depositStep: { amount: string; window: string; windowHint: string; whatThisMeans: string };
    limits: {
      price: string; hours: string; deposit(amount: string, minutes: number): string; refund(hours: number, limit: string): string; booked: string; language: string; charge: string;
    };
    languagesStep: { main: string; also: string; hint: string; ownerLanguage: string; ownerNumber: string; ownerNumberHelp: string };
    problems: {
      nameEmpty: string; noService: string; priceBad(row: number): string; depositBad: string; depositTooBig(deposit: string, cheapest: string): string; windowBad: string;
      hoursBad: string; noDay: string; noLanguage: string; ownerNumberBad: string; sameNumber: string; serviceNameEmpty(row: number): string;
      expectedBad: string; numberIdBad: string; businessNumberBad: string; keyIdBad: string; secretMissing(what: string): string; secretShape(what: string): string; calendarIdBad: string; jsonBad: string; modeBad: string;
    };
    accounts: {
      intro: string; received(at: string): string; keepEmpty: string; neverShown: string;
      whatsapp: { title: string; intro: string; steps: string[]; number: string; numberId: string; token: string; appSecret: string };
      calendar: { title: string; intro: string; steps: string[]; shareAddress: string; noAddress: string; id: string; json: string; jsonHelp: string };
      razorpay: { title: string; intro: string; steps: string[]; mode: string; modeLive: string; modeTest: string; keyId: string; keySecret: string; webhookSecret: string; webhookUrl(url: string): string };
    };
    checks: {
      saveFirst: string; saveButton: string; saved: string; runButton: string; waiting: string; settingsOk: string; handCheck: string; handNotRun: string;
      deploy: string; deployApplied(at: string): string; deployNot: string; limitsProven(proven: number, of: number): string; limitsNot: string;
      guardNotSet: string; readOnly: string;
      whatsapp: { title: string; confirmed(number: string): string; differs(ending: string): string; notFound: string };
      razorpay: { title: string; confirmed(mode: string): string; differs: string; wrongMode: string };
      calendar: { title: string; confirmed(name: string): string; differs: string; notFound: string; notWritable(role: string): string };
      generic: Record<Exclude<CheckCode, "confirmed" | "account_mismatch" | "wrong_mode" | "not_writable" | "not_found">, string>;
      razorpayWhose: string; guardWords(detail: string): string;
      bookingsExpected: string; readyButton: string; ready: string; notReady(n: number): string; certificate: string; switchOn: string;
    };
  };
  errors: { notFound: string; notAllowed: string; csrf: string; tooBig: string; wrongMethod: string; tryAgain: string };
}

/** Sample arguments for the functions in a Words set, so the review sheet can show one real sentence per line. */
export const SAMPLE_ARGS: Record<string, unknown[]> = {
  "login.wait": [30], "join.title": ["partner"], "shops.version": ["bookings@0.1.0"], "shops.limits": [9, 9], "shops.setUpBy": ["Divya"],
  "shop.versions": ["0.1.0", "0.1.0"], "shop.hoursRange": ["10:00", "20:00"], "shop.lastDeploy": ["4 Nov 2026, 10:30"], "shop.unprovable": ["refund-limit"], "shop.backupCopy": ["4 Nov 2026, 10:30"], "shop.backupDrill": ["4 Nov 2026, 04:00", true],
  "shop.summaryDeposit": ["₹200", 15], "shop.summaryCancel": [24, "₹200"], "shop.waiting": [2], "shop.needBuilder": [1], "shop.approvalsLine": [3, 2, 1],
  "shop.makeReport": ["2026-11"], "shop.stopTitle": ["Glow Salon"], "shop.stopAsked": ["4 Nov 2026, 10:30"], "shop.detailsPrices": ["2026-11-03"],
  "cost.fromRecord": [38], "cost.assumption": [40], "cost.subtotal": [3], "cost.priceList": ["2026-11-03"],
  "plan.is": ["Business"], "plan.included": [3000], "plan.price": ["₹299"], "plan.priceInnovator": ["₹299", "₹179"],
  "setup.progress": [2, 5], "setup.fallback": ["The deposit is more than the cheapest service."],
  "setup.limits.deposit": ["₹200", 15], "setup.limits.refund": [24, "₹200"],
  "setup.problems.priceBad": [2], "setup.problems.depositTooBig": ["₹500", "₹450"], "setup.problems.serviceNameEmpty": [2], "setup.problems.secretMissing": ["the access token"], "setup.problems.secretShape": ["the access token"],
  "setup.accounts.received": ["4 Nov 2026, 10:30"], "setup.accounts.razorpay.webhookUrl": ["https://shops.example.com/hooks/glow-salon/razorpay"],
  "setup.checks.deployApplied": ["4 Nov 2026, 10:30"], "setup.checks.limitsProven": [9, 9], "setup.checks.guardWords": ["the route is not listed"], "setup.checks.notReady": [2],
  "setup.checks.whatsapp.confirmed": ["+91 98765 43210"], "setup.checks.whatsapp.differs": ["3210"],
  "setup.checks.razorpay.confirmed": ["Live"], "setup.checks.calendar.confirmed": ["Glow Salon bookings"], "setup.checks.calendar.notWritable": ["reader"],
};

const t1 = (n: number, one: string, many: string) => (n === 1 ? one : many);

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
    title: (role) => `Create your ${role} account`, intro: "Your invitation works once. Choose how you sign in.", name: "Your name", handle: "Name to sign in with", handleHelp: "3 to 40 letters, digits, dots or dashes.",
    passphrase: "Passphrase", passphraseHelp: "At least 10 characters. A few words in a row is easy to remember and hard to guess.", language: "Your language", button: "Create account",
    problems: {
      "invite-unknown": "This link is not one we made. Ask for a new one.", "invite-used": "This link was already used. Ask for a new one.", "invite-expired": "This link has run out. Ask for a new one.",
      "handle-bad": "Use 3 to 40 letters, digits, dots or dashes for the sign-in name.", "handle-taken": "That sign-in name is taken. Choose another.", "name-bad": "Write your name.",
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
    papers: "Papers for the owner", goLive: "Go-live certificate", goLiveNone: "Not made yet. It is made when the checks pass in setup.", monthly: "Monthly report", makeReport: (m) => `Make the report for ${m}`,
    reportNoRecord: "The record has not been shared with the panel yet, so a monthly report cannot be made.", reportMade: "The report is ready.",
    stop: "Stop this shop", stopTitle: (n) => `Stop ${n}?`, stopText: "This asks the server to stop the agent. Nothing more goes out once the server has stopped it. It can take a minute, and the server starts it again only when you ask.",
    stopConfirm: "Yes, stop it", stopAsked: (at) => `Stop requested at ${at}. Waiting for the server to confirm.`, stopOnly: "Only the server can say it has stopped.",
    details: "Show what we did ▸", detailsDeploy: "The server's last message", detailsPins: "Ids the checks confirmed", detailsPrices: (d) => `Price list of ${d}`, detailsNothing: "nothing yet", detailsStatusFile: "What the server reported",
  },
  cost: {
    heading: "What it costs to run, each month", early: "Early estimate: no real bookings are counted yet.", fromRecord: (n) => `Worked out from ${n} bookings in the record.`, assumption: (n) => `We assumed ${n} bookings a month.`,
    lines: { whatsapp: "WhatsApp messages (Meta's fee)", "whatsapp-provider": "WhatsApp provider's own fee", razorpay: "Razorpay's fee", geometer: "Geometer's fee (founding price)", hosting: "Hosting share" },
    payer: {
      "builder-pays-whatsapp-provider": "paid by the builder or partner to their own WhatsApp provider", "shop-pays-razorpay": "paid by the shop to Razorpay",
      "builder-pays-geometer": "paid to Geometer by the builder or partner; the AI model is included", hosting: "the server's cost, shared",
    },
    unknown: "unknown", total: "Total", subtotal: (n) => `Subtotal. ${n} ${t1(n, "item has", "items have")} no price yet, so this is not the whole cost.`, priceList: (d) => `Prices from the list of ${d}.`,
    caveats: {
      "assumed-exchange-rate": "Dollar and euro prices use an assumed rate (₹90 and ₹100). A real bill may differ.",
      "provider-not-chosen": "No WhatsApp provider is chosen yet, so its fee is unknown.",
      "provider-not-priced": "The price list has no price for this provider.",
      "fee-not-priced": "The price list has no price for Geometer's fee.",
      "hosting-not-measured": "The hosting share has not been measured yet.",
      "payment-link-fee-conflict": "Razorpay's own pages disagree about the fee on payment links. The higher one (2%) is used.",
      "whatsapp-rate-second-hand": "The rupee rate for WhatsApp comes from a reseller's page, not Meta's. Check it on the first invoice.",
    },
  },
  plan: {
    heading: "Plan", none: "No plan is set for this shop yet.",
    names: { basic: "Basic", business: "Business", operations: "Operations" },
    is: (name) => `This shop is on the ${name} plan.`, included: (n) => `${n} customer messages a month are included.`,
    price: (price) => `Proposed price: ${price} a month, before GST.`,
    priceInnovator: (price, yours) => `Proposed price: ${price} a month, ${yours} with the Innovator discount, before GST.`,
    proposedNote: "Prices are proposed and not final.", innovator: "Innovator",
    buttons: "AI is paused for this shop. Customers get button menus instead.",
    buttonsWhy: {
      overage_unfunded: "This shop has used more messages than its plan includes, and the recharge balance cannot cover more. Recharge to turn AI back on.",
      other: "Geometer asked for button menus for this shop.",
    },
    warn: {
      allowance_80: "80% of this month's included messages are used.",
      balance_80: "80% of the recharge balance is used. Recharge before it runs out.",
      whatsapp_unsettled: "Some WhatsApp charges are not paid from the balance yet. Recharge to settle them.",
    },
  },
  setup: {
    title: "Set up a shop", chooseTemplate: "What will it do?", templateNames: { bookings: "Bookings with a deposit" },
    templateElsewhere: "A builder sets this one up with the plugin. The phone setup does not have it yet.", start: "Start", progress: (n, o) => `Step ${n} of ${o}`,
    steps: { business: "The business", deposit: "Deposit and cancellation", languages: "Languages and your number", accounts: "Connect the shop's accounts", checks: "Checks" },
    problemsTitle: "Please fix this:", fallback: (e) => `One thing needs fixing: ${e}`,
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
    languagesStep: {
      main: "Main language of your customers", also: "Also tick any others your customers write in", hint: "The agent starts in the main language and answers each customer in the one they write in.", ownerLanguage: "Your language for messages to you",
      ownerNumber: "Your own WhatsApp number", ownerNumberHelp: "Start with the country code, for example +91 98765 43210. The agent asks you here before any refund. It is your own number, not the shop's number that customers write to.",
    },
    problems: {
      nameEmpty: "Write the shop's name.", noService: "Add at least one service with a price.", priceBad: (n) => `Service ${n}: write the price in whole rupees, for example 450.`, depositBad: "Write the deposit in whole rupees, for example 200.",
      depositTooBig: (d, c) => `The deposit (${d}) is more than your cheapest service (${c}). Make the deposit smaller.`, windowBad: "Write the hours as a whole number, for example 24.",
      hoursBad: "The shop must open before it closes. Write times like 10:00 and 20:00.", noDay: "Tick at least one day the shop is open.", noLanguage: "Tick at least one language.",
      ownerNumberBad: "Write your number with the country code, for example +91 98765 43210.", sameNumber: "Your number and the shop's WhatsApp number must be different. You answer from your own phone.",
      serviceNameEmpty: (n) => `Service ${n} has a price but no name.`,
      expectedBad: "Write the bookings a month as a whole number, for example 40, or leave it empty.", numberIdBad: "The phone number ID is digits only (6 to 20 of them).", businessNumberBad: "Write the shop's WhatsApp number with the country code.", keyIdBad: "The key ID starts with rzp_live_ or rzp_test_.",
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
      },
      calendar: {
        title: "Calendar", intro: "Bookings go into the shop's own Google Calendar.",
        steps: ["Open Google Calendar on a computer, and open the calendar's settings.", "Under “Share with specific people”, add the address below and choose “Make changes to events”.", "Under “Integrate calendar”, copy the Calendar ID and type it below."],
        shareAddress: "Share the calendar with this address:", noAddress: "This server has no shared address. Paste the key file your builder gave you, below.", id: "Calendar ID", json: "Service-account key file", jsonHelp: "Only if your builder gave you one. Paste the whole file.",
      },
      razorpay: {
        title: "Razorpay", intro: "Customers pay the deposit into the shop's own Razorpay account. The money goes straight to the shop's bank. Geometer never holds it.",
        steps: ["Sign in to the shop's own Razorpay account.", "Under Settings, API keys, make a key and copy the Key ID and the Key secret.", "Under Settings, Webhooks, add the web address shown below and choose a secret of your own. Type the same secret here."],
        mode: "Which key is this?", modeLive: "Live: real money", modeTest: "Practice: test money", keyId: "Key ID", keySecret: "Key secret", webhookSecret: "Webhook secret",
        webhookUrl: (u) => `Web address for the webhook: ${u}`,
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
      },
      razorpay: {
        title: "Razorpay", confirmed: (m) => `The key works (${m}).`, differs: "This is a different key from the one confirmed before. Nothing was changed.",
        wrongMode: "This key's mode is not the one chosen above. Use the key that matches.",
      },
      calendar: {
        title: "Calendar", confirmed: (n) => `Found “${n}”, and it can be changed.`, differs: "Google shows a different calendar from the one given. Nothing was changed.",
        notFound: "Not found. Check the ID, and that it is shared with the address above.", notWritable: (r) => `It is shared, but not with “Make changes to events” (it says ${r}).`,
      },
      generic: {
        not_allowed: "The account did not accept the check. Check the keys.", refused_by_guard: "The server's Guard did not let this check through.", unreachable: "Could not reach it. Try again in a minute.",
        unexpected_response: "The answer was not what this service gives, so it was not used.", not_configured: "Fill in the details above first.",
      },
      razorpayWhose: "Razorpay does not say whose account a key belongs to. Open the first test payment link and look: the shop's name must be on it.",
      guardWords: (d) => `Guard said: ${d}`,
      bookingsExpected: "Bookings you expect each month (only used for the cost)", readyButton: "Ready to go live", ready: "Ready to go live. The go-live certificate is made.",
      notReady: (n) => `Not ready yet: ${n} ${t1(n, "thing needs", "things need")} fixing.`, certificate: "Open the go-live certificate", switchOn: "The server switches the shop on when it applies it.",
    },
  },
  errors: { notFound: "There is nothing here.", notAllowed: "You cannot do that.", csrf: "That form was too old or did not come from this page. Go back and try again.", tooBig: "That was too much to send.", wrongMethod: "That is not how this page works.", tryAgain: "Something went wrong. Try again." },
};
