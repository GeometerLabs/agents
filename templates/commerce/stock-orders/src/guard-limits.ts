// What Stock orders asks of the WhatsApp Guard: the numbers a message may go to. A Stock orders shop writes to its owner and to the suppliers on its approved list, and to
// nobody else, so the Guard in front of WhatsApp is told exactly those numbers (bundle/generate/guards.ts whatsappSpec, rule "approved-recipients-only") and refuses a send to any
// other. It is the same list the agent keeps in its own `approved-supplier-only` rule, held a second time outside the agent: a supplier set to "paused" in the settings is out of
// the list the next time the shop's Guard is generated, whatever the agent does.
//
// What this does NOT do, and the README says so: the per-order cap and the month's budget are amounts, and a WhatsApp message carries no amount Guard can read, so no Guard rule
// holds them. They are held by the agent (limits.ts) and by the owner's approval card; Deferred.md has the row.
import type { Settings } from "./settings.ts";

/** The owner and the approved suppliers, each number as the settings write it and without the plus sign (what the wire body may carry): exact values for the Guard's allowlist. */
export function approvedRecipients(settings: Pick<Settings, "owner" | "suppliers">): string[] {
  const numbers = [settings.owner.whatsapp, ...settings.suppliers.filter((s) => s.approved).map((s) => s.whatsapp)];
  return [...new Set(numbers.flatMap((n) => [n, n.replace(/\D/gu, "")]))].sort();
}
