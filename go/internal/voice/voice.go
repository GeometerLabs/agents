// Package voice is the Go twin of modules/voice (plan B29, decision 42): a voice note heard as the words of a typed message. LISTEN IN VOICE, REPLY IN TEXT (owner, 12 Nov 2026:
// the agent never speaks). The service decides nothing about the shop: whether voice is on, and whether the month's AI cap or button mode lets it run, is asked by the caller
// (runtime/voice.go, turn.ts createListener) before it calls.
//
// What it promises (voice.ts):
//   - every failure is a plain answer, never an error: a note that cannot be read ("failed", "too_long", "unreadable", "low_confidence", "daily_cap") makes the agent send the line
//     it already sends, asking the sender to type. Nothing here waits for a Guard that is down (the calls' timeouts are short and no retry runs);
//   - the audio is held in memory for the call and dropped; what comes back is words, a length and a cost, which is all the record keeps;
//   - the same note asked twice (a step that runs again after a Guard wait) is answered from memory within half an hour, never paid for twice.
//
// The files: the service and the record's marks (here), the runtime.json `speech` block (config.go), fetching a WhatsApp note's audio (media.go), the length of Ogg and WebM Opus
// (audio.go), Geometer's speech service client and the HTTP it needs (speech.go). Only Geometer's own service is ported; Sarvam (sarvam.ts) is not (Deferred.md).
package voice

import (
	"fmt"
	"strconv"
	"sync"
	"time"
	"unicode"
)

// Heard is voice.ts Heard: the words (OK), or why not, with what listening cost either way.
type Heard struct {
	OK           bool
	Text         string
	Language     string
	Seconds      float64
	HasSeconds   bool // a failure tells the length only when it was read
	CostMicroInr int64
	Provider     string
	Model        string
	Confidence   *float64
	Reason       string // failed, too_long, unreadable, low_confidence, daily_cap
}

// Why are turn.ts VOICE_WHY: why a voice note was not used, in the record's words.
var Why = map[string]string{
	"failed": "it could not be fetched or the speech provider did not answer", "too_long": "it is longer than the limit for voice notes", "unreadable": "it is not a recording whose length could be read",
	"low_confidence": "the provider could not make out words it was sure of", "daily_cap": "the day's limit for voice notes is reached",
}

// seconds1 is `seconds.toFixed(1)` for the lengths a note has (positive, far below 1e21).
func seconds1(s float64) string { return strconv.FormatFloat(s, 'f', 1, 64) }

// Marks are turn.ts voiceMarks: the record's marks for a message that came by voice.
func Marks(h Heard) map[string]string {
	return map[string]string{"via": "voice", "speechProvider": h.Provider, "speechModel": h.Model, "speechSeconds": seconds1(h.Seconds), "speechMicroInr": strconv.FormatInt(h.CostMicroInr, 10)}
}

// FailedMarks are turn.ts failedMarks: why a note was not used, and (when a call was made and charged) the cost as a rules-read message, so the cost meter counts it.
func FailedMarks(h Heard) map[string]string {
	out := map[string]string{"voice": h.Reason}
	if h.CostMicroInr > 0 {
		out["step"], out["provider"], out["model"], out["inputTokens"], out["outputTokens"], out["costMicroInr"] = "rules", h.Provider, h.Model, "0", "0", strconv.FormatInt(h.CostMicroInr, 10)
		if h.HasSeconds {
			out["speechSeconds"] = seconds1(h.Seconds)
		}
	}
	return out
}

// SpeechRead is conversation.ts speechRead: a heard note's cost as the cost meter prices a line (a rules read whose cost is the speech's).
func SpeechRead(h Heard) map[string]string {
	return map[string]string{"step": "rules", "provider": h.Provider, "model": h.Model, "inputTokens": "0", "outputTokens": "0", "costMicroInr": strconv.FormatInt(h.CostMicroInr, 10)}
}

// Transcript is speech.ts Transcript.
type Transcript struct {
	Text       string
	Language   string // "" when the provider named none the shop speaks
	Confidence *float64
}

// Provider is speech.ts SpeechProvider: Transcribe errs on any failure; the service turns every failure into "ask the sender to type".
type Provider interface {
	Name() string
	Model() string
	Transcribe(audio []byte, mime string, languages []string) (Transcript, error)
}

// Defaults of voice.ts: the plain speech-to-text endpoints are for under 30 seconds; 200 notes a day.
const (
	DefaultMaxSeconds  = 30
	DefaultNotesPerDay = 200
	lowConfidenceBelow = 0.5 // speech.ts LOW_CONFIDENCE_BELOW
	memoFor            = 30 * 60_000
	memoMax            = 200
)

// Service is voice.ts createVoice's service.
type Service struct {
	provider    Provider
	media       *MediaSource
	rate        float64 // rupees a minute listened (runtime.json speech.rate.sttInrPerMinute)
	languages   []string
	now         func() int64
	maxSeconds  float64
	notesPerDay int
	log         func(string)
	mu          sync.Mutex
	memo        map[string]memoEntry
	order       []string
}

type memoEntry struct {
	at    int64
	heard Heard
}

