// Vector cases for go/internal/payments/upi: the `upi://pay` link (modules/payments/providers/upi/link.ts) on awkward UPI IDs, names, notes and amounts, with the exact words of every problem.
import { amountText, normaliseVpa, payeeProblem, upiPayLink, vpaProblem } from "../../../modules/payments/providers/upi/link.ts";

const attempt = <T>(f: () => T): { ok: T } | { error: string } => { try { return { ok: f() }; } catch (e) { return { error: (e as Error).message }; } };

export function upiVectors(): unknown {
  const vpas = ["glowsalon@okicici", "  GlowSalon@OkICICI ", "", "   ", "nope", "a@b", "ab@c1", "ab@cd", "a.b-c_d@oksbi", "x".repeat(256) + "@ok", "x".repeat(257) + "@ok", "ab@" + "o" + "k".repeat(64), "ab@" + "o" + "k".repeat(65), "ab@1bank", "é@okicici", "ab@ok@icici", "ab cd@okicici", "AB@OKİ"];
  const names = ["Glow Salon", "  Glow Salon  ", "", "  ", "Glow\nSalon", "Glow\tSalon", "Glow\u0007Salon", "x".repeat(50), "x".repeat(51), "é".repeat(50), "é".repeat(51), "😀".repeat(50), "😀".repeat(51), "Salon & Spa (Main)!", " Glow "];
  const amounts = [1, 99, 100, 20000, 100000, 100001, 10_000_000, 10_000_001, 0, -5, 150.5];
  const notes = ["Glow Salon b-3", "", "  a   b\t\nc  ", "x".repeat(60), "é".repeat(60), "😀".repeat(60), "a&b=c", "50% off ~ (x) *y* !z '", " a b"];
  const links = [];
  for (const note of notes) links.push({ vpa: "glowsalon@okicici", payee: "Glow Salon", amountPaise: 60000, note });
  for (const amountPaise of amounts) links.push({ vpa: "glowsalon@okicici", payee: "Glow Salon", amountPaise, note: "b-3" });
  for (const vpa of vpas) links.push({ vpa, payee: "Glow Salon", amountPaise: 100, note: "n" });
  for (const payee of names) links.push({ vpa: "glowsalon@okicici", payee, amountPaise: 100, note: "n" });
  links.push({ vpa: "Glow.Salon@OkICICI", payee: " Salon & Spa (Main)! ", amountPaise: 123456, note: "Case b-3 ✓" });
  return {
    vpa: vpas.map((v) => ({ v, problem: vpaProblem(v), normal: normaliseVpa(v) })),
    payee: names.map((n) => ({ n, problem: payeeProblem(n) })),
    amount: amounts.map((a) => ({ a, out: attempt(() => amountText(a)) })),
    link: links.map((l) => ({ ...l, out: attempt(() => upiPayLink(l)) })),
  };
}

export async function files(): Promise<[string, unknown][]> {
  return [["payments/upi/testdata/upi-vectors.json", upiVectors()]];
}
