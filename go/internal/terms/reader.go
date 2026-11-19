// Reads client/terms.json for a running shop (B72), the way the licence is read: again whenever the file changes, so an Operator's change reaches the runtime with no restart. No file,
// or a file that does not check, means the terms feature is off for this shop. The Go twin of modules/terms/reader.ts; handed to the agent as its `terms`.
package terms

import (
	"os"
	"path/filepath"
	"sync"

	"github.com/GeometerLabs/agents/go/internal/guard"
)

// NewReader is termsReader: the returned function gives the shop's terms now, or nil when the feature is off. It reads the file again only when its modified time changed. A file that
// is there but does not check is remembered as "off" until it changes (the TypeScript sets `seen` to the modified time before checking it), and any failure to stat, read or parse the
// file switches the feature off and forgets the modified time, so a repaired file with the same time is read.
//
// Go differs from JavaScript in one small way: the modified time is compared in nanoseconds, where `mtimeMs` is a float of milliseconds, so two writes within one millisecond are told
// apart here.
func NewReader(folder string) func() *File {
	abs, err := filepath.Abs(folder)
	if err != nil {
		abs = folder
	}
	file := filepath.Join(abs, "terms.json")
	var mu sync.Mutex
	var last *File
	seen := int64(-1)
	return func() *File {
		mu.Lock()
		defer mu.Unlock()
		info, err := os.Stat(file)
		if err == nil {
			if m := info.ModTime().UnixNano(); m != seen {
				var text []byte
				if text, err = os.ReadFile(file); err == nil {
					var raw any
					if raw, err = guard.Decode(string(text)); err == nil {
						last, seen = ReadFile(raw), m
					}
				}
			}
		}
		if err != nil {
			last, seen = nil, -1 // the file is gone (or unreadable): the feature is off again
		}
		return last
	}
}
