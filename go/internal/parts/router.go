package parts

// The router's decision and its saved state: which part a message goes to. Pure: the claims in, the decision out (router_test.go runs the cases without a shop).
//
// Each part says how sure it is that a message is its own, by its rules alone (runtime.Claim: its own command with its own reference, words its reader reads as its own or an
// open conversation, a customer's words about what is open with them, or "a new customer, and I take new customers"). The highest claim takes the message. Two parts at the
// same highest claim is a message the shop does not guess about: it asks the one who wrote one short question (the parts' names, with a button each), keeps the message, and
// hands it to the part the answer names. A message no part claims goes to the shop's first part: for the owner, its assistant reads it (the assistant hosts every part's skill);
// for anyone else, the first part answers as a single-part shop of it would.

import (
	"encoding/json"

	"github.com/GeometerLabs/agents/go/internal/runtime"
)

// askWindowMs is how long the shop waits for the answer to its question; a later message is read on its own and the one asked about is not acted on.
const askWindowMs = 30 * 60_000

// routedKeep is how many messages' parts the router remembers, so a message delivered again goes to the part it went to the first time (that part's own memory drops it).
const routedKeep = 200

// decision is where a message goes: one part, or a question about the parts in `ask`.
type decision struct {
	part int
	ask  []int
	// why says it for the record: "claimed" (one part claimed it most), "nobody" (no part did: the first part has it), "tied" (two or more did, equally)
	why string
}

// decide is the router's rule over the parts' claims; `first` is the part a message nobody claims goes to.
func decide(claims []runtime.Claim, first int) decision {
	top := runtime.ClaimNone
	for _, c := range claims {
		top = max(top, c)
	}
	if top == runtime.ClaimNone {
		return decision{part: first, why: "nobody"}
	}
	var tied []int
	for i, c := range claims {
		if c == top {
			tied = append(tied, i)
		}
	}
	if len(tied) == 1 {
		return decision{part: tied[0], why: "claimed"}
	}
	return decision{part: -1, ask: tied, why: "tied"}
}

// routerState is the router's part of the saved state.
type routerState struct {
	// Routed are the last messages and the part each went to ("" for one the shop asked about).
	Routed []routed `json:"routed,omitempty"`
	// Asked are the messages the shop asked about, each waiting for its writer's answer: one per number (a newer question to the same number replaces its older one).
	Asked []*asked `json:"asked,omitempty"`
}

// askedKeep is how many numbers' questions wait at once; the oldest goes first (its message is not acted on, as with any question not answered).
const askedKeep = 50

// takeAsked is the question waiting for this number's answer, and takes it off the list (the next message from the number either answers it or leaves it unanswered).
func (r *routerState) takeAsked(from string) *asked {
	for i, q := range r.Asked {
		if digitsOf(q.From) == digitsOf(from) {
			r.Asked = append(r.Asked[:i:i], r.Asked[i+1:]...)
			return q
		}
	}
	return nil
}

// ask puts a question on the list.
func (r *routerState) ask(q *asked) {
	r.takeAsked(q.From)
	r.Asked = append(r.Asked, q)
	if len(r.Asked) > askedKeep {
		r.Asked = r.Asked[len(r.Asked)-askedKeep:]
	}
}

type routed struct {
	ID   string `json:"id"`
	Part string `json:"part"`
}

// asked is a message kept until its writer says which part it is for. Event is the event as it came (its words included: kept only until it is answered or the next message
// comes, as a part keeps a conversation's words).
type asked struct {
	ID    string          `json:"id"`
	From  string          `json:"from"`
	Owner bool            `json:"owner"`
	Parts []string        `json:"parts"`
	AtMs  int64           `json:"atMs"`
	Event json.RawMessage `json:"event"`
}

// partOf is the part a message went to, and whether it is remembered at all.
func (r *routerState) partOf(id string) (string, bool) {
	for i := len(r.Routed) - 1; i >= 0; i-- {
		if r.Routed[i].ID == id {
			return r.Routed[i].Part, true
		}
	}
	return "", false
}

// remember says which part a message went to.
func (r *routerState) remember(id, part string) {
	if id == "" {
		return
	}
	r.Routed = append(r.Routed, routed{ID: id, Part: part})
	if len(r.Routed) > routedKeep {
		r.Routed = r.Routed[len(r.Routed)-routedKeep:]
	}
}
