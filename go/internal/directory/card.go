// The directory's A2A Agent Card (modules/discovery/card.ts; specs/agent-card.md), served at /.well-known/agent-card.json. The card's TEXT is the TypeScript's, rendered by
// scripts/gen_directory.ts with slots for the origin, the provider and the area (four forms: with or without the `ask` skill and the area); here the slots are filled and the card is
// signed (a JWS over its RFC 8785 form, signing.SignCard) with the directory's own key.
package directory

import (
	"encoding/json"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/signing"
)

// CardOptions are what a card says about this directory.
type CardOptions struct {
	Origin       string // https://<domain> with no path
	Organization string
	ProviderURL  string
	Area         string
	Assistant    bool // the buyer's assistant is on: the card lists the `ask` skill
	Key          *signing.Key
}

// jsonFill puts values into the `{name}` slots of JSON text, escaped as JSON strings.
func jsonFill(raw string, values map[string]string) string {
	pairs := make([]string, 0, 2*len(values))
	for k, v := range values {
		b, _ := marshalNoEscape(v)
		pairs = append(pairs, "{"+k+"}", string(b[1:len(b)-1]))
	}
	return strings.NewReplacer(pairs...).Replace(raw)
}

// DirectoryCard is the signed card.
func DirectoryCard(o CardOptions) (map[string]any, error) {
	name := "plain"
	if o.Assistant {
		name = "ask"
	}
	if o.Area != "" {
		name += "-area"
	} else {
		name += "-none"
	}
	raw := string(loadPack().Cards[name])
	text := jsonFill(raw, map[string]string{"origin": o.Origin, "org": o.Organization, "purl": o.ProviderURL, "area": o.Area})
	var card map[string]any
	if err := json.Unmarshal([]byte(text), &card); err != nil {
		return nil, err
	}
	return o.Key.SignCard(card)
}
