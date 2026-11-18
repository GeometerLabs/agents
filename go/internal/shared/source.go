package shared

// The folder layout the deployer writes (folderSource in modules/runtime/shared.ts): `<clients>/<shop>/client/{settings.json,runtime.json,pathway.lock,...}` (read-only here) and
// `<secrets>/<shop>/{internal_token,channel_token,record_key}`. The shop's data folder is named in its runtime.json (`dataDir`).

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"sort"
)

// FolderSource is the deployer's layout.
type FolderSource struct{ ClientsDir, SecretsDir string }

// List: every directory whose name is a shop name, sorted.
func (f FolderSource) List() []string {
	entries, err := os.ReadDir(f.ClientsDir)
	if err != nil {
		return nil
	}
	var out []string
	for _, e := range entries {
		if e.IsDir() && ShopName.MatchString(e.Name()) {
			out = append(out, e.Name())
		}
	}
	sort.Strings(out)
	return out
}

// Paths of one shop's files.
func (f FolderSource) Paths(name string) Paths {
	return Paths{Name: name, ClientFolder: filepath.Join(f.ClientsDir, name, "client"), TokenFile: filepath.Join(f.SecretsDir, name, "internal_token"),
		ChannelTokenFile: filepath.Join(f.SecretsDir, name, "channel_token"), RecordKeyFile: filepath.Join(f.SecretsDir, name, "record_key")}
}

// Ready: every file there (the lock is written last, so a shop half written never runs; a missing token file means NO start, never a start on another's token).
func (f FolderSource) Ready(name string) bool {
	p := f.Paths(name)
	for _, file := range []string{filepath.Join(p.ClientFolder, "settings.json"), filepath.Join(p.ClientFolder, "runtime.json"), filepath.Join(p.ClientFolder, "pathway.lock"), p.TokenFile, p.ChannelTokenFile, p.RecordKeyFile} {
		if _, err := os.Stat(file); err != nil {
			return false
		}
	}
	return true
}

// Fingerprint: only the three files that decide how the shop runs; pages.json, owner-grants.json and the like are read fresh by the shop on every request and need no restart.
func (f FolderSource) Fingerprint(name string) string {
	h := sha256.New() // the same text as shared.ts: the three files joined by a NUL, so a strike memory file is readable by either
	for i, file := range []string{"settings.json", "runtime.json", "pathway.lock"} {
		b, _ := os.ReadFile(filepath.Join(f.Paths(name).ClientFolder, file))
		if i > 0 {
			h.Write([]byte{0})
		}
		h.Write(b)
	}
	return hex.EncodeToString(h.Sum(nil))[:16]
}
