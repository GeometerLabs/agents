// The lab agent's actions, as plain functions. They call the lab-information service named by LIMS_URL. A
// protocol step runs once per sample (the service's own list of steps is read first and again after a call
// that got no answer); discarding a sample waits for a scientist's approval id.
const env = process.env;

export const cfg = { url: env.LIMS_URL ?? "http://lims.example", timeout: Number(env.TOOL_TIMEOUT_MS ?? "30000") };

/** One request: {status, body}, or null when no answer came. */
export async function call(method: string, path: string, body?: unknown, key?: string) {
  try {
    const r = await fetch(cfg.url + path, {
      method,
      headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.timeout),
    });
    return { status: r.status, body: (await r.json().catch(() => null)) as any };
  } catch {
    return null;
  }
}

async function stepOf(sample: string, step: string) {
  const r = await call("GET", `/v1/samples/${sample}/steps`);
  return r?.status === 200 ? (r.body as any[]).find((s) => s.step === step) : undefined;
}

export async function getSample(sample: string) {
  const r = await call("GET", `/v1/samples/${sample}`);
  return r?.status === 200 ? r.body : "no such sample";
}

export async function runStep(sample: string, step: string) {
  const r = await call("GET", `/v1/samples/${sample}`);
  if (r?.status !== 200) return "no such sample; nothing was run";
  const done = await stepOf(sample, step);
  if (done) return `already run: ${JSON.stringify(done)}`;
  const body = { step, volume_ml: r.body.volume_ml };
  for (let attempt = 0; attempt < 2; attempt++) { // no answer: look whether it ran before trying once more
    const sent = await call("POST", `/v1/samples/${sample}/steps`, body, `step-${sample}-${step}`);
    if (sent) return sent.body;
    const seen = await stepOf(sample, step);
    if (seen) return `run: ${JSON.stringify(seen)}`;
  }
  return "no answer from the lab service; whether the step ran is unknown.";
}

export async function discardSample(sample: string, approval = "") {
  const r = await call("GET", `/v1/samples/${sample}`);
  if (r?.status !== 200) return "no such sample; nothing was discarded";
  if (!approval) return `held: discarding ${sample} needs a scientist's approval id`;
  const body = { volume_ml: r.body.volume_ml, approval };
  const sent = await call("POST", `/v1/samples/${sample}/discard`, body, `discard-${sample}`);
  return sent ? sent.body : "no answer from the lab service; whether the sample was discarded is unknown.";
}
