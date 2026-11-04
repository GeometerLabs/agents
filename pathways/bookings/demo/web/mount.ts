// "Build your first agent, in the browser": the Bookings agent template's demo, mounted inside any element of any page.
//
//   import { mountDemo } from "./dist/index.js";
//   mountDemo(document.getElementById("demo"));
//
// It is the same demo as the one a partner runs on a laptop (demo/page.js draws it, demo/api.ts and demo/session.ts run it): the
// real template code on in-memory stand-ins for WhatsApp, payments and the calendar, with test money and a fake clock. Everything runs
// in this page. There is no server, no sign-in, nothing is sent and nothing is saved. scripts/build-web-demo.ts builds it for the browser.
// The look is demo/web/theme.css: every colour, size and font is a custom property (--geo-*) that the page around it can set.
import { createLocalDemo } from "./local.ts";
import type { LocalDemoOptions } from "./local.ts";
import { CSS, MARKUP, startPage } from "./generated.js"; // written by scripts/build-web-demo.ts from theme.css, the page's markup and page.js; not in the source tree

export const ROOT_CLASS = "geo-demo";
/** The second label, always on screen beside the banner "Demo · test money · nothing real is sent" (which the page draws itself). */
export const GUARD_NOTE = "In this demo the template's own code checks the limit. On a live shop, Guard holds it outside the AI.";
/** The three steps: the shop form, the chat with test money, and what was checked (the owner's plain-words lines, the record). */
export const STEPS = [["shop", "Your shop"], ["try", "Try it"], ["checked", "What was checked"]] as const;

export interface MountOptions extends LocalDemoOptions {
  /** Which step first: "form" (default) opens step 1, the shop form, filled in with the example shop; "chat" opens step 2 with the example shop. */
  startWith?: "form" | "chat";
}

export interface MountedDemo {
  /** Take the demo out of the page. */
  unmount(): void;
}

let mounts = 0;
const styled = new WeakSet<Document>();

export function mountDemo(element: HTMLElement, options: MountOptions = {}): MountedDemo {
  const doc = element.ownerDocument;
  const win = doc.defaultView as Window;
  const prefix = `${ROOT_CLASS}-${++mounts}-`; // every id in the markup gets this, so the host page's own ids cannot clash with ours

  // The stylesheet goes in once per page, as a constructed sheet where there is one: it is not an inline <style>, so a page whose policy
  // refuses inline styles still gets it. Everything in it is under .geo-demo.
  if (!styled.has(doc)) {
    styled.add(doc);
    if ("adoptedStyleSheets" in doc && typeof win.CSSStyleSheet === "function" && "replaceSync" in win.CSSStyleSheet.prototype) {
      const sheet = new win.CSSStyleSheet();
      sheet.replaceSync(CSS);
      doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
    } else {
      const style = doc.createElement("style");
      style.textContent = CSS;
      doc.head.appendChild(style);
    }
  }

  const root = doc.createElement("div");
  root.className = ROOT_CLASS;
  const template = doc.createElement("template");
  template.innerHTML = MARKUP.replace(/\b(id|aria-labelledby)="([^"]+)"/g, (_all, attribute: string, value: string) => `${attribute}="${prefix}${value}"`); // fixed markup of our own; no visitor text goes through here
  root.appendChild(template.content);
  const find = (id: string): HTMLElement => {
    const found = root.querySelector<HTMLElement>(`[id="${prefix}${id}"]`);
    if (!found) throw new Error(`The demo's markup has no element ${id}.`);
    return found;
  };

  // The labels sit together at the top and stay there. The banner is the page's own element (it rewrites its words in the shop's language).
  const banner = find("banner");
  const notes = doc.createElement("div");
  notes.className = "geo-notes";
  const note = doc.createElement("p");
  note.className = "geo-note";
  note.textContent = GUARD_NOTE;
  banner.before(notes);
  notes.append(banner, note);

  // The steps, under the labels. They only press the page's own buttons and read what the page shows, so they cannot disagree with it.
  const nav = doc.createElement("nav");
  nav.className = "geo-steps";
  nav.setAttribute("aria-label", "Steps");
  const list = doc.createElement("ol");
  list.className = "geo-steps-list";
  const stepButtons = new Map<string, HTMLElement>();
  STEPS.forEach(([key, label], i) => {
    const item = doc.createElement("li");
    item.className = "geo-step-item";
    const button = doc.createElement("button");
    button.type = "button";
    button.className = `geo-step geo-step--${key}`;
    const number = doc.createElement("span");
    number.className = "geo-step-number";
    number.textContent = String(i + 1);
    const text = doc.createElement("span");
    text.className = "geo-step-label";
    text.textContent = label;
    button.append(number, text);
    stepButtons.set(key, button);
    item.appendChild(button);
    list.appendChild(item);
  });
  const waitingBadge = doc.createElement("span"); // how many answers wait for the owner (the page's own count, on its Owner tab)
  waitingBadge.className = "geo-step-badge";
  waitingBadge.hidden = true;
  stepButtons.get("checked")!.appendChild(waitingBadge);
  nav.appendChild(list);
  notes.after(nav);

  const closeForm = () => { if (!find("sheet").hidden) find("sheetForm").querySelector<HTMLElement>(".geo-button--quiet")?.click(); };
  stepButtons.get("shop")!.addEventListener("click", () => { if (find("sheet").hidden) find("btnSetup").click(); });
  stepButtons.get("try")!.addEventListener("click", () => { closeForm(); find("tabCustomer").click(); });
  stepButtons.get("checked")!.addEventListener("click", () => { closeForm(); find("tabOwner").click(); });
  const sync = () => {
    const checking = find("tabOwner").getAttribute("aria-selected") === "true" || find("tabRecord").getAttribute("aria-selected") === "true";
    const step = !find("sheet").hidden ? "shop" : checking ? "checked" : "try";
    if (root.dataset.step !== step) root.dataset.step = step;
    stepButtons.forEach((button, key) => { if ((button.getAttribute("aria-current") === "step") !== (key === step)) { if (key === step) button.setAttribute("aria-current", "step"); else button.removeAttribute("aria-current"); } });
    const count = find("badge");
    if (waitingBadge.hidden !== count.hidden) waitingBadge.hidden = count.hidden;
    if (waitingBadge.textContent !== count.textContent) waitingBadge.textContent = count.textContent;
  };
  sync();
  const watcher = new win.MutationObserver((records) => { if (records.some((r) => !nav.contains(r.target))) sync(); });
  watcher.observe(root, { subtree: true, attributes: true, attributeFilter: ["hidden", "aria-selected"] });

  // The page's script is written for a whole page. It gets the demo's root in the place of the page: it finds things by id inside it, puts
  // `lang` and `aria-busy` on it, never scrolls the host page, and asks the in-page demo where it would ask a server.
  const local = createLocalDemo(options);
  const first = { pending: options.startWith !== "chat" };
  const fetchForPage = async (path: string, init?: { method?: string; body?: string }) => {
    const answer = await local.fetch(path, init);
    if (first.pending) {
      first.pending = false;
      win.setTimeout(() => find("btnSetup").click(), 0); // after the page has drawn the first screen: open the shop form
    }
    return answer;
  };
  const page = { getElementById: (id: string) => find(id), createElement: (tag: string) => doc.createElement(tag), createTextNode: (text: string) => doc.createTextNode(text), documentElement: root, body: root };
  element.replaceChildren(root);
  startPage(page, { scrollTo() {} }, fetchForPage, win.setTimeout.bind(win), win.clearTimeout.bind(win));

  return { unmount: () => { watcher.disconnect(); root.remove(); } };
}
