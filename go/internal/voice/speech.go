package voice

// Getting a voice note's audio (modules/voice/media.ts), Geometer's own speech service (geometer.ts, the default provider) and the HTTP both need (wire.ts): a multipart body going
// out (the audio) and raw bytes coming back (the downloaded audio), with the same Guard classification as every other client (guard.Classify: an answer with a `guard` object is
// Guard's decision, never the provider's reply). Nothing here holds a key: each base URL is a Guard in front of the provider; a token is only this agent's credential for that Guard.
// Short timeouts on purpose: a slow provider costs the sender one line asking to type, not the shop's queue.
//
// Media (Meta): the webhook carries a media id. GET /{version}/{media_id} (through the WhatsApp Guard) answers {url, mime_type, file_size}; the url is downloaded through the media
// Guard, and only from a host the settings name (`downloadHosts`): only its path and query go on, so this code cannot ask for anything else.
//
// The speech service: POST /stt, multipart/form-data with one part `file` (the note as it came) -> 200 {"text", "language", "confidence" (optional, 0 to 1)}.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/GeometerLabs/agents/go/internal/guard"
)

// MaxAudioBytes is media.ts MAX_AUDIO_BYTES: a voice note is a few hundred kilobytes, so more is refused rather than read.
const MaxAudioBytes = 2 * 1024 * 1024

// MediaRef is media.ts MediaRef: where to fetch a note's audio. Never audio, never kept past the call.
type MediaRef struct {
	ID, URL, Mime string
}

// MediaSource is media.ts MediaSource: the Guard in front of the media lookup (nil: the provider's callback carries the address), the one in front of the download host, the Graph
// version in the lookup path, and the hosts a download may be on.
type MediaSource struct {
	Lookup        *Wire
	Download      *Wire
	Version       string
	DownloadHosts []string
}

var mediaID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

// fetchAudio is media.ts fetchAudio: the audio behind a reference, or an error (the caller turns any error into "ask the sender to type").
func fetchAudio(src *MediaSource, ref MediaRef) ([]byte, string, error) {
	u, mime := ref.URL, ref.Mime
	if u == "" {
		if ref.ID == "" || !mediaID.MatchString(ref.ID) {
			return nil, "", guard.Apif(400, "The voice note carried no usable media reference.")
		}
		if src.Lookup == nil {
			return nil, "", errors.New("This shop's voice settings have no media lookup address, and the voice note carried only an id.")
		}
		found, err := src.Lookup.Request("GET", "/"+src.Version+"/"+url.PathEscape(ref.ID), nil, "", 0)
		if err != nil {
			return nil, "", err
		}
		o, isObj := found.JSON.(map[string]any)
		if found.Status < 200 || found.Status >= 300 || !isObj {
			return nil, "", guard.Apif(found.Status, "The media lookup answered %d.", found.Status)
		}
		u, _ = o["url"].(string)
		if m, ok := o["mime_type"].(string); ok {
			mime = m
		}
		if size, ok := jsNumber(o["file_size"]); ok && size > MaxAudioBytes {
			return nil, "", guard.Apif(413, "The voice note is longer than the limit for voice notes.")
		}
	}
	if u == "" {
		return nil, "", guard.Apif(502, "The media lookup gave no address for the audio.")
	}
	parsed, err := url.Parse(u)
	if err != nil || parsed.Host == "" {
		return nil, "", guard.Apif(400, "The voice note's address is not a web address.")
	}
	allowed := false
	for _, h := range src.DownloadHosts {
		allowed = allowed || h == parsed.Hostname()
	}
	if parsed.Scheme != "https" || !allowed {
		return nil, "", guard.Apif(400, "The voice note's address is not on a host this shop reads audio from.")
	}
	got, err := src.Download.Request("GET", parsed.EscapedPath(), parsed.Query(), "", MaxAudioBytes)
	if err != nil {
		return nil, "", err
	}
	if got.Status < 200 || got.Status >= 300 {
		return nil, "", guard.Apif(got.Status, "The audio download answered %d.", got.Status)
	}
	if len(got.Bytes) == 0 {
		return nil, "", guard.Apif(502, "The audio download was empty.")
	}
	if mime == "" {
		mime = strings.Split(got.ContentType, ";")[0]
	}
	if mime == "" {
		mime = "audio/ogg"
	}
	return got.Bytes, mime, nil
}

// jsNumber is `num(Number(x))`: a finite number from a JSON number or a numeric string.
func jsNumber(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case string:
		var f float64
		if _, err := fmt.Sscan(strings.TrimSpace(x), &f); err == nil {
			return f, true
		}
	}
	return 0, false
}

// Wire is wire.ts createWire's wire: one Guard's base URL, a name for the errors, a timeout and this agent's token.
type Wire struct {
	base    string
	what    string
	timeout time.Duration
	token   string
	client  *http.Client
}

// WireReply is wire.ts WireReply.
type WireReply struct {
	Status      int
	ContentType string
	Bytes       []byte
	JSON        any
}

