// The shapes a directory works with (modules/discovery/types.ts), written once. They follow specs/shop-feed.md, specs/shop-check.md and specs/directory.md; a change here is a
// change to those documents. JSON member ORDER is the TypeScript object's, so a document written here reads the same, byte for byte, as the TypeScript one.
package directory

import (
	"encoding/json"
	"time"
)

// Langs are the four languages the words are in, in the TypeScript order (it is the order a title's members are written in).
var Langs = []string{"en", "hi", "ml", "kn"}

// Categories is the fixed list of kinds, in the TypeScript order.
var Categories = []string{"pets", "food", "clothes", "home", "electronics", "vehicles_and_cycles", "services", "other"}

const (
	MaxFeedBytes = 1_000_000
	MaxFeedItems = 200
	MaxCheckIDs  = 10
)

func isLang(s string) bool {
	for _, l := range Langs {
		if l == s {
			return true
		}
	}
	return false
}

func isCategory(s string) bool {
	for _, c := range Categories {
		if c == s {
			return true
		}
	}
	return false
}

// LangWords is a title or a text: words by language. It is written in Langs order and with only the languages it has, as the TypeScript object is.
type LangWords map[string]string

func (w LangWords) MarshalJSON() ([]byte, error) {
	out := []byte{'{'}
	first := true
	for _, l := range Langs {
		v, ok := w[l]
		if !ok {
			continue
		}
		if !first {
			out = append(out, ',')
		}
		first = false
		k, _ := json.Marshal(l)
		val, _ := marshalNoEscape(v)
		out = append(append(append(out, k...), ':'), val...)
	}
	return append(out, '}'), nil
}

// Price is the owner's price: exact rupees as a decimal string with two places. Nil elsewhere means "ask the shop".
type Price struct {
	Value    string `json:"value"`
	Currency string `json:"currency"`
	Note     string `json:"note,omitempty"`
}

// Photo is a photo as a feed lists it.
type Photo struct {
	URL    string `json:"url"`
	Type   string `json:"type"`
	Width  *int64 `json:"width,omitempty"`
	Height *int64 `json:"height,omitempty"`
}

// Registration is the owner's own word about a trade registration; it always says so.
type Registration struct {
	Kind   string `json:"kind"`
	Number string `json:"number"`
	Source string `json:"source"`
}

// Place is where a shop is.
type Place struct {
	Town    string `json:"town"`
	Pincode string `json:"pincode,omitempty"`
	Lat     string `json:"lat,omitempty"`
	Lon     string `json:"lon,omitempty"`
}

// FeedShop is the shop block of a feed.
type FeedShop struct {
	Name         string
	Page         string
	Trade        string
	Languages    []string
	Place        Place
	Chat, Check  string
	AgentCard    string
	Registration *Registration
}

// FeedItem is one listing as a feed carries it, once read and checked.
type FeedItem struct {
	ID, Page, Category string
	Title, Text        LangWords
	OwnerLanguage      string
	MachineWritten     []string
	Price              *Price
	Quantity           *int64
	Photos             []Photo
	Availability       string
	Confirmed          string
}

// Feed is a feed once read and checked (the signature is checked by trust.go, not here).
type Feed struct {
	Updated string
	Shop    FeedShop
	Items   []FeedItem
}

// CheckedItem is one item as the check answer gives it. HasPrice tells "no price member" from "price: null" (null means "ask the shop").
type CheckedItem struct {
	ID           string
	Availability string // in_stock, call_to_check or gone
	HasPrice     bool
	Price        *Price
	Quantity     *int64
	Confirmed    string
}

// Fetcher is how the directory reaches the network, handed in by whoever runs it (so the package opens no socket itself, and a test needs no network). A call that cannot be
// answered (no connection, a refused address, a timeout, a body over MaxBytes) returns an error; an answer with any status returns.
type Fetcher func(url string, req FetchRequest) (FetchResponse, error)

// FetchRequest is one call.
type FetchRequest struct {
	Method   string
	Headers  map[string]string
	Body     string
	Timeout  time.Duration
	MaxBytes int
}

// FetchResponse is what a call came to; the header names are lower-case.
type FetchResponse struct {
	Status  int
	Headers map[string]string
	Body    string
}
