package messaging_test

// recordMessageStatus against the TypeScript (testdata/status-vectors.json): for each scripted record the line it wrote (or that it wrote none), including the RangeError the
// TypeScript lets escape for a time no Date can hold.

import (
	"encoding/hex"
	"encoding/json"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/messaging"
)

type fakeRecord struct {
	entries  []messaging.Entry
	captured *messaging.NewEntry
}

func (r *fakeRecord) Entries() []messaging.Entry { return r.entries }

func (r *fakeRecord) Append(e messaging.NewEntry) messaging.Entry {
	c := e
	r.captured = &c
	line := messaging.Entry{Seq: len(r.entries) + 1, Conversation: e.Conversation, Booking: e.Booking, Action: e.Action, Language: e.Language, Refs: e.Refs}
	r.entries = append(r.entries, line)
	return line
}

func TestStatusVectors(t *testing.T) {
	var f struct {
		Cases []struct {
			Name    string                  `json:"name"`
			Key     *string                 `json:"key"`
			Entries []messaging.Entry       `json:"entries"`
			Status  messaging.MessageStatus `json:"status"`
			Ctx     struct {
				Owner     *messaging.OwnerInfo `json:"owner"`
				Approvers []string             `json:"approvers"`
			} `json:"ctx"`
			Captured json.RawMessage `json:"captured"`
			Result   struct {
				Wrote  bool `json:"wrote"`
				Thrown *struct {
					Name    string `json:"name"`
					Message string `json:"message"`
				} `json:"thrown"`
			} `json:"result"`
		} `json:"cases"`
	}
	readJSON(t, "testdata/status-vectors.json", &f)
	if len(f.Cases) < 30 {
		t.Fatalf("too few cases: %d", len(f.Cases))
	}
	for _, c := range f.Cases {
		t.Run(c.Name, func(t *testing.T) {
			ctx := messaging.StatusContext{Owner: c.Ctx.Owner, Approvers: c.Ctx.Approvers}
			if c.Key != nil {
				k, err := hex.DecodeString(*c.Key)
				if err != nil {
					t.Fatal(err)
				}
				ctx.RecordKey = k
			}
			rec := &fakeRecord{entries: c.Entries}
			_, wrote, err := messaging.RecordMessageStatus(rec, c.Status, ctx)
			if c.Result.Thrown != nil {
				if err == nil || err.Error() != c.Result.Thrown.Message {
					t.Fatalf("Go %v, TypeScript threw %s: %s", err, c.Result.Thrown.Name, c.Result.Thrown.Message)
				}
				if rec.captured != nil {
					t.Error("a line was written before the throw")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if wrote != c.Result.Wrote {
				t.Fatalf("wrote: Go %v, TypeScript %v", wrote, c.Result.Wrote)
			}
			var got any
			if rec.captured != nil {
				e := rec.captured
				got = map[string]any{"conversation": e.Conversation, "booking": e.Booking, "action": e.Action, "inputs": e.Inputs, "outcome": e.Outcome, "language": e.Language, "notes": e.Notes, "refs": e.Refs}
			}
			same(t, "the line written", got, c.Captured)
		})
	}
}

func TestMessageFingerprint(t *testing.T) {
	// the same construction as fingerprint.ts: "m-" and the first 12 hex digits of the HMAC under "geometer/message/1\n<id>"; the status vectors with a key prove the values
	k, _ := hex.DecodeString("00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff")
	if got := messaging.MessageFingerprint(k, "wamid.1"); len(got) != 14 || got[:2] != "m-" {
		t.Fatalf("got %q", got)
	}
}
