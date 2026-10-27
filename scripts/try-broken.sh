#!/bin/sh
# Try a broken variant: copy a blueprint, apply one of its broken/*.patch files, and let Geometer check it.
# usage: scripts/try-broken.sh refund-desk blind-retry
set -e
src="$(cd "$(dirname "$0")/.." && pwd)/$1"
[ -f "$src/broken/$2.patch" ] || { echo "no such patch: $1/broken/$2.patch"; ls "$src/broken"; exit 2; }
work="$(mktemp -d)/$1"
cp -R "$src" "$work"
(cd "$work" && patch -p1 -s < "broken/$2.patch")
echo "Checking $1 with broken/$2.patch applied (a copy in $work) ..."
geo check "$work"
