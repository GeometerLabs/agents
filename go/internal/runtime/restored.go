package runtime

// A runtime put back from a nightly snapshot (modules/runtime/restored.ts): the deploy bundle leaves `restored.json` beside the database, and at the next start, before any step,
// the runtime writes one `restored` entry to the record (an append like any other), naming the snapshot, and renames the note so this is done once (and, if the process stops in
// between, not twice: the entry is looked for first). The TypeScript codec moves every "count" field of the store on by 100,000; a listings-only store has none (its listings keep
// their own id sequence inside assistant.listings), so the snapshot is unchanged: exactly what the TypeScript runtime saves, including its entry text, which says the ids moved
// on. (That sentence is not true for a listings shop's listing ids in EITHER runtime: noted in go/TRIAL.md.)

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/GeometerLabs/agents/go/internal/store"
)

const restoreIDGap = 100_000

// afterRestore does the restore step if a note is there. A failure to write is returned; the note is only retired after the entry is saved.
func (r *Runtime) afterRestore() error {
	file := filepath.Join(r.o.Client.Config.DataDir, "restored.json")
	b, err := os.ReadFile(file)
	if err != nil {
		return nil
	}
	var note map[string]any
	if json.Unmarshal(b, &note) != nil {
		note = map[string]any{} // an unreadable note still means the data was put back
	}
	str := func(k string) string {
		if s, ok := note[k].(string); ok && s != "" {
			return s
		}
		return "unknown"
	}
	refs := map[string]string{"snapshot": str("snapshot"), "restoredAt": str("restoredAt"), "idGap": fmt.Sprint(restoreIDGap)}
	done := false
	for _, e := range r.entries {
		if e.Action == "restored" && e.Refs["snapshot"] == refs["snapshot"] && e.Refs["restoredAt"] == refs["restoredAt"] {
			done = true
		}
	}
	if !done {
		lastSeq := len(r.entries)
		if v, ok := note["lastSeq"].(float64); ok {
			lastSeq = int(v)
		}
		number, lang := r.owner()
		rec := r.recorder()
		rec.append(NewLine{Conversation: number, Action: "restored", Outcome: "confirmed", Inputs: note, Language: lang, Refs: refs,
			Notes: fmt.Sprintf("This shop's data was put back from the nightly snapshot of %s, which ends at entry %d. What the agent did after that snapshot is not in this record; the payment service, the calendar and Guard keep their own. Every new id starts %d further on, so none can be one used after the snapshot. Each payment link, refund and calendar write is looked up in the provider's own record before anything is sent.", refs["snapshot"], lastSeq, restoreIDGap)})
		if err := r.o.Store.CommitStep(store.Step{Snapshot: r.snapshot, Entries: rec.fresh, NowMs: r.o.Now()}); err != nil {
			return err
		}
		r.entries = append(r.entries, rec.fresh...)
		r.o.Log(fmt.Sprintf("Restored from the snapshot of %s: ids moved on by %d, a \"restored\" entry written; every payment link, refund and calendar write is looked up at the provider before it is sent.", refs["snapshot"], restoreIDGap))
	}
	stamp := strings.NewReplacer("-", "", ":", "").Replace(time.UnixMilli(r.o.Now()).UTC().Format("2006-01-02T150405Z"))
	_ = os.Rename(file, file+".done-"+stamp)
	return nil
}
