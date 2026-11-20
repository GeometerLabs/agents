package voice

// The Go voice module against the TypeScript's own answers (testdata/voice-vectors.json, made by go/scripts/gen_voice_vectors.ts): the length of Ogg Opus and WebM Opus notes
// and of files that are neither, the cost of listening; and the service's own rules over a scripted provider (the day's limit, too long, low confidence, the memo that answers a
// step that runs again without a second call).

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"testing"
)

type vectors struct {
	Audio []struct {
		Bytes string   `json:"bytes"`
		Ogg   *float64 `json:"ogg"`
		Webm  *float64 `json:"webm"`
	} `json:"audio"`
	Costs []struct {
		Rate, Seconds float64
		Micro         int64
	} `json:"costs"`
}

func load(t *testing.T) vectors {
	b, err := os.ReadFile("testdata/voice-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v vectors
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func same(t *testing.T, what string, got float64, ok bool, want *float64) {
	t.Helper()
	if want == nil {
		if ok {
			t.Errorf("%s: got %v, TypeScript reads no length", what, got)
		}
		return
	}
	if !ok || got != *want {
		t.Errorf("%s: got %v (%v), TypeScript %v", what, got, ok, *want)
	}
}

func TestTheLengthOfANoteIsTheTypeScripts(t *testing.T) {
	for i, a := range load(t).Audio {
		b, _ := base64.StdEncoding.DecodeString(a.Bytes)
		s, ok := OggOpusSeconds(b)
		same(t, "ogg", s, ok, a.Ogg)
		s, ok = WebmOpusSeconds(b)
		same(t, "webm", s, ok, a.Webm)
		_ = i
	}
}

func TestTheCostOfListeningIsTheTypeScripts(t *testing.T) {
	for _, c := range load(t).Costs {
		if got := CostMicroInr(c.Rate, c.Seconds); got != c.Micro {
			t.Errorf("%v rupees a minute for %v s: got %d, TypeScript %d", c.Rate, c.Seconds, got, c.Micro)
		}
	}
}

type scripted struct {
	calls int
	t     Transcript
	err   error
}

func (s *scripted) Name() string  { return "scripted" }
func (s *scripted) Model() string { return "scripted-stt" }
func (s *scripted) Transcribe([]byte, string, []string) (Transcript, error) {
	s.calls++
	return s.t, s.err
}

func note(t *testing.T, seconds float64) []byte {
	for _, a := range load(t).Audio {
		if a.Ogg != nil && *a.Ogg == seconds {
			b, _ := base64.StdEncoding.DecodeString(a.Bytes)
			return b
		}
	}
	t.Fatalf("no %v s note in the vectors", seconds)
	return nil
}

func TestTheServiceListensOnceAndSaysWhyNot(t *testing.T) {
	sure := 0.9
	p := &scripted{t: Transcript{Text: "today", Language: "en", Confidence: &sure}}
	s := New(p, nil, 0.6, []string{"en"}, func() int64 { return 1_000 }, 30, 2, nil)
	h := s.HearAudio(note(t, 12), "audio/ogg", 0, "r1")
	if !h.OK || h.Text != "today" || h.Seconds != 12 || h.CostMicroInr != 120000 || p.calls != 1 {
		t.Fatalf("heard %+v after %d calls", h, p.calls)
	}
	if again := s.HearAudio(note(t, 12), "audio/ogg", 0, "r1"); !again.OK || p.calls != 1 {
		t.Fatalf("the same recording again is answered from memory: %+v, %d calls", again, p.calls)
	}
	if h := s.HearAudio(note(t, 12), "audio/ogg", 2, "r2"); h.Reason != "daily_cap" || p.calls != 1 {
		t.Fatalf("at the day's limit nothing is asked: %+v", h)
	}
	if h := s.HearAudio(note(t, 31), "audio/ogg", 0, "r3"); h.Reason != "too_long" || !h.HasSeconds || p.calls != 1 {
		t.Fatalf("a note over the limit is not sent: %+v", h)
	}
	if h := s.HearAudio([]byte("not audio"), "audio/ogg", 0, "r4"); h.Reason != "unreadable" {
		t.Fatalf("a file with no length: %+v", h)
	}
	unsure := 0.3
	p.t = Transcript{Text: "today", Language: "en", Confidence: &unsure}
	if h := s.HearAudio(note(t, 5), "audio/ogg", 0, "r5"); h.Reason != "low_confidence" || h.CostMicroInr != 50000 {
		t.Fatalf("an unsure transcript is not used, but it was paid for: %+v", h)
	}
	p.err = errors.New("down")
	if h := s.HearAudio(note(t, 5), "audio/ogg", 0, "r6"); h.Reason != "failed" || h.CostMicroInr != 0 {
		t.Fatalf("a provider that fails: %+v", h)
	}
	if m := FailedMarks(Heard{Reason: "low_confidence", CostMicroInr: 50000, Provider: "p", Model: "m", Seconds: 5, HasSeconds: true}); m["step"] != "rules" || m["speechSeconds"] != "5.0" || m["voice"] != "low_confidence" {
		t.Fatalf("the record's marks of a paid note that was not used: %v", m)
	}
}
