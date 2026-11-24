package runtime

// The action record's writer: what the shop did and who it was done for, one line each, appended and never changed (modules/record/record.ts). The words people said are not in it:
// `inputs` is kept as a digest, keyed with the shop's own record key so a guess cannot be tested against it.
//
// Decision 65 (25 Nov 2026): a shop of several template parts keeps ONE record; each part writes and reads through its own view (Part), which marks its lines with refs.part.

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/GeometerLabs/agents/go/internal/store"
)

// NewLine is a line to write. Booking is the case it is about ("b-3"; "" for none, written as null). Decisions are the limits' decisions the line carries (record.ts
// `decisions`), each already JSON; nil is an empty list.
type NewLine struct {
	Conversation string
	Booking      string
	Action       string
	Outcome      string
	Inputs       any
	Language     string
	Notes        string
	Refs         map[string]string
	Decisions    []json.RawMessage
}

type recorder struct {
	key   []byte
	base  int
	saved []store.Entry // the record as the last saved step left it (read-only): what a template reads back
	fresh []store.Entry
	now   func() int64
	// A PART'S VIEW of the step's recorder (decision 65, a shop of several template parts: Part below). root is the step's one recorder, which holds every line; part is the
	// template the view writes for (its lines carry refs.part); carried says the view also reads the lines that carry no part (the shop's history from before it had parts,
	// when this part was its only template); beatOff says the shop's shared beat work (the licence notice, the morning line) is another part's. All zero: the step's recorder.
	root    *recorder
	part    string
	carried bool
	beatOff bool
}

// Recorder is one step's record writer, for a template's agent: Append writes a line, Entries is the whole record as this step sees it (the saved lines, then this step's own).
type Recorder = recorder

// PartRef is the record's ref that says which part of a shop of several parts wrote a line (decision 65). A single-part shop's lines never carry it.
const PartRef = "part"

// Part is a view of this recorder for one part of a shop of several parts (decision 65): every line it writes goes into this recorder (one record per shop, in the order
// written) with refs.part set to `part`; Entries is only that part's lines (and, when carried, the lines with no part), so the part's own counts, reports and "was this
// already sent" memory read exactly what a single-part shop of that template would. ShopEntries is the whole record. beatOff: the shop's shared beat work is not this part's.
func (r *recorder) Part(part string, carried, beatOff bool) *Recorder {
	return &recorder{key: r.key, now: r.now, root: r.top(), part: part, carried: carried, beatOff: beatOff}
}

// top is the recorder that holds the lines: the step's own, under any view.
func (r *recorder) top() *recorder {
	if r.root != nil {
		return r.root
	}
	return r
}

// PartName is the part this view writes for; "" for the step's own recorder (a single-part shop).
func (r *recorder) PartName() string { return r.part }

// SharedBeatOff: in a shop of several parts, the licence notice and the morning line are said once for the shop, by its first part; true on every other part's view.
func (r *recorder) SharedBeatOff() bool { return r.beatOff }

// Append writes one line (record.ts append).
func (r *recorder) Append(l NewLine) store.Entry {
	r.append(l)
	t := r.top()
	return t.fresh[len(t.fresh)-1]
}

// Entries is the saved record followed by this step's lines (record.ts entries()); on a part's view, only that part's lines.
func (r *recorder) Entries() []store.Entry {
	if r.root != nil {
		var out []store.Entry
		for _, e := range r.root.Entries() {
			if r.mine(e) {
				out = append(out, e)
			}
		}
		return out
	}
	out := make([]store.Entry, 0, len(r.saved)+len(r.fresh))
	return append(append(out, r.saved...), r.fresh...)
}

// ShopEntries is the shop's whole record as this step sees it, whichever part is asking: what a document number is worked out over (accounting numbers.go), so a series is
// gap-free and unique for the business, not for one part. On the step's own recorder it is Entries.
func (r *recorder) ShopEntries() []store.Entry { return r.top().Entries() }

// mine: a line belongs to this part's view.
func (r *recorder) mine(e store.Entry) bool {
	p, has := e.Refs[PartRef]
	if !has {
		return r.carried
	}
	return p == r.part
}

