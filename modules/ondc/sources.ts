// What the mapping was written against: the exact version, commit and date of each primary source it was read from, and their licences.
//
// Why in code: a mapping to a moving specification is only worth anything if it says WHICH specification. The adapter that comes later (a provider module) must check these
// against the contracts the network's gateway and registry enforce at that time, and a change in any of them is a reason to re-read and re-run the tests. None of the
// sources' files is copied into this repository: Beckn's core is CC BY-NC-SA 4.0, ONDC-Protocol-Specs is CC BY-ND 4.0, and the ONDC retail and services repositories carry no
// licence file at all, so the field tables in contract.ts are written by hand from reading them (the facts, not the files), each citing its source here.

export interface Source { what: string; repo: string; ref: string; commit: string; committed: string; read: string; licence: string; wireVersion: string }

export const READ_ON = "2026-11-17";

export const SOURCES: readonly Source[] = [
  { what: "Beckn core, the transaction API and its schemas", repo: "github.com/beckn/protocol-specifications", ref: "tag core-v1.1.0 (core-v1.1.1 is the latest tag)", commit: "8479762c101c385125cd66ecb907817ed6bdd231", committed: "2023-06-16", read: READ_ON, licence: "CC BY-NC-SA 4.0 (LICENSE.md), not copied", wireVersion: "core 1.1.0" },
  { what: "ONDC retail B2C (RET10 grocery, RET11 food and beverage): the attribute sheets, enums, cancellation codes and the F&B and slotted-delivery examples", repo: "github.com/ONDC-Official/ONDC-RET-Specifications", ref: "branch draft-b2c-1.2.5 (a draft: no release tag)", commit: "7a9c7e6955018ae8f758c22f3f78f7af7d8def4e", committed: "2025-08-08", read: READ_ON, licence: "no licence file, so not copied", wireVersion: "core_version 1.2.5 (its examples say 1.2.0)" },
  { what: "ONDC retail B2B: the buyer's select, init and confirm", repo: "github.com/ONDC-Official/ONDC-RET-Specifications", ref: "branch release-2.0.2 (the README's current B2B release)", commit: "aa74e5d8e0543f0b7e943d029a08ec10f8b1c0e3", committed: "2024-08-23", read: READ_ON, licence: "no licence file, so not copied", wireVersion: "version 2.0.2" },
  { what: "ONDC services (SRV): the services order with a scheduled fulfillment", repo: "github.com/ONDC-Official/ONDC-SRV-Specifications", ref: "branch draft-services (release-services, 336b256a, 2024-12-18, was compared and is a subset)", commit: "0e7ec4bc71b217098a544d4be500c907506a5dba", committed: "2025-09-05", read: READ_ON, licence: "no licence file, so not copied", wireVersion: "version 2.0.0" },
  { what: "ONDC protocol specs (the umbrella repository; its licence was read, its files were not used)", repo: "github.com/ONDC-Official/ONDC-Protocol-Specs", ref: "branch master", commit: "7f1b948a7602daa2a7746191c918d7d0e0c02636", committed: "2025-01-31", read: READ_ON, licence: "CC BY-ND 4.0, not copied", wireVersion: "core 1.0.0 and 0.9.3 tags" },
];

/** The wire versions the builders write into `context`. */
export const RETAIL_CORE_VERSION = "1.2.5";
export const B2B_VERSION = "2.0.2";
export const SERVICES_VERSION = "2.0.0";
