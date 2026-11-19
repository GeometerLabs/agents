package runtime

// The action record's writer: what the shop did and who it was done for, one line each, appended and never changed (modules/record/record.ts). The words people said are not in it:
// `inputs` is kept as a digest, keyed with the shop's own record key so a guess cannot be tested against it.

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

// NewLine is a line to write.
type NewLine struct {
	Conversation string
	Action       string
	Outcome      string
	Inputs       any
	Language     string
	Notes        string
	Refs         map[string]string
}

type recorder struct {
	key   []byte
	base  int
	fresh []store.Entry
	now   func() int64
}

func (r *recorder) append(l NewLine) {
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
		m := hmac.New(sha256.New, r.key)
		m.Write([]byte("geometer/message/1\n" + id))
		cp := make(map[string]string, len(refs))
		for k, v := range refs {
			cp[k] = v
		}
		cp["messageId"] = "m-" + hex.EncodeToString(m.Sum(nil))[:12]
		refs = cp
	}
	r.fresh = append(r.fresh, store.Entry{
		Seq: r.base + len(r.fresh) + 1, Time: time.UnixMilli(r.now()).UTC().Format("2006-01-02T15:04:05.000Z"), Conversation: l.Conversation, Action: l.Action, InputsDigest: digest,
		Outcome: l.Outcome, Decisions: []json.RawMessage{}, Language: l.Language, Notes: l.Notes, Refs: refs,
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
