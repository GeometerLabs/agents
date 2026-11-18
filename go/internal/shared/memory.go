package shared

// What the host remembers about a shop BY NAME, so a shop that is stopped and started again does not get a clean sheet (shared-pool.ts `Memory`). It is dropped when the shop's
// fingerprint (its files) changes: someone fixed it. Unlike the TypeScript pool it is also written to a small json file in the host's state dir after every change, because a
// quarantined shop must STAY quarantined across a restart of the host: that restart is the one moment nothing in the process holds the shop's store, so it is where a stuck
// shop is moved out safely.

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type memory struct {
	Fingerprint string  `json:"fingerprint"`
	Strikes     []int64 `json:"strikes,omitempty"`  // ms; strikes in the shared process
	Failures    []int64 `json:"failures,omitempty"` // ms; failures of its own process (quarantine)
	Quarantined bool    `json:"quarantined,omitempty"`
	PausedUntil int64   `json:"pausedUntil,omitempty"`
	PausedWhy   string  `json:"pausedWhy,omitempty"`
}

const memoryFile = "shared-strikes.json"

func loadMemory(dir string) map[string]*memory {
	out := map[string]*memory{}
	if dir == "" {
		return out
	}
	if b, err := os.ReadFile(filepath.Join(dir, memoryFile)); err == nil {
		_ = json.Unmarshal(b, &out) // a file that cannot be read is a clean sheet, never a reason not to start
	}
	if out == nil {
		out = map[string]*memory{}
	}
	return out
}

// saveMemory writes the whole map (small: a few lines per shop that ever struck) through a temporary file, so a crash never leaves half a file.
func saveMemory(dir string, m map[string]*memory) error {
	if dir == "" {
		return nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	b, err := json.Marshal(m)
	if err != nil {
		return err
	}
	tmp := filepath.Join(dir, memoryFile+".tmp")
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(dir, memoryFile))
}

// recent keeps the entries newer than the window.
func recent(list []int64, now int64, windowMs int64) []int64 {
	var out []int64
	for _, at := range list {
		if now-at < windowMs {
			out = append(out, at)
		}
	}
	return out
}
