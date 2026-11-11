#!/bin/bash
# bundle/test/proof/install-in-container.sh: install.sh run for real (plan item 14b), for the owner's test pass. Not part of `npm test`; it needs Docker.
#
#   bash bundle/test/proof/install-in-container.sh <monorepo>/apps/fleet
#
# What it does: clones this repository (its committed HEAD) into a work folder, adds a test release commit and tag there (never pushed: release.json filled in
# with that tag and the sha256 of the local Guard image saved as a file), starts fleet from the monorepo on 127.0.0.1:18790 with pairing and a test licence
# key, makes a pairing code for a builder, builds an ubuntu:24.04 image with curl, git, sudo and the Docker CLI (so Docker counts as installed), and runs
# install.sh in it as a user with sudo, against this machine's Docker: Node is downloaded from nodejs.org and checked, the Guard file is checked and loaded,
# the server is paired, HTTPS and the panel start on ports 8080 and 8443. Then a second run (it must change nothing and ask for no code), the `geometer`
# command, the panel through Caddy from the host, and the heartbeat at fleet. It removes only what it made: one compose project, one container, one image,
# its work folder. Bind mounts are resolved by the Docker daemon, so the work folder must be a path Docker shares (on Docker Desktop: under /Users,
# /private, /tmp or /var/folders); it is mounted at the same path in the container.
# Needs: the Guard image geo-guard:0.1.0-alpha.2-pathways.1 on this machine, Node 26, python3, and the network (nodejs.org, Docker Hub for ubuntu:24.04 and docker:27-cli).
set -uo pipefail
FLEET=${1:?say where fleet is: <monorepo>/apps/fleet}
AGENTS=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
# always a fresh folder of its own (WORKDIR only says where to make it), because the cleanup removes it
W=$(mktemp -d "${WORKDIR:-${TMPDIR:-/tmp}}/geo-install-proof.XXXXXX")
LOG=$W.log
sha() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
mkdir -p "$W/home" "$W/fleet"
: >"$LOG"
exec > >(tee -a "$LOG") 2>&1
say() { printf '\n#### %s\n' "$*"; }
FLEET_PID=""
cleanup() {
  say "cleanup"
  if [ -f "$W/home/geometer-server/generated/compose.yaml" ]; then docker compose -f "$W/home/geometer-server/generated/compose.yaml" --project-directory "$W/home/geometer-server/generated" down -v --remove-orphans 2>&1 | tail -n 3; fi
  [ -n "$FLEET_PID" ] && kill "$FLEET_PID" 2>/dev/null
  docker rm -f geo-install-test >/dev/null 2>&1
  docker rmi geo-install-test:local >/dev/null 2>&1
  rm -rf "$W"
  echo "cleaned"
}
trap cleanup EXIT

say "1. a clone of the branch, with a test release commit and tag (in the clone only)"
git clone -q "$AGENTS" "$W/home/geometer/agents" || exit 1
docker save geo-guard:0.1.0-alpha.2-pathways.1 -o "$W/guard.tar" || exit 1
GSHA=$(sha "$W/guard.tar")
python3 -I - "$W/home/geometer/agents/bundle/release.json" "$GSHA" <<'EOF'
import json, sys
p, sha = sys.argv[1], sys.argv[2]
r = json.load(open(p))
r.update({"release": "0.0.0-installtest", "agents_tag": "v0.0.0-installtest", "guard_file_sha256_arm64": sha, "guard_file_sha256_amd64": sha})
open(p, "w").write("{\n" + ",\n".join(f"  {json.dumps(k)}: {json.dumps(v)}" for k, v in r.items()) + "\n}\n")
EOF
git -C "$W/home/geometer/agents" -c user.name=test -c user.email=test@example.com commit -qam "test release for the install proof (never merged)"
git -C "$W/home/geometer/agents" tag v0.0.0-installtest
COMMIT=$(git -C "$W/home/geometer/agents" rev-parse HEAD)
echo "clone at $COMMIT, guard.tar sha256 $GSHA"

say "2. fleet on this machine, with pairing and a test licence key"
cat >"$W/fleet/fleet.json" <<EOF
{ "data_dir": "$W/fleet/data", "listen": { "host": "127.0.0.1", "port": 18790 }, "timezone": "Asia/Kolkata", "notifiers": [{ "type": "log" }],
  "licence": { "key_file": "$W/fleet/licence.pem" }, "pairing": { "public_url": null } }
