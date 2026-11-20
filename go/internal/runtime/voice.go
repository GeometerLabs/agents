package runtime

// Voice notes in a template's step (modules/voice/turn.ts createListener, understanding/ai-state.ts addSpeech and speechNotesToday, channels/owner-audio.ts), and the owner's
// recording from their page (items 11d and 11e with B29: `POST /internal/channel/owner-voice`). The service itself is internal/voice; what is here is what needs the step's state:
// whether listening is allowed now (not in button mode, not over the month's AI cap), the day's count of notes listened to (kept in the saved AI state, so the day's limit survives
// a restart), and the cost added to the month's AI spend whether or not the note could be used.
//
// The owner's recordings are held in this process's memory only (never on disk, never in the record), for five minutes at most, eight at most: the saved event carries the
// recording's reference, and a step that runs again finds it again (the voice service then answers it from memory, not paying twice).

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"sync"

	"github.com/GeometerLabs/agents/go/internal/budget"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/voice"
)

// OwnerVoiceKit is a template's Kit with a voice service for the owner's assistant: the owner's page may send a recording (TypeScript: the kit's `ownerVoice`, there only with a
// voice service and the assistant).
type OwnerVoiceKit interface {
	OwnerVoiceOn() bool
}

// owner-audio.ts AUDIO_HELD_MS and AUDIO_HELD_MAX.
const (
	audioHeldMs  = 5 * 60_000
	audioHeldMax = 8
)

// audioDrop is owner-audio.ts createAudioDrop: recordings in memory, by a random reference.
type audioDrop struct {
	mu    sync.Mutex
	held  map[string]heldAudio
	order []string
}

type heldAudio struct {
	at    int64
	audio PageAudio
}

func (d *audioDrop) sweep(now int64) {
	keep := d.order[:0]
	for _, ref := range d.order {
		if now-d.held[ref].at >= audioHeldMs {
			delete(d.held, ref)
			continue
		}
		keep = append(keep, ref)
	}
	d.order = keep
}

func (d *audioDrop) put(a PageAudio, now int64) string {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.held == nil {
		d.held = map[string]heldAudio{}
	}
	d.sweep(now)
	for len(d.order) >= audioHeldMax {
		delete(d.held, d.order[0])
		d.order = d.order[1:]
	}
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	ref := hex.EncodeToString(b)
	d.held[ref] = heldAudio{now, a}
	d.order = append(d.order, ref)
	return ref
}

// get is the recording while it is held; not taken out (a step that runs again finds it again).
func (d *audioDrop) get(ref string, now int64) *PageAudio {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.held == nil {
		return nil
	}
	d.sweep(now)
	if h, ok := d.held[ref]; ok {
		a := h.audio
		a.Ref = ref
		return &a
	}
	return nil
}

// OwnerAudio is the owner's recording with this reference, while this process holds it (nil: gone, after a restart or five minutes).
func (c *StepContext) OwnerAudio(ref string) *PageAudio {
	if c.rt == nil {
		return nil
	}
	return c.rt.ownerAudio.get(ref, c.Now())
}

