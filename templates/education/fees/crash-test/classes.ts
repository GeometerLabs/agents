// The crash-test situations of Classes (owner decision 50), run only for a centre that has the `classes` block (a Fees centre's list of situations is as it was). Like every
// situation they start a fresh world, make something go wrong on purpose, and judge from the stand-ins' own records: the WhatsApp outbox (what each contact was sent) and
// the record, never from what the agent said it did.
//
// The five: a class link to a student whose fee is unpaid and past its grace days is refused (and goes once it is paid); a student removed from a batch, or past their fee's grace
// days, loses the reading-material page; a link the teacher changes after the reminders were queued is the one that is sent; a lost reply to a send is not sent twice;
// and a missed-class note goes only after the teacher marks the student absent.
import { MINUTE, addDays, zonedToMs } from "../../../../modules/core/time.ts";
import type { LocalDate } from "../../../../modules/core/time.ts";
import { checker } from "../../../../modules/crash-test/situations.ts";
import type { Situation } from "../../../../modules/crash-test/situations.ts";
import { capabilitiesOf } from "../../../../modules/payments/providers/index.ts";
import { createGoWorld } from "./go-world.ts";
import type { GoWorld as World } from "./go-world.ts";
import { occurrencesBetween } from "../src/classes/rules.ts";
import type { Occurrence } from "../src/classes/rules.ts";
import { materialView } from "../src/classes/view.ts";
import type { Settings, Student } from "../src/settings.ts";

const LINK_A = "https://meet.example/first-link";
const LINK_B = "https://meet.example/second-link";

