// The hosted demo for a template that has no page of its own for it (Orders, Fees): the REAL agent on the in-memory stand-ins (the template's own createWorld, a fake
// clock), driven from a small chat page that runs entirely in the visitor's browser. Nothing here talks to a network or keeps anything: every visit builds its own
// world in memory, so two visitors share nothing and a reload starts again. Test money only; the stand-in WhatsApp and payments never leave the page.
//
// Two halves in one file so a template needs only an adapter (templates/<x>/demo/quick.ts):
//   createQuick(shop)         the session: the chat of the customer and of the owner, taps, typing, paying the link with test money, time passing. No page code in
//                             it, so a test drives it without a browser.
//   mountQuick(element, ...)  the page: builds the DOM with textContent only (nothing a visitor types or the agent says is ever parsed as markup), no inline style or
//                             script, so it runs under the streetlist.in page rules (script-src 'self', style-src 'self').
// The Bookings demo (templates/commerce/bookings/demo/) is the richer one it grew from; it keeps its own page because its screens are bookings-shaped.
import { formatTime } from "../language/format.ts";
import { localParts } from "../core/time.ts";
import type { InteractiveMessage } from "../language/interactive.ts";
import type { Language } from "../language/languages.ts";
import { QUICK_LANGUAGE_NAMES, QUICK_WORDS } from "./quick-strings.ts";
import type { QuickWords } from "./quick-strings.ts";

export const MAX_MESSAGES = 200; // per world; the page then offers "Start again" (the world is in memory: it may not grow for ever)
export const MAX_ACTIONS = 600;
export const MAX_LENGTH = 300;
const TICK_MINUTES = 15; // time passes in steps: one big jump would skip the reminders the agent sends one tick at a time

/** What the demo needs of a template's `createWorld` result: the same shape in Bookings, Orders and Fees. */
export interface QuickWorld {
  clock: { now(): number };
  owner: string;
  messaging: { outbox(): { to: string; text: string; kind?: string; sentAt: number; interactive?: InteractiveMessage }[] };
  say(text: string, options?: { from?: string }): Promise<unknown>;
  tap(id: string, options?: { from?: string }): Promise<unknown>;
  advance(minutes: number): Promise<void>;
  deliverPaymentEvents(): Promise<void>;
}

/** One template's demo shop: its world, who the visitor plays, and the little that differs from template to template. */
export interface QuickShop {
  world: QuickWorld;
  shopName: string;
  language: Language;
  timezone: string;
  /** The number the visitor writes from (the customer, or the parent). */
  customer: string;
  /** What to call the visitor's tab, in the language; default the words' "Customer". */
  customerTab?: string;
  /** Sentences to tap instead of typing, in the language. */
  chips: string[];
  /** The payment link the visitor can pay with test money right now, or undefined. */
  payable(): { label: string } | undefined;
  /** Pay it (the stand-in provider's webhook then reaches the agent in `pay`). */
  payNow(): void;
}

export interface Bubble { who: "me" | "agent"; text: string; time: string; choices?: { buttons?: { id: string; title: string }[]; list?: { button: string; rows: { id: string; title: string; description?: string }[] } } }
export type Seat = "customer" | "owner";

export interface Quick {
  readonly shop: QuickShop;
  readonly words: QuickWords;
  readonly logs: Record<Seat, Bubble[]>;
  /** The newest message each seat could still tap an option of (an older one is dimmed, not removed, as in WhatsApp). */
  say(seat: Seat, text: string): Promise<string | undefined>;
  tap(seat: Seat, id: string): Promise<string | undefined>;
  pay(): Promise<string | undefined>;
  advance(minutes: number): Promise<string | undefined>;
  /** What the owner can tap instead of typing: a UPI shop's owner is told to reply "received <code>" once the money shows in their UPI app (the command word is the same in every language). */
  ownerChips(): string[];
  clock(): string;
}

