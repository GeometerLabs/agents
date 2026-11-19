package bookings

// The shared runtime's task runner, driven through the Bookings template, proved equal to the TypeScript's (modules/runtime/tasks.ts over the real store) on the cases of
// testdata/runner-vectors.json: steps one at a time in the order they arrived, a failing step tried again then failed while the queue goes on, a try counted before the process
// died, no retries, and /readyz's reason when the store cannot be read. These stand for the TypeScript unit tests runtime.test.ts and server.test.ts (readyz), whose step seam
// (`aroundStep`) is in-process only.

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/store"
)

// stepKit is the Bookings kit with an agent that notes each try and fails the ones the case names.
type stepKit struct {
	*Kit
	mu    sync.Mutex
	tries []string
	fail  map[string]bool
}

type stepAgent struct {
	runtime.Agent
	k *stepKit
}

func (a stepAgent) Handle(ev map[string]any) error {
	key := runtime.EventKey(ev)
	a.k.mu.Lock()
	a.k.tries = append(a.k.tries, key)
	a.k.mu.Unlock()
	if a.k.fail[key] {
		return errors.New("this step fails (the case says so)")
	}
	return nil
}

func (k *stepKit) NewAgent(c *runtime.StepContext) runtime.Agent {
	return stepAgent{Agent: k.Kit.NewAgent(c), k: k}
}

func testRuntime(t *testing.T, kit runtime.Kit, s *Settings, dir string, delays []time.Duration) (*runtime.Runtime, *store.Store) {
	t.Helper()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	client := &runtime.Client{Folder: dir}
	client.Settings.Own, client.Settings.Name, client.Settings.Timezone = s, s.Name, s.Timezone
	client.Settings.Owner.Whatsapp, client.Settings.Owner.Language = s.Owner.Whatsapp, s.Owner.Language
	client.Config.DataDir, client.Config.Mode = dir, "fakes"
	rt, err := runtime.New(runtime.Options{Client: client, Store: st, Kit: kit, RetryDelays: delays})
	if err != nil {
		t.Fatal(err)
	}
	return rt, st
}

func TestRunnerVectors(t *testing.T) {
	var vs []struct {
		Name  string `json:"name"`
		Input struct {
			Events         []string        `json:"events"`
			RetryDelaysMs  []int64         `json:"retryDelaysMs"`
			Steps          map[string]string `json:"steps"`
			RestartRunning bool            `json:"restartRunning"`
			Closed         bool            `json:"closed"`
		} `json:"input"`
		Output json.RawMessage `json:"output"`
	}
	readVectors(t, "runner-vectors.json", &vs)
	s := exampleSettings(t)
	for _, v := range vs {
		t.Run(v.Name, func(t *testing.T) {
			dir := t.TempDir()
			kit := &stepKit{Kit: &Kit{Settings: s}, fail: map[string]bool{}}
			for k, what := range v.Input.Steps {
				kit.fail[k] = what == "fail"
			}
			delays := []time.Duration{}
			for _, ms := range v.Input.RetryDelaysMs {
				delays = append(delays, time.Duration(ms)*time.Millisecond)
			}
			rt, st := testRuntime(t, kit, s, dir, delays)
			if v.Input.Closed {
				var want struct {
					ReasonStartsWith string `json:"reasonStartsWith"`
				}
				_ = json.Unmarshal(v.Output, &want)
				if ok, _ := rt.Ready(); !ok {
					t.Fatal("not ready while the store is open")
				}
				_ = st.Close()
				ok, why := rt.Ready()
				if ok || !strings.HasPrefix(why, want.ReasonStartsWith) {
					t.Fatalf("with the store closed: ready=%v %q", ok, why)
				}
				return
			}
			var events []map[string]any
			for _, id := range v.Input.Events {
				events = append(events, map[string]any{"kind": "message", "message": map[string]any{"id": id, "from": "+919811111111", "text": "hi", "timestamp": float64(1)}})
			}
			if _, _, err := rt.SubmitKit(events); err != nil {
				t.Fatal(err)
			}
			if v.Input.RestartRunning {
				// the first task's try was counted, then the process died: the next start runs it again
				head, _ := st.NextPending()
				if _, err := st.StartAttempt(head.ID); err != nil {
					t.Fatal(err)
				}
			}
			rt.Start(time.Hour)
			deadline := time.Now().Add(5 * time.Second)
			for {
				c, _ := st.TaskCounts()
				if c.Pending == 0 || time.Now().After(deadline) {
					break
				}
				time.Sleep(5 * time.Millisecond)
			}
			rt.Close()
			counts, _ := st.TaskCounts()
			got, _ := json.Marshal(map[string]any{"tries": kit.tries, "counts": counts})
			var want, have any
			_ = json.Unmarshal(v.Output, &want)
			_ = json.Unmarshal(got, &have)
			if string(mustJSON(want)) != string(mustJSON(have)) {
				t.Fatalf("want %s\n got %s", mustJSON(want), mustJSON(have))
			}
			_ = st.Close()
			_ = os.RemoveAll(filepath.Join(dir, "agent.db"))
		})
	}
}

func mustJSON(v any) []byte { b, _ := json.Marshal(v); return b }