export function buildClassSituations(settings: Settings): Situation[] {
  const classes = settings.classes;
  if (!classes) return [];
  const tz = settings.timezone;
  const student: Student | undefined = settings.students.find((s) => !s.adult && classes.timetable[s.batchId]);
  if (!student) return [];
  const batch = settings.batches.find((b) => b.id === student.batchId)!;
  const startMs = zonedToMs({ year: 2026, month: 11, day: 2 }, { hour: 9, minute: 0 }, tz); // the harness's own start
  const classesAfter = (ms: number): Occurrence[] => occurrencesBetween(classes, tz, ms, ms + 40 * 86_400_000).filter((o) => o.batchId === batch.id);
  const early = classesAfter(startMs + 2 * 3_600_000)[0]; // the first class of the batch: the fee is open and within its grace days
  const dueDate: LocalDate = { year: 2026, month: 11, day: settings.due.day };
  const lateAfter = zonedToMs(addDays(dueDate, settings.due.graceDays + 2), { hour: 0, minute: 0 }, tz);
  const late = classesAfter(lateAfter)[0]; // a class after the grace days of November's fee
  if (!early || !late) return [];
  const gateway = capabilitiesOf(settings.payment).confirmsAutomatically;
  const parent = student.parent;
  const lead = classes.linkLeadMinutes * MINUTE;

  // the centre's page is the shop folder's pages.json (go-shop.ts writes one), so the reminders carry each parent's private link as on a real centre
  const world = (): Promise<World> => createGoWorld({ settings, nowMs: startMs });
  const at = async (w: World, ms: number) => { w.clock.set(ms); await w.tick(); };
  const links = (w: World, text: string) => w.messaging.sentTo(parent).filter((m) => m.text.includes(text)).length;
  const notes = (w: World) => w.record.entries().filter((e) => e.action === "send_message" && e.outcome === "confirmed" && e.conversation === parent && (e.refs.templates ?? "") === "class_missed_note").length;
  /** The teacher pastes the link, the lead window opens, the contact answers the first question. */
  async function agreed(w: World, occ: Occurrence, link: string): Promise<void> {
    await w.ownerSays(`link ${batch.id} ${link}`);
    await at(w, occ.startMs - lead + MINUTE); // the consent question goes first
    await w.say("yes", { from: parent });
  }
  const pay = async (w: World) => { if (gateway) { w.pays(student.name); await w.deliverPaymentEvents(); } else await w.ownerMarksReceived(student.name); };
  const out: Situation[] = [];
  const add = (s: Situation) => out.push(s);

  add({
    id: "class-link-unpaid", title: "A class link is not sent to a student whose fee is unpaid and past its grace days, and is sent once it is paid", how: "the clock reaches a class after the grace days; the fee is then paid",
    async run() {
      const { results, expect } = checker();
      const w = await world();
      await agreed(w, late, LINK_A);
      await at(w, late.startMs - lead + 2 * MINUTE);
      expect("No class link reached the student", links(w, LINK_A) === 0, w.textsTo(parent).join(" | "));
      expect("The record says it was stopped, by the class-access rule", w.record.entries().some((e) => e.action === "class_access" && e.outcome === "blocked" && e.decisions.some((d) => d.ruleId === "class-access" && d.verdict === "block")));
      await pay(w);
      await at(w, late.startMs - lead + 10 * MINUTE); // past the five minutes before the fee is read again for a held student
      expect("Once the fee is paid the link goes, once", links(w, LINK_A) === 1, w.textsTo(parent).join(" | "));
      await at(w, late.startMs - lead + 20 * MINUTE);
      expect("A later beat does not send it again", links(w, LINK_A) === 1);
      return results;
    },
  });

  add({
    id: "class-material-access", title: "A student removed from a batch, or past their fee's grace days, loses the reading-material page", how: "the page's own read, before and after the student leaves the batch or the fee falls late",
    async run() {
      const { results, expect } = checker();
      const w = await world();
      await w.say("yes", { from: parent }); // not asked yet: no agreement recorded, so nothing opens
      await agreed(w, early, LINK_A);
      await at(w, early.startMs - lead + 2 * MINUTE);
      const now = early.startMs;
      expect("A student who agreed, with a fee within its grace days, opens the material", materialView(settings, w.store, parent, batch.id, now) !== null);
      const left = { ...settings, students: settings.students.filter((s) => s !== student) };
      expect("The same link opens nothing once the student is no longer in the batch", materialView(left, w.store, parent, batch.id, now) === null);
      expect("It opens nothing for another batch of the contact that has no student of theirs", materialView(settings, w.store, parent, "no-such-batch", now) === null);
      expect("It opens nothing once the fee's grace days are over and it is unpaid", materialView(settings, w.store, parent, batch.id, lateAfter + 3_600_000) === null);
      return results;
    },
  });

  add({
    id: "class-link-changed", title: "A class link the teacher changes after the reminders were queued is the one that is sent", how: "the link is changed before the lead window, and again after it was sent",
    async run() {
      const { results, expect } = checker();
      const w = await world();
      await agreed(w, early, LINK_A); // the first question is asked at the lead window; the link was set before it
      await w.ownerSays(`link ${batch.id} ${LINK_B}`); // changed after A was queued and before anything was sent
      await at(w, early.startMs - lead + 2 * MINUTE);
      expect("Only the new link was sent", links(w, LINK_B) === 1 && links(w, LINK_A) === 0, w.textsTo(parent).join(" | "));
      await w.ownerSays(`link ${batch.id} ${LINK_A}`); // changed after it was sent
      await at(w, early.startMs - lead + 3 * MINUTE);
      expect("A link changed after sending is sent once more, and each link only once", links(w, LINK_A) === 1 && links(w, LINK_B) === 1, w.textsTo(parent).join(" | "));
      return results;
    },
  });

  add({
    id: "class-link-lost-reply", title: "A reply lost on the way is not sent a second time", how: "the provider loses the reply to the class link's send",
    async run() {
      const { results, expect } = checker();
      const w = await world();
      await agreed(w, early, LINK_A);
      w.messaging.inject("sendText", "lostReply");
      w.messaging.inject("sendTemplate", "lostReply");
      await at(w, early.startMs - lead + 2 * MINUTE);
      await at(w, early.startMs - lead + 3 * MINUTE);
      await at(w, early.startMs - lead + 4 * MINUTE);
      expect("The link was not sent again after the lost reply", w.messaging.sentTo(parent).filter((m) => m.text.includes(LINK_A)).length <= 1, w.textsTo(parent).join(" | "));
      return results;
    },
  });

  add({
    id: "class-missed-note", title: "A missed-class note goes only after the teacher marks the student absent", how: "the class ends and nothing is marked; the teacher then marks the student absent twice",
    async run() {
      const { results, expect } = checker();
      const w = await world();
      await agreed(w, early, LINK_A);
      await at(w, early.startMs - lead + 2 * MINUTE);
      await at(w, early.endMs + 5 * MINUTE);
      expect("The teacher was asked for attendance, and no note went before they answered", notes(w) === 0 && w.record.entries().some((e) => e.conversation === w.owner && e.refs.templates === "owner_class_attendance"));
      const roster = settings.students.filter((s) => s.batchId === batch.id);
      await w.ownerSays(`absent ${roster.indexOf(student) + 1}`);
      expect("One note went to the absent student's contact", notes(w) === 1, String(notes(w)));
      await w.ownerSays(`absent ${roster.indexOf(student) + 1}`);
      await at(w, early.endMs + 10 * MINUTE);
      expect("The same words again, and the clock, sent no second note", notes(w) === 1, String(notes(w)));
      return results;
    },
  });

  return out;
}
