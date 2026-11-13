// A booking's calendar file (plan item 11h, decision 45): what a customer without WhatsApp keeps instead of a reminder message. Served by the public front at
// <the booking's page>/booking.ics (front.ts), made from the booking's saved state as its own page shows it (BookingView), never from anything the customer typed.
//
// RFC 5545, the least that every phone's calendar reads: one VEVENT with a stable UID (the booking's reference and part of its handle's hash, so adding it twice
// updates one event), UTC times, CRLF line endings, escaped text and lines folded at 75 octets. The booking page's address is NOT written in: it is the booking's
// bearer link, and a calendar file is synced to other companies' servers. The file says where to look instead ("your booking's page").
import type { BookingView } from "./backend.ts";

/** The calendar's words, per language. Machine-written in Hindi, Malayalam and Kannada, like the page. */
const DESCRIPTION: Record<string, (ref: string) => string> = {
  en: (ref) => `Booking reference: ${ref}. Your booking's page has the details.`,
  hi: (ref) => `बुकिंग संदर्भ: ${ref}। पूरी जानकारी आपकी बुकिंग के पेज पर है।`,
  ml: (ref) => `ബുക്കിംഗ് റഫറൻസ്: ${ref}. വിവരങ്ങൾ നിങ്ങളുടെ ബുക്കിംഗ് പേജിൽ ഉണ്ട്.`,
  kn: (ref) => `ಬುಕಿಂಗ್ ಉಲ್ಲೇಖ: ${ref}. ವಿವರಗಳು ನಿಮ್ಮ ಬುಕಿಂಗ್ ಪುಟದಲ್ಲಿವೆ.`,
};

/** Text as RFC 5545 wants it: backslash, semicolon, comma and line breaks escaped. */
export const icsText = (s: string): string => s.replace(/\\/gu, "\\\\").replace(/;/gu, "\\;").replace(/,/gu, "\\,").replace(/\r?\n/gu, "\\n");

/** One content line folded at 75 octets (a fold is CRLF and a space), never inside a character. */
export function fold(line: string): string {
  const out: string[] = [];
  let cur = "";
  let size = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (size + n > (out.length === 0 ? 75 : 74)) { out.push(cur); cur = ""; size = 0; }
    cur += ch; size += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const stamp = (ms: number): string => new Date(ms).toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");

/** The file for a booking that has a time, or undefined (nothing held, a refusal, a page still waiting). */
export function bookingIcs(o: { view: BookingView; shop: { name: string; address?: string }; language: string; handleHash: string; host: string; nowMs: number }): string | undefined {
  const v = o.view;
  if (!("ref" in v) || v.startMs === undefined) return undefined;
  if (v.status !== "held" && v.status !== "booked" && v.status !== "checking" && v.status !== "cancelled" && v.status !== "done") return undefined;
  const service = v.service?.names[o.language as keyof NonNullable<typeof v.service>["names"]] ?? v.service?.names.en ?? "";
  const end = v.endMs ?? v.startMs + (v.service?.durationMinutes ?? 30) * 60_000;
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Geometer//Shop page//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${v.ref}.${o.handleHash.slice(0, 16)}@${o.host}`,
    `DTSTAMP:${stamp(o.nowMs)}`, `DTSTART:${stamp(v.startMs)}`, `DTEND:${stamp(end)}`,
    `SUMMARY:${icsText(service ? `${service}, ${o.shop.name}` : o.shop.name)}`,
    ...(o.shop.address ? [`LOCATION:${icsText(o.shop.address)}`] : []),
    `DESCRIPTION:${icsText((DESCRIPTION[o.language] ?? DESCRIPTION.en)(v.ref))}`,
    // held: the time is kept only until the deposit is paid; cancelled: a calendar that has the event marks it so when the file is opened again
    `STATUS:${v.status === "cancelled" ? "CANCELLED" : v.status === "held" || v.status === "checking" ? "TENTATIVE" : "CONFIRMED"}`,
    "END:VEVENT", "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
