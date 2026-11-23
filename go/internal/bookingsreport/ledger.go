// The head of the shop's record as a hash-chained ledger: modules/record/ledger.ts `headOf` (with `tenantOf`, `ledgerBody`, `kindOf`, `entryHash`, `ledgerEntries`, `ledgerHead`), the
// one call a signed report makes to anchor itself to the record (data.ts `anchor`). Only the head is built: the key log, the checkpoint and the evidence pack of the same file belong to the
// deployer's export and the CLI and are not ported. Nothing in Go had this yet (grep of go/internal: no ledger code), so it lives here, in the one package that calls it.
//
// What the TypeScript does, copied: sort the entries by seq (stable), insist the record runs 1, 2, 3 ... with no gap or repeat, read each entry's time with Date.parse, and chain
// sha256("geo-ledger/1\n" + canonical bytes of the entry with `hash` set to 64 zeros). The body of one ledger entry is the canonical JSON of the record entry WITHOUT its conversation,
// notes and refs.page; the entry's own `refs` are all strings, so a ref that is not there is simply not in the map (the TypeScript's JSON round trip drops an undefined one).
//
// Where Go differs from JavaScript: the TypeScript refuses a lone surrogate (`!isWellFormed()`); Go text that is not valid UTF-8 is the same fault and is refused with the same sentence
// (the path it names is the first one in the order the TypeScript walks: seq, time, booking, action, outcome, inputsDigest, decisions, language, then refs in sorted key order, because a Go
// map has no insertion order; the sentence is only ever shown for a damaged record). The tenant slug uses golang.org/x/text/unicode/norm NFKD, as String.prototype.normalize("NFKD").
package bookingsreport

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/report"
)

// Ledger names (ledger.ts LEDGER, BODY_TYPE).
const (
	ledgerName = "agent-record"
	bodyType   = "geometer.agent-record-entry/1"
)

var zeroHash = "sha256:" + strings.Repeat("0", 64)

var tenantIDRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$`)
var nonSlugRe = regexp.MustCompile(`[^a-z0-9]+`)

// LedgerHead is ledger.ts LedgerHead: what a paper's anchor slot names. Numbers are plain numbers (the papers' own form).
type LedgerHead struct {
	Ledger string
	Tenant string
	Seq    int
	Head   string
}

// Tree is the head as the signed JSON tree.
func (h *LedgerHead) Tree() any {
	if h == nil {
		return nil
	}
	return map[string]any{"ledger": h.Ledger, "tenant": h.Tenant, "seq": h.Seq, "head": h.Head}
}

// tenantOf is tenantOf: a tenant id is the shop's id on the server, or a slug of the shop's name.
func tenantOf(text string) (string, error) {
	if tenantIDRe.MatchString(text) {
		return text, nil
	}
	slug := nonSlugRe.ReplaceAllString(strings.ToLower(norm.NFKD.String(text)), "-")
	slug = strings.Trim(slug, "-")
	if len(slug) > 80 {
		slug = slug[:80] // ASCII only by now, so bytes are UTF-16 units
	}
	if slug == "" {
		return "", fmt.Errorf(`"%s" cannot be turned into a ledger tenant id. Name the shop with letters or digits, or give the shop's id.`, text)
	}
	return slug, nil
}

func refsTree(refs map[string]string, without string) map[string]any {
	out := make(map[string]any, len(refs))
	for k, v := range refs {
		if k != without {
			out[k] = v
		}
	}
	return out
}

func bookingTree(b *string) any {
	if b == nil {
		return nil
	}
	return *b
}

// ledgerBody is ledgerBody(e): the entry's own fields except conversation, notes and refs.page.
func ledgerBody(e accounting.Entry) map[string]any {
	return map[string]any{"seq": e.Seq, "time": e.Time, "booking": bookingTree(e.Booking), "action": e.Action, "outcome": e.Outcome, "inputsDigest": e.InputsDigest,
		"decisions": report.DecisionsTree(e), "language": e.Language, "refs": refsTree(e.Refs, "page")}
}

// wellFormed walks a tree the way bytesOf does, in the TypeScript's key order for an entry body, and names the first text that is not valid UTF-16 (here: not valid UTF-8).
func wellFormed(v any, path string) error {
	switch x := v.(type) {
	case string:
		if !utf8.ValidString(x) {
			return fmt.Errorf("The ledger was about to write broken text at %s.", path)
		}
	case []any:
		for i, e := range x {
			if err := wellFormed(e, fmt.Sprintf("%s.%d", path, i)); err != nil {
				return err
			}
		}
	case map[string]any:
		order := []string{"seq", "time", "booking", "action", "outcome", "inputsDigest", "decisions", "language"}
		seen := map[string]bool{}
		var keys []string
		for _, k := range order {
			if _, ok := x[k]; ok {
				keys = append(keys, k)
				seen[k] = true
			}
		}
		var rest []string
		for k := range x {
			if !seen[k] {
				rest = append(rest, k)
			}
		}
		sort.Strings(rest)
		for _, k := range append(keys, rest...) {
			if err := wellFormed(x[k], path+"."+k); err != nil {
				return err
			}
		}
	}
	return nil
}

func ledgerBytes(v any) (string, error) {
	if err := wellFormed(v, "$"); err != nil {
		return "", err
	}
	return report.CanonicalJSON(v), nil
}

// HeadOf is headOf(entries, tenant): the head of the whole record as a ledger (the last entry's number and hash), or nil for an empty record. The error is the TypeScript's sentence for a
// record with a gap or a repeat, an entry with no readable time, a tenant that cannot be made an id, or text that is not well formed.
func HeadOf(entries []accounting.Entry, tenantText string) (*LedgerHead, error) {
	tenant, err := tenantOf(tenantText)
	if err != nil {
		return nil, err
	}
	sorted := append([]accounting.Entry(nil), entries...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Seq < sorted[j].Seq })
	prev := ""
	for i, e := range sorted {
		if e.Seq != i+1 {
			return nil, fmt.Errorf("The record jumps from entry %d to entry %d: a record is numbered 1, 2, 3 ... and this one has a gap or a repeat, so it is not chained.", i, e.Seq)
		}
		at, ok := accounting.ParseISO(e.Time)
		if !ok || at < 0 {
			return nil, fmt.Errorf("Record entry %d has no readable time.", e.Seq)
		}
		kind := "observed_fact"
		if e.Action == "owner_decision" {
			kind = "approval"
		}
		subject := ""
		if e.Booking != nil {
			subject = *e.Booking
		}
		body, err := ledgerBytes(ledgerBody(e))
		if err != nil {
			return nil, err
		}
		base := map[string]any{"v": 1, "tenant": tenant, "seq": strconv.Itoa(e.Seq), "kind": kind, "subject": subject, "at_ms": strconv.FormatInt(at, 10),
			"body_type": bodyType, "body": body, "links": []any{}}
		if prev != "" {
			base["prev"] = prev
		}
		hashed := map[string]any{"hash": zeroHash}
		for k, v := range base {
			hashed[k] = v
		}
		text, err := ledgerBytes(hashed)
		if err != nil {
			return nil, err
		}
		prev = report.SHA256([]byte("geo-ledger/1\n" + text))
	}
	if len(sorted) == 0 {
		return nil, nil
	}
	return &LedgerHead{Ledger: ledgerName, Tenant: tenant, Seq: sorted[len(sorted)-1].Seq, Head: prev}, nil
}
