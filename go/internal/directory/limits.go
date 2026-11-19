// Per-address limits, kept in memory only (modules/discovery/limits.ts; specs/directory.md "Privacy"): how many requests one address may make in a window. The address is held as a
// salted hash (so a heap dump or a crash report does not hold a visitor's address as it is) and only for the window; nothing is written to disk, and a restart forgets it all.
package directory

import (
	"crypto/rand"
	"encoding/hex"
	"strings"
	"sync"
	"time"
)

// Limit is how many requests in a window (milliseconds).
type Limit struct {
	Max   int
	PerMs int64
}

// Limiter is a sliding-window limiter.
type Limiter struct {
	limits map[string]Limit
	now    func() int64
	salt   string
	mu     sync.Mutex
	seen   map[string][]int64
	swept  int64
}

// NewLimiter makes one. now is in milliseconds (nil: the clock).
func NewLimiter(limits map[string]Limit, now func() int64) *Limiter {
	if now == nil {
		now = func() int64 { return time.Now().UnixMilli() }
	}
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return &Limiter{limits: limits, now: now, salt: hex.EncodeToString(b), seen: map[string][]int64{}}
}

// Take counts one request and says whether it is allowed.
func (l *Limiter) Take(kind, who string) bool {
	limit, ok := l.limits[kind]
	if !ok {
		return true
	}
	t := l.now()
	l.mu.Lock()
	defer l.mu.Unlock()
	if t-l.swept > 60_000 { // forget old windows, so the memory holds only the last few minutes
		l.swept = t
		for k, v := range l.seen {
			per := l.limits[strings.SplitN(k, " ", 2)[0]].PerMs
			var keep []int64
			for _, x := range v {
				if t-x < per {
					keep = append(keep, x)
				}
			}
			if len(keep) > 0 {
				l.seen[k] = keep
			} else {
				delete(l.seen, k)
			}
		}
	}
	id := kind + " " + turnHash(l.salt+"|"+who)
	var times []int64
	for _, x := range l.seen[id] {
		if t-x < limit.PerMs {
			times = append(times, x)
		}
	}
	if len(times) >= limit.Max {
		l.seen[id] = times
		return false
	}
	l.seen[id] = append(times, t)
	return true
}

// Held is how many windows are held (a test that checks the memory is bounded).
func (l *Limiter) Held() int { l.mu.Lock(); defer l.mu.Unlock(); return len(l.seen) }
