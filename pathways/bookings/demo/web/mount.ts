// "Build your first agent, in the browser": the Bookings agent template's demo, mounted inside any element of any page.
//
//   import { mountDemo } from "./dist/index.js";
//   mountDemo(document.getElementById("demo"));
//
// It is the same demo as the one a partner runs on a laptop (demo/page.js draws it, demo/api.ts and demo/session.ts run it): the
// real template code on in-memory stand-ins for WhatsApp, payments and the calendar, with test money and a fake clock. Everything runs
// in this page. There is no server, no sign-in, nothing is sent and nothing is saved. scripts/build-web-demo.ts builds it for the browser.
import { createLocalDemo } from "./local.ts";
import type { LocalDemoOptions } from "./local.ts";
import { CSS, MARKUP, startPage } from "./generated.js"; // written by scripts/build-web-demo.ts from page.css, the page's markup and page.js; not in the source tree

export const ROOT_CLASS = "geo-demo";
/** The second label, always on screen beside the banner "Demo · test money · nothing real is sent" (which the page draws itself). */
export const GUARD_NOTE = "In this demo the template's own code checks the limit. On a live shop, Guard holds it outside the AI.";

export interface MountOptions extends LocalDemoOptions {
  /** Which screen first: "form" (default) opens the shop form, filled in with the example shop, so the visitor builds their own; "chat" opens the chat with the example shop. */
  startWith?: "form" | "chat";
}

export interface MountedDemo {
  /** Take the demo out of the page. */
  unmount(): void;
}

export function mountDemo(element: HTMLElement, options: MountOptions = {}): MountedDemo {
  const doc = element.ownerDocument;
  const win = doc.defaultView as Window;

  // The demo lives in a shadow root inside the element: the host page's styles cannot reach in, ours cannot reach out, and ids cannot clash.
  // (Inherited text styles still cross the edge; the root class resets them.)
  const host = doc.createElement("div");
  const shadow = host.attachShadow({ mode: "open" });
  if ("adoptedStyleSheets" in shadow && typeof win.CSSStyleSheet === "function" && "replaceSync" in win.CSSStyleSheet.prototype) {
    const sheet = new win.CSSStyleSheet();
    sheet.replaceSync(CSS); // a constructed sheet is not an inline <style>, so a page whose policy refuses inline styles still gets it
    shadow.adoptedStyleSheets = [sheet];
  } else {
    const style = doc.createElement("style");
    style.textContent = CSS;
    shadow.appendChild(style);
  }
  const root = doc.createElement("div");
  root.className = ROOT_CLASS;
  const template = doc.createElement("template");
  template.innerHTML = MARKUP; // the build's fixed markup; no visitor text goes through here
  root.appendChild(template.content);
  shadow.appendChild(root);
  const find = (id: string): HTMLElement => {
    const found = shadow.getElementById(id);
    if (!found) throw new Error(`The demo's markup has no element ${id}.`);
    return found;
  };

  // Both labels sit together at the top and stay there. The banner is the page's own element (it rewrites its words in the shop's language).
  const banner = find("banner");
  const notes = doc.createElement("div");
  notes.className = "geo-notes";
  const note = doc.createElement("p");
  note.className = "geo-note";
  note.textContent = GUARD_NOTE;
  banner.before(notes);
  notes.append(banner, note);

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
  element.replaceChildren(host);
  startPage(page, { scrollTo() {} }, fetchForPage, win.setTimeout.bind(win), win.clearTimeout.bind(win));

  return { unmount: () => host.remove() };
}