// NewWire is createWire: a base URL that holds a password or key is refused.
func NewWire(base, what string, timeoutMs int, token string) (*Wire, error) {
	if err := guard.CheckBaseURL(base, what); err != nil {
		return nil, err
	}
	return &Wire{base: base, what: what, timeout: time.Duration(timeoutMs) * time.Millisecond, token: token, client: &http.Client{Transport: &http.Transport{DisableCompression: true, DisableKeepAlives: true, Proxy: nil}}}, nil
}

// Request sends one call: `file` (when not nil) as a multipart body's one part, and reads at most maxBytes of the reply (0: 16 MB).
func (w *Wire) Request(method, path string, query url.Values, mime string, maxBytes int, file ...[]byte) (WireReply, error) {
	target := strings.TrimRight(w.base, "/") + path
	if len(query) > 0 {
		target += "?" + query.Encode()
	}
	var body io.Reader
	contentType := ""
	if len(file) > 0 {
		var buf bytes.Buffer
		mw := multipart.NewWriter(&buf)
		h := textproto.MIMEHeader{}
		h.Set("Content-Disposition", `form-data; name="file"; filename="voice-note"`)
		h.Set("Content-Type", mime)
		part, _ := mw.CreatePart(h)
		_, _ = part.Write(file[0])
		_ = mw.Close()
		body, contentType = &buf, mw.FormDataContentType()
	}
	ctx, cancel := context.WithTimeout(context.Background(), w.timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, target, body)
	if err != nil {
		return WireReply{}, &guard.NotSentError{Message: w.what + ": could not connect (ERR_INVALID_URL).", Code: "ERR_INVALID_URL"}
	}
	if contentType != "" {
		req.Header.Set("content-type", contentType)
	}
	if w.token != "" {
		req.Header.Set("authorization", "Bearer "+w.token)
	}
	resp, err := w.client.Do(req)
	if err != nil {
		var op interface{ Timeout() bool }
		if errors.As(err, &op) && op.Timeout() {
			return WireReply{}, &guard.TimeoutError{What: w.what}
		}
		return WireReply{}, &guard.NotSentError{Message: w.what + ": could not connect.", Code: "ECONNREFUSED"}
	}
	defer resp.Body.Close()
	limit := maxBytes
	if limit <= 0 {
		limit = 16 * 1024 * 1024
	}
	if resp.ContentLength > int64(limit) {
		return WireReply{}, &guard.TimeoutError{What: fmt.Sprintf("%s (the reply was larger than %d bytes)", w.what, limit)}
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, int64(limit)+1))
	if err != nil {
		return WireReply{}, &guard.TimeoutError{What: w.what}
	}
	if len(raw) > limit {
		return WireReply{}, &guard.TimeoutError{What: fmt.Sprintf("%s (the reply was larger than %d bytes)", w.what, limit)}
	}
	ct := resp.Header.Get("content-type")
	var parsed any
	if strings.Contains(strings.ToLower(ct), "json") || (len(raw) > 0 && raw[0] == '{') {
		if json.Unmarshal(raw, &parsed) != nil {
			parsed = nil
		}
	}
	if decided := guard.Classify(resp.StatusCode, resp.Header, parsed, guard.SentCall{Method: method, Path: path}); decided != nil {
		return WireReply{}, decided
	}
	return WireReply{Status: resp.StatusCode, ContentType: ct, Bytes: raw, JSON: parsed}, nil
}

// geometerSpeech is geometer.ts createGeometerSpeech: the client of Geometer's own speech service (open-source models in one container Geometer runs).
type geometerSpeech struct{ wire *Wire }

func (geometerSpeech) Name() string  { return "geometer" }
func (geometerSpeech) Model() string { return "geometer-speech" }

var shopLanguages = []string{"en", "hi", "ml", "kn"} // languages.ts LANGUAGES

func (g geometerSpeech) Transcribe(audio []byte, mime string, languages []string) (Transcript, error) {
	reply, err := g.wire.Request("POST", "/stt", nil, mime, 0, audio)
	if err != nil {
		return Transcript{}, err
	}
	o, isObj := reply.JSON.(map[string]any)
	if reply.Status < 200 || reply.Status >= 300 || !isObj {
		return Transcript{}, guard.Apif(reply.Status, "The speech service answered %d to a voice note.", reply.Status)
	}
	text, _ := o["text"].(string)
	t := Transcript{Text: strings.TrimSpace(text)} // String.prototype.trim: JavaScript's white space, which TrimSpace covers for these words
	if heard, ok := o["language"].(string); ok && contains(shopLanguages, heard) && contains(languages, heard) {
		t.Language = heard
	}
	if c, ok := o["confidence"].(float64); ok && c >= 0 && c <= 1 {
		t.Confidence = &c
	}
	return t, nil
}

func contains(xs []string, s string) bool {
	for _, x := range xs {
		if x == s {
			return true
		}
	}
	return false
}
