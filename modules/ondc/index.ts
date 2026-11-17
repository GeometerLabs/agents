// The mapping from our records to Beckn and ONDC, in one place: outbound builders, the inbound reader, the state and gap tables, and the required-field lists that hold a message
// to its contract. Pure: no disk, no network, no database, and nothing from a template. A template's own `src/ondc.ts` turns its store and settings into the neutral types;
// a later ONDC adapter (a provider module) calls these and does the signing and the network, which are not here (modules/Deferred.md).
export * from "./money.ts";
export * from "./types.ts";
export * from "./states.ts";
export * from "./gaps.ts";
export * from "./common.ts";
export * as retail from "./retail.ts";
export * as services from "./services.ts";
export * as b2b from "./b2b.ts";
export * from "./inbound.ts";
export * as contract from "./contract.ts";
export { SOURCES, READ_ON } from "./sources.ts";
