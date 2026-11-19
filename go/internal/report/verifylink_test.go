// Tests of the older check link, its QR, and the page blocks (page, table, list, esc, fig, sealBlock, What this checks) against the TypeScript's output, byte for byte.
package report

import (
	"strconv"
	"testing"
)

func TestVerifyLinks(t *testing.T) {
	var links []struct {
		Digest string
		Key    *string
		trialOf[string]
		QR trialOf[string] `json:"qr"`
	}
	vec(t, "verifyLinks", &links)
	for _, l := range links {
		key := ""
		if l.Key != nil {
			key = *l.Key
		}
		got, err := VerifyLink(l.Digest, key)
		l.same(t, l.Digest, got, err, strEq)
		svg, err := VerifyQrSvg(l.Digest, "Scan <me>", key)
		l.QR.same(t, "qr "+l.Digest, svg, err, strEq)
	}
	var codes []struct{ Code, Link, Path string }
	vec(t, "codeLinks", &codes)
	for _, c := range codes {
		if VerifyCodeLink(c.Code) != c.Link || VerifyCodePath(c.Code) != c.Path {
			t.Errorf("%s: the code links differ", c.Code)
		}
	}
}

func TestPageBlocksMatchTypeScript(t *testing.T) {
	var p struct {
		Pages []struct {
			Title, Lang string
			Sections    []string
			HTML        string `json:"html"`
		}
		Esc       []struct{ Value, Out string }
		Fig       []struct{ Value, Out string }
		FigNumber []struct {
			Value int
			Out   string
		}
		Table []struct {
			Head []TableHead
			Rows [][]string
			HTML string `json:"html"`
		}
		List []struct {
			Items []string
			HTML  string `json:"html"`
		}
		SealBlocks []struct {
			Words struct {
				CheckHeading, Code, Digest, SignedBy, NotSigned, SignatureNote, ScanToCheck, ScanSummary string
			}
			Envelope struct {
				Digest, Code string
				Signature    *Signature
			}
			Extra       [][2]string
			SummaryLink *string
			HTML        string `json:"html"`
		}
		WhatThisChecks []struct{ Lang, HTML string }
	}
	vec(t, "page", &p)
	for _, c := range p.Pages {
		if got := Page(c.Title, c.Lang, c.Sections); got != c.HTML {
			t.Errorf("page %q (%s) differs", c.Title, c.Lang)
		}
	}
	for _, c := range p.Esc {
		if Esc(c.Value) != c.Out {
			t.Errorf("esc %q", c.Value)
		}
	}
	for _, c := range p.Fig {
		if Fig(c.Value) != c.Out {
			t.Errorf("fig %q", c.Value)
		}
	}
	for _, c := range p.FigNumber {
		if Fig(strconv.Itoa(c.Value)) != c.Out {
			t.Errorf("fig %d", c.Value)
		}
	}
	for _, c := range p.Table {
		if Table(c.Head, c.Rows) != c.HTML {
			t.Errorf("table %v", c.Head)
		}
	}
	for _, c := range p.List {
		if List(c.Items) != c.HTML {
			t.Errorf("list %v", c.Items)
		}
	}
	for i, c := range p.SealBlocks {
		w := SealWords{c.Words.CheckHeading, c.Words.Code, c.Words.Digest, c.Words.SignedBy, c.Words.NotSigned, c.Words.SignatureNote, c.Words.ScanToCheck, c.Words.ScanSummary}
		link := ""
		if c.SummaryLink != nil {
			link = *c.SummaryLink
		}
		got, err := SealBlock(w, Envelope{Digest: c.Envelope.Digest, Code: c.Envelope.Code, Signature: c.Envelope.Signature}, c.Extra, link)
		if err != nil || got != c.HTML {
			t.Errorf("sealBlock %d differs (%v)", i, err)
		}
	}
	for _, c := range p.WhatThisChecks {
		if WhatThisChecksBlock(c.Lang) != c.HTML {
			t.Errorf("what this checks (%s) differs", c.Lang)
		}
	}
}
