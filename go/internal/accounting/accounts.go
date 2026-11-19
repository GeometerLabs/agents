// The shop's accounts: the stable codes the books write and the words an accountant reads in the export (modules/accounting/accounts.ts).
//
// Why codes and not names: a code goes into the record (`refs`), which is hash-chained and never rewritten, so it must never change. An account a service names is
// `revenue:<service id>`; every other code is fixed here. The list is in the TypeScript's own order (Object.values(ACCOUNTS)), which the lookups below keep; a test compares every code,
// kind and accountant word with what the TypeScript gives.
package accounting

import (
	"fmt"
	"regexp"
	"strings"
)

// AccountKind is accounts.ts AccountKind: asset, liability, income or expense.
type AccountKind string

const (
	Asset     AccountKind = "asset"
	Liability AccountKind = "liability"
	Income    AccountKind = "income"
	Expense   AccountKind = "expense"
)

// Method is how the money moved: "gateway", "upi", "cash" or "bank".
type Method string

// Account is one fixed account: its code, kind and the accountant's words.
type Account struct {
	Code       string
	Kind       AccountKind
	Accountant string
}

// The fixed accounts (accounts.ts ACCOUNTS), by the TypeScript's own names.
var (
	AccCash        = Account{"cash", Asset, "Cash in hand"}
	AccUPI         = Account{"upi", Asset, "Bank (UPI receipts, marked by owner)"}
	AccBank        = Account{"bank", Asset, "Bank (transfers, marked by owner)"}
	AccGateway     = Account{"gateway", Asset, "Payment gateway clearing"}
	AccBankSettled = Account{"bank_settled", Asset, "Bank (gateway settlements)"}
	AccReceivable  = Account{"receivable", Asset, "Sundry debtors (fees)"}
	AccAdvances    = Account{"advances", Liability, "Customer advances and deposits"}
	AccRefundsOwed = Account{"refunds_owed", Liability, "Refunds payable to customers"}
	AccFees        = Account{"revenue:fees", Income, "Fees"}
	AccOrders      = Account{"revenue:orders", Income, "Sales (orders)"}
	AccLateFees    = Account{"revenue:late_fees", Income, "Late fees"}
	AccKept        = Account{"revenue:kept", Income, "Cancellation charges retained"}
	AccDiscounts   = Account{"discounts", Income, "Discount allowed"}
	AccReturns     = Account{"returns", Income, "Sales returns (refunds after the sale)"}
	AccGatewayFees = Account{"gateway_fees", Expense, "Payment gateway charges"}
	AccGSTOnFees   = Account{"gst_on_fees", Expense, "GST on payment gateway charges"}
	AccWrittenOff  = Account{"written_off", Expense, "Bad debts written off"}
)

// AllAccounts is Object.values(ACCOUNTS), in the TypeScript's order.
var AllAccounts = []Account{AccCash, AccUPI, AccBank, AccGateway, AccBankSettled, AccReceivable, AccAdvances, AccRefundsOwed, AccFees, AccOrders, AccLateFees, AccKept, AccDiscounts, AccReturns, AccGatewayFees, AccGSTOnFees, AccWrittenOff}

// MethodAccount is METHOD_ACCOUNT: the account a payment method's money lands in. A method that is not one of the four gives "" (the TypeScript's `undefined`, which isAccount then refuses).
func MethodAccount(m Method) string {
	switch m {
	case "gateway":
		return AccGateway.Code
	case "upi":
		return AccUPI.Code
	case "cash":
		return AccCash.Code
	case "bank":
		return AccBank.Code
	}
	return ""
}

// service is accounts.ts SERVICE: /^[a-z0-9][a-z0-9_-]{0,99}$/u. `$` matches only at the very end in both languages.
var service = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,99}$`)

// ServiceAccount is serviceAccount: `revenue:<service id>`, or the TypeScript's error for an id the books cannot carry.
func ServiceAccount(id string) (string, error) {
	if !service.MatchString(id) {
		return "", fmt.Errorf("\"%s\" is not a service id the books can use (lower-case letters, digits, \"_\" and \"-\", at most 100).", id)
	}
	return "revenue:" + id, nil
}

func fixed(code string) (Account, bool) {
	for _, a := range AllAccounts {
		if a.Code == code {
			return a, true
		}
	}
	return Account{}, false
}

// IsAccount is isAccount: every code the books may write.
func IsAccount(code string) bool {
	if _, ok := fixed(code); ok {
		return true
	}
	return strings.HasPrefix(code, "revenue:") && service.MatchString(code[len("revenue:"):])
}

// AccountantName is accountantName: the accountant's words for any code (a service account names its service id).
func AccountantName(code string) string {
	if a, ok := fixed(code); ok {
		return a.Accountant
	}
	if strings.HasPrefix(code, "revenue:") {
		return "Sales: " + code[len("revenue:"):]
	}
	return code
}

// KindOfAccount is accounts.ts kindOf: income for every `revenue:*` not fixed, and "asset" for any unknown code.
func KindOfAccount(code string) AccountKind {
	if a, ok := fixed(code); ok {
		return a.Kind
	}
	if strings.HasPrefix(code, "revenue:") {
		return Income
	}
	return Asset
}

// TallyGroupOf is tally.ts groupOf: the default TallyPrime group of an account code. Unknown codes go by kind: a liability is Current Liabilities, income Sales Accounts, expense Indirect
// Expenses, an asset Sundry Debtors. It sits here (and not in tally.go) because the owner's export and the Tally files both name it.
func TallyGroupOf(code string) string {
	switch code {
	case "cash":
		return "Cash-in-Hand"
	case "upi", "bank", "bank_settled":
		return "Bank Accounts"
	case "gateway", "receivable":
		return "Sundry Debtors" // what the payment service or a parent still owes the shop
	case "advances", "refunds_owed":
		return "Current Liabilities"
	case "discounts", "gateway_fees", "gst_on_fees", "written_off":
		return "Indirect Expenses"
	case "returns":
		return "Sales Accounts" // Tally keeps sales returns under Sales Accounts
	}
	if strings.HasPrefix(code, "tax_out:") {
		return "Duties & Taxes"
	}
	switch KindOfAccount(code) {
	case Liability:
		return "Current Liabilities"
	case Income:
		return "Sales Accounts"
	case Expense:
		return "Indirect Expenses"
	}
	return "Sundry Debtors"
}
