// The shop's accounts: the stable codes the books write, and the words an accountant reads in the export.
//
// Why codes and not names: a code goes into the record (`refs`), which is hash-chained and never rewritten, so it must never change. The words for it may change
// (and the owner's own words, in four languages, are in words.ts, never these). An account a service names is `revenue:<service id>`; every other code is fixed here.
//
// What the books cover: the money that went through the shop's agent (deposits, advances, fees, refunds), not the shop's whole business. Money paid at the shop
// is not here (the owner's decision of 15 Nov 2026, plan Q1).

/** asset: the shop holds it. liability: the shop holds it for someone else. income and expense: the result. Contra-income (discounts, returns) is income with a debit balance. */
export type AccountKind = "asset" | "liability" | "income" | "expense";

export interface Account { code: string; kind: AccountKind; /** The accountant's words (the export). */ accountant: string }

/** How the money moved. A gateway's money sits in `gateway` until it is settled into the shop's bank (settlements, plan step 6). */
export type Method = "gateway" | "upi" | "cash" | "bank";

export const ACCOUNTS = {
  cash: { code: "cash", kind: "asset", accountant: "Cash in hand" },
  upi: { code: "upi", kind: "asset", accountant: "Bank (UPI receipts, marked by owner)" },
  bank: { code: "bank", kind: "asset", accountant: "Bank (transfers, marked by owner)" },
  gateway: { code: "gateway", kind: "asset", accountant: "Payment gateway clearing" },
  bankSettled: { code: "bank_settled", kind: "asset", accountant: "Bank (gateway settlements)" },
  receivable: { code: "receivable", kind: "asset", accountant: "Sundry debtors (fees)" },
  advances: { code: "advances", kind: "liability", accountant: "Customer advances and deposits" },
  refundsOwed: { code: "refunds_owed", kind: "liability", accountant: "Refunds payable to customers" },
  fees: { code: "revenue:fees", kind: "income", accountant: "Fees" },
  orders: { code: "revenue:orders", kind: "income", accountant: "Sales (orders)" },
  lateFees: { code: "revenue:late_fees", kind: "income", accountant: "Late fees" },
  kept: { code: "revenue:kept", kind: "income", accountant: "Cancellation charges retained" },
  discounts: { code: "discounts", kind: "income", accountant: "Discount allowed" },
  returns: { code: "returns", kind: "income", accountant: "Sales returns (refunds after the sale)" },
  gatewayFees: { code: "gateway_fees", kind: "expense", accountant: "Payment gateway charges" },
  gstOnFees: { code: "gst_on_fees", kind: "expense", accountant: "GST on payment gateway charges" },
  writtenOff: { code: "written_off", kind: "expense", accountant: "Bad debts written off" },
} as const satisfies Record<string, Account>;

/** The account a payment method's money lands in. */
export const METHOD_ACCOUNT: Record<Method, string> = { gateway: ACCOUNTS.gateway.code, upi: ACCOUNTS.upi.code, cash: ACCOUNTS.cash.code, bank: ACCOUNTS.bank.code };

const SERVICE = /^[a-z0-9][a-z0-9_-]{0,99}$/u;

/** The income account of one service of a shop: `revenue:<service id>`. A service id that is not a plain id is refused, because the code is chained for good. */
export function serviceAccount(service: string): string {
  if (!SERVICE.test(service)) throw new Error(`"${service}" is not a service id the books can use (lower-case letters, digits, "_" and "-", at most 100).`);
  return `revenue:${service}`;
}

/** Every code the books may write, so the fold can refuse an unknown one. */
export function isAccount(code: string): boolean {
  return Object.values(ACCOUNTS).some((a) => a.code === code) || (code.startsWith("revenue:") && SERVICE.test(code.slice("revenue:".length)));
}

/** The accountant's words for any code (a service account names its service id). */
export function accountantName(code: string): string {
  const fixed = Object.values(ACCOUNTS).find((a) => a.code === code);
  if (fixed) return fixed.accountant;
  if (code.startsWith("revenue:")) return `Sales: ${code.slice("revenue:".length)}`;
  return code;
}

/** Whether a code is income-like (for the owner's "this month" lines): every `revenue:*`, and the two contra-income accounts. */
export const kindOf = (code: string): AccountKind => Object.values(ACCOUNTS).find((a) => a.code === code)?.kind ?? (code.startsWith("revenue:") ? "income" : "asset");
