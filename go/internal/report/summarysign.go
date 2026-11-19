// Signing a paper's summary and checking one the way the website will, plus the claim a server sends Geometer's fleet: modules/report/summary-sign.ts (summary.go says what a summary
// is). A summary is made only for a paper that is signed, and only with the key that signed the paper (SummaryFor checks the key is the one in the paper's own signature); a paper that
// is not signed keeps the older #sha256 link.
//
// Edges: a paper's figures are int64 here (the TypeScript's safe integers); `messageCheckLink` measures the filled message in UTF-16 units as WhatsApp's limit is counted
// (language.UTF16Len), not in bytes or runes.
package report

import (
	"crypto/ed25519"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

// SummaryFields is what a template says about its paper; the digest and the key hint come from the signed paper and the key, never from the caller.
type SummaryFields struct {
	Layout      int
	Source      string
	OwnerMarked bool
	Period      string
	Pathway     string
	Shop        string
	By          string // who set the shop up, as the paper says it; "" when it names no one (the TypeScript's null)
	Figures     []int64
}

// SignedSummary is a summary with its bytes, its signature and its link.
type SignedSummary struct {
	Summary   PaperSummary
	Payload   []byte
	Signature []byte
	Link      string
}

// KeyHintOf is keyHintOf: the first 8 bytes of the key id ("key:" and the sha256 of the raw public key), as 16 hex digits.
func KeyHintOf(keyID string) (string, error) {
	if !keyIDRe.MatchString(keyID) {
		return "", sErr("A key id is key: and 64 hex digits.")
	}
	return keyID[4 : 4+KeyHintBytes*2], nil
}

// SummaryOf is summaryOf: the summary as it will be carried, texts on one line and cut to what the format holds (a cut text ends with "…").
func SummaryOf(f SummaryFields, digest, keyID string) (PaperSummary, error) {
	hint, err := KeyHintOf(keyID)
	if err != nil {
		return PaperSummary{}, err
	}
	return PaperSummary{
		Layout: f.Layout, Source: f.Source, OwnerMarked: f.OwnerMarked, Period: f.Period, Figures: append([]int64{}, f.Figures...),
		Pathway: FitText(f.Pathway, MaxPathway), Shop: FitText(f.Shop, MaxShopBytes), By: FitText(f.By, MaxByBytes), KeyHint: hint, Digest: digest,
	}, nil
}

// SignSummary is signSummary: Ed25519 over "geo-summary/1\n" and the payload.
func SignSummary(s PaperSummary, key ed25519.PrivateKey) (SignedSummary, error) {
	payload, err := EncodeSummary(s)
	if err != nil {
		return SignedSummary{}, err
	}
	sig := ed25519.Sign(key, SignedBytes(payload))
	link, err := SummaryLinkOf(payload, sig)
	if err != nil {
		return SignedSummary{}, err
	}
	return SignedSummary{Summary: s, Payload: payload, Signature: sig, Link: link}, nil
}

// SummaryFor is summaryFor: the summary link for a sealed paper, or nil when there is no key, the paper is not signed, or its figures are not something the format can carry (a
// report is never held back for its summary: the page then prints the older #digest link). The error is only for a key that is not the one that signed the paper: that is a
// mistake in the caller, and a summary must never name a signer other than the paper's own.
func SummaryFor(e Envelope, f SummaryFields, key ed25519.PrivateKey) (*SignedSummary, error) {
	if key == nil || e.Signature == nil {
		return nil, nil
	}
	if PublicKeyHex(key) != e.Signature.PublicKey {
		return nil, errors.New("The summary would be signed with a different key from the paper's own signature.")
	}
	sum, err := SummaryOf(f, e.Digest, e.Signature.KeyID)
	var signed SignedSummary
	if err == nil {
		signed, err = SignSummary(sum, key)
	}
	if err != nil {
		if _, ok := AsSummaryError(err); ok {
			return nil, nil
		}
		return nil, err
	}
	return &signed, nil
}

// SummaryLinkFor is summaryLinkFor: the same, as just the link ("" when there is none).
func SummaryLinkFor(e Envelope, f SummaryFields, key ed25519.PrivateKey) (string, error) {
	s, err := SummaryFor(e, f, key)
	if s == nil {
		return "", err
	}
	return s.Link, nil
}

// YearMonth is a month of a year.
type YearMonth struct{ Year, Month int }

// ReportPeriod is a report's period: a whole month (Month set) or any range of days.
type ReportPeriod struct {
	Month             *YearMonth
	FirstDay, LastDay zone.Date
}

func two(n int) string { return fmt.Sprintf("%02d", n) }

// DayOf is dayOf: a date as "2026-11-03".
func DayOf(d zone.Date) string { return fmt.Sprintf("%d-%s-%s", d.Year, two(d.Month), two(d.Day)) }

// PeriodOf is periodOf: "2026-11" for a whole month, "2026-11-01..2026-11-15" for any other range.
func PeriodOf(p ReportPeriod) string {
	if p.Month != nil {
		return fmt.Sprintf("%d-%s", p.Month.Year, two(p.Month.Month))
	}
	return DayOf(p.FirstDay) + ".." + DayOf(p.LastDay)
}

// GoLiveCertificate is the part of a go-live certificate goLiveSummaryFields reads.
type GoLiveCertificate struct {
	PathwayName, ShopName string
	PreparedBy            string // "" when null
	IssuedOn              zone.Date
	Held, Total, Failed   int
	NotTested             int // how many things were not tested
}

// GoLiveSummaryFields is goLiveSummaryFields: layout 3, held N of M situations, K failed, J things not tested, on the day it was issued. The hand check runs on stand-in services
// only, so its source is always "stand-in"; it counts no money, so nothing is marked by the owner.
func GoLiveSummaryFields(c GoLiveCertificate) SummaryFields {
	return SummaryFields{Layout: 3, Source: "stand-in", Period: DayOf(c.IssuedOn), Pathway: c.PathwayName, Shop: c.ShopName, By: c.PreparedBy,
		Figures: []int64{int64(c.Held), int64(c.Total), int64(c.Failed), int64(c.NotTested)}}
}

// WhatsAppBodyLimit is WHATSAPP_BODY_LIMIT: the most characters (UTF-16 units) WhatsApp takes in a template's body once its values are filled in.
const WhatsAppBodyLimit = 1024

// MessageCheckLink is messageCheckLink: the check link a monthly report's WhatsApp message carries, the longest that lets the whole filled message stay within WhatsAppBodyLimit:
// the signed summary link (summaryLink not ""), then the #sha256 link, then the #code link (used even if the message is still too long, since nothing shorter is a link).
// fill gives the whole message for a check link.
func MessageCheckLink(fill func(check string) string, digest, code, summaryLink string) (string, error) {
	fits := func(link string) bool { return language.UTF16Len(fill(link)) <= WhatsAppBodyLimit }
	if summaryLink != "" && fits(summaryLink) {
		return summaryLink, nil
	}
	d, err := VerifyLink(digest, "")
	if err != nil {
		return "", err
	}
	if fits(d) {
		return d, nil
	}
	return VerifyCodeLink(code), nil
}

// ---- checking, as the page will ----

// ListedSigner is one entry of fleet's public list of signers, as far as checking needs it.
type ListedSigner struct {
	KeyID     string  `json:"key_id"`
	PublicKey string  `json:"public_key"`
	Kind      string  `json:"kind"`
	Name      *string `json:"name"`
	Since     string  `json:"since"`
}

// SummaryCheck is checkSummaryLink's answer. Status is "genuine" (Signer set: the signature verifies under that listed signer; says nothing about whether the figures are true),
// "unknown-signer" (readable, but no listed key could have signed it), "not-genuine" (a listed key matches the hint but the signature does not verify) or "unreadable" (Reason set).
type SummaryCheck struct {
	Status  string
	Summary *PaperSummary
	Signer  *ListedSigner
	Reason  string
}

// CheckSummaryLink is checkSummaryLink: read the link, take the listed keys whose id starts with the hint (an entry whose id is not the sha256 of its own public key is ignored), and
// verify the signature over exactly the bytes in the link under each.
func CheckSummaryLink(link string, signers []ListedSigner) SummaryCheck {
	read, err := ReadSummaryLink(link)
	if err != nil {
		return SummaryCheck{Status: "unreadable", Reason: err.Error()}
	}
	sum := read.Summary
	var candidates []ListedSigner
	for _, s := range signers {
		if hex64Re.MatchString(s.PublicKey) && KeyIDOf(s.PublicKey) == s.KeyID && strings.HasPrefix(s.KeyID, "key:"+sum.KeyHint) {
			candidates = append(candidates, s)
		}
	}
	if len(candidates) == 0 {
		return SummaryCheck{Status: "unknown-signer", Summary: &sum}
	}
	for i := range candidates {
		pub, _ := hex.DecodeString(candidates[i].PublicKey)
		if ed25519.Verify(ed25519.PublicKey(pub), read.Signed, read.Signature) {
			return SummaryCheck{Status: "genuine", Summary: &sum, Signer: &candidates[i]}
		}
	}
	return SummaryCheck{Status: "not-genuine", Summary: &sum}
}

// ---- the claim a server sends fleet ----

// SignerClaimDomain is SIGNER_CLAIM_DOMAIN.
const SignerClaimDomain = "geo-paper-signer/1\n"

// SignerClaimBytes is signerClaimBytes: the domain, the deployment id, a line break, and the raw public key in hex.
func SignerClaimBytes(deploymentID, publicKey string) []byte {
	return []byte(SignerClaimDomain + deploymentID + "\n" + publicKey)
}

var deploymentIDRe = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)

// SignerClaim is signerClaim: what a server sends fleet's POST /v1/paper-signers to put its signing key on the public list: the raw public key and a proof that it holds the
// private half, made for this deployment only.
func SignerClaim(key ed25519.PrivateKey, deploymentID string) (publicKey, proof string, err error) {
	if !deploymentIDRe.MatchString(deploymentID) {
		return "", "", fmt.Errorf(`"%s" is not a deployment id.`, deploymentID)
	}
	publicKey = PublicKeyHex(key)
	return publicKey, hex.EncodeToString(ed25519.Sign(key, SignerClaimBytes(deploymentID, publicKey))), nil
}
