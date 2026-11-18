// What the owner's private page shows for a listings-only shop (modules/channels/owner-page.ts): nothing waiting and nothing coming, because there are no cases. The
// owner's real work is on the listings page and in the talk box (the assistant's cards). Pure.
import type { OwnerView } from "../../../../modules/channels/backend.ts";
import type { Settings } from "./settings.ts";

export const ownerView = (settings: Settings): OwnerView => ({
  shop: { name: settings.name, timezone: settings.timezone, ownerLanguage: settings.owner.language }, kind: "listings", services: [], items: [], upcoming: [],
});
