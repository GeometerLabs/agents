package runtime

// A Fees centre's own channel reads (wave 3): a parent's private page and Classes' reading material (modules/runtime/http.ts `/internal/channel/parent` and `/material`). They
// are OPTIONAL interfaces of a template's ChannelKit, as AccountantFiler is: a template whose channel has neither (Bookings, the listings shop) answers 404 exactly as before, and
// the contract holds that. The route's checks (the method, the link's hash, the batch and file ids) are http.ts's and live in kitserver.go.

import "regexp"

// ParentReader is a ChannelKit with parents' private pages (core.ts ChannelKit `parent`): what the link with this hash opens now, or nil (no parent has it now: 404).
type ParentReader interface {
	Parent(s KitState, linkHash string) any
}

// MaterialReader is a ChannelKit with Classes' reading material (core.ts ChannelKit `material`): a batch's files for the parent whose link has this hash, or one file by its id
// ("" for the list); nil when nothing is open here (404).
type MaterialReader interface {
	Material(s KitState, linkHash, batch, file string) any
}

var (
	materialBatchRe = regexp.MustCompile(`^[a-z0-9-]{1,40}$`)
	materialFileRe  = regexp.MustCompile(`^[0-9a-f]{12}$`)
)
