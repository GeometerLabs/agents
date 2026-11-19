package bookings

// The rule parser and the reading, proved equal to the TypeScript on its own outputs: testdata/parser-vectors.json (parseIntent over parser.test.ts's phrases and the crash
// test's sentences) and coerce-vectors.json's areas "sure" (rulesAreSure), "prompt" (systemPrompt) and "schema" (intentSchema), for the example shop. The model's answer put in
// an Intent's shape (toIntentShape) has no vectors; its cases are model-llm.test.ts's, written here.

import (
	"encoding/json"
	"testing"
)

func TestParserVectors(t *testing.T) {
	var vs []vec
	readVectors(t, "parser-vectors.json", &vs)
	s := exampleSettings(t)
	for _, v := range vs {
		var in string
		_ = json.Unmarshal(v.Input, &in)
		sameJSON(t, v.Name, v.Output, ParseIntent(in, s))
	}
	if len(vs) < 100 {
		t.Fatalf("only %d phrases", len(vs))
	}
}

func TestReadingVectors(t *testing.T) {
	var vs []vec
	readVectors(t, "coerce-vectors.json", &vs)
	s := exampleSettings(t)
	r := Reading{S: s}
	seen := map[string]int{}
	for _, v := range vs {
		switch v.Area {
		case "sure":
			var in string
			_ = json.Unmarshal(v.Input, &in)
			got := ParseIntent(in, s)
			sameJSON(t, v.Name, v.Output, map[string]any{"intent": got, "rulesAreSure": r.Sure(got)})
		case "prompt":
			var want string
			_ = json.Unmarshal(v.Output, &want)
			if got := r.Prompt(); got != want {
				t.Errorf("the prompt differs:\nGo:\n%s\nJavaScript:\n%s", got, want)
			}
		case "schema":
			sameJSON(t, v.Name, v.Output, r.Schema())
		default:
			continue
		}
		seen[v.Area]++
	}
	if seen["sure"] == 0 || seen["prompt"] != 1 || seen["schema"] != 1 {
		t.Fatalf("areas compared: %v", seen)
	}
}

// TestShape: model-llm.test.ts "nulls are dropped, extra date fields are ignored and \"18:00 pm\" is repaired", and a few more of what a model may send.
func TestShape(t *testing.T) {
	s := exampleSettings(t)
	r := Reading{S: s}
	cases := []struct{ name, answer, want string }{
		{"nulls, extra date fields, 18:00 pm", `{"kind":"reschedule","language":null,"serviceId":null,"offerInr":null,"date":{"kind":"weekday","weekday":6,"which":"this","offsetDays":null,"day":null},"time":{"hour":18,"minute":30,"period":"pm"},"overrideAttempt":false}`,
			`{"kind":"reschedule","date":{"kind":"weekday","weekday":6,"which":"this"},"time":{"hour":18,"minute":30}}`},
		{"a null period", `{"kind":"book","serviceId":"haircut","offerInr":null,"date":null,"time":{"hour":18,"minute":0,"period":null},"overrideAttempt":false,"language":"en"}`,
			`{"kind":"book","language":"en","serviceId":"haircut","time":{"hour":18,"minute":0}}`},
		{"a button-only flag", `{"kind":"cancel","ask":true,"overrideAttempt":true,"language":null,"serviceId":null,"offerInr":null,"date":null,"time":null}`,
			`{"kind":"cancel","overrideAttempt":true}`},
		{"0 o'clock keeps no period", `{"kind":"book","time":{"hour":0,"minute":15,"period":"am"}}`, `{"kind":"book","time":{"hour":0,"minute":15}}`},
		{"a time that does not exist", `{"kind":"book","time":{"hour":99,"minute":0,"period":null}}`, ``},
	}
	for _, c := range cases {
		var a any
		_ = json.Unmarshal([]byte(c.answer), &a)
		in, ok := r.Coerce(r.Shape(a))
		if c.want == "" {
			if ok {
				t.Errorf("%s: read as %v", c.name, in)
			}
			continue
		}
		if !ok {
			t.Errorf("%s: refused", c.name)
			continue
		}
		sameJSON(t, c.name, json.RawMessage(c.want), in)
	}
}