export function createQuick(shop: QuickShop): Quick {
  const words = QUICK_WORDS[shop.language];
  const world = shop.world;
  const logs: Record<Seat, Bubble[]> = { customer: [], owner: [] };
  let seen = 0;
  let messages = 0;
  let actions = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const clockAt = (ms: number) => formatTime(localParts(ms, shop.timezone), shop.language);

  /** Copy what the agent has sent since last time into the right chat, in the order it was sent. */
  const collect = () => {
    const out = world.messaging.outbox();
    for (; seen < out.length; seen++) {
      const m = out[seen];
      const i = m.interactive;
      const bubble: Bubble = { who: "agent", text: i ? i.body : m.text, time: clockAt(m.sentAt), ...(i ? { choices: { ...(i.buttons ? { buttons: i.buttons } : {}), ...(i.list ? { list: i.list } : {}) } } : {}) };
      if (m.to === shop.customer) logs.customer.push(bubble);
      else if (m.to === world.owner) logs.owner.push(bubble);
    }
  };
  const settle = async () => { await world.deliverPaymentEvents(); collect(); };
  /** One action at a time: the agent has no locking, so two quick taps must not interleave at its await points. */
  const run = <T>(action: () => Promise<T>): Promise<T> => { const next = queue.then(action, action); queue = next.catch(() => undefined); return next; };
  const room = () => messages < MAX_MESSAGES && actions < MAX_ACTIONS;
  const optionFor = (seat: Seat, id: string) => {
    for (let n = logs[seat].length - 1; n >= 0; n--) {
      const c = logs[seat][n].choices;
      const found = [...(c?.buttons ?? []), ...(c?.list?.rows ?? [])].find((o) => o.id === id);
      if (found) return found;
    }
    return undefined;
  };
  const from = (seat: Seat) => (seat === "owner" ? world.owner : shop.customer);

  const quick: Quick = {
    shop, words, logs,
    say: (seat, text) => run(async () => {
      const t = text.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, MAX_LENGTH);
      if (t === "") return undefined;
      if (!room()) return words.full;
      messages++;
      logs[seat].push({ who: "me", text: t, time: clockAt(world.clock.now()) });
      await world.say(t, { from: from(seat) });
      await settle();
      return undefined;
    }),
    tap: (seat, id) => run(async () => {
      const option = optionFor(seat, id);
      if (!option) return undefined; // a stale or invented id: nothing on the screen offers it, so nothing happens
      if (!room()) return words.full;
      messages++;
      logs[seat].push({ who: "me", text: option.title, time: clockAt(world.clock.now()) }); // WhatsApp shows the chosen option's title as the sender's message
      await world.tap(id, { from: from(seat) });
      await settle();
      return undefined;
    }),
    pay: () => run(async () => {
      if (++actions > MAX_ACTIONS) return words.full;
      if (!shop.payable()) return undefined;
      shop.payNow();
      await settle();
      return undefined;
    }),
    advance: (minutes) => run(async () => {
      if (++actions > MAX_ACTIONS) return words.full;
      for (let left = minutes; left > 0; left -= TICK_MINUTES) await world.advance(Math.min(TICK_MINUTES, left));
      await settle();
      return undefined;
    }),
    ownerChips: () => {
      const asked = logs.owner.filter((b) => b.who === "agent").slice(-2).flatMap((b) => b.text.match(/\breceived [A-Z0-9]{4,8}\b/g) ?? []);
      return [...new Set(asked)].reverse();
    },
    clock: () => `${clockAt(world.clock.now())}`,
  };
  collect(); // anything the agent sent while the shop was being made (the Fees reminder that is due on the first morning)
  return quick;
}

// ---- the page ----------------------------------------------------------------------------------------------------------------------------

