// The name and phone number a customer types on the booking page, or an AI assistant passes for its user, checked and put in one shape. Used by the public front
// (before anything is sent to the runtime) and by the runtime's check of a channel event (modules/channels/events.ts), so both read them the same way.
//
// The number is typed, never verified (an OTP by SMS needs DLT registration in India: Deferred.md). It is kept so the owner can call the customer, and it counts for the
// per-number limits; it is never used to find a booking, and nothing is ever sent to it from the shop's WhatsApp.

/** An Indian mobile number written any usual way ("98111 11111", "+91-9811111111", "09811111111"), or another country's number in full with its +. */
export function normalisePhone(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length > 32) return undefined;
  const trimmed = raw.trim();
  if (!/^\+?[\d\s().-]+$/u.test(trimmed)) return undefined;
  const digits = trimmed.replace(/\D/gu, "");
  if (trimmed.startsWith("+")) {
    if (digits.startsWith("91")) return /^91[6-9]\d{9}$/u.test(digits) ? `+${digits}` : undefined;
    return /^[1-9]\d{7,14}$/u.test(digits) ? `+${digits}` : undefined;
  }
  // without a +: a 10-digit Indian mobile, maybe with a leading 0 or 91
  const local = digits.length === 11 && digits.startsWith("0") ? digits.slice(1) : digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/u.test(local) ? `+91${local}` : undefined;
}

export const NAME_MAX = 60;

/** A person's name as they typed it: 1 to 60 characters, letters of any script, spaces and . ' -. No digits (a number in a name field is usually a mistake), no markup. */
export function normaliseName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const name = raw.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (name.length === 0 || name.length > NAME_MAX) return undefined;
  return /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(name) ? name : undefined;
}

/** The digits of a number, for comparing two numbers however they were written. */
export const phoneDigits = (phone: string): string => phone.replace(/\D/gu, "");
