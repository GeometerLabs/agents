// runtime.json's `talk` block (modules/runtime/config.ts): the same shape and the same refusals as `parser`, naming "talk".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readRuntimeConfig } from "../config.ts";

const SHAPE = [{ name: "messaging" }] as never;
const base = { mode: "fakes" };
const talk = { wire: "openai", baseUrl: "http://model-guard:8080/v1", model: "m", agentTokenFile: "/run/secrets/agent_model", provider: "deepinfra" };

test("a talk block is read like a parser block", () => {
  const r = readRuntimeConfig({ ...base, talk }, "/x", SHAPE);
  assert.ok(r.ok);
  assert.equal(r.config.talk?.model, "m");
  assert.equal(r.config.talk?.provider, "deepinfra");
  assert.equal(r.config.parser, undefined);
});

test("left out, there is none (the talk then uses the parser's model)", () => {
  const r = readRuntimeConfig({ ...base }, "/x", SHAPE);
  assert.ok(r.ok);
  assert.equal(r.config.talk, undefined);
});

test("refusals name talk, and a key in the file is refused", () => {
  const r = readRuntimeConfig({ ...base, talk: { ...talk, apiKey: "sk-nope", wire: "soap" } }, "/x", SHAPE);
  assert.ok(!r.ok);
  const text = r.errors.join("\n");
  assert.match(text, /talk\.apiKey is not allowed/u);
  assert.match(text, /talk\.wire must be/u);
  assert.ok(!/parser/u.test(text));
  assert.ok(!text.includes("sk-nope"));
});
