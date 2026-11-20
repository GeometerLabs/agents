package runtime

// The shop's state as one JSON text (modules/runtime/snapshot.ts, templates/commerce/listings/server/snapshot.ts): `{"format":1, "assistant":{...}, "ai":{...}}`. Only two fields,
// and both are here on purpose: `assistant` holds the listings, the cards and the owner's talk; `ai` holds the month's AI counts. This runtime models the listings and the AI counts;
// the assistant's own state (seq, cards, refused, closedDays, undo, talk, chat) is typed (internal/assistant/state.go); the stock count is typed (listings/stock.go); every other member of
// `assistant` (limitChanges, memory, and any member a later version adds) is carried through as raw JSON, so a shop that is run by the TypeScript runtime again loses nothing by a spell in Go.

import (
	"bytes"
	"encoding/json"
	"fmt"

	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/budget"
	"github.com/GeometerLabs/agents/go/internal/listings"
	"github.com/GeometerLabs/agents/go/internal/signing"
)

// Format is the snapshot's own version.
const Format = 1

// Snap is the state, parsed.
type Snap struct {
	// A is the assistant's own state, typed (internal/assistant/state.go: seq, cards, refused, closedDays, undo, talk, chat); nil: the shop has none yet. `assistant` is its Rest: the members this
	// runtime keeps as raw JSON because other code owns them (limitChanges, listings, stock, memory) or because no version here knows them.
	A         *assistant.State
	assistant map[string]json.RawMessage
	Listings  listings.State
	hasList   bool
	Stock     *listings.Stock
	AI        *budget.AI
	// T is a template's own store (template.go KitState), nil for the listings shop. Its members are the snapshot's top-level members other than format, assistant and ai.
	T KitState
}

// ensureA makes the assistant's state on first use, as the TypeScript runtime's `assistantOf` does (the empty state, with its list of limit changes).
func (s *Snap) ensureA() {
	if s.A == nil {
		s.A = assistant.Fresh()
		s.assistant = s.A.Rest
	}
}

// Parse reads a snapshot; "" is the state of a shop that has had no step yet.
func ParseSnap(text string) (*Snap, error) {
	s := &Snap{Listings: listings.Empty()}
	if text == "" {
		return s, nil
	}
	var raw struct {
		Format    int                        `json:"format"`
		Assistant map[string]json.RawMessage `json:"assistant"`
		AI        *budget.AI                 `json:"ai"`
	}
	if err := json.Unmarshal([]byte(text), &raw); err != nil || raw.Format != Format {
		return nil, fmt.Errorf("the saved state is not in a format this version can read. It was probably written by another version of the pathway")
	}
	s.AI = raw.AI
	if raw.Assistant != nil {
		s.A = assistant.FromMembers(raw.Assistant)
		s.assistant = s.A.Rest
	}
	if err := s.readAssistantParts(); err != nil {
		return nil, err
	}
	return s, nil
}

// readAssistantParts reads the parts of the assistant's state this runtime types (the listings and the stock count) out of its raw members, for every shop: the listings-only shop,
// and a template's (a Bookings shop's assistant has the listings skill too, wire.ts).
func (s *Snap) readAssistantParts() error {
	if l, ok := s.assistant["listings"]; ok {
		if err := json.Unmarshal(l, &s.Listings); err != nil {
			return fmt.Errorf("the saved listings cannot be read: %w", err)
		}
		s.hasList = true
		if s.Listings.Items == nil {
			s.Listings.Items = []listings.Listing{}
		}
		if s.Listings.Pending == nil {
			s.Listings.Pending = []listings.PendingPhoto{}
		}
		for i := range s.Listings.Items {
			if s.Listings.Items[i].Words == nil {
				s.Listings.Items[i].Words = map[string]listings.LangText{}
			}
			if s.Listings.Items[i].Photos == nil {
				s.Listings.Items[i].Photos = []listings.Photo{}
			}
		}
	}
	if st, ok := s.assistant["stock"]; ok {
		var stock listings.Stock
		if json.Unmarshal(st, &stock) == nil {
			stock.Fix()
			s.Stock = &stock
		}
	}
	return nil
}

