// Reading feeds from the network (modules/discovery/refresh.ts; specs/directory.md "Which feeds it reads"): one read of one feed, and the pass that reads every feed that is due. The
// network is the Fetcher handed in, so this file opens no socket itself.
//
// A feed is due when: a notice hinted it changed and it was last read more than a minute ago (at most once a minute per feed); it was never read; or it was last read more than 6 hours ago.
// Every read after the first sends If-None-Match with the shop's ETag. What the answer does: 200 the text goes through IngestFeed (a refused feed leaves the index as it was and records why);
// 304 nothing changed; 404/410 the feed is "gone" (after a whole day of it the feed and its items are dropped); anything else, or no answer, is recorded and tried again next time (a shop's
// server being down for a day does not remove it).
package directory

import (
	"strconv"
	"sync"
	"time"
)

const (
	RefreshMs   = 6 * 3_600_000
	MinRereadMs = 60_000
	DropAfterMs = 24 * 3_600_000
)

// ReadDeps is what a read needs.
type ReadDeps struct {
	Index   *Index
	Fetch   Fetcher
	Now     func() int64
	Timeout time.Duration
}

func (d ReadDeps) now() int64 {
	if d.Now != nil {
		return d.Now()
	}
	return time.Now().UnixMilli()
}

func strp(s string) *string { return &s }

// ReadFeedNow reads one feed now and acts on the answer. It never panics for a bad answer. Results: accepted, unchanged, held, refused, gone, dropped, error.
func ReadFeedNow(d ReadDeps, url string) (string, *Ingested) {
	now := d.now()
	row := d.Index.Feed(url)
	if row == nil {
		return "error", nil
	}
	headers := map[string]string{"accept": "application/json"}
	if row.Etag != nil && *row.Etag != "" && row.HasBody {
		headers["if-none-match"] = *row.Etag
	}
	timeout := d.Timeout
	if timeout == 0 {
		timeout = 10 * time.Second
	}
	res, err := d.Fetch(url, FetchRequest{Method: "GET", Headers: headers, Timeout: timeout, MaxBytes: MaxFeedBytes})
	if err != nil {
		d.Index.Touch(url, now, strp("no answer: "+err.Error()))
		return "error", nil
	}
	switch {
	case res.Status == 304:
		d.Index.ClearGone(url)
		d.Index.Touch(url, now, nil)
		return "unchanged", nil
	case res.Status == 404 || res.Status == 410:
		d.Index.Touch(url, now, strp("the feed answered "+strconv.Itoa(res.Status)))
		since := d.Index.MarkGone(url, now)
		if now-since >= DropAfterMs {
			d.Index.DropFeed(url)
			return "dropped", nil
		}
		return "gone", nil
	case res.Status != 200:
		d.Index.Touch(url, now, strp("the feed answered "+strconv.Itoa(res.Status)))
		return "error", nil
	}
	var etag *string
	if e, ok := res.Headers["etag"]; ok {
		etag = &e
	}
	done := IngestFeed(d.Index, url, res.Body, etag, now, false)
	if done.State == "accepted" {
		return "accepted", &done
	}
	if done.State == "refused" {
		d.Index.Touch(url, now, strp(done.Reason))
		return "refused", &done
	}
	d.Index.Touch(url, now, strp("signed by another key than the one pinned; held for a person"))
	return "held", &done
}

// IsDue: is this feed due for a read now?
func IsDue(f FeedRow, now int64) bool {
	if f.CheckedAt == nil {
		return true
	}
	if f.WantedAt != nil && now-*f.CheckedAt >= MinRereadMs {
		return true
	}
	return now-*f.CheckedAt >= RefreshMs
}

// RefreshDue is one pass: read every feed that is due, a few at a time. It returns what each read did.
func RefreshDue(d ReadDeps, concurrency int) map[string]string {
	now := d.now()
	var due []string
	for _, f := range d.Index.Feeds() {
		if IsDue(f, now) {
			due = append(due, f.URL)
		}
	}
	out := map[string]string{}
	var mu, qmu sync.Mutex
	next := 0
	var wg sync.WaitGroup
	for w := 0; w < concurrency && w < len(due); w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				qmu.Lock()
				if next >= len(due) {
					qmu.Unlock()
					return
				}
				u := due[next]
				next++
				qmu.Unlock()
				r, _ := ReadFeedNow(d, u)
				mu.Lock()
				out[u] = r
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	return out
}
