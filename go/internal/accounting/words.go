// The words the books say, loaded once per process from words/words.json.gz: the owner's Money words and the customer document's words in four languages, the "Money this month" block's
// words, each language's machine-written note, and the two style sheets the document page prints. The file is MADE BY RUNNING the TypeScript (scripts/gen_books_words.ts), never retyped: a
// word that is a function of its arguments is a template with {0}, {1} ... slots (internal/slots), or a {one, other} pair for a count, after the generator has checked on other values
// that it does nothing but put its arguments in. The freshness test (templates/commerce/listings/contract/words-fresh.test.ts) fails when the TypeScript changed and the generator was not run.
package accounting

import (
	"bytes"
	"compress/gzip"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"sync"

	"github.com/GeometerLabs/agents/go/internal/slots"
)

//go:embed words/words.json.gz
var wordsGz []byte

// OwnerWords is words-owner.ts OwnerMoneyWords. A template word keeps its slots (use Fill on it); Machine is nil in English.
type OwnerWords struct {
	Machine           *string     `json:"machine"`
	Title             string      `json:"title"`
	Today             string      `json:"today"`
	Month             string      `json:"month"`
	Received          string      `json:"received"`
	GivenBack         string      `json:"givenBack"`
	Kept              string      `json:"kept"`
	Charges           string      `json:"charges"`
	StillToCome       string      `json:"stillToCome"`
	Payments          slots.Count `json:"payments"`
	Refunds           slots.Count `json:"refunds"`
	Fees              slots.Count `json:"fees"`
	ByWordTitle       string      `json:"byWordTitle"`
	ByWordRow         string      `json:"byWordRow"` // {0} amount, {1} case
	OwedTitle         string      `json:"owedTitle"`
	OwedNone          string      `json:"owedNone"`
	OwedUpi           string      `json:"owedUpi"`     // {0} case
	OwedService       string      `json:"owedService"` // {0} case
	NotMatchedTitle   string      `json:"notMatchedTitle"`
	NotMatchedNone    string      `json:"notMatchedNone"`
	PayoutsUnchecked  string      `json:"payoutsUnchecked"`
	UpiClaim          string      `json:"upiClaim"`    // {0} amount, {1} case
	Gateway           string      `json:"gateway"`     // {0} amount, {1} case, {2} date
	GatewayHeld       string      `json:"gatewayHeld"` // {0} amount, {1} case
	NotThrough        string      `json:"notThrough"`  // {0} amount
	Untold            string      `json:"untold"`      // {0} amount, {1} case
	ACase             string      `json:"aCase"`
	AccountantTitle   string      `json:"accountantTitle"`
	AccountantNote    string      `json:"accountantNote"`
	ThisMonth         string      `json:"thisMonth"`
	LastMonth         string      `json:"lastMonth"`
	ThisYear          string      `json:"thisYear"` // {0} financial year
	FileJournal       string      `json:"fileJournal"`
	FileDocuments     string      `json:"fileDocuments"`
	FileReadme        string      `json:"fileReadme"`
	FileSettlements   string      `json:"fileSettlements"`
	FileTallyMasters  string      `json:"fileTallyMasters"`
	FileTallyVouchers string      `json:"fileTallyVouchers"`
	ShareWhatsapp     string      `json:"shareWhatsapp"`
	ShareText         string      `json:"shareText"` // {0} period
	Scope             string      `json:"scope"`
}

// DocWords is words-documents.ts DocWords. Cites is {0} number, {1} date; Footer is {0} shop.
type DocWords struct {
	Title           map[DocKind]string  `json:"title"`
	AmountLabel     map[DocKind]string  `json:"amountLabel"`
	Number          string              `json:"number"`
	Date            string              `json:"date"`
	ForLabel        string              `json:"forLabel"`
	Person          string              `json:"person"`
	Phone           string              `json:"phone"`
	PaidBy          string              `json:"paidBy"`
	HowKnown        string              `json:"howKnown"`
	Method          map[Method]string   `json:"method"`
	Evidence        map[Evidence]string `json:"evidence"`
	OwnerMarkRefund string              `json:"ownerMarkRefund"`
	Cites           string              `json:"cites"`
	Legend          string              `json:"legend"`
	Footer          string              `json:"footer"`
	PrintHint       string              `json:"printHint"`
	Receipts        string              `json:"receipts"`
}

// MoneyBlockWords is report-block.ts MoneyBlockWords (the amount slot is the TypeScript's own `{amount}`, replaced by the caller).
type MoneyBlockWords struct {
	Heading         string `json:"heading"`
	Received        string `json:"received"`
	GivenBack       string `json:"givenBack"`
	Kept            string `json:"kept"`
	OwedBack        string `json:"owedBack"`
	ToCome          string `json:"toCome"`
	ByWord          string `json:"byWord"`
	PaidTwice       string `json:"paidTwice"`
	MarkedReceived  string `json:"markedReceived"`
	MarkedGivenBack string `json:"markedGivenBack"`
}

type wordsFile struct {
	Languages []string                    `json:"languages"`
	Owner     map[string]*OwnerWords      `json:"owner"`
	Doc       map[string]*DocWords        `json:"doc"`
	Block     map[string]*MoneyBlockWords `json:"block"`
	Machine   map[string]string           `json:"machine"`
	CSS       struct {
		Customer string `json:"customer"`
		Doc      string `json:"doc"`
	} `json:"css"`
}

var (
	wordsOnce sync.Once
	words     wordsFile
)

func loadWords() *wordsFile {
	wordsOnce.Do(func() {
		zr, err := gzip.NewReader(bytes.NewReader(wordsGz))
		if err != nil {
			panic("accounting/words/words.json.gz is not gzip: " + err.Error())
		}
		raw, err := io.ReadAll(zr)
		if err == nil {
			err = json.Unmarshal(raw, &words)
		}
		if err != nil {
			panic("accounting/words/words.json.gz is not the words file: " + err.Error())
		}
	})
	return &words
}

// Owner is OWNER_MONEY_WORDS[language]. A language that is not one of the four is a programming fault (the TypeScript's lookup gives undefined and the next property read throws).
func Owner(language string) *OwnerWords {
	w := loadWords().Owner[language]
	if w == nil {
		panic(fmt.Sprintf("no owner money words for language %q", language))
	}
	return w
}

// Doc is DOC[language] (words-documents.ts).
func Doc(language string) *DocWords {
	w := loadWords().Doc[language]
	if w == nil {
		panic(fmt.Sprintf("no document words for language %q", language))
	}
	return w
}

// BlockWords is MONEY_BLOCK_WORDS[language].
func BlockWords(language string) *MoneyBlockWords {
	w := loadWords().Block[language]
	if w == nil {
		panic(fmt.Sprintf("no money block words for language %q", language))
	}
	return w
}

// MachineNote is PAGE[language].machine of modules/channels/words.ts: the machine-written note of a language ("" in English).
func MachineNote(language string) string { return loadWords().Machine[language] }

// CustomerCSS is CUSTOMER_CSS of modules/channels/look.ts, the customer pages' style sheet.
func CustomerCSS() string { return loadWords().CSS.Customer }

// DocCSS is DOC_CSS of document-page.ts, the document page's screen additions and print sheet.
func DocCSS() string { return loadWords().CSS.Doc }
