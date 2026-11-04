// The agents someone else wrote that have been deployed, as the compose file and the shared services' configs need to know them. Read from what was APPLIED (the state file), not
// from the agent's folder, so a shop's deploy puts every agent back exactly as it was (and never takes its Guards away with `up --remove-orphans`). Kept apart from the agent's own
// deploy (agent/deploy.ts) because deploy.ts needs this and agent/deploy.ts needs deploy.ts.
import type { Settings } from "../../pathways/bookings/src/settings.ts";
import type { AgentFacts } from "../generate/configs.ts";
import { readSecretFile, secretFile } from "../lib/secrets.ts";
import type { State } from "../lib/state.ts";
import type { AgentFile } from "./folder.ts";

const have = (dir: string, container: string, ...file: string[]) => !!readSecretFile(secretFile(dir, container, ...file));

export function agentFacts(dir: string, state: State): AgentFacts[] {
  return Object.entries(state.agents ?? {}).filter(([, a]) => a.applied).sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, a]) => {
    const snap = a.applied!;
    const agent = JSON.parse(snap.agentText) as AgentFile;
    const settings = JSON.parse(snap.settingsText) as Pick<Settings, "name" | "timezone" | "owner">;
    const meta = have(dir, "inbox", name, "whatsapp_app_secret");
    return {
      name, index: a.index, guards: Object.values(snap.guards).map((g) => ({ kind: g.kind as "razorpay", service: g.service, tenant: name })),
      createdAt: agent.createdAt, ownerWhatsapp: settings.owner.whatsapp, ...(agent.whatsapp ? { phoneNumberId: agent.whatsapp.phoneNumberId } : {}), ...(agent.calendar ? { calendarId: agent.calendar.calendarId } : {}),
      verification: !meta && have(dir, "inbox", name, "whatsapp_path_token") ? "path-token" : "meta-signature",
      hasGoogle: have(dir, "refresher", name, "google_service_account.json") || have(dir, "refresher", "_server", "google_service_account.json"), ownGoogleKey: have(dir, "refresher", name, "google_service_account.json"),
      ...(agent.whatsapp?.forwardTo ? { forwardTo: agent.whatsapp.forwardTo } : {}),
      business: { name: settings.name, timeZone: settings.timezone, ownerLanguage: settings.owner.language },
    };
  });
}
