package bookings

// The settings readers every template shares, handed to another template's settings (wave 3: Fees). The TypeScript templates all call the same shared readers for the
// blocks they have in common: readPaymentSettings (modules/payments/providers), readApprovers (modules/approvals/people.ts) and readAssistantSettings (modules/assistant
// settings.ts), with the same sentences. Their Go twins were written here for Bookings (settings.go, settings_check.go); this file only opens them to another package, so
// Fees says the same refusals with no second copy of them ("no duplicates", decision 61). Nothing here changes what Bookings reads or says.
//
// When the TypeScript templates are deleted, these readers belong in a package of their own (internal/settingsread); go/internal/fees/Deferred.md says so.

import "strings"

// SettingsReader is the reader of one settings.json: the problems so far, in order, and each object's keys in the order the file names them.
type SettingsReader struct {
	r    *reader
	keys func(path string) []string
}

// NewSettingsReader reads the keys' order from the file's bytes (nil: not known, sorted).
func NewSettingsReader(raw []byte) *SettingsReader {
	order := map[string][]string{}
	if raw != nil {
		order = ordered(raw)
	}
	return &SettingsReader{r: &reader{}, keys: func(path string) []string { return order[path] }}
}

// Add is one problem, in plain words.
func (s *SettingsReader) Add(format string, a ...any) { s.r.add(format, a...) }

// Errors are the problems so far.
func (s *SettingsReader) Errors() []string { return s.r.errs }

// Count is how many problems there are so far.
func (s *SettingsReader) Count() int { return len(s.r.errs) }

// Keys is Object.keys of the object at this path (JSON-pointer style: "" the file, "/batches/0/names"): the file's order when known, else sorted.
func (s *SettingsReader) Keys(obj map[string]any, path string) []string {
	return keysOf(obj, s.keys(path))
}

// UnknownKeys is the templates' unknownKeys: "I don't know what "x" means in <where>. Allowed: ...".
func (s *SettingsReader) UnknownKeys(obj map[string]any, path string, allowed []string, where string) {
	s.r.unknownKeys(obj, s.keys(path), allowed, where)
}

// Payment is readPaymentSettings: the module ("upi" or "razorpay"), and a UPI shop's ID and payee; module "" when the block was refused (the problem is added). `given`: the
// file names the block (a `null` there is the shape sentence; left out, the block is asked for).
func (s *SettingsReader) Payment(v any, given bool, path string) Payment {
	var tmp Settings
	s.r.payment(v, given, s.keys(path), s.keys(path+"/upi"), &tmp)
	return tmp.Payment
}

// Approvers is readApprovers(v, {ownerWhatsapp, refundLimitInr}): the checked block, or nil (left out, or refused: the problems are added). refundOK says the refund limit was read.
func (s *SettingsReader) Approvers(v any, given bool, path, ownerWhatsapp string, refundLimitInr int64, refundOK bool) map[string]any {
	var tmp Settings
	tmp.Owner.Whatsapp = ownerWhatsapp
	tmp.Cancellation.RefundLimitInr, tmp.refundLimitOK = refundLimitInr, refundOK
	s.r.approvers(v, given, s.prefixed(path, "/approvers"), &tmp)
	return tmp.Approvers
}

// Assistant is readAssistantSettings: the checked block (morningAt, the character, talk when it is off), or nil.
func (s *SettingsReader) Assistant(v any, given bool, path string) map[string]any {
	var tmp Settings
	s.r.assistant(v, given, s.prefixed(path, "/assistant"), &tmp)
	return tmp.Assistant
}

// prefixed maps the paths the Bookings readers ask for ("/approvers/...") onto where the block is in this file (a template that keeps it at the top has path == own).
func (s *SettingsReader) prefixed(path, own string) func(string) []string {
	return func(p string) []string { return s.keys(path + strings.TrimPrefix(p, own)) }
}

// IsWhole is a JSON number that is a whole number (Number.isInteger over what JSON.parse gives), as int64.
func IsWhole(v any) (int64, bool) { return isWhole(v) }

// JSJSON is JavaScript's JSON.stringify of a value read from JSON.
func JSJSON(v any) string { return jsJSON(v) }

// Capitalise is a label's first letter in upper case (`label.charAt(0).toUpperCase() + label.slice(1)`).
func Capitalise(s string) string { return capitalise(s) }

// LanguageList is the templates' languageList(): `"hi" (Hindi), "en" (English), ...`.
func LanguageList() string { return languageList() }
