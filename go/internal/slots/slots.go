// Package slots fills the words the TypeScript wrote. A message that carries a shop's value (an amount, a name, a count) is rendered once, by the real TypeScript function, with
// `{0}`, `{1}` ... where the values go (scripts/lib_words.ts); Go only substitutes. A word that depends on a count is stored as {"one": ..., "other": ...}.
// Substitution is one pass over the template, so a value that itself holds "{1}" is never filled again.
package slots

import (
	"strconv"
	"strings"
)

// Fill puts args[i] where the template says {i}. A slot with no argument is left as written.
func Fill(template string, args ...string) string {
	if !strings.Contains(template, "{") {
		return template
	}
	var b strings.Builder
	for i := 0; i < len(template); {
		if template[i] == '{' {
			if j := strings.IndexByte(template[i:], '}'); j > 1 {
				if n, err := strconv.Atoi(template[i+1 : i+j]); err == nil && n >= 0 && n < len(args) && strconv.Itoa(n) == template[i+1:i+j] {
					b.WriteString(args[n])
					i += j + 1
					continue
				}
			}
		}
		b.WriteByte(template[i])
		i++
	}
	return b.String()
}

// Count is a word that depends on a number: One for exactly 1, Other for any other (its {0} is the number).
type Count struct {
	One   string `json:"one"`
	Other string `json:"other"`
}

// Fill writes the count's words for n.
func (c Count) Fill(n int) string {
	if n == 1 {
		return Fill(c.One, "1")
	}
	return Fill(c.Other, strconv.Itoa(n))
}