// ParseSnapKit reads a template's snapshot: the shared parts (the owner's assistant, the AI counts) as ParseSnap reads them, and every other top-level member, in its order, to
// the template. "" is a fresh store. With no kit it is ParseSnap.
func ParseSnapKit(text string, kit Kit) (*Snap, error) {
	if kit == nil {
		return ParseSnap(text)
	}
	s := &Snap{Listings: listings.Empty()}
	if text == "" {
		t, err := kit.ParseState(nil)
		s.T = t
		return s, err
	}
	pairs, ok := topMembers([]byte(text))
	unreadable := fmt.Errorf("the saved state is not in a format this version can read. It was probably written by another version of the pathway")
	if !ok {
		return nil, unreadable
	}
	var own []Member
	format := false
	for _, p := range pairs {
		switch p.Name {
		case "format":
			var f int
			if json.Unmarshal(p.Raw, &f) != nil || f != Format {
				return nil, unreadable
			}
			format = true
		case "ai":
			// snapshot.ts optional-ai: anything but an object is left out
			var ai budget.AI
			if isObject(p.Raw) && json.Unmarshal(p.Raw, &ai) == nil {
				s.AI = &ai
			}
		case "assistant":
			var members map[string]json.RawMessage
			if isObject(p.Raw) && json.Unmarshal(p.Raw, &members) == nil {
				s.A = assistant.FromMembers(members)
				s.assistant = s.A.Rest
				if err := s.readAssistantParts(); err != nil {
					return nil, err
				}
			}
		default:
			own = append(own, p)
		}
	}
	if !format {
		return nil, unreadable
	}
	t, err := kit.ParseState(own)
	if err != nil {
		return nil, err
	}
	s.T = t
	return s, nil
}

// isObject: the raw member is a JSON object (snapshot.ts takes an optional member only when it is one).
func isObject(raw json.RawMessage) bool {
	for _, c := range raw {
		switch c {
		case ' ', '\t', '\n', '\r':
			continue
		}
		return c == '{'
	}
	return false
}

// topMembers is a JSON object's members in the order they were written (encoding/json's maps lose it).
func topMembers(raw []byte) ([]Member, bool) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	if t, err := dec.Token(); err != nil || t != json.Delim('{') {
		return nil, false
	}
	var out []Member
	for dec.More() {
		kt, err := dec.Token()
		if err != nil {
			return nil, false
		}
		var v json.RawMessage
		if err := dec.Decode(&v); err != nil {
			return nil, false
		}
		out = append(out, Member{Name: kt.(string), Raw: v})
	}
	return out, true
}

// serializeKit writes a template's snapshot in the codec's order: the format, then the template's members, with the AI counts and the owner's assistant where its codec puts
// them (snapshot.ts writes an optional member only when it is set).
func (s *Snap) serializeKit() (string, error) {
	members, err := s.T.Members()
	if err != nil {
		return "", err
	}
	var b bytes.Buffer
	b.WriteString(`{"format":1`)
	put := func(name string, raw []byte) {
		k, _ := json.Marshal(name)
		b.WriteByte(',')
		b.Write(k)
		b.WriteByte(':')
		b.Write(raw)
	}
	for _, m := range members {
		switch m.Name {
		case "ai":
			if s.AI != nil {
				raw, err := signing.Marshal(s.AI)
				if err != nil {
					return "", err
				}
				put("ai", raw)
			}
		case "assistant":
			if s.A != nil {
				members, err := s.assistantMembers()
				if err != nil {
					return "", err
				}
				raw, err := signing.Marshal(members)
				if err != nil {
					return "", err
				}
				put("assistant", raw)
			}
		default:
			if m.Raw != nil {
				put(m.Name, m.Raw)
			}
		}
	}
	b.WriteByte('}')
	return b.String(), nil
}

// Touch makes the shop's assistant state and its listings, as the TypeScript `listingsOf(store.assistant ??= ...)` does on first use.
func (s *Snap) Touch() *listings.State {
	s.ensureA()
	s.hasList = true
	return &s.Listings
}

// Serialize writes the state as the codec does: the format, then the assistant and the AI counts when there are any.
func (s *Snap) Serialize() (string, error) {
	if s.T != nil {
		return s.serializeKit()
	}
	out := struct {
		Format    int                        `json:"format"`
		Assistant map[string]json.RawMessage `json:"assistant,omitempty"`
		AI        *budget.AI                 `json:"ai,omitempty"`
	}{Format: Format, AI: s.AI}
	if s.A != nil {
		members, err := s.assistantMembers()
		if err != nil {
			return "", err
		}
		out.Assistant = members
	}
	b, err := signing.Marshal(out)
	return string(b), err
}

// assistantMembers is the assistant's state as members: its own, with the listings and the stock count written back whenever this runtime holds them (a state whose stock could
// not be read stays as the raw member it was carried as).
func (s *Snap) assistantMembers() (map[string]json.RawMessage, error) {
	m := s.A.Members()
	if s.hasList {
		l, err := signing.Marshal(s.Listings)
		if err != nil {
			return nil, err
		}
		m["listings"] = l
	}
	if s.Stock != nil {
		st, err := signing.Marshal(s.Stock)
		if err != nil {
			return nil, err
		}
		m["stock"] = st
	}
	return m, nil
}