func (s *Service) no(reason string, cost int64, seconds *float64) Heard {
	h := Heard{Reason: reason, CostMicroInr: cost, Provider: s.provider.Name(), Model: s.provider.Model()}
	if seconds != nil {
		h.Seconds, h.HasSeconds = *seconds, true
	}
	return h
}

func (s *Service) remember(memo string, h Heard) Heard {
	if memo == "" {
		return h
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.memo[memo]; !ok {
		s.order = append(s.order, memo)
	}
	s.memo[memo] = memoEntry{s.now(), h}
	if len(s.order) > memoMax { // the oldest goes first, as a Map's first key does
		delete(s.memo, s.order[0])
		s.order = s.order[1:]
	}
	return h
}

func (s *Service) before(memo string) (Heard, bool) {
	if memo == "" {
		return Heard{}, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.memo[memo]
	if !ok || s.now()-e.at >= memoFor {
		return Heard{}, false
	}
	return e.heard, true
}

// Hear is voice.ts hear: a WhatsApp note by its media reference. notesToday is read by the caller from the shop's saved state, so the day's limit survives a restart.
func (s *Service) Hear(ref MediaRef, notesToday int) Heard {
	memo := ref.ID
	if memo == "" {
		memo = ref.URL
	}
	if h, ok := s.before(memo); ok {
		return h
	}
	if notesToday >= s.notesPerDay {
		return s.no("daily_cap", 0, nil)
	}
	audio, mime, err := fetchAudio(s.media, ref)
	if err != nil {
		s.log(fmt.Sprintf("A voice note could not be fetched (%s).", err.Error()))
		return s.no("failed", 0, nil)
	}
	return s.listenTo(audio, mime, memo)
}

// HearAudio is voice.ts hearAudio: audio already in hand (the owner's recording from their page, held in memory only), with the same limits, cost and answers; memo names the
// recording, so a step that runs again gets the first answer.
func (s *Service) HearAudio(audio []byte, mime string, notesToday int, memo string) Heard {
	if memo != "" {
		memo = "audio:" + memo
	}
	if h, ok := s.before(memo); ok {
		return h
	}
	if notesToday >= s.notesPerDay {
		return s.no("daily_cap", 0, nil)
	}
	return s.listenTo(audio, mime, memo)
}

// listenTo is voice.ts listenTo: the length read from the audio itself (Ogg Opus, or WebM Opus from Android's Chrome), the limit, the provider's words, the cost, the confidence.
func (s *Service) listenTo(audio []byte, mime, memo string) Heard {
	seconds, ok := OggOpusSeconds(audio)
	if !ok {
		seconds, ok = WebmOpusSeconds(audio)
	}
	if !ok {
		return s.no("unreadable", 0, nil)
	}
	if seconds > s.maxSeconds {
		return s.remember(memo, s.no("too_long", 0, &seconds))
	}
	t, err := s.provider.Transcribe(audio, mime, s.languages)
	if err != nil {
		s.log(fmt.Sprintf("A voice note could not be transcribed (%s).", err.Error()))
		return s.no("failed", 0, &seconds)
	}
	cost := CostMicroInr(s.rate, seconds)
	if lowConfidence(t) {
		return s.remember(memo, s.no("low_confidence", cost, &seconds))
	}
	return s.remember(memo, Heard{OK: true, Text: t.Text, Language: t.Language, Seconds: seconds, HasSeconds: true, CostMicroInr: cost, Provider: s.provider.Name(), Model: s.provider.Model(), Confidence: t.Confidence})
}

// CostMicroInr is speech.ts sttCostMicroInr: micro-rupees for listening to `seconds`, rounded up (never below zero).
func CostMicroInr(inrPerMinute, seconds float64) int64 {
	v := inrPerMinute*(seconds/60)*1_000_000 - 1e-9
	c := int64(0)
	if v > 0 {
		c = int64(v)
		if float64(c) < v {
			c++ // Math.ceil
		}
	}
	return c
}

// lowConfidence is speech.ts lowConfidence: no letter or digit, no language the shop speaks, or a stated confidence under the line (an unknown one is not low by itself).
func lowConfidence(t Transcript) bool {
	has := false
	for _, r := range t.Text {
		if unicode.IsLetter(r) || unicode.IsNumber(r) {
			has = true
			break
		}
	}
	if !has || t.Language == "" {
		return true
	}
	return t.Confidence != nil && *t.Confidence < lowConfidenceBelow
}

// New is voice.ts createVoice over a provider and a media source (config.go Build makes both from runtime.json).
func New(p Provider, media *MediaSource, inrPerMinute float64, languages []string, now func() int64, maxSeconds, notesPerDay int, log func(string)) *Service {
	if maxSeconds <= 0 {
		maxSeconds = DefaultMaxSeconds
	}
	if notesPerDay <= 0 {
		notesPerDay = DefaultNotesPerDay
	}
	if now == nil {
		now = func() int64 { return time.Now().UnixMilli() }
	}
	if log == nil {
		log = func(string) {}
	}
	return &Service{provider: p, media: media, rate: inrPerMinute, languages: languages, now: now, maxSeconds: float64(maxSeconds), notesPerDay: notesPerDay, log: log, memo: map[string]memoEntry{}}
}
