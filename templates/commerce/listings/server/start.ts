// Start ONE listings-only shop's runtime from its folder: read the folder, open its store, resume what was left pending, listen, tick. The start sequence is the same for every
// template (modules/runtime/start.ts); this file gives it this template's client, store and runtime. A shared process (modules/runtime/shared.ts) calls this once for each shop it
// holds, with that shop's own folder, tokens and port, so a shop run alone and a shop run in the shared process are the same code.
import { join } from "node:path";
import { PAGES_FILE, pagesReader, picturesOf } from "../../../../modules/channels/pages-file.ts";
import { pushMessaging } from "../../../../modules/push/push.ts";
import type { Clock } from "../../../../modules/core/clock.ts";
import { licenceReader } from "../../../../modules/runtime/config.ts";
import { buildUnderstanding as understanding, startRuntimeClient } from "../../../../modules/runtime/start.ts";
import type { RunningClient as SharedRunningClient, StartOptions as SharedStartOptions } from "../../../../modules/runtime/start.ts";
import { OWNER_UNDERSTANDING, buildTalker } from "../../../../modules/assistant/understanding.ts";
import type { OwnerParser } from "../../../../modules/assistant/reading.ts";
import { loadClient, pathwayVersion } from "./config.ts";
import type { ClientFolder } from "./config.ts";
import { createRuntime } from "./runtime.ts";
import type { Runtime } from "./runtime.ts";

export type StartOptions = SharedStartOptions & { clock?: Clock };
export type RunningClient = SharedRunningClient<ClientFolder["settings"], Runtime> & { client: ClientFolder };

export async function startClient(options: StartOptions): Promise<RunningClient> {
  return await startRuntimeClient<ClientFolder["settings"], Runtime>(options, {
    casesName: "listings",
    loadClient,
    async build(client, { store, clock, log, recordKey, ownerSignin, push }) {
      // no WhatsApp: the push-only stand-in. A message to the owner is pushed when a phone has alerts on and otherwise refused with a plain sentence (the owner's app lists it).
      const messaging = pushMessaging(undefined, push, client.settings.owner.whatsapp, clock);
      const reading = understanding(client as never, { clock, log }, OWNER_UNDERSTANDING as never);
      const talker = buildTalker(client as never, { clock, log });
      return createRuntime({
        settings: client.settings, store, clock, services: { messaging }, ai: reading.ai, ownerParser: reading.parser as unknown as OwnerParser, ...(talker ? { talker } : {}),
        pathwayVersion: pathwayVersion(), licence: licenceReader(client.folder, clock), ...(recordKey ? { recordKey } : {}), ...(ownerSignin ? { ownerSignin } : {}), ...(push ? { push } : {}),
        pictures: () => picturesOf(pagesReader(join(client.folder, PAGES_FILE))()), log,
      });
    },
  }) as RunningClient;
}
