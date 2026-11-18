package runtime

// The shop's state as one JSON text (modules/runtime/snapshot.ts, templates/commerce/listings/server/snapshot.ts): `{"format":1, "assistant":{...}, "ai":{...}}`. Only two fields,
// and both are here on purpose: `assistant` holds the listings, the cards and the owner's talk; `ai` holds the month's AI counts. This runtime models the listings and the AI counts;
// every other member of `assistant` (cards, talk, notes, memory, ...) is carried through as raw JSON; the stock count is typed (listings/stock.go) and written back, so a shop that is run by the TypeScript runtime again loses nothing
// by a spell in Go.

import (
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
	if l, ok := s.assistant["listings"]; ok {
		if err := json.Unmarshal(l, &s.Listings); err != nil {
			return nil, fmt.Errorf("the saved listings cannot be read: %w", err)
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
	return s, nil
}

// Touch makes the shop's assistant state and its listings, as the TypeScript `listingsOf(store.assistant ??= ...)` does on first use.
func (s *Snap) Touch() *listings.State {
	s.ensureA()
	s.hasList = true
	return &s.Listings
}

// Serialize writes the state as the codec does: the format, then the assistant and the AI counts when there are any.
func (s *Snap) Serialize() (string, error) {
	out := struct {
		Format    int                        `json:"format"`
		Assistant map[string]json.RawMessage `json:"assistant,omitempty"`
		AI        *budget.AI                 `json:"ai,omitempty"`
	}{Format: Format, AI: s.AI}
	if s.A != nil {
		out.Assistant = s.A.Members()
		if s.hasList {
			l, err := signing.Marshal(s.Listings)
			if err != nil {
				return "", err
			}
			out.Assistant["listings"] = l
		}
		// the stock count is written back whenever this runtime holds it (a state whose stock could not be read stays as the raw member it was carried as)
		if s.Stock != nil {
			st, err := signing.Marshal(s.Stock)
			if err != nil {
				return "", err
			}
			out.Assistant["stock"] = st
		}
	}
	b, err := signing.Marshal(out)
	return string(b), err
}
