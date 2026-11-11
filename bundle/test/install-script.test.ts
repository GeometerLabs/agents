// install.sh, the one-step install of a builder's server (plan item 14b), one function at a time, with every outside program replaced by a stub on PATH that
// writes down how it was called: the system it accepts and refuses, release.json read without Node, this copy checked against the release tag, Node and Docker's
// key checked against their pins before anything is installed, ports and the domain, the Guard image file's sha256, the files it never replaces, the `geometer`
// command it writes (one shop's kill switch kept apart from stopping the server), and a whole dry run that changes nothing. Nothing here runs as root, touches
// /usr/local or /etc, or reaches the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DEFAULT_GUARD_IMAGE } from "../lib/server.ts";

const INSTALL = new URL("../../install.sh", import.meta.url).pathname;
const RELEASE = new URL("../release.json", import.meta.url).pathname;
const BASH = ["/opt/homebrew/bin/bash", "/usr/local/bin/bash", "/usr/bin/bash", "/bin/bash"].find((b) => existsSync(b) && !spawnSync(b, ["-c", "[ ${BASH_VERSINFO[0]} -ge 4 ]"]).status) ?? "bash";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** A sandbox: a stub folder first on PATH, a log of every stubbed call, and a home folder. `sudo` only writes into the sandbox; anything else it is asked, it notes. */
function sandbox(stubs: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "geo-install-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const log = join(root, "calls.log");
  writeFileSync(log, "");
  const all: Record<string, string> = {
    sha256sum: 'exec shasum -a 256 "$@"',
    // root's commands are noted; one whose last argument (where it writes) is inside the sandbox is carried out (without the chown to root, which a test user cannot do)
    sudo: `case "\${@: -1}" in "${root}"*) [ "$1" = -n ] && shift; args=(); skip=0; for a in "$@"; do if [ $skip = 1 ]; then skip=0; continue; fi; case "$a" in -o|-g) skip=1;; *) args+=("$a");; esac; done; "\${args[@]}";; esac`,
    ...stubs,
  };
  for (const [name, body] of Object.entries(all)) {
    writeFileSync(join(bin, name), `#!/bin/bash\necho "${name} $*" >> "$STUB_LOG"\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const env = (extra: Record<string, string> = {}) => ({ PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: join(root, "home"), USER: "builder", STUB_LOG: log, TMPDIR: root, ...extra });
  mkdirSync(join(root, "home"));
  /** Source install.sh and run `script` in a new session (no terminal to ask on, as under cloud-init). */
  const run = (script: string, extra: Record<string, string> = {}) => new Promise<{ code: number; out: string }>((resolve) => {
    const child = spawn(BASH, ["-c", `GEOMETER_INSTALL_LIB=1 source ${JSON.stringify(INSTALL)}\n${script}`], { env: env(extra), detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (c: Buffer) => { out += c.toString(); });
    child.stderr.on("data", (c: Buffer) => { out += c.toString(); });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, out }); });
  });
  const calls = () => readFileSync(log, "utf8").trim().split("\n").filter(Boolean);
  return { root, bin, run, calls, done: () => rmSync(root, { recursive: true, force: true }) };
}

/** A release.json with these values over the real one's. */
function releaseWith(dir: string, change: Record<string, string>): string {
  const r = { ...JSON.parse(readFileSync(RELEASE, "utf8")), ...change } as Record<string, string>;
  const file = join(dir, "release.json");
  writeFileSync(file, `{\n${Object.entries(r).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n")}\n}\n`);
  return file;
}

test("release.json is one flat object of strings, one per line, so the installer reads it without Node; its Guard image is the bundle's default", async () => {
  const raw = readFileSync(RELEASE, "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  assert.ok(Object.values(parsed).every((v) => typeof v === "string"), "only strings");
  assert.equal(raw.trim().split("\n").length, Object.keys(parsed).length + 2, "one value per line");
  assert.equal(parsed.guard_image, DEFAULT_GUARD_IMAGE, "one image name: change both at the release (monorepo Deferred D90 item 6)");
  assert.match(String(parsed.node_sha256_linux_x64), /^[0-9a-f]{64}$/u);
  assert.match(String(parsed.node_sha256_linux_arm64), /^[0-9a-f]{64}$/u);
  assert.equal(parsed.docker_gpg_fingerprint, "9DC858229FC7DD38854AE2D88D81803C0EBFCD88", "Docker's published fingerprint");
  const s = sandbox();
  try {
    const keys = Object.keys(parsed).filter((k) => k !== "about");
    const r = await s.run(`RELEASE_FILE=${JSON.stringify(RELEASE)}\nfor k in ${keys.join(" ")}; do printf '%s=%s\\n' "$k" "$(release_get "$k")"; done`);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(r.out.trim().split("\n"), keys.map((k) => `${k}=${parsed[k]}`));
  } finally { s.done(); }
});

test("only Ubuntu 22.04 or 24.04 on x86_64 or arm64, never as root; anything else is refused in plain words", async () => {
  const s = sandbox({ uname: 'echo "${UNAME_M:-x86_64}"', id: 'if [ "$1" = -u ]; then echo "${ID_U:-1000}"; else /usr/bin/id "$@"; fi' });
  try {
    const os = (id: string, v: string) => { const f = join(s.root, `os-${id}-${v}`); writeFileSync(f, `NAME="X"\nID=${id}\nVERSION_ID="${v}"\nVERSION_CODENAME=noble\n`); return f; };
    let r = await s.run("check_system", { OS_RELEASE: os("ubuntu", "24.04") });
    assert.equal(r.code, 0, r.out); assert.match(r.out, /System: Ubuntu 24\.04 on amd64/u);
    r = await s.run("check_system", { OS_RELEASE: os("ubuntu", "22.04"), UNAME_M: "aarch64" });
    assert.match(r.out, /Ubuntu 22\.04 on arm64/u);
    for (const [osFile, why] of [[os("debian", "12"), /runs debian 12\. The install is made for Ubuntu 22\.04 or 24\.04 only/u], [os("ubuntu", "20.04"), /runs ubuntu 20\.04/u]] as const) {
      r = await s.run("check_system", { OS_RELEASE: osFile });
      assert.equal(r.code, 1); assert.match(r.out, why);
    }
    r = await s.run("check_system", { OS_RELEASE: os("ubuntu", "24.04"), UNAME_M: "riscv64" });
    assert.equal(r.code, 1); assert.match(r.out, /processor is riscv64.*x86_64.*arm64/u);
    r = await s.run("check_not_root", { ID_U: "0" });
    assert.equal(r.code, 1); assert.match(r.out, /not as root/u);
    r = await s.run('for d in shops.example.com a.b.co localhost; do valid_domain "$d" && echo "ok $d"; done; for d in https://x.com "x com" example "-a.com" "a..com"; do valid_domain "$d" || echo "no $d"; done');
    assert.deepEqual(r.out.trim().split("\n"), ["ok shops.example.com", "ok a.b.co", "ok localhost", "no https://x.com", "no x com", "no example", "no -a.com", "no a..com"]);
  } finally { s.done(); }
});

test("only the pinned release is installed: this copy must be exactly its tag with no change, or --use-this-checkout says loudly that it is not one", async () => {
  const s = sandbox();
  const repo = join(s.root, "repo");
  const git = (...a: string[]) => { const r = spawnSync("git", ["-C", repo, ...a], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  try {
    mkdirSync(join(repo, "bundle"), { recursive: true });
    spawnSync("git", ["init", "-q", repo]);
    const file = (tag: string) => releaseWith(join(repo, "bundle"), { agents_tag: tag, release: tag ? "0.9.0" : "" });
    file("");
    git("add", "."); git("commit", "-q", "-m", "one");
    const env = { RELEASE_FILE: join(repo, "bundle", "release.json"), APP_DIR: repo };
    const PATH = `${s.bin}:${process.env.PATH}`; // the real git
    let r = await s.run("check_release", { ...env, PATH });
    assert.equal(r.code, 1); assert.match(r.out, /names no release yet.*--use-this-checkout/u);
    r = await s.run("USE_THIS_CHECKOUT=1 check_release", { ...env, PATH });
    assert.equal(r.code, 0, r.out); assert.match(r.out, /NOT A RELEASE: installing this copy of the repository as it is \(commit [0-9a-f]{40}\)/u);

    file("v0.9.0"); git("commit", "-q", "-am", "two"); git("tag", "v0.9.0");
    r = await s.run("check_release", { ...env, PATH });
    assert.equal(r.code, 0, r.out); assert.match(r.out, /Release 0\.9\.0: tag v0\.9\.0, commit [0-9a-f]{40}, no local changes/u);
    r = await s.run(`EXPECT_COMMIT=${"0".repeat(40)} check_release`, { ...env, PATH });
    assert.equal(r.code, 1); assert.match(r.out, /not 0{40} as asked/u);
    writeFileSync(join(repo, "bundle", "x.txt"), "x"); git("add", "bundle/x.txt");
    r = await s.run("check_release", { ...env, PATH });
    assert.equal(r.code, 1); assert.match(r.out, /changes to tracked files/u);
    git("commit", "-q", "-m", "three");
    r = await s.run("check_release", { ...env, PATH });
    assert.equal(r.code, 1); assert.match(r.out, /not at the release v0\.9\.0.*git -C .* checkout v0\.9\.0/u);
  } finally { s.done(); }
});

test("Node is installed only after its download matches release.json's sha256 and nodejs.org's SHASUMS256.txt; a mismatch installs nothing", async () => {
  const tarball = "a pretend node tarball";
  const s = sandbox({
    curl: 'out=""; while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift 2;; *) url=$1; shift;; esac; done; case "$url" in *SHASUMS256.txt) printf "%s  node-v26.13.0-linux-x64.tar.xz\\n" "$LISTED" > "$out";; *) printf "%s" "${TARBALL}" > "$out";; esac',
  });
  try {
    const release = releaseWith(s.root, { node_version: "26.13.0", node_sha256_linux_x64: sha(tarball) });
    const base = { RELEASE_FILE: release, TARBALL: tarball, LISTED: sha(tarball) };
    let r = await s.run("NODE_ARCH=x64; install_node; echo \"NODE_BIN=$NODE_BIN\"", base);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /sha256 [0-9a-f]{64}, the one release\.json pins and nodejs\.org publishes/u);
    assert.match(r.out, /NODE_BIN=\/usr\/local\/bin\/node/u);
    assert.ok(s.calls().some((c) => /^sudo tar -xJf .*node-v26\.13\.0-linux-x64\.tar\.xz -C \/usr\/local\/lib\/nodejs --no-same-owner$/u.test(c)));
    assert.ok(s.calls().includes("sudo ln -sfn /usr/local/lib/nodejs/node-v26.13.0-linux-x64/bin/node /usr/local/bin/node"));

    const s2 = sandbox({ curl: readFileSync(join(s.bin, "curl"), "utf8").split("\n").slice(2).join("\n") });
    try {
      r = await s2.run("NODE_ARCH=x64; install_node", { ...base, TARBALL: "something else" });
      assert.equal(r.code, 1); assert.match(r.out, /not [0-9a-f]{64} as release\.json pins it\. Nothing was installed/u);
      r = await s2.run("NODE_ARCH=x64; install_node", { ...base, LISTED: "f".repeat(64) });
      assert.equal(r.code, 1); assert.match(r.out, /SHASUMS256\.txt does not list/u);
      assert.ok(!s2.calls().some((c) => c.startsWith("sudo")), "nothing went to root");
    } finally { s2.done(); }
  } finally { s.done(); }
});

test("Docker: kept when it is there with a new enough Compose; otherwise Docker's key must have Docker's fingerprint before apt trusts it", async () => {
  const present = sandbox({ docker: 'if [ "$1 $2" = "compose version" ]; then echo "${COMPOSE:-2.29.1}"; else echo "Docker version 28.0.0"; fi' });
  try {
    let r = await present.run(`RELEASE_FILE=${JSON.stringify(RELEASE)}; install_docker`);
    assert.equal(r.code, 0, r.out); assert.match(r.out, /Docker Engine: present/u);
    r = await present.run(`RELEASE_FILE=${JSON.stringify(RELEASE)}; install_docker`, { COMPOSE: "2.10.0" });
    assert.equal(r.code, 1); assert.match(r.out, /Compose plugin is missing or older than 2\.20\.0/u);
  } finally { present.done(); }
  const fresh = sandbox({
    curl: 'while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift 2;; *) shift;; esac; done; echo key > "$out"',
    gpg: 'echo "pub:-:4096:1:8D81803C0EBFCD88:1487788586:::-:::scESA:::::::"; echo "fpr:::::::::${FPR}:"',
    dpkg: "echo amd64",
  });
  try {
    const osFile = join(fresh.root, "os"); writeFileSync(osFile, "ID=ubuntu\nVERSION_ID=\"24.04\"\nUBUNTU_CODENAME=noble\n");
    let r = await fresh.run(`RELEASE_FILE=${JSON.stringify(RELEASE)}; install_docker`, { FPR: "0000000000000000000000000000000000000000", OS_RELEASE: osFile });
    assert.equal(r.code, 1); assert.match(r.out, /not 9DC858229FC7DD38854AE2D88D81803C0EBFCD88 as Docker publishes it\. Nothing was installed/u);
    assert.ok(!fresh.calls().some((c) => c.includes("docker-ce")), "no Docker package was asked for");
    r = await fresh.run(`RELEASE_FILE=${JSON.stringify(RELEASE)}; install_docker`, { FPR: "9DC858229FC7DD38854AE2D88D81803C0EBFCD88", OS_RELEASE: osFile });
    assert.equal(r.code, 0, r.out);
    const calls = fresh.calls();
    assert.ok(calls.includes("sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin"));
    assert.ok(calls.some((c) => /^sudo install -m 0644 .* \/etc\/apt\/sources\.list\.d\/docker\.list$/u.test(c)));
    assert.ok(calls.findIndex((c) => c.startsWith("gpg")) < calls.findIndex((c) => c.includes("/etc/apt/keyrings/docker.asc")), "the key is checked before it is put where apt trusts it");
  } finally { fresh.done(); }
});

test("ports 80 and 443 must be free or this server's own Caddy's; the domain should point here, and a mismatch is said and asked about", async () => {
  const s = sandbox({
    ss: 'case "$*" in *":80 )"*) echo "LISTEN 0 4096 0.0.0.0:80 0.0.0.0:*";; esac',
    docker: 'echo "${HOLDER}"',
    getent: '[ "$1" = ahostsv4 ] && echo "${RESOLVES:-203.0.113.7} STREAM shops.example.com"; true',
    ip: 'echo "2: eth0    inet 203.0.113.7/24 brd 203.0.113.255 scope global eth0"',
  });
  try {
    let r = await s.run("HTTP_PORT=80 HTTPS_PORT=443; check_ports", { HOLDER: "geometer-ravi-abcdef-caddy-1" });
    assert.equal(r.code, 0, r.out); assert.match(r.out, /Port 80: held by this server's own HTTPS front.*\nPort 443: free/su);
    r = await s.run("HTTP_PORT=80 HTTPS_PORT=443; check_ports", { HOLDER: "nginx" });
    assert.equal(r.code, 1); assert.match(r.out, /Port 80 is used by another program \(nginx\)/u);
    r = await s.run("DOMAIN=shops.example.com; check_dns");
    assert.equal(r.code, 0, r.out); assert.match(r.out, /points at this server \(203\.0\.113\.7/u);
    r = await s.run("DOMAIN=shops.example.com; check_dns", { RESOLVES: "198.51.100.9" });
    // stdout and stderr arrive on two pipes, so each line is looked for on its own, not in an order
    assert.equal(r.code, 1); assert.match(r.out, /points at 198\.51\.100\.9, but this server's addresses are 203\.0\.113\.7/u); assert.match(r.out, /no terminal to ask on/u);
    r = await s.run("DOMAIN=shops.example.com; YES=1; check_dns", { RESOLVES: "198.51.100.9" });
    assert.equal(r.code, 0, r.out); assert.match(r.out, /keeps trying, so it can be fixed after the install/u);
    r = await s.run("DOMAIN=localhost; check_dns");
    assert.match(r.out, /local name, so Caddy makes its own certificate/u);
  } finally { s.done(); }
});

test("a Guard image file is loaded only when its sha256 is the one release.json pins for this CPU", async () => {
  const s = sandbox({ docker: 'case "$1" in image) [ -n "${HAVE_IMAGE:-}" ];; load) echo "Loaded image: geo-guard:0.1.0-alpha.2-pathways.1";; esac' });
  try {
    const file = join(s.root, "guard.tar"); writeFileSync(file, "a pretend image");
    const pinned = releaseWith(s.root, { guard_file_sha256_amd64: sha("a pretend image") });
    let r = await s.run(`ARCH=amd64 DOCKER_DIRECT=1 GUARD_FILE=${JSON.stringify(file)}; get_guard_image; echo "state: $GUARD_STATE"`, { RELEASE_FILE: pinned, HAVE_IMAGE: "1" });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /sha256 [0-9a-f]{64}, as release\.json pins it.*state: loaded from a file/su);
    assert.ok(s.calls().some((c) => c === `docker load -i ${file}`));
    const wrong = releaseWith(join(s.root, "home"), { guard_file_sha256_amd64: "0".repeat(64) });
    r = await s.run(`ARCH=amd64 DOCKER_DIRECT=1 GUARD_FILE=${JSON.stringify(file)}; get_guard_image`, { RELEASE_FILE: wrong });
    assert.equal(r.code, 1); assert.match(r.out, /not 0{64} as release\.json pins it for amd64\. It was not loaded/u);
    r = await s.run(`ARCH=amd64 DOCKER_DIRECT=1 GUARD_FILE=${JSON.stringify(file)}; get_guard_image`, { RELEASE_FILE: RELEASE });
    assert.equal(r.code, 1); assert.match(r.out, /pins no Guard image file for amd64.*Nothing was loaded/u);
    assert.equal(s.calls().filter((c) => c.startsWith("docker load")).length, 1, "only the pinned file was ever loaded");
    r = await s.run("ARCH=amd64 DOCKER_DIRECT=1; get_guard_image; echo \"state: $GUARD_STATE\"", { RELEASE_FILE: RELEASE });
    assert.match(r.out, /not on this machine.*The panel starts without it.*state: missing/su);
  } finally { s.done(); }
});

test("system files are written only when new or the install's own, never over someone else's; the geometer command keeps one shop's stop apart from the server's", async () => {
  const s = sandbox({ id: 'if [ "$1" = -u ]; then echo "${ID_U:-1000}"; else /usr/bin/id "$@"; fi' });
  try {
    const target = join(s.root, "geometer");
    const vars = `APP_DIR=/home/builder/geometer/agents SERVER_DIR=/home/builder/geometer-server NODE_BIN=${JSON.stringify(join(s.bin, "node"))} USER=builder`;
    let r = await s.run(`${vars}; put_system_file ${JSON.stringify(target)} 0755 "$(shim)"`);
    assert.equal(r.code, 0, r.out); assert.match(r.out, /written/u);
    r = await s.run(`${vars}; put_system_file ${JSON.stringify(target)} 0755 "$(shim)" || echo unchanged`);
    assert.match(r.out, /as it should be\.\nunchanged/u);
    const foreign = join(s.root, "foreign.service"); writeFileSync(foreign, "[Service]\nExecStart=/bin/true\n");
    r = await s.run(`${vars}; put_system_file ${JSON.stringify(foreign)} 0644 "$(deployer_unit)" || echo left`);
    assert.match(r.out, /was not written by this install, so it is left as it is.*\nleft/su);
    assert.equal(readFileSync(foreign, "utf8"), "[Service]\nExecStart=/bin/true\n");
    r = await s.run(`${vars}; deployer_unit`);
    assert.match(r.out, /User=builder\n.*Environment=GEOMETER_SERVER=\/home\/builder\/geometer-server\nWorkingDirectory=\/home\/builder\/geometer\/agents\nExecStart=.*bundle\/geometer\.ts apply --watch/su);

    const sc = spawnSync("shellcheck", ["-s", "bash", target], { encoding: "utf8" });
    if (sc.error === undefined) assert.equal(sc.status, 0, sc.stdout);

    // the command it writes: a stand-in node says what it was asked; `server stop` without an answer stops nothing
    writeFileSync(join(s.bin, "node"), '#!/bin/bash\necho "node $*" >> "$STUB_LOG"\ncase "$*" in *"server stop") exit 3;; esac\n');
    chmodSync(join(s.bin, "node"), 0o755);
    const shimRun = (args: string, extra: Record<string, string> = {}) => s.run(`${JSON.stringify(target)} ${args}`, extra);
    r = await shimRun("stop glow-salon");
    assert.equal(r.code, 0, r.out);
    assert.ok(s.calls().includes("node /home/builder/geometer/agents/bundle/geometer.ts stop glow-salon"), "geometer stop <shop> is still the kill switch, passed through");
    r = await shimRun("server stop");
    assert.equal(r.code, 1);
    assert.ok(!s.calls().some((c) => c.includes("systemctl") || c.endsWith("server stop --confirm")), "nothing was stopped without the answer");
    r = await shimRun("status", { ID_U: "0" });
    assert.equal(r.code, 2); assert.match(r.out, /Run geometer as builder, not as root/u);
  } finally { s.done(); }
});

test("a pairing code file must hold a code; the questions are never asked when nobody is there, and the answers come from the options", async () => {
  const s = sandbox();
  try {
    const code = join(s.root, "code"); writeFileSync(code, "gfp_abcd-efgh-jkmn-pqrs-tvwx-yz23\n");
    let r = await s.run(`SERVER_DIR=${JSON.stringify(join(s.root, "srv"))} PAIR_MODE="" DOMAIN=Shops.Example.com CODE_FILE=${JSON.stringify(code)}; ask_questions; echo "$PAIR_MODE $DOMAIN"`);
    assert.equal(r.code, 0, r.out); assert.match(r.out, /^code shops\.example\.com$/mu);
    writeFileSync(code, "123456\n");
    r = await s.run(`SERVER_DIR=${JSON.stringify(join(s.root, "srv"))} PAIR_MODE="" DOMAIN=shops.example.com CODE_FILE=${JSON.stringify(code)}; ask_questions`);
    assert.equal(r.code, 1); assert.match(r.out, /not a pairing code: it starts with gfp_/u);
    r = await s.run(`SERVER_DIR=${JSON.stringify(join(s.root, "srv"))} PAIR_MODE="" YES=1; ask_questions`);
    assert.equal(r.code, 1); assert.match(r.out, /Say the domain: --domain/u);
    r = await s.run(`SERVER_DIR=${JSON.stringify(join(s.root, "srv"))} PAIR_MODE="" YES=1 DOMAIN=shops.example.com; ask_questions`);
    assert.equal(r.code, 1); assert.match(r.out, /--pairing-code-file <file>, or --skip-pairing/u);
    r = await s.run(`SERVER_DIR=${JSON.stringify(join(s.root, "srv"))} PAIR_MODE="" DOMAIN=shops.example.com; ask_questions`);
    assert.equal(r.code, 1); assert.match(r.out, /no terminal to ask on/u);
  } finally { s.done(); }
});

test("a whole dry run says each step and changes nothing: no root command, no server folder, no code sent", async () => {
  const s = sandbox({
    uname: "echo x86_64",
    docker: 'case "$1" in compose) echo 2.29.1;; info) exit 0;; image) exit 1;; --version) echo "Docker version 28.0.0";; esac',
    node: 'case "$1" in --version) echo v26.13.0;; *) echo "node $*" >> "$STUB_LOG";; esac',
  });
  try {
    const osFile = join(s.root, "os"); writeFileSync(osFile, "ID=ubuntu\nVERSION_ID=\"24.04\"\nVERSION_CODENAME=noble\n");
    const r = await new Promise<{ code: number; out: string }>((resolve) => {
      const child = spawn(BASH, [INSTALL, "--dry-run", "--yes", "--use-this-checkout", "--domain", "localhost", "--skip-pairing", "--http-port", "8080", "--https-port", "8443"], { env: { PATH: `${s.bin}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: join(s.root, "home"), USER: "builder", STUB_LOG: join(s.root, "calls.log"), OS_RELEASE: osFile, TMPDIR: s.root }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
      let out = ""; child.stdout.on("data", (c: Buffer) => { out += c; }); child.stderr.on("data", (c: Buffer) => { out += c; });
      child.on("close", (code) => resolve({ code: code ?? 1, out }));
    });
    assert.equal(r.code, 0, r.out);
    for (const said of [/Dry run: each step is printed, nothing is changed, and no code is sent/u, /NOT A RELEASE/u, /What the install will do/u, /no pairing: the panel starts, but no alerts from outside and no licence lease/u,
      /would run: env GEOMETER_SERVER=.*geometer-server .*bundle\/geometer\.ts init .*geometer-server --domain localhost --reviewed-by builder@.* --guard-image geo-guard:0\.1\.0-alpha\.2-pathways\.1 --panel --http-port 8080 --https-port 8443/u,
      /would run: .*bundle\/geometer\.ts up/u, /Left for the panel's first run/u, /Not paired: nobody outside hears if this server goes down/u]) assert.match(r.out, said);
    assert.ok(!s.calls().some((c) => c.startsWith("sudo")), `no root command: ${s.calls().filter((c) => c.startsWith("sudo")).join("; ")}`);
    assert.ok(!existsSync(join(s.root, "home", "geometer-server")), "no server folder");
  } finally { s.done(); }
});

test("cloud-init's passwordless sudo is taken away at the end, leaving only the geometer command's verbs and passwd; --keep-sudo keeps it; nothing else is touched", async () => {
  const s = sandbox({ visudo: "exit 0" });
  try {
    const dir = join(s.root, "sudoers.d");
    mkdirSync(dir);
    const grant = join(dir, "90-cloud-init-users");
    const original = "# Created by cloud-init v. 24.1\n\n# User rules for builder\nbuilder ALL=(ALL) NOPASSWD:ALL\n\n# User rules for ubuntu\nubuntu ALL=(ALL) NOPASSWD:ALL\n";
    writeFileSync(grant, original);
    let r = await s.run(`KEEP_SUDO=1 USER=builder SUDOERS_DIR=${JSON.stringify(dir)}; narrow_sudo`);
    assert.equal(r.code, 0, r.out);
    assert.equal(readFileSync(grant, "utf8"), original, "--keep-sudo changes nothing");
    r = await s.run(`USER=builder SUDOERS_DIR=${JSON.stringify(dir)}; narrow_sudo`);
    assert.equal(r.code, 0, r.out);
    const left = readFileSync(grant, "utf8");
    assert.doesNotMatch(left, /builder/u, "the builder's line and its comment are gone");
    assert.match(left, /ubuntu ALL=\(ALL\) NOPASSWD:ALL/u, "another user's line is left as it was");
    assert.equal(readFileSync(`${grant}.before-geometer`, "utf8"), original, "the file as it was is kept, under a name sudo never reads");
    const narrow = readFileSync(join(dir, "geometer-builder"), "utf8");
    assert.match(narrow, /^builder ALL=\(root\) NOPASSWD: \/usr\/bin\/systemctl start geometer-deployer\.service, \/usr\/bin\/systemctl stop geometer-deployer\.service, \/usr\/bin\/systemctl restart geometer-deployer\.service, \/usr\/bin\/journalctl -u geometer-deployer\.service -n 100 --no-pager, \/usr\/bin\/passwd builder$/mu);
    assert.match(r.out, /To put it back: sudo passwd builder \(choose a password\), then: echo 'builder ALL=\(ALL\) NOPASSWD:ALL' \| sudo tee /u);
    assert.ok(s.calls().some((c) => c.startsWith("visudo -cqf")), "the narrow rule was checked before it went in");
    r = await s.run(`USER=builder SUDOERS_DIR=${JSON.stringify(dir)}; narrow_sudo; echo "rc=$?"`);
    assert.match(r.out, /^rc=0$/mu);
    assert.doesNotMatch(r.out, /Taking away/u, "a second run finds nothing to take away");
  } finally { s.done(); }
});

