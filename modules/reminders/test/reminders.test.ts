import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY, HOUR } from "../../core/time.ts";
import { daysFrom, hoursBefore, scheduleAround, takeDue, upcoming } from "../reminders.ts";

const due = Date.UTC(2026, 10, 5, 4, 30);

test("reminders are scheduled around a moment, in the order given, and a moment already past is never scheduled", () => {
  const all = scheduleAround(due, daysFrom([-3, 0, 5]), due - 10 * DAY);
  assert.deepEqual(all.map((r) => r.atMs), [due - 3 * DAY, due, due + 5 * DAY]);
  assert.ok(all.every((r) => r.sent === false));
  assert.deepEqual(scheduleAround(due, daysFrom([-3, 0, 5]), due - DAY).map((r) => r.atMs), [due, due + 5 * DAY], "the one three days before is past");
  assert.deepEqual(scheduleAround(due, hoursBefore([24, 2]), due - 5 * HOUR).map((r) => r.atMs), [due - 2 * HOUR]);
});

test("when several fell due while nothing was running, one message is due and every one is marked taken", () => {
  const list = scheduleAround(due, daysFrom([-3, 0, 5]), due - 10 * DAY);
  assert.deepEqual(takeDue(list, due - 4 * DAY), { due: false, atMs: null });
  const burst = takeDue(list, due + DAY);
  assert.deepEqual(burst, { due: true, atMs: due });
  assert.deepEqual(list.map((r) => r.sent), [true, true, false]);
  assert.deepEqual(takeDue(list, due + DAY), { due: false, atMs: null }, "none comes back");
  assert.deepEqual(upcoming(list, due + DAY).map((r) => r.atMs), [due + 5 * DAY]);
});
