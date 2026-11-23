# internal/reportwire: what a template's runtime needs to run the monthly report

The code that was in `internal/orders/agent_after.go` and `internal/bookings/agent_after.go` as private copies, written once for every template and used first by `internal/fees`
(`report.go`): the messaging adapter (`MessagingOf`, with the faults turned into `internal/report`'s own, which the job reads to decide whether a send may be tried again), the `report`
block of runtime.json (`ReadSetup`: modules/runtime/config.ts readReport and server/start.ts monthlyReportSetup, every problem said at once in the TypeScript's words), the report's name
and badge read again whenever runtime.json changes (`optionsReader`), the failure told once an hour (`FailureLog`), and running a template's job on a beat (`Runner`, `Record`).

It depends on `messaging`, `guard`, `runtime` and `report`, which is why it is not in `internal/report`. Bookings and Orders can move onto it and delete their copies (see
`internal/feesreport/Deferred.md`).
