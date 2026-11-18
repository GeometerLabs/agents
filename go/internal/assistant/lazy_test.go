package assistant

import (
	"os"
	"testing"
)

var loadedAtStart []string

// TestMain looks at the process before any test has asked for words: nothing is unpacked until a shop needs it.
func TestMain(m *testing.M) {
	loadedAtStart = Loaded()
	os.Exit(m.Run())
}

func TestWordsAreUnpackedOnDemandOncePerLanguage(t *testing.T) {
	if len(loadedAtStart) != 0 {
		t.Fatalf("languages unpacked before anyone asked: %v", loadedAtStart)
	}
	if Words("ml") != Words("ml") {
		t.Fatal("one copy per language per process")
	}
	if Words("xx") != Words("en") {
		t.Fatal("a language we do not have is English")
	}
}
