package listings

// The shop's never-used words as one question, for a customer's talk (modules/assistant/talk-check.ts check 3 applies BANNED.any, hi, ml and kn to a sentence): the lists are draft.go's
// `banned` (modules/report/claims.ts), so the talk and a listing's draft ask the same words. Added for the Bookings chat; nothing of the listings changes.

// BannedWords reports whether the text has a word no document of the shop may contain (safe, guaranteed, certified, an earnings word, or their Hindi, Malayalam and Kannada forms). The
// text is taken as given: the caller has made it the form the TypeScript reads (talk-check.ts `norm`).
func BannedWords(t string) bool {
	for _, group := range []string{"any", "hi", "ml", "kn"} {
		for _, re := range banned[group] {
			if re.MatchString(t) {
				return true
			}
		}
	}
	return false
}
