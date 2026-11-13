// `geometer home pack|install|rollback|status`: the Streetlist home on the partner server (lib/home.ts says how and why). The command line's side only: reading the pin,
// getting the file, saying in plain words what happened. Nothing here restarts Caddy or runs a deploy: Caddy reads home/current, which `install` and `rollback` move
// by one atomic rename, and the Caddy settings do not depend on which build is installed.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { HomeRefused, HOME_RULES_SHA, homePaths, homeStatus, installHome, makePack, readPin, readSource, rollbackHome } from "./lib/home.ts";
import { loadServer } from "./lib/server.ts";
import type { HomePin } from "./lib/home.ts";

export interface HomeIo { log: (line: string) => void; pin?: () => HomePin; fetcher?: Parameters<typeof readSource>[1] }

export const HOME_SUBCOMMANDS = ["pack", "install", "rollback", "status"] as const;

export async function homeCommand(serverDir: string, sub: string | undefined, args: string[], flags: { out?: string; sha256?: string; commit?: string }, io: HomeIo): Promise<number> {
  const pin = (io.pin ?? readPin)();
  if (sub === "pack") {
    // on the owner's machine, from the built streetlist repository; no server folder is needed
    if (!args[0]) throw new HomeRefused("Say which folder: home pack <the streetlist folder> [--out <file>] (build the site there first: npm run build).");
    const made = makePack(args[0], flags.commit ? { commit: flags.commit } : {});
    const out = resolve(flags.out ?? `streetlist-home-${made.pack.commit.slice(0, 12)}.json`);
    writeFileSync(out, made.bytes);
    io.log(`Wrote ${out} (${made.pack.files.length} files, ${Math.round(made.bytes.length / 1024)} KB) from Streetlist commit ${made.pack.commit}.`);
    io.log(`sha256 ${made.sha256}`);
    io.log(`To serve it: put the file where the server can read it (an https address, or on the server), then set bundle/home.json to {"commit": "${made.pack.commit}", "sha256": "${made.sha256}", "url": "<the https address or empty>"} in a reviewed commit, and on the server run: geometer home install <file or address>.`);
    return 0;
  }
  const server = loadServer(serverDir);
  if (!server.pages) throw new HomeRefused('This server has no pages domain ("pages" in geometer.json), so it serves no Streetlist home. Partner server only: geometer init ... --pages-domain streetlist.in.');
  if (sub === "status" || sub === undefined) {
    const s = homeStatus(serverDir);
    io.log(`Pages domain: ${server.pages.domain}${server.pages.extraDomains.length ? ` (also ${server.pages.extraDomains.join(", ")}, redirected)` : ""}. Folder: ${homePaths(serverDir).root}`);
    io.log(s.current ? `Served now: Streetlist commit ${s.current.commit} (build ${s.current.id}, installed ${s.current.installedAt}).` : "Nothing is installed: the domain is served by the door alone (no home page).");
    if (s.previous) io.log(`Before that, kept for \`geometer home rollback\`: commit ${s.previous.commit} (build ${s.previous.id}).`);
    io.log(pin.sha256 ? `This bundle pins commit ${pin.commit} (sha256 ${pin.sha256.slice(0, 16)}...)${s.current && s.current.sha256 === pin.sha256 ? ": that is what is served." : s.current ? ": NOT what is served. Run `geometer home install`." : "."}` : "This bundle pins no build yet (bundle/home.json is empty).");
    io.log(`Hosting rules this bundle serves by: ${HOME_RULES_SHA.slice(0, 16)}...`);
    return 0;
  }
  if (sub === "install") {
    // the pin decides what is served; --sha256 is only for a server whose bundle pins nothing (and may not contradict a pin)
    if (pin.sha256 && flags.sha256 && flags.sha256.toLowerCase() !== pin.sha256) throw new HomeRefused(`--sha256 ${flags.sha256} is not what this bundle pins (${pin.sha256}). The pin is changed in bundle/home.json, in a reviewed commit, not on the command line.`);
    const expect = pin.sha256 || flags.sha256;
    if (!expect) throw new HomeRefused("This bundle pins no build (bundle/home.json is empty), and none was named. Give --sha256 <the checksum `geometer home pack` printed>.");
    const source = args[0] ?? pin.url;
    if (!source) throw new HomeRefused("Say where the build is: home install <file on this server, or an https address> (bundle/home.json names no address).");
    const bytes = await readSource(source, io.fetcher);
    const r = installHome(serverDir, bytes, { expectSha: expect });
    io.log(r.changed ? `Installed Streetlist commit ${r.commit} (build ${r.id}) and switched to it. The one before is kept: \`geometer home rollback\` goes back.` : `Streetlist commit ${r.commit} is already the one served. Nothing changed.`);
    return 0;
  }
  if (sub === "rollback") {
    const r = rollbackHome(serverDir);
    io.log(`Switched back to Streetlist commit ${r.commit} (build ${r.id}).`);
    return 0;
  }
  throw new HomeRefused(`Say what to do: home ${HOME_SUBCOMMANDS.join("|")}`);
}
