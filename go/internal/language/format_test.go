package language

// The shared formats, proved equal to the TypeScript's format.ts on internal/assistant/testdata/format-vectors.json (made by go/scripts/gen_format_vectors.ts: rupee amounts, dates
// for every language, the 24 hours by five minutes, and instants across midnight, noon, a month's end and a leap day), plus groupPhone and sentenceStart.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestFormatsEqualTypeScript(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "assistant", "testdata", "format-vectors.json"))
	if err != nil {
		t.Skipf("the format vectors are not here (go/scripts/gen_format_vectors.ts writes them): %v", err)
	}
	var v struct {
		Inr []struct {
			Paise int64
			Text  string
		}
		Date []struct {
			Lang    string
			Y, M, D int
			Text    string
		}
		Time []struct {
			Lang   string
			H, Min int
			Text   string
		}
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	for _, c := range v.Inr {
		if got := FormatInr(float64(c.Paise) / 100); got != c.Text {
			t.Errorf("FormatInr(%d paise) = %q, want %q", c.Paise, got, c.Text)
		}
	}
	for _, c := range v.Date {
		if got := Formats(c.Lang).Date(c.Y, c.M, c.D); got != c.Text {
			t.Errorf("%s date %d-%d-%d = %q, want %q", c.Lang, c.Y, c.M, c.D, got, c.Text)
		}
	}
	for _, c := range v.Time {
		if got := Formats(c.Lang).TimeOfDay(c.H, c.Min); got != c.Text {
			t.Errorf("%s time %d:%02d = %q, want %q", c.Lang, c.H, c.Min, got, c.Text)
		}
	}
	if len(v.Inr) == 0 || len(v.Date) == 0 || len(v.Time) == 0 {
		t.Fatal("the vector file is empty")
	}
}

func TestSlotInIndia(t *testing.T) {
	ist, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		t.Skip("no zone database here: ", err)
	}
	ms := time.Date(2026, 11, 10, 12, 30, 0, 0, time.UTC).UnixMilli() // 6:00 pm in India
	for lang, want := range map[string]string{"en": "Tue 10 Nov, 6:00 pm", "hi": "मंगलवार, 10 नवंबर, शाम 6:00 बजे", "ml": "ചൊവ്വ, 10 നവംബർ, വൈകുന്നേരം 6:00", "kn": "ಮಂಗಳವಾರ, 10 ನವೆಂಬರ್, ಸಂಜೆ 6:00"} {
		if got := Formats(lang).Slot(ms, ist); got != want {
			t.Errorf("%s slot = %q, want %q", lang, got, want)
		}
	}
}

func TestGroupPhoneAndSentenceStart(t *testing.T) {
	for in, want := range map[string]string{"+919811111111": "+91 98111 11111", "+91981111111": "+91981111111", "+9198111111111": "+9198111111111", "+919811111x11": "+919811111x11", "+14155550123": "+14155550123", "": ""} {
		if got := GroupPhone(in); got != want {
			t.Errorf("GroupPhone(%q) = %q, want %q", in, got, want)
		}
	}
	if SentenceStart("haircut", "en") != "Haircut" || SentenceStart("haircut", "hi") != "haircut" || SentenceStart("ßeta", "en") != "SSeta" || SentenceStart("", "en") != "" {
		t.Error("SentenceStart is not JavaScript's")
	}
}