// Fingerprint is a message id as the record keeps it: under the shop's key "m-" and 12 hex digits (fingerprint.ts messageFingerprint, B69), else the id itself.
func (r *recorder) Fingerprint(id string) string {
	if r.key == nil {
		return id
	}
	m := hmac.New(sha256.New, r.key)
	m.Write([]byte("geometer/message/1\n" + id))
	return "m-" + hex.EncodeToString(m.Sum(nil))[:12]
}

func (r *recorder) append(l NewLine) {
	if r.root != nil {
		// a part's line: the part named in its refs (a copy, so a caller's map is never changed), then written into the step's one recorder
		refs := make(map[string]string, len(l.Refs)+1)
		for k, v := range l.Refs {
			refs[k] = v
		}
		refs[PartRef] = r.part
		l.Refs = refs
		r.root.append(l)
		return
	}
	canon := recordCanonical(l.Inputs)
	var digest string
	if r.key != nil {
		m := hmac.New(sha256.New, r.key)
		m.Write([]byte("geometer/inputs/1\n" + canon))
		digest = "k-" + hex.EncodeToString(m.Sum(nil))[:16]
	} else {
		s := sha256.Sum256([]byte(canon))
		digest = hex.EncodeToString(s[:])[:16]
	}
	refs := l.Refs
	if refs == nil {
		refs = map[string]string{}
	}
	// record.ts: a message id is kept only as its keyed fingerprint (fingerprint.ts messageFingerprint, B69)
	if id, ok := refs["messageId"]; ok && r.key != nil {
		cp := make(map[string]string, len(refs))
		for k, v := range refs {
			cp[k] = v
		}
		cp["messageId"] = r.Fingerprint(id)
		refs = cp
	}
	var booking *string
	if l.Booking != "" {
		b := l.Booking
		booking = &b
	}
	decisions := l.Decisions
	if decisions == nil {
		decisions = []json.RawMessage{}
	}
	r.fresh = append(r.fresh, store.Entry{
		Seq: r.base + len(r.fresh) + 1, Time: time.UnixMilli(r.now()).UTC().Format("2006-01-02T15:04:05.000Z"), Conversation: l.Conversation, Booking: booking, Action: l.Action, InputsDigest: digest,
		Outcome: l.Outcome, Decisions: decisions, Language: l.Language, Notes: l.Notes, Refs: refs,
	})
}

// recordCanonical is record.ts `canonicalJson`: keys sorted the way JavaScript sorts them (by UTF-16 code unit), scalars as JSON writes them.
func recordCanonical(v any) string {
	switch x := v.(type) {
	case nil:
		return "null"
	case map[string]any:
		keys := make([]string, 0, len(x))
		for k := range x {
			keys = append(keys, k)
		}
		sort.Slice(keys, func(i, j int) bool { return lessUTF16(keys[i], keys[j]) })
		parts := make([]string, len(keys))
		for i, k := range keys {
			kj, _ := json.Marshal(k)
			parts[i] = string(kj) + ":" + recordCanonical(x[k])
		}
		return "{" + strings.Join(parts, ",") + "}"
	case map[string]string:
		m := make(map[string]any, len(x))
		for k, s := range x {
			m[k] = s
		}
		return recordCanonical(m)
	case []string:
		a := make([]any, len(x))
		for i, s := range x {
			a[i] = s
		}
		return recordCanonical(a)
	case []any:
		parts := make([]string, len(x))
		for i, e := range x {
			parts[i] = recordCanonical(e)
		}
		return "[" + strings.Join(parts, ",") + "]"
	case int:
		return strconv.Itoa(x)
	case int64:
		return strconv.FormatInt(x, 10)
	}
	b, _ := json.Marshal(v)
	return string(b)
}

func lessUTF16(a, b string) bool {
	ua, ub := utf16.Encode([]rune(a)), utf16.Encode([]rune(b))
	for i := 0; i < len(ua) && i < len(ub); i++ {
		if ua[i] != ub[i] {
			return ua[i] < ub[i]
		}
	}
	return len(ua) < len(ub)
}