// ownerVoice is `POST /internal/channel/owner-voice` for a template's shop with a voice service and the assistant: the owner's credential, then audio/ogg or audio/webm (the type is
// written by us, not copied), at most 256 KB, not empty; held in memory and its reference saved as an owner_message.
func (s *Server) ownerVoice(w http.ResponseWriter, r *http.Request) error {
	if err := only(r, "POST"); err != nil {
		return err
	}
	if !s.ownerAuthorised(r) {
		send(w, 403, errBody(ownerRefused))
		return nil
	}
	if vk, ok := s.rt.o.Kit.(OwnerVoiceKit); !ok || !vk.OwnerVoiceOn() {
		send(w, 404, errBody("Voice is not on for this shop's assistant."))
		return nil
	}
	m := audioType.FindStringSubmatch(r.Header.Get("content-type"))
	if m == nil {
		send(w, 415, errBody("Send the recording as audio/ogg or audio/webm (Opus)."))
		return nil
	}
	b, err := readBody(r, maxVoiceBytes)
	if err != nil {
		if he, isHTTP := err.(httpError); isHTTP {
			send(w, he.status, errBody(he.msg), "connection", "close")
			return nil
		}
		return err
	}
	if len(b) == 0 {
		send(w, 400, errBody("The recording is empty."))
		return nil
	}
	ref := s.rt.ownerAudio.put(PageAudio{Bytes: b, Mime: "audio/" + lower(m[1]) + "; codecs=opus"}, s.rt.o.Now())
	id := make([]byte, 16)
	_, _ = rand.Read(id)
	return s.submitKit(w, []map[string]any{{"kind": "owner_message", "id": hex.EncodeToString(id), "text": "", "voice": ref}})
}

// ---- listening in a step (turn.ts createListener) ---------------------------------------------------------------------------------------------------------

// speechState is ai-state.ts AiState.speech.
type speechState struct {
	Notes int64  `json:"notes"`
	Day   string `json:"day,omitempty"`
	Today int64  `json:"today,omitempty"`
}

// notesToday is ai-state.ts speechNotesToday: voice notes listened to today (the shop's local day), from the saved state.
func (c *StepContext) notesToday() int {
	if c.Snap == nil || c.Snap.AI == nil || len(c.Snap.AI.Speech) == 0 {
		return 0
	}
	var sp speechState
	if json.Unmarshal(c.Snap.AI.Speech, &sp) != nil || sp.Day != c.Clock.Day(c.Now()) {
		return 0
	}
	return int(sp.Today)
}

// countSpeech is ai-state.ts addSpeech: one more note listened to, and what it cost, in the month's AI spend (a cost is always known: voice does not run without its rate).
func (c *StepContext) countSpeech(costMicroInr int64) {
	now := c.Now()
	s := budget.For(&c.Snap.AI, c.Clock, now)
	var sp speechState
	_ = json.Unmarshal(s.Speech, &sp)
	day := c.Clock.Day(now)
	sp.Notes++
	if sp.Day != day {
		sp.Today = 0
	}
	sp.Today++
	sp.Day = day
	s.Speech, _ = json.Marshal(sp)
	s.CostMicroInr += costMicroInr
}

// Listen is turn.ts createListener's `listen`: a voice note heard if voice is on and allowed right now. nil when no listening was tried (no voice service, no audio and no media
// reference, a commander (the owner and the other approvers type their commands), STOP, or the shop in button mode or out of AI allowance: the provider is not asked in any of
// those). The cost of a call that was made is counted in the month's AI spend whether or not the note could be used.
func (c *StepContext) Listen(svc *voice.Service, msg messaging.InboundMessage, audio *PageAudio, commander, optedOut bool) *voice.Heard {
	if svc == nil || (msg.Media == nil && audio == nil) || commander || optedOut || c.Snap == nil {
		return nil
	}
	now := c.Now()
	if buttons, _ := budget.Buttons(&c.Snap.AI, c.Policy, c.Clock, now); buttons || budget.ModelOff(&c.Snap.AI, c.Policy, c.Clock, now) != "" {
		return nil
	}
	var h voice.Heard
	if audio != nil {
		h = svc.HearAudio(audio.Bytes, audio.Mime, c.notesToday(), audio.Ref)
	} else {
		h = svc.Hear(voice.MediaRef{ID: msg.Media.ID, URL: msg.Media.URL, Mime: msg.Media.Mime}, c.notesToday())
	}
	// a cached answer (a step that ran again) was counted by the first run, whose state was thrown away: counting it here is what makes the surviving state right
	if h.OK || h.CostMicroInr > 0 {
		c.countSpeech(h.CostMicroInr)
	}
	return &h
}
