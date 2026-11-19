// The vector files of the packages that come after the shared core: every module here returns `[path under go/internal, value]` pairs. Added to as each Go package is ported.
export async function all(): Promise<[string, unknown][]> {
  const out: [string, unknown][] = [];
  const modules: string[] = ["./razorpay.ts"];
  for (const m of modules) out.push(...await (await import(m)).files());
  return out;
}
