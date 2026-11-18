package assistant

import (
	"encoding/json"
	"unicode"
)

func jsonUnmarshal(b []byte, v any) error { return json.Unmarshal(b, v) }
func isLetter(r rune) bool                { return unicode.IsLetter(r) }
func isMark(r rune) bool                  { return unicode.IsMark(r) }
