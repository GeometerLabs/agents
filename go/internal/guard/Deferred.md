# internal/guard: left out

- `NotSentError` for a dial that times out: Go reports it as a timeout (the call may have happened is the safe reading); Node's connect timeout is reported the same way.
- Proxies are never used (`Proxy: nil`): Guard is on the shop's own network.
- Decimal numbers that are not whole are not read anywhere (see Explanation.md).
