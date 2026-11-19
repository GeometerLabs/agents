package payments

// Money in settings: whole rupees to paise (modules/payments/guard-limits.ts rupeesToPaise). The agent's refund limit (whole rupees) and Guard's approval threshold (paise) are one
// number, so it is never typed twice. A fraction of a rupee, a negative one, or a number too big to count exactly is refused rather than rounded. The rest of guard-limits.ts builds
// Guard's limits spec for the deployer and the Guard stand-in, which stay TypeScript.

import "fmt"

// MaxSafe is Number.MAX_SAFE_INTEGER.
const MaxSafe = 1<<53 - 1

// RupeesToPaise is rupeesToPaise for a whole number of rupees.
func RupeesToPaise(inr int64) (int64, error) {
	if inr < 0 {
		return 0, fmt.Errorf("%d is not a whole number of rupees, so it cannot be turned into paise.", inr)
	}
	if inr > MaxSafe/100 {
		return 0, fmt.Errorf("%d rupees is too large to count in paise exactly.", inr)
	}
	return inr * 100, nil
}
