// The signing module's public surface in one import. Pure part: canonical.ts (no imports). Server part: keys.ts, sign.ts, jws.ts (node:crypto).
export { canonicalBytes, canonicalJson, CanonicalError } from "./canonical.ts";
export type { Canonical } from "./canonical.ts";
export { generateSigningKey, keyIdOf, privateText, publicKeyObject, publicTextOf, rawOfPublic, signingKeyFromText, signingKeyOf } from "./keys.ts";
export type { SigningKey } from "./keys.ts";
export { ALG, signAnswer, signFeed, signNotice, signValue, verifyDocument, verifyNotice, verifyValue } from "./sign.ts";
export type { Sealed, Verified } from "./sign.ts";
export { signCard, verifyCard } from "./jws.ts";
export type { CardSignature } from "./jws.ts";
