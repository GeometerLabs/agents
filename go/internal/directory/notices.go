// "My feed changed" (modules/discovery/notices.ts; specs/shop-feed.md "My feed changed"). A shop that turned listing on tells its directory its feed changed. The notice is only a HINT:
// the directory never takes a listing from it, it reads the feed again (refresh.go, at most once a minute per feed) and believes only what the signed feed says.
//
// Accepted: a notice for a feed address under one of the pages domains this directory serves (https://<domain>/<slug>/listings.json), or exactly one of the configured feed addresses.
// When the directory already holds the shop's key the notice must be signed with it (so a notice naming a known shop cannot even make the directory read the feed more often). For a shop
// it has not met there is no key to check against and the hint is taken: all it does is get the feed read, where the real checks are. The number of feeds is capped.
package directory

import (
	"encoding/json"
	"regexp"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/signing"
)

const (
	MaxFeeds       = 5000
	MaxNoticeBytes = 2048
)

// NoticeConfig is what a notice is judged against.
type NoticeConfig struct {
	Index      *Index
	Served     []string // the pages domains this directory serves (host names, no scheme)
	Configured []string // feed addresses the directory was set up to read
	Now        func() int64
}

// NoticeAnswer is the status and the body to send.
type NoticeAnswer struct {
	Status  int
	OK      bool
	Message string
}

var slugFeed = regexp.MustCompile(`^/[a-z0-9][a-z0-9-]{1,38}[a-z0-9]/listings\.json$`)

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// FeedAllowed: may the directory read this feed address because a notice (or the config) named it?
func FeedAllowed(url string, served, configured []string) bool {
	u, ok := parseHTTPS(url)
	if !ok || u.Search != "" || u.Hash != "" {
		return false
	}
	if contains(configured, u.Href) {
		return true
	}
	return contains(served, u.Hostname) && u.Port == "" && slugFeed.MatchString(u.Pathname)
}

func refuse(status int, message string) NoticeAnswer {
	return NoticeAnswer{Status: status, Message: message}
}

// HandleNotice handles one notice (the body's text, already known to be JSON of the right size).
func HandleNotice(cfg NoticeConfig, body []byte) NoticeAnswer {
	var doc any
	_ = json.Unmarshal(body, &doc)
	n, ok := isObj(doc)
	feed, f1 := n["feed"].(string)
	_, f2 := n["updated"].(string)
	_, f3 := n["keyId"].(string)
	_, f4 := n["sig"].(string)
	if !ok || n["format"] != "shop-feed-changed/1" || !f1 || !f2 || !f3 || !f4 {
		return refuse(400, "That is not a shop-feed-changed/1 notice.")
	}
	if !FeedAllowed(feed, cfg.Served, cfg.Configured) {
		return refuse(403, "This directory does not read that address.")
	}
	now := cfg.Now()
	page := ""
	if len(feed) >= len("listings.json") {
		page = feed[:len(feed)-len("listings.json")]
	}
	if pin := cfg.Index.PinOf(page); pin != nil {
		// a known shop: the notice must be the shop's own
		var members map[string]json.RawMessage
		_ = json.Unmarshal(body, &members)
		if _, err := signing.VerifyNotice(members, pin.Key); err != nil {
			return refuse(403, "The notice is not signed with this shop's key.")
		}
	} else if !strings.HasSuffix(feed, "/listings.json") {
		return refuse(400, "A feed is at <shop page>/listings.json.")
	}
	if cfg.Index.Feed(feed) == nil && cfg.Index.FeedCount() >= MaxFeeds {
		return refuse(429, "This directory is full of feeds.")
	}
	cfg.Index.AddFeed(feed, "notice", now)
	cfg.Index.Want(feed, now)
	return NoticeAnswer{Status: 202, OK: true, Message: "Thank you: the feed will be read again soon."}
}
