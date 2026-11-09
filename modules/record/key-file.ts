// Reading a fingerprint key from its file's text. Apart from fingerprint.ts because this needs Node's Buffer, and fingerprint.ts is part of the browser demo's build.

export const KEY_BYTES = 32;

/** A key file's text as a key: 64 hex digits, however it is padded with newlines. Anything else is refused, never used as a key. */
export function parseKey(text: string, what = "The fingerprint key"): Buffer {
  const hex = text.trim();
  if (!/^[0-9a-fA-F]+$/u.test(hex) || hex.length !== KEY_BYTES * 2) throw new Error(`${what} is not ${KEY_BYTES} bytes written as hex.`);
  return Buffer.from(hex, "hex");
}
