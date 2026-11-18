#!/bin/sh
# Copies the dated price tables of modules/understanding/rates/ into internal/budget/rates/, where go:embed can reach them (embed cannot read outside the Go module).
# The contract test `rates-fresh.test.ts` fails when the two folders differ, so a new dated table in TypeScript cannot be forgotten here.
cd "$(dirname "$0")/.." && cp ../modules/understanding/rates/*.json internal/budget/rates/