export interface MountOptions {
  /** A fresh shop (and so a fresh world) in this language: called at the start and on "Start again". */
  make(language: Language): Promise<QuickShop>;
  language: Language;
  /** The visitor chose another language in the page's own choice. */
  onLanguage(language: Language): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = doc.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export async function mountQuick(root: HTMLElement, options: MountOptions): Promise<void> {
  const doc = root.ownerDocument;
  let quick = await createQuickFor(options.language);
  let seat: Seat = "customer";
  let note: string | undefined;

  async function createQuickFor(language: Language): Promise<Quick> { return createQuick(await options.make(language)); }

  function draw(): void {
    const { words, shop } = quick;
    root.replaceChildren();
    root.lang = shop.language;
    root.className = "gq";

    const banner = el(doc, "p", "gq-banner", words.banner);
    banner.setAttribute("role", "note");
    const head = el(doc, "header", "gq-head");
    head.append(el(doc, "h1", "gq-name", shop.shopName));
    const choice = el(doc, "label", "gq-lang");
    choice.append(el(doc, "span", "gq-lang-label", words.language));
    const select = el(doc, "select", "gq-select");
    for (const l of Object.keys(QUICK_LANGUAGE_NAMES) as Language[]) {
      const o = el(doc, "option", "", QUICK_LANGUAGE_NAMES[l]);
      o.value = l;
      o.selected = l === shop.language;
      select.append(o);
    }
    select.addEventListener("change", () => options.onLanguage(select.value as Language));
    choice.append(select);
    head.append(choice);

    const tabs = el(doc, "div", "gq-tabs");
    tabs.setAttribute("role", "tablist");
    for (const s of ["customer", "owner"] as const) {
      const b = el(doc, "button", "gq-tab", s === "customer" ? shop.customerTab ?? words.customer : words.owner);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(seat === s));
      b.addEventListener("click", () => { seat = s; note = undefined; draw(); });
      tabs.append(b);
    }

    const log = el(doc, "div", "gq-log");
    log.setAttribute("role", "log");
    const bubbles = quick.logs[seat];
    if (bubbles.length === 0) log.append(el(doc, "p", "gq-empty", seat === "owner" ? words.ownerEmpty : words.chatEmpty));
    bubbles.forEach((b, n) => {
      const row = el(doc, "div", `gq-msg gq-msg--${b.who}`);
      row.append(el(doc, "p", "gq-text", b.text), el(doc, "time", "gq-time", b.time));
      if (b.choices) {
        const current = n === bubbles.reduceRight((found, x, i) => (found === -1 && x.choices ? i : found), -1); // only the newest options are live
        const opts = el(doc, "div", `gq-choices${current ? "" : " gq-choices--old"}`);
        const add = (id: string, title: string, description?: string, into: HTMLElement = opts) => {
          const c = el(doc, "button", "gq-choice", title);
          c.type = "button";
          if (description) c.append(el(doc, "span", "gq-choice-desc", description));
          c.addEventListener("click", () => act(() => quick.tap(seat, id)));
          into.append(c);
        };
        for (const x of b.choices.buttons ?? []) add(x.id, x.title);
        if (b.choices.list) {
          const details = el(doc, "details", "gq-list");
          details.append(el(doc, "summary", "gq-list-button", b.choices.list.button || words.choose));
          for (const r of b.choices.list.rows) add(r.id, r.title, r.description, details);
          opts.append(details);
        }
        row.append(opts);
      }
      log.append(row);
    });

    const bar = el(doc, "div", "gq-actions");
    const action = (label: string, run: () => Promise<string | undefined>, cls = "") => {
      const b = el(doc, "button", `gq-button ${cls}`.trim(), label);
      b.type = "button";
      b.addEventListener("click", () => act(run));
      bar.append(b);
    };
    const payable = seat === "customer" ? shop.payable() : undefined;
    if (payable) action(`${words.pay} · ${payable.label}`, () => quick.pay(), "gq-button--primary");
    action(words.time1h, () => quick.advance(60));
    action(words.time1d, () => quick.advance(1440));
    const reset = el(doc, "button", "gq-button gq-button--quiet", words.reset);
    reset.type = "button";
    reset.addEventListener("click", async () => { quick = await createQuickFor(quick.shop.language); note = undefined; draw(); });
    bar.append(reset);

    const form = el(doc, "form", "gq-form");
    const input = el(doc, "input", "gq-input");
    input.type = "text";
    input.maxLength = MAX_LENGTH;
    input.placeholder = seat === "owner" ? words.typeOwner : words.typeHere;
    input.setAttribute("aria-label", input.placeholder);
    input.autocomplete = "off";
    const send = el(doc, "button", "gq-send", words.send);
    send.type = "submit";
    form.append(input, send);
    form.addEventListener("submit", (e) => { e.preventDefault(); const t = input.value; input.value = ""; act(() => quick.say(seat, t)); });

    const parts: HTMLElement[] = [banner, head, tabs, log];
    if (note) parts.push(el(doc, "p", "gq-notice", note));
    const suggestions = seat === "customer" ? shop.chips : quick.ownerChips();
    if (suggestions.length > 0) {
      const chips = el(doc, "div", "gq-chips");
      chips.append(el(doc, "span", "gq-chips-label", words.trySaying));
      for (const text of suggestions) {
        const c = el(doc, "button", "gq-chip", text);
        c.type = "button";
        c.addEventListener("click", () => act(() => quick.say(seat, text)));
        chips.append(c);
      }
      parts.push(chips);
    }
    parts.push(bar, form, el(doc, "p", "gq-clock", `${words.clock}: ${quick.clock()}`), el(doc, "p", "gq-foot", words.note));
    root.append(...parts);
    log.scrollTop = log.scrollHeight;
  }

  async function act(run: () => Promise<string | undefined>): Promise<void> {
    note = await run();
    draw();
  }

  draw();
}
