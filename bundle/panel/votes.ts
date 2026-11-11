// The template vote for the first 100 innovators (plan B56): a simple poll in the panel on which template Geometer builds next.
//  - The candidates are in one data file (vote-options.json).
//  - Only a person whom fleet flags as an Innovator sees it: fleet's answer for a shop they serve carries `innovator` (contract.ts FleetAnswer). Anyone else gets a 404.
//  - One vote per innovator, changeable: the vote is one file per account, so a second vote replaces the first and can never add a second one.
//  - Results are counts only, never names, and only to a person who has voted.
//  - The votes stay in the panel's own store. They travel to Geometer as counts per option in the heartbeat once fleet accepts that field (bundle/Deferred.md);
//    `heartbeatField` is the exact shape, ready, and nothing sends it yet.
import { readFileSync } from "node:fs";
import type { Language } from "../../modules/language/languages.ts";
import { isObj } from "./contract.ts";
import type { Account } from "./accounts.ts";
import type { Shops } from "./shops.ts";
import type { Store } from "./store.ts";

export const VOTE_OPTIONS_FILE = new URL("./vote-options.json", import.meta.url);

export interface VoteOption { id: string; label: Record<Language, string> }
export interface VoteRound { round: string; options: VoteOption[] }
export interface VoteRecord { schema: 1; round: string; option: string; at: string }

const ID = /^[a-z][a-z0-9-]{0,39}$/u;

// Reads the candidates from vote-options.json (one data file, so the choices change without code); throws on a bad file because a broken poll should fail loudly at start.
export function loadVoteRound(file: URL | string = VOTE_OPTIONS_FILE): VoteRound {
  const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isObj(raw) || raw.format !== "geometer-template-vote/1" || typeof raw.round !== "string" || !/^\d{4}-\d{2}$/u.test(raw.round) || !Array.isArray(raw.options)) throw new Error("vote-options.json is not a template-vote file.");
  const seen = new Set<string>();
  const options = raw.options.map((o: unknown): VoteOption => {
    if (!isObj(o) || typeof o.id !== "string" || !ID.test(o.id) || seen.has(o.id) || !isObj(o.label)) throw new Error("vote-options.json: every option needs a new id and a label.");
    seen.add(o.id);
    const label = {} as Record<Language, string>;
    for (const l of ["en", "hi", "ml", "kn"] as const) {
      const t = o.label[l];
      if (typeof t !== "string" || t.trim() === "" || t.length > 160) throw new Error(`vote-options.json: option ${o.id} needs a label in ${l}.`);
      label[l] = t;
    }
    return { id: o.id, label };
  });
  if (options.length < 2 || options.length > 20) throw new Error("vote-options.json: a poll needs between 2 and 20 options.");
  return { round: raw.round, options };
}

const nameOf = (accountId: string) => `votes/${accountId.replace(/_/gu, "-")}.json`;

// The vote store: one file per account, so a second vote replaces the first and a person can never count twice. `now` is injectable for tests.
export function createVotes(store: Store, shops: Shops, now: () => number, round: VoteRound = loadVoteRound()) {
  const api = {
    round,
    /** Is this person an Innovator? Fleet says so for a shop they serve (fleet/<shop>.json), and that is the only way. */
    isInnovator(account: Account): boolean {
      return shops.ids().some((id) => shops.servedBy(id)?.accountId === account.id && shops.fleet(id)?.innovator === true);
    },
    /** This person's vote in this round, or undefined. */
    mine(account: Account): string | undefined {
      const v = store.read<VoteRecord>(nameOf(account.id));
      return v && v.schema === 1 && v.round === round.round && round.options.some((o) => o.id === v.option) ? v.option : undefined;
    },
    /** Record or change the vote. An option that is not on the list is refused. */
    cast(account: Account, option: string): boolean {
      if (!round.options.some((o) => o.id === option)) return false;
      store.write(nameOf(account.id), { schema: 1, round: round.round, option, at: new Date(now()).toISOString() } satisfies VoteRecord);
      return true;
    },
    /** Votes counted on this panel, per option of this round. Counts only: nothing here says who voted. */
    counts(): Record<string, number> {
      const out: Record<string, number> = Object.fromEntries(round.options.map((o) => [o.id, 0]));
      for (const f of store.list("votes")) {
        const v = store.read<VoteRecord>(`votes/${f}`);
        if (v && v.schema === 1 && v.round === round.round && Object.hasOwn(out, v.option)) out[v.option]++;
      }
      return out;
    },
    /** The exact field the heartbeat will carry once fleet accepts it: counts per option, no names (bundle/Deferred.md). */
    heartbeatField(): { template_votes: { round: string; counts: Record<string, number> } } {
      return { template_votes: { round: round.round, counts: api.counts() } };
    },
  };
  return api;
}
export type Votes = ReturnType<typeof createVotes>;
