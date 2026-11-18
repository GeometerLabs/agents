package runtime

// The shop's state as one JSON text (modules/runtime/snapshot.ts, templates/commerce/listings/server/snapshot.ts): `{"format":1, "assistant":{...}, "ai":{...}}`. Only two fields,
// and both are here on purpose: `assistant` holds the listings, the cards and the owner's talk; `ai` holds the month's AI counts. This runtime models the listings and the AI counts;
// every other member of `assistant` (cards, talk, notes, memory, ...) is carried through as raw JSON; the stock count is typed (listings/stock.go) and written back, so a shop that is run by the TypeScript runtime again loses nothing
// by a spell in Go.

import (
	"encoding/json"
	"fmt"

	"github.com/GeometerLabs/agents/go/internal/budget"
	"github.com/GeometerLabs/agents/go/internal/listings"
	"github.com/GeometerLabs/agents/go/internal/signing"
)

// Format is the snapshot's own version.
const Format = 1

// Snap is the state, parsed.
type Snap struct {
	assistant map[string]json.RawMessage // nil: the shop has none yet
	Listings  listings.State
	hasList   bool
	Stock     *listings.Stock
	AI        *budget.AI
}

// freshAssistant is what the TypeScript runtime makes on first use of the assistant's state.
func freshAssistant() map[string]json.RawMessage {
	return map[string]json.RawMessage{"seq": json.RawMessage("0"), "cards": json.RawMessage("[]"), "refused": json.RawMessage("[]"), "closedDays": json.RawMessage("[]"),
		"undo": json.RawMessage("[]"), "talk": json.RawMessage("[]"), "limitChanges": json.RawMessage("[]")}
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
	s.assistant, s.AI = raw.Assistant, raw.AI
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
	if s.assistant == nil {
		s.assistant = freshAssistant()
	}
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
	if s.assistant != nil {
		out.Assistant = map[string]json.RawMessage{}
		for k, v := range s.assistant {
			out.Assistant[k] = v
		}
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
