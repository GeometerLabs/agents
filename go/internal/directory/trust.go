// Whose key signed a feed, and may it speak for this shop page? (modules/discovery/trust.ts; specs/directory.md "Keys"). The directory PINS the first key it saw for a shop page. A
// feed signed with the pinned key is believed. A feed signed with another key is not shown: its items are held and the change is listed for a person to look at. A key changes only
// when a shop loses its folder (its key moves with it when the shop changes Operator), so this is rare, and a person decides. The feed's own key is used only the first time (no key
// pinned yet), because the feed's own key proves nothing about whose it is; from then on the pinned key is the one the signature is checked against.
package directory

import (
	"encoding/json"

	"github.com/GeometerLabs/agents/go/internal/signing"
)

// Pin is a pinned key: its id and the public key (SPKI DER, base64url).
type Pin struct{ KeyID, Key string }

// Trust states.
const (
	TrustFirst   = "first"   // no key was pinned: this one is kept now
	TrustSame    = "same"    // signed with the pinned key
	TrustChanged = "changed" // signed (validly) by another key than the pinned one: hold and list
	TrustRefused = "refused" // not signed, or not validly
)

// FeedTrust is the answer of TrustFeed.
type FeedTrust struct {
	State   string
	Pin     Pin // first, same: the key to keep
	Pinned  Pin // changed
	Offered Pin // changed
	Reason  string
}

// TrustFeed checks a feed document's signature and compares its key with the pinned one (if any). `members` is the document as received (every member as its bytes).
func TrustFeed(members map[string]json.RawMessage, pinned *Pin) FeedTrust {
	var sig struct {
		Key   *string `json:"key"`
		KeyID *string `json:"keyId"`
	}
	if raw, ok := members["signature"]; !ok || json.Unmarshal(raw, &sig) != nil || sig.Key == nil || sig.KeyID == nil {
		return FeedTrust{State: TrustRefused, Reason: "the feed is not signed with a key it carries"}
	}
	offered := Pin{KeyID: *sig.KeyID, Key: *sig.Key}
	// the feed's own signature must be valid under the key it carries, always
	if _, err := signing.VerifyDocument(members, ""); err != nil {
		return FeedTrust{State: TrustRefused, Reason: "the feed's signature is not valid (" + err.Error() + ")"}
	}
	if pinned == nil {
		return FeedTrust{State: TrustFirst, Pin: offered}
	}
	if *pinned == offered {
		return FeedTrust{State: TrustSame, Pin: *pinned}
	}
	return FeedTrust{State: TrustChanged, Pinned: *pinned, Offered: offered}
}