EOF
cd "$FLEET" || exit 1
node main.ts licence key new "$W/fleet/licence.pem" --config "$W/fleet/fleet.json"
node main.ts partner add ravi --name "Ravi Builds" --contact ravi@example.com --kind builder --config "$W/fleet/fleet.json"
CODE=$(node main.ts pairing code ravi --config "$W/fleet/fleet.json" | grep -o 'gfp_[a-z0-9-]*')
[ -n "$CODE" ] || { echo "no code"; exit 1; }
umask 077; printf '%s\n' "$CODE" >"$W/home/pairing-code"; umask 022
node main.ts serve --config "$W/fleet/fleet.json" >"$W/fleet/serve.log" 2>&1 &
FLEET_PID=$!
sleep 2
curl -fsS http://127.0.0.1:18790/healthz && echo " fleet up"

say "3. the test image: ubuntu:24.04, curl git sudo xz, the docker CLI and Compose plugin (so Docker counts as installed), a user with sudo"
docker build -q -t geo-install-test:local - <<'EOF' || exit 1
FROM docker:27-cli AS cli
FROM ubuntu:24.04
RUN apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends ca-certificates curl git sudo xz-utils iproute2 >/dev/null && rm -rf /var/lib/apt/lists/*
COPY --from=cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
RUN useradd -m -s /bin/bash builder && echo 'builder ALL=(ALL) NOPASSWD:ALL' >/etc/sudoers.d/builder && chmod 440 /etc/sudoers.d/builder && git config --system --add safe.directory '*'
EOF
SOCK_GID=$(docker run --rm -v /var/run/docker.sock:/var/run/docker.sock geo-install-test:local stat -c %g /var/run/docker.sock)
echo "docker socket group: $SOCK_GID"

INSTALL="bash $W/home/geometer/agents/install.sh --yes --domain localhost --fleet-url http://host.docker.internal:18790 --http-port 8080 --https-port 8443"
# one long-lived container, like a server: what the first run installs (Node, the geometer command) is still there for the second
docker rm -f geo-install-test >/dev/null 2>&1
docker run -d --name geo-install-test --add-host host.docker.internal:host-gateway -v /var/run/docker.sock:/var/run/docker.sock -v "$W:$W" --group-add "$SOCK_GID" geo-install-test:local sleep infinity >/dev/null || exit 1
run_in() { docker exec -u builder -e HOME="$W/home" -e USER=builder -w "$W/home" geo-install-test bash -c "$1"; }

say "4. the first run: paired, the Guard file checked, Node downloaded and checked"
run_in "$INSTALL --pairing-code-file $W/home/pairing-code --guard-image-file $W/guard.tar --expect-commit $COMMIT; echo FIRST_RC=\$?"

say "5. the server folder, as the first run left it"
ls -la "$W/home/geometer-server" | sed -n '1,40p'
ls -l "$W/home/geometer-server/fleet_key"
grep -c . "$W/home/geometer-server/pairing.json" >/dev/null && sed 's/"trialLease": "[^"]*"/"trialLease": "..."/' "$W/home/geometer-server/pairing.json"
sed -n '1,200p' "$W/home/geometer-server/geometer.json"
cat "$W/home/geometer-server/state/install.json"
grep -rl "$CODE" "$W/home/geometer-server" && echo "THE CODE IS IN THE SERVER FOLDER" || echo "the code is nowhere in the server folder"

say "6. the second run: finds everything, changes nothing, asks for no code"
run_in "$INSTALL; echo SECOND_RC=\$?"

say "7. the geometer command the install wrote (/usr/local/bin/geometer)"
run_in "ls -l /usr/local/bin/geometer; head -n 3 /usr/local/bin/geometer;
  echo '--- geometer server status'; geometer server status; echo rc=\$?;
  echo '--- geometer invite builder'; geometer invite builder --note proof; echo rc=\$?;
  echo '--- geometer stop (no shop)'; geometer stop; echo rc=\$?;
  echo '--- geometer server stop (nobody to confirm)'; geometer server stop </dev/null; echo rc=\$?;
  echo '--- as root'; sudo /usr/local/bin/geometer status; echo rc=\$?" 2>&1 | sed 's#/join/[A-Za-z0-9_-]*#/join/<token>#'

say "8. from this Mac: the panel through Caddy, and the heartbeat at fleet"
curl -sk -o /dev/null -w "https://localhost:8443/healthz -> %{http_code}\n" https://localhost:8443/healthz
curl -sk https://localhost:8443/ | grep -o '<title>[^<]*</title>' | head -n 1
echo "waiting 80 s for a heartbeat"
sleep 80
cd "$FLEET" && node main.ts deployment list --config "$W/fleet/fleet.json"
node main.ts pairing list --config "$W/fleet/fleet.json"
grep -E "paired|refused|heartbeat" "$W/fleet/serve.log" | tail -n 5
echo "PROOF DONE"
