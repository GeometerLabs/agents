package guard

// JSON.stringify(JSON.parse(text)): the text a JavaScript program would write for a body it has read. A few identifiers are derived from it (a webhook's fallback event id is a digest of
// it), so the Go side must write the same bytes from the raw body. What this copies: members in the order JavaScript keeps (array-index keys first, ascending, then the others in the
// order first seen; a repeated key keeps its first place and its last value), whitespace gone, strings written as JSON.stringify writes them, and numbers written as Number#toString
// does for integers up to 2^53 and for plain decimals. KNOWN LIMIT: a number written with an exponent or more than 17 significant digits is formatted by Go's shortest form, which
// agrees with JavaScript's for every value tried but is not proved for all; none of the provider bodies this is used on has one.

import (
	"encoding/json"
	"math"
	"sort"
	"strconv"
	"strings"
)

// ReEmit parses a JSON text and writes it as JSON.stringify(JSON.parse(text)) would.
func ReEmit(text string) (string, error) {
	dec := json.NewDecoder(strings.NewReader(text))
	dec.UseNumber()
	var sb strings.Builder
	if err := emitValue(dec, &sb); err != nil {
		return "", err
	}
	if _, err := dec.Token(); err == nil {
		return "", errTrailing
	}
	return sb.String(), nil
}

type member struct {
	key string
	val string
}

func emitValue(dec *json.Decoder, sb *strings.Builder) error {
	t, err := dec.Token()
	if err != nil {
		return err
	}
	switch v := t.(type) {
	case json.Delim:
		if v == '[' {
			sb.WriteByte('[')
			first := true
			for dec.More() {
				if !first {
					sb.WriteByte(',')
				}
				first = false
				if err := emitValue(dec, sb); err != nil {
					return err
				}
			}
			_, err := dec.Token()
			sb.WriteByte(']')
			return err
		}
		var members []member
		index := map[string]int{}
		for dec.More() {
			kt, err := dec.Token()
			if err != nil {
				return err
			}
			var inner strings.Builder
			if err := emitValue(dec, &inner); err != nil {
				return err
			}
			k := kt.(string)
			if i, seen := index[k]; seen {
				members[i].val = inner.String()
			} else {
				index[k] = len(members)
				members = append(members, member{k, inner.String()})
			}
		}
		if _, err := dec.Token(); err != nil {
			return err
		}
		ordered := orderLikeJS(members)
		sb.WriteByte('{')
		for i, m := range ordered {
			if i > 0 {
				sb.WriteByte(',')
			}
			sb.WriteString(MustJSText(m.key))
			sb.WriteByte(':')
			sb.WriteString(m.val)
		}
		sb.WriteByte('}')
	case string:
		sb.WriteString(MustJSText(v))
	case bool:
		sb.WriteString(strconv.FormatBool(v))
	case nil:
		sb.WriteString("null")
	case json.Number:
		sb.WriteString(jsNumber(string(v)))
	}
	return nil
}

// isArrayIndex: a canonical array index ("0", "17", never "01"), below 2^32-1, which JavaScript orders first and ascending in an object.
func isArrayIndex(k string) (uint64, bool) {
	if k == "" || (len(k) > 1 && k[0] == '0') {
		return 0, false
	}
	n, err := strconv.ParseUint(k, 10, 64)
	return n, err == nil && n < 1<<32-1
}

func orderLikeJS(ms []member) []member {
	var idx, rest []member
	for _, m := range ms {
		if _, ok := isArrayIndex(m.key); ok {
			idx = append(idx, m)
		} else {
			rest = append(rest, m)
		}
	}
	sort.SliceStable(idx, func(i, j int) bool { a, _ := isArrayIndex(idx[i].key); b, _ := isArrayIndex(idx[j].key); return a < b })
	return append(idx, rest...)
}

// jsNumber is Number(text).toString().
func jsNumber(text string) string {
	f, err := strconv.ParseFloat(text, 64)
	if err != nil || math.IsInf(f, 0) {
		return "null" // JSON.stringify writes a non-finite number as null
	}
	if f == 0 {
		return "0" // -0 is "0"
	}
	if f == math.Trunc(f) && math.Abs(f) < 1e21 {
		return strconv.FormatFloat(f, 'f', -1, 64)
	}
	abs := math.Abs(f)
	if abs >= 1e-6 && abs < 1e21 {
		return strconv.FormatFloat(f, 'f', -1, 64)
	}
	s := strconv.FormatFloat(f, 'e', -1, 64) // 1e-07 -> JavaScript writes 1e-7, and 1e+21 as 1e+21
	mant, exp, _ := strings.Cut(s, "e")
	sign := exp[0]
	digits := strings.TrimLeft(exp[1:], "0")
	if digits == "" {
		digits = "0"
	}
	return mant + "e" + string(sign) + digits
}
