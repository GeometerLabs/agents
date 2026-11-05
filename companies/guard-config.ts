// The guard.toml for one company's Guard, in Guard's production profile. It is the same file whether Guard runs as a Compose sidecar, a Kubernetes sidecar or on
// a plain host, and the end-to-end test starts the real Guard from what this writes.
//
// It holds no secret. The agent's and the operator's tokens appear only as sha256 hashes (`geo-guard credential` prints a token and its hash), and the API's own
// key is read from a file only Guard can read. Until you put real hashes in, the all-zero ones match no token, so a Guard started from an unedited file lets nobody in.
export const ZERO_HASH = "0".repeat(64);
export const ZERO_DIGEST = `sha256:${ZERO_HASH}`;

/** Where things are inside Guard's container. A test that runs the program on this computer gives its own. */
export const CONTAINER_PATHS = { listen: "0.0.0.0:8080", adminListen: "127.0.0.1:8082", healthListen: "0.0.0.0:8081", state: "/var/lib/geo-guard/state.db", bundle: "/etc/geo-guard/bundle.json" };

export interface GuardConfigOptions {
  /** The client, exactly as in the spec. Guard refuses to start if they differ. */
  tenant: string;
  /** The upstream's name, exactly as in the spec. */
  tool: string;
  /** Guard's name in its own records. */
  deployment: string;
  /** `host:port` of the API Guard sends to. */
  upstream: string;
  /** True when the API is reached over HTTPS (the usual case). False only for a stand-in on your own computer. */
  tls: boolean;
  /** The digest `geo-guard compile` printed. Guard will not load a bundle file that does not hash to it. */
  bundleDigest?: string;
  /** The header the API wants its own key in, and the file Guard reads the value from. The whole header value is on one line, `Bearer sk_live_...` included. */
  authHeader?: { name: string; file: string };
  /** Agents that may call Guard, by id and the sha256 of their token. */
  agents: { id: string; sha256: string; operations?: string[] }[];
  /** The sha256 of the operator's token (the admin port: approvals, the kill switch, decisions). */
  adminSha256?: string;
  /** Operations that hold for a person (the spec's `call_bound_approval` rules). A role that may approve them is written. */
  approvalOperations?: string[];
  paths?: Partial<typeof CONTAINER_PATHS>;
}

const q = (s: string) => JSON.stringify(s);

export function guardToml(o: GuardConfigOptions): string {
  const where = { ...CONTAINER_PATHS, ...o.paths };
  const header = o.authHeader ?? { name: "Authorization", file: "/run/secrets/api_authorization" };
  const lines = [
    `# guard.toml for ${o.deployment}. Written by companies/guard-config.ts; edit it freely, it is yours.`,
    `# It holds no secret: tokens are sha256 hashes (geo-guard credential prints a token and its hash), and the API's key is read from a file only Guard can read.`,
    `# The all-zero hashes below match no token, so a Guard started from an unedited file lets nobody in.`,
    `schema = 2`,
    `profile = "production"`,
    `# The agent port is the only way the agent reaches the API. The admin port stays on loopback; reach it from a container that shares Guard's network.`,
    `listen = ${q(where.listen)}`,
    `admin_listen = ${q(where.adminListen)}`,
    `health_listen = ${q(where.healthListen)}`,
    `deployment = ${q(o.deployment)}`,
    `tenant = ${q(o.tenant)}`,
    `tool = ${q(o.tool)}`,
    `mode = "enforce"`,
    `upstream = ${q(o.upstream)}`,
    `upstream_timeout_ms = 15000`,
    `state = ${q(where.state)}`,
    `bundle = ${q(where.bundle)}`,
    `# Guard will not load a bundle that does not hash to this. All zeros never matches, so it will not start until the real digest is here.`,
    `bundle_digest = ${q(o.bundleDigest ?? ZERO_DIGEST)}`,
    `unlisted_tools = "deny"`,
    ``,
    `[[admins]]`,
    `id = "ops"`,
    `token_sha256 = ${q(o.adminSha256 ?? ZERO_HASH)}`,
  ];
  for (const a of o.agents) {
    lines.push(``, `[[agents]]`, `id = ${q(a.id)}`, `token_sha256 = ${q(a.sha256)}`, `tenant = ${q(o.tenant)}`);
    if (a.operations && a.operations.length > 0) lines.push(`operations = [${a.operations.map(q).join(", ")}]`);
  }
  lines.push(``, `[upstream_headers]`, `${/^[A-Za-z0-9_-]+$/u.test(header.name) ? header.name : q(header.name)} = ${q("${file:" + header.file + "}")}`);
  if (o.tls) lines.push(``, `[upstream_tls]`);
  if (o.approvalOperations && o.approvalOperations.length > 0) {
    lines.push(
      ``, `# Who may approve a held call. Guard's admin credential alone never approves: an approver needs a role that covers the call.`,
      `# Issue an approver a credential that expires with POST /admin/approvers (see companies/README.md, "Approvals").`,
      `[[roles]]`, `id = "approver"`, `tools = [${q(o.tool)}]`, `operations = [${o.approvalOperations.map(q).join(", ")}]`, `rules = ["*"]`, `tenants = [${q(o.tenant)}]`,
    );
  }
  return `${lines.join("\n")}\n`;
}
