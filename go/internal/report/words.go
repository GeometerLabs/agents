// The report's words that are plain data in the TypeScript (the Innovator badge, the "settled by" lines, the check-link label, what a paper with a summary says under its QR,
// "What this checks", the signed summary's LAYOUTS, the page's style sheet, the claim rules, the sample link), loaded once from words/words.json.gz. The file is MADE BY RUNNING the
// TypeScript (scripts/gen_report_words.ts), never retyped: a word that is a function of its arguments is carried as a template with {0} slots (internal/slots) after the generator
// has checked it does nothing but put the arguments in. The freshness test (templates/commerce/listings/contract/words-fresh.test.ts) fails when the TypeScript changed and the
// generator was not run.
package report

import (
	"bytes"
	"compress/gzip"
	_ "embed"
	"encoding/json"
	"io"
	"sync"
)

//go:embed words/words.json.gz
var wordsGz []byte

type wordsFile struct {
	Innovator        map[string]string `json:"innovator"`
	SettledByWord    map[string]string `json:"settledByWord"` // "{0}" is who
	SettledBySomeone map[string]string `json:"settledBySomeone"`
	CheckGenuine     map[string]string `json:"checkGenuine"`
	ScanSummary      map[string]string `json:"scanSummary"`
	WhatThisChecks   map[string]struct {
		Heading string      `json:"heading"`
		Lines   [][2]string `json:"lines"`
	} `json:"whatThisChecks"`
	Layouts []Layout `json:"layouts"`
	CSS     string   `json:"css"`
	Banned  map[string][]struct {
		Source string `json:"source"`
		Flags  string `json:"flags"`
	} `json:"banned"`
	SampleLink   string `json:"sampleLink"`
	SampleDigest string `json:"sampleDigest"`
}

var (
	wordsOnce sync.Once
	words     wordsFile
)

func loadWords() *wordsFile {
	wordsOnce.Do(func() {
		zr, err := gzip.NewReader(bytes.NewReader(wordsGz))
		if err != nil {
			panic("report/words/words.json.gz is not gzip: " + err.Error())
		}
		raw, err := io.ReadAll(zr)
		if err == nil {
			err = json.Unmarshal(raw, &words)
		}
		if err != nil {
			panic("report/words/words.json.gz is not the words file: " + err.Error())
		}
	})
	return &words
}

// SampleSummaryLink is SAMPLE_SUMMARY_LINK (a real summary link for the example values Meta's template review and the native review sheets show) and SampleDigest the digest it carries.
func SampleSummaryLink() (link, digest string) { w := loadWords(); return w.SampleLink, w.SampleDigest }
