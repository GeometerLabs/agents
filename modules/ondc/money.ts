// Money for the ONDC mapping: our whole paise to ONDC's decimal strings and back, with integers only.
//
// Why a file of its own: ONDC writes every amount as a decimal STRING in rupees ("229", "3257.65", "-1000"; Beckn's DecimalValue is `[+-]?([0-9]*[.])?[0-9]+`), while every shop
// of ours counts money as a whole number of paise (or whole rupees, which the views turn into paise exactly). A float anywhere between the two (175.5 * 100, "3257.65" * 100)
// can drift by a paisa and make a quote that does not add up, so both directions here use integer division and a strict pattern, never `parseFloat` or `Number(string)`.

/** Whole paise to ONDC's string: "229" for 22900, "175.50" for 17550, "-10.05" for -1005. A whole rupee has no decimals, anything else has exactly two. */
export function rupees(paise: number): string {
  if (!Number.isSafeInteger(paise)) throw new Error(`An amount must be a whole number of paise, not ${paise}.`);
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  const whole = Math.trunc(abs / 100);
  const part = abs % 100;
  return part === 0 ? `${sign}${whole}` : `${sign}${whole}.${String(part).padStart(2, "0")}`;
}

const DECIMAL = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/u;

/** ONDC's string to whole paise. Accepts "229", "229.0", "3257.65", "-1000"; refuses more than two decimals (that is not a whole number of paise), blanks and anything else. */
export function paiseOf(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const m = DECIMAL.exec(value.trim());
  if (!m) return undefined;
  const paise = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(paise)) return undefined;
  return m[1] === "-" ? -paise : paise;
}

/** Whole rupees (which Orders and Bookings keep) to paise, exactly. */
export const paiseOfRupees = (rupeesWhole: number): number => {
  if (!Number.isSafeInteger(rupeesWhole)) throw new Error(`An amount in rupees must be a whole number, not ${rupeesWhole}.`);
  return rupeesWhole * 100;
};

/** ONDC's price object for an amount in paise. */
export const price = (paise: number): { currency: "INR"; value: string } => ({ currency: "INR", value: rupees(paise) });
