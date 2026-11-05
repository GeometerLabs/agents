// The deploy recipes are text, and nothing is started. The Compose file is checked by `docker compose config` (skipped, saying so, without Docker); the
// Kubernetes files are read as YAML by Ruby's built-in parser and checked for structure only (skipped without Ruby). A last group of checks ties the recipes to
// what companies/guard-config.ts writes into guard.toml (ports, paths), so the two cannot drift apart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CONTAINER_PATHS, guardToml } from "../guard-config.ts";

const DEPLOY = join(import.meta.dirname!, "..", "deploy");
const file = (name: string) => join(DEPLOY, name);
const text = (name: string) => readFileSync(file(name), "utf8");

const works = (cmd: string, args: string[]) => { try { return spawnSync(cmd, args, { stdio: "ignore" }).status === 0; } catch { return false; } };
const skipWithoutDocker: string | false = works("docker", ["compose", "version"]) ? false : "docker compose was not found on this computer";
const skipWithoutRuby: string | false = works("ruby", ["-ryaml", "-e", "1"]) ? false : "ruby (its built-in YAML parser) was not found on this computer";

const compose = (args: string[]) => spawnSync("docker", ["compose", "--env-file", file(".env.example"), "-f", file("compose.yaml"), ...args], { encoding: "utf8" });
const composeJson = () => {
  const r = compose(["--profile", "review", "config", "--format", "json"]);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout) as any;
};
const yamlDocs = (name: string): any[] => {
  const r = spawnSync("ruby", ["-ryaml", "-rjson", "-e", "puts JSON.generate(YAML.load_stream(File.read(ARGV[0])))", file(name)], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
const port = (hostPort: string) => Number(hostPort.split(":").at(-1));

test("the Compose file passes `docker compose config`, with and without the review profile, and says which variable is missing", { skip: skipWithoutDocker }, () => {
  assert.equal(compose(["config", "-q"]).status, 0);
  assert.equal(compose(["--profile", "review", "config", "-q"]).status, 0);
  const bare = spawnSync("docker", ["compose", "-f", file("compose.yaml"), "config", "-q"], { encoding: "utf8", env: { ...process.env, GEO_GUARD_IMAGE: "", AGENT_IMAGE: "" } });
  assert.notEqual(bare.status, 0);
  assert.match(bare.stderr, /GEO_GUARD_IMAGE|AGENT_IMAGE/u);
});

test("in Compose the agent is on an internal network with Guard and nothing else; only Guard can reach out; no port is published", { skip: skipWithoutDocker }, () => {
  const c = composeJson();
  assert.equal(c.networks["agent-net"].internal, true);
  assert.ok(!c.networks.egress.internal);
  assert.deepEqual(Object.keys(c.services.agent.networks), ["agent-net"], "the agent has no network with a way out");
  assert.deepEqual(Object.keys(c.services.guard.networks).sort(), ["agent-net", "egress"]);
  for (const [name, s] of Object.entries<any>(c.services)) assert.equal(s.ports, undefined, `${name} publishes no port`);
  assert.equal(c.services["record-export"].network_mode, "service:guard", "the export reaches the admin port on Guard's loopback");
});

test("in Compose each container gets only its own secret: the API's key reaches Guard alone", { skip: skipWithoutDocker }, () => {
  const c = composeJson();
  const sources = (name: string) => (c.services[name].secrets ?? []).map((s: any) => s.source);
  assert.deepEqual(sources("guard"), ["api_authorization"]);
  assert.deepEqual(sources("agent"), ["guard_agent_token"]);
  assert.deepEqual(sources("record-export"), ["guard_admin_token"]);
  assert.equal(c.services.guard.secrets[0].target, "/run/secrets/api_authorization", "where guard.toml reads the key from");
  assert.equal(c.services.guard.read_only, true);
  assert.equal(c.services.guard.user, "65532:65532");
});

test("the Compose file and the guard.toml the kit writes agree on ports and paths", { skip: skipWithoutDocker }, () => {
  const c = composeJson();
  const toml = guardToml({ tenant: "t", tool: "x", deployment: "d", upstream: "api.example.com:443", tls: true, agents: [{ id: "agent", sha256: "0".repeat(64) }] });
  const agentPort = port(CONTAINER_PATHS.listen), adminPort = port(CONTAINER_PATHS.adminListen), healthPort = port(CONTAINER_PATHS.healthListen);
  assert.equal(c.services.agent.environment.API_BASE_URL, `http://guard:${agentPort}`);
  assert.ok(c.services.guard.healthcheck.test.includes(`127.0.0.1:${healthPort}/readyz`));
  assert.ok(c.services["record-export"].command.join(" ").includes(`--admin http://127.0.0.1:${adminPort} `));
  const mounts = c.services.guard.volumes.map((v: any) => v.target);
  assert.ok(mounts.includes("/etc/geo-guard"), "bundle and config folder");
  assert.ok(CONTAINER_PATHS.bundle.startsWith("/etc/geo-guard/"));
  assert.ok(mounts.includes(CONTAINER_PATHS.state.slice(0, CONTAINER_PATHS.state.lastIndexOf("/"))), "the folder the store lives in");
  assert.ok(toml.includes(`\${file:/run/secrets/api_authorization}`), "the key is read from the file Compose mounts");
  const exporter = c.services["record-export"];
  assert.ok(exporter.command.join(" ").includes("/var/lib/geo-guard/export"), "the folder, as Guard sees it, that the backup goes to");
  assert.ok(mounts.includes("/var/lib/geo-guard/export"), "and Guard has it mounted");
  // the export reads that same folder, read-only, and copies only the two files reviewers need: it never gets the keys by a writable path
  const backups = exporter.volumes.find((v: any) => v.target === "/backups");
  assert.equal(backups.read_only, true);
  assert.equal(backups.source, c.services.guard.volumes.find((v: any) => v.target === "/var/lib/geo-guard/export").source, "the same folder");
  assert.ok(exporter.command.join(" ").includes("--backup-read-dir /backups"));
  assert.match(exporter.command.join(" "), /--out \/export\/\$+\(date -u/u, "every run makes a new dated folder");
});

test("the Kubernetes sidecar: two containers, the API's key in Guard's alone, probes on the health port, one replica that does not overlap itself", { skip: skipWithoutRuby }, () => {
  const [claim, deployment] = yamlDocs("kubernetes-sidecar.yaml");
  assert.equal(claim.kind, "PersistentVolumeClaim");
  assert.equal(deployment.kind, "Deployment");
  assert.equal(deployment.spec.replicas, 1);
  assert.equal(deployment.spec.strategy.type, "Recreate");
  const pod = deployment.spec.template.spec;
  assert.deepEqual(pod.containers.map((c: any) => c.name), ["agent", "guard"]);
  const [agent, guard] = pod.containers;
  const volumeOf = (name: string) => pod.volumes.find((v: any) => v.name === name);
  const mountsOf = (c: any) => (c.volumeMounts ?? []).map((m: any) => m.name);
  assert.deepEqual(mountsOf(agent), ["guard-agent-token"]);
  assert.deepEqual(mountsOf(guard).sort(), ["api-key", "guard-config", "guard-state"]);
  assert.equal(volumeOf("api-key").secret.secretName, "api-key");
  assert.equal(volumeOf("api-key").secret.items[0].path, "api_authorization", "the file name guard.toml reads");
  assert.equal(volumeOf("guard-state").persistentVolumeClaim.claimName, claim.metadata.name);
  for (const c of pod.containers) assert.equal(c.securityContext.readOnlyRootFilesystem, true);
  assert.deepEqual(Object.fromEntries(agent.env.map((e: any) => [e.name, e.value])), { API_BASE_URL: `http://127.0.0.1:${port(CONTAINER_PATHS.listen)}`, API_TOKEN_FILE: "/run/secrets/guard/token" });
  const health = guard.ports.find((p: any) => p.name === "health");
  assert.equal(health.containerPort, port(CONTAINER_PATHS.healthListen));
  assert.equal(guard.readinessProbe.httpGet.path, "/readyz");
  assert.equal(guard.livenessProbe.httpGet.path, "/healthz");
  assert.equal(guard.readinessProbe.httpGet.port, "health");
  assert.deepEqual(guard.args, ["run", "--config", "/etc/geo-guard/guard.toml"]);
  assert.equal(pod.automountServiceAccountToken, false);
});

test("the Kubernetes sidecar file says what it does not separate", () => {
  const t = text("kubernetes-sidecar.yaml");
  assert.match(t, /does NOT stop the agent container from calling the API directly/u);
  assert.match(t, /kubernetes-network-policy\.yaml/u);
});

test("the network-policy file: agent pods may reach Guard's service and DNS only; Guard takes the agent port from those pods only", { skip: skipWithoutRuby }, () => {
  const docs = yamlDocs("kubernetes-network-policy.yaml");
  assert.deepEqual(docs.map((d) => d.kind), ["Service", "NetworkPolicy", "NetworkPolicy"]);
  const [service, agents, guard] = docs;
  assert.equal(service.spec.ports[0].port, port(CONTAINER_PATHS.listen));
  assert.deepEqual(agents.spec.policyTypes, ["Egress"]);
  assert.deepEqual(agents.spec.podSelector.matchLabels, { "geo-guard/agent": "true" });
  assert.equal(agents.spec.egress.length, 2, "Guard and DNS, nothing else");
  assert.deepEqual(agents.spec.egress[0].to[0].podSelector.matchLabels, service.spec.selector);
  assert.deepEqual(agents.spec.egress[0].ports, [{ port: port(CONTAINER_PATHS.listen), protocol: "TCP" }]);
  assert.deepEqual(guard.spec.podSelector.matchLabels, service.spec.selector);
  assert.deepEqual(guard.spec.ingress[0].from[0].podSelector.matchLabels, { "geo-guard/agent": "true" });
  assert.ok(!JSON.stringify(guard.spec.ingress).includes(String(port(CONTAINER_PATHS.adminListen))), "the admin port is not opened to anyone");
});

test("no deploy file holds a key, a token or a real credential hash", () => {
  for (const name of readdirSync(DEPLOY)) {
    const t = text(name);
    assert.doesNotMatch(t, /sk_(live|test)_[A-Za-z0-9]/u, name);
    assert.doesNotMatch(t, /Bearer\s+[A-Za-z0-9_-]{12,}/u, name);
    assert.doesNotMatch(t, /gg_[0-9a-f]{32}/u, name);
    assert.doesNotMatch(t, /(?<![0-9a-f])(?!0{64})[0-9a-f]{64}(?![0-9a-f])/u, `${name} holds something that looks like a hash`);
  }
});
