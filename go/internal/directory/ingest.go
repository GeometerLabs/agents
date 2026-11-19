// Taking one feed's text into the index (modules/discovery/ingest.ts): read it (feed.go), check its signature and key (trust.go), and put it in (index.go), or hold it or refuse it. The
// single place a feed becomes index rows, whether the text just came off the network or is being read again from the copy the index kept.
package directory

import "encoding/json"

// Ingested is what became of a feed's text.
type Ingested struct {
	State   string // accepted, held or refused
	Shop    string
	Items   int
	Dropped []string
	NewKey  bool
	Reason  string
}

// IngestFeed takes a feed's text (read from feedURL) into the index. etag is what the shop answered with, kept for the next conditional read. fromStore is a rebuild reading its own kept
// copy: a copy signed by an earlier key than the pinned one is skipped, not held again.
func IngestFeed(index *Index, feedURL, text string, etag *string, now int64, fromStore bool) Ingested {
	read := ParseFeed(text, feedURL)
	if !read.OK {
		return Ingested{State: "refused", Reason: read.Reason}
	}
	var members map[string]json.RawMessage
	_ = json.Unmarshal([]byte(text), &members)
	page := read.Feed.Shop.Page
	trust := TrustFeed(members, index.PinOf(page))
	switch trust.State {
	case TrustRefused:
		return Ingested{State: "refused", Reason: trust.Reason}
	case TrustChanged:
		if fromStore {
			return Ingested{State: "refused", Reason: "the kept copy was signed with an earlier key than the pinned one"}
		}
		index.Hold(page, trust.Pinned.KeyID, trust.Offered, now)
		return Ingested{State: "held", Shop: page}
	}
	if err := index.Ingest(feedURL, read.Feed, trust.Pin, text, etag, now); err != nil {
		return Ingested{State: "refused", Reason: "the index could not take the feed"}
	}
	return Ingested{State: "accepted", Shop: page, Items: len(read.Feed.Items), Dropped: read.Dropped, NewKey: trust.State == TrustFirst}
}
