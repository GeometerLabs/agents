#!/usr/bin/env bash
# install.sh: Geometer's one-step setup of a builder's server (plan item 14b, decision 38: the panel is the builder's app).
#
# Who runs it: a builder, once, on a fresh Ubuntu server, as a normal user with sudo (not as root); or cloud-init, through bundle/cloud-init.yaml, with --yes.
# It lives at the top of the agents repository, not in bundle/, because it sets up the whole machine (Docker, Node, a system service), and it is the first
# thing a builder opens, like Bitwarden's bitwarden.sh. It runs from a copy of this repository and installs THAT copy: the pins it trusts (bundle/release.json:
# the release tag, the Guard image, Node's checksums, Docker's signing key) come from the same clone, so nothing it installs is an unpinned "latest".
#
#   git clone --branch <release tag> https://github.com/GeometerLabs/agents.git ~/geometer/agents
#   bash ~/geometer/agents/install.sh
#
# It asks two questions, the domain and the pairing code from geometer.dev/account ("Add a server", or "skip"), says what it will do, asks before changing
# anything, and then: installs Docker Engine (Docker's own apt repository, its key checked against Docker's published fingerprint) and Node (nodejs.org's
# tarball, checked against release.json and nodejs.org's SHASUMS256.txt) only if they are missing or too old; checks this copy is the pinned release; loads
# the Guard image; pairs the server with fleet (the code is sent once); makes the server folder (`geometer init`); writes and starts the deployer's systemd
# service and the `geometer` command; starts HTTPS and the panel; waits for them; and prints the panel's address and a one-time sign-in link. The model's key,
# the backup place and Google are left for the panel's first run, and its last lines say so.
#
# Run it again at any time: it finds what is there and only repairs or carries on. It never replaces the server folder, its keys, or a service file it did
# not write. `--dry-run` prints each step and changes nothing.
#
# Options (all optional; a question is asked for what is missing, unless --yes):
#   --domain D                  the domain whose A (and AAAA) record points at this server; Caddy gets its HTTPS certificate for it
#   --pairing-code-file F       a file holding the pairing code (never put the code itself on a command line: other users can read it there)
#   --skip-pairing --licence-key HEX
#                               no pairing: the panel starts, but no alerts from outside, no licence lease, and so no shop starts with a production Guard image.
#                               Fleet's licence key is still needed (decision 39: no server folder without it); Geometer gives it with a deployment key
#   --fleet-key-file F --deployment-id ID --licence-key HEX [--lease-file F]
#                               the by-hand path: a deployment key, its server id, fleet's licence key and a lease Geometer gave you
#   --guard-image-file F        the Guard image as a file (until it is in a registry), checked against release.json's sha256 for this CPU
#   --server-dir D              the server folder (default ~/geometer-server)
#   --fleet-url U               fleet's address (default: release.json's)
#   --reviewed-by ID            who reviews the Guards' limits on this server (default: <user>@<host>)
#   --http-port N --https-port N   other ports than 80 and 443, for a trial on a machine where those are taken
#   --expect-commit SHA         refuse unless this copy is exactly that commit (a pin from outside the repository, e.g. in cloud-init)
#   --use-this-checkout         install this copy as it is, with no release pin (for a trial before a release); says so loudly
#   --keep-sudo                 keep the passwordless sudo cloud-init gave this user (by default the install takes it away at the end; see narrow_sudo)
#   --dry-run                   print each step; change nothing; send no code
#   --yes                       answer yes to every question: only for cloud-init, where nobody is there to answer
set -euo pipefail

# ---- small helpers ---------------------------------------------------------------------------------------------------------------------------------------

say() { printf '%s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }
note() { printf 'Note: %s\n' "$*"; }
die() { printf '\nStopped: %s\n' "$*" >&2; exit 1; }

# Every command that changes the machine goes through `run`, so --dry-run shows it instead.
run() {
  if [ "${DRY_RUN:-0}" = 1 ]; then printf '  would run: %s\n' "$*"; return 0; fi
  "$@"
}
# As root, through sudo (the script itself never runs as root: the files it makes in the server folder must be the builder's).
as_root() { run sudo "$@"; }

have() { command -v "$1" >/dev/null 2>&1; }

# A question, read from the terminal even when the script came through a pipe (stdin is then the script itself).
ask() {
  local prompt=$1 answer=""
  if [ ! -r /dev/tty ] || ! { : </dev/tty; } 2>/dev/null; then die "There is no terminal to ask on. Give the answers as options (--domain, --pairing-code-file or --skip-pairing) and --yes."; fi
  printf '%s' "$prompt" >/dev/tty
  IFS= read -r answer </dev/tty || true
  printf '%s' "$answer"
}

confirm() {
  [ "${YES:-0}" = 1 ] && return 0
  case "$(ask "$1 [y/N] ")" in y | Y | yes | YES | Yes) return 0 ;; *) return 1 ;; esac
}

# One value from bundle/release.json. The file is one flat object of strings, one per line (a test holds it to that), so it is read without Node or jq.
release_get() {
  sed -n "s/^[[:space:]]*\"$1\":[[:space:]]*\"\([^\"]*\)\",\{0,1\}[[:space:]]*\$/\1/p" "$RELEASE_FILE" | head -n 1
}

# Version a.b.c at least b? (sort -V knows versions)
version_at_least() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n 1)" = "$2" ]; }

# ---- the machine -----------------------------------------------------------------------------------------------------------------------------------------

check_system() {
  local id="" version=""
  if [ -r "${OS_RELEASE:-/etc/os-release}" ]; then
    id=$(sed -n 's/^ID=//p' "${OS_RELEASE:-/etc/os-release}" | tr -d '"')
    version=$(sed -n 's/^VERSION_ID=//p' "${OS_RELEASE:-/etc/os-release}" | tr -d '"')
  fi
  case "$id:$version" in
    ubuntu:22.04 | ubuntu:24.04) ;;
    *) die "This server runs ${id:-an unknown system} ${version}. The install is made for Ubuntu 22.04 or 24.04 only (what Hetzner and DigitalOcean offer). Make the server with one of those, or set it up by hand (bundle/README.md, \"By hand\")." ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) ARCH=amd64 NODE_ARCH=x64 ;;
    aarch64 | arm64) ARCH=arm64 NODE_ARCH=arm64 ;;
    *) die "This server's processor is $(uname -m). The install supports Intel or AMD (x86_64) and ARM (arm64) only." ;;
  esac
  UBUNTU=$version
  say "System: Ubuntu $UBUNTU on $ARCH."
}

check_not_root() {
  if [ "$(id -u)" = 0 ]; then
    die "Run this as a normal user with sudo, not as root: the server folder and the panel's keys must belong to the user who runs the deployer. (Make one with: adduser builder && usermod -aG sudo builder, then log in as builder.)"
  fi
  have sudo || die "sudo is not installed. Install it as root (apt-get install sudo) and add this user to the sudo group."
}

valid_domain() {
  [ "$1" = localhost ] && return 0
  printf '%s' "$1" | grep -Eq '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$'
}

# A domain no public certificate authority serves: a trial with Caddy's own certificate.
local_domain() {
  case "$1" in localhost | *.localhost | *.local | *.internal) return 0 ;; esac
  return 1
}

# Ports 80 and 443 free, or held by this server's own Caddy (a second run).
check_ports() {
  local port holder
  if ! have ss; then note "ss (iproute2) is not here, so ports $HTTP_PORT and $HTTPS_PORT were not checked."; return 0; fi
  for port in "$HTTP_PORT" "$HTTPS_PORT"; do
    if ss -ltnH "( sport = :$port )" 2>/dev/null | grep -q .; then
      holder=""
      # whose it is: this server's own Caddy on a second run (asked as root if this shell has no docker group yet)
      if have docker; then holder=$( { docker ps --filter "publish=$port" --format '{{.Names}}' 2>/dev/null || sudo docker ps --filter "publish=$port" --format '{{.Names}}' 2>/dev/null; } | head -n 1 || true); fi
      case "$holder" in
        geometer-*caddy*) say "Port $port: held by this server's own HTTPS front ($holder)." ;;
        *) die "Port $port is used by another program${holder:+ ($holder)}. Caddy needs ports $HTTP_PORT and $HTTPS_PORT for HTTPS. See which: sudo ss -ltnp 'sport = :$port'. Stop it, or use --http-port and --https-port for a trial." ;;
      esac
    else
      say "Port $port: free."
    fi
  done
}

# Does the domain point here? Caddy needs that for the certificate. No outside "what is my address" service is asked: the server's own addresses are compared
# with what the domain resolves to, and a mismatch is said and asked about (behind a NAT or a load balancer it can be right).
check_dns() {
  local resolved mine common
  if local_domain "$DOMAIN"; then say "Domain: $DOMAIN is a local name, so Caddy makes its own certificate (a trial; browsers will warn)."; return 0; fi
  resolved=$({ getent ahostsv4 "$DOMAIN" 2>/dev/null; getent ahostsv6 "$DOMAIN" 2>/dev/null; } | awk '{print $1}' | sort -u || true)
  mine=$(ip -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | sort -u || true)
  common=$(comm -12 <(printf '%s\n' "$resolved") <(printf '%s\n' "$mine") | grep . || true)
  if [ -n "$common" ]; then say "Domain: $DOMAIN points at this server ($(printf '%s' "$common" | tr '\n' ' '))."; return 0; fi
  if [ -z "$resolved" ]; then
    say "Domain: $DOMAIN does not resolve yet. Add an A record (and AAAA, if the server has IPv6) pointing at this server: $(printf '%s' "$mine" | tr '\n' ' ')"
  else
    say "Domain: $DOMAIN points at $(printf '%s' "$resolved" | tr '\n' ' '), but this server's addresses are $(printf '%s' "$mine" | tr '\n' ' ')."
  fi
  say "Caddy needs the domain to point here to get the HTTPS certificate; it keeps trying, so it can be fixed after the install."
  confirm "Go on anyway?" || die "Point $DOMAIN at this server, then run the install again."
}

# ---- Docker Engine ---------------------------------------------------------------------------------------------------------------------------------------

docker_ready() {
  have docker || return 1
  local v
  v=$(docker compose version --short 2>/dev/null | sed 's/^v//' || true)
  [ -n "$v" ] && version_at_least "$v" "$(release_get docker_compose_min)"
}

# Docker's own apt repository, as docs.docker.com/engine/install/ubuntu describes, with its signing key checked against the fingerprint Docker publishes
# (release.json, docker_gpg_fingerprint) before apt is told to trust it.
install_docker() {
  if docker_ready; then say "Docker Engine: present ($(docker --version 2>/dev/null)), Compose $(docker compose version --short 2>/dev/null)."; return 0; fi
  if have docker; then die "Docker is here but its Compose plugin is missing or older than $(release_get docker_compose_min). Update Docker (sudo apt-get install docker-compose-plugin), or remove it and run the install again."; fi
  step "Installing Docker Engine from Docker's own apt repository"
  local want got key codename list
  want=$(release_get docker_gpg_fingerprint)
  [ -n "$want" ] || die "release.json names no fingerprint for Docker's key."
  as_root apt-get update -qq
  as_root apt-get install -y -qq ca-certificates curl gnupg
  key=$(mktemp)
  run curl -fsSL --proto '=https' --tlsv1.2 -o "$key" https://download.docker.com/linux/ubuntu/gpg
  if [ "${DRY_RUN:-0}" != 1 ]; then
    got=$(gpg --show-keys --with-colons "$key" 2>/dev/null | awk -F: '/^fpr:/ {print $10; exit}')
    [ "$got" = "$want" ] || die "Docker's signing key has the fingerprint ${got:-unknown}, not $want as Docker publishes it. Nothing was installed."
    say "Docker's signing key: fingerprint $got, as Docker publishes it."
  fi
  as_root install -m 0755 -d /etc/apt/keyrings
  as_root install -m 0644 "$key" /etc/apt/keyrings/docker.asc
  rm -f "$key"
  # the release's code name (noble, jammy), read rather than sourced: nothing in os-release is run
  codename=$(sed -n 's/^UBUNTU_CODENAME=//p; s/^VERSION_CODENAME=//p' "${OS_RELEASE:-/etc/os-release}" | tr -d '"' | head -n 1)
  list=$(mktemp)
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' "$(dpkg --print-architecture)" "$codename" >"$list"
  as_root install -m 0644 "$list" /etc/apt/sources.list.d/docker.list
  rm -f "$list"
  as_root apt-get update -qq
  as_root apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  as_root systemctl enable --now docker
}

# The deployer talks to Docker as this user, through the docker group (which is root on this machine, as Docker says: only for the user who runs the server).
DOCKER_DIRECT=""
docker_access() {
  if docker info >/dev/null 2>&1; then DOCKER_DIRECT=1; return 0; fi
  if ! id -nG "$USER" 2>/dev/null | tr ' ' '\n' | grep -qx docker; then
    say "Adding $USER to the docker group, so the deployer can run containers as $USER."
    as_root usermod -aG docker "$USER"
  fi
  DOCKER_DIRECT=0
}

# Run a command with the docker group, even in this shell, which was started before the group was added. docker_q is for questions that change nothing (it
# runs in a dry run too); with_docker is for everything else.
docker_q() {
  if [ "$DOCKER_DIRECT" = 1 ]; then "$@"; else sg docker -c "$(printf '%q ' "$@")"; fi
}
with_docker() {
  if [ "${DRY_RUN:-0}" = 1 ]; then printf '  would run: %s\n' "$*"; return 0; fi
  docker_q "$@"
}

# ---- Node ------------------------------------------------------------------------------------------------------------------------------------------------

# nodejs.org's Linux builds of Node load libatomic.so.1 when they start. A minimal Ubuntu (the ubuntu:24.04 image, a slim cloud image) does not have it, and Node
# then stops at once: "error while loading shared libraries: libatomic.so.1" (found by bundle/test/proof/install-in-container.sh, 12 Nov 2026). It comes from
# Ubuntu's own archive, only when the system's library list does not show it already.
# grep reads the whole list (no -q): under `set -o pipefail`, `grep -q` stops at the first match, ldconfig can then die of SIGPIPE (exit 141)
# and the check reads as "missing", so apt was asked for a library that was there (seen as a flaky install-script test, 13 Nov 2026).
need_libatomic() {
  if ldconfig -p 2>/dev/null | grep 'libatomic\.so\.1 ' >/dev/null; then return 0; fi
  step "Installing libatomic1 from Ubuntu (Node needs it to start)"
  as_root apt-get update -qq
  as_root apt-get install -y -qq --no-install-recommends libatomic1
}

# Node from nodejs.org, the version release.json pins, checked twice: against release.json's sha256 (from this copy of the repository) and against the
# SHASUMS256.txt nodejs.org publishes for that version. A Node 26 or newer already on the PATH is used as it is.
install_node() {
  local found major version want got tmp file
  found=$(command -v node || true)
  if [ -n "$found" ]; then
    major=$(node --version 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/')
    if [ "${major:-0}" -ge 26 ]; then NODE_BIN=$found; say "Node: $(node --version) at $found."; return 0; fi
    say "Node: $(node --version) at $found is older than 26; Node $(release_get node_version) goes beside it in /usr/local."
  fi
  version=$(release_get node_version)
  want=$(release_get "node_sha256_linux_$NODE_ARCH")
  [ -n "$version" ] && [ -n "$want" ] || die "release.json names no Node version or checksum for $NODE_ARCH."
  step "Installing Node $version from nodejs.org"
  file="node-v$version-linux-$NODE_ARCH.tar.xz"
  tmp=$(mktemp -d)
  run curl -fsSL --proto '=https' --tlsv1.2 -o "$tmp/$file" "https://nodejs.org/dist/v$version/$file"
  run curl -fsSL --proto '=https' --tlsv1.2 -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/v$version/SHASUMS256.txt"
  if [ "${DRY_RUN:-0}" != 1 ]; then
    got=$(sha256sum "$tmp/$file" | cut -d' ' -f1)
    [ "$got" = "$want" ] || die "The Node download's sha256 is $got, not $want as release.json pins it. Nothing was installed."
    grep -qx "$want  $file" "$tmp/SHASUMS256.txt" || die "nodejs.org's SHASUMS256.txt does not list $want for $file. Nothing was installed."
    say "Node's download: sha256 $got, the one release.json pins and nodejs.org publishes."
  fi
  need_libatomic
  as_root mkdir -p /usr/local/lib/nodejs
  as_root tar -xJf "$tmp/$file" -C /usr/local/lib/nodejs --no-same-owner
  as_root ln -sfn "/usr/local/lib/nodejs/node-v$version-linux-$NODE_ARCH/bin/node" /usr/local/bin/node
  rm -rf "$tmp"
  NODE_BIN=/usr/local/bin/node
}

# ---- this copy of the agents repository ------------------------------------------------------------------------------------------------------------------

# Install only a release: this copy must be exactly the tag release.json names, with no change to a tracked file (and the commit given from outside, if one is).
check_release() {
  local tag head tagged dirty
  RELEASE=$(release_get release)
  tag=$(release_get agents_tag)
  have git || die "git is not installed (sudo apt-get install git)."
  head=$(git -C "$APP_DIR" rev-parse HEAD 2>/dev/null) || die "$APP_DIR is not a git copy of the agents repository. Get one with: git clone --branch <release tag> $(release_get agents_repository)"
  dirty=$(git -C "$APP_DIR" status --porcelain --untracked-files=no 2>/dev/null || true)
  if [ -n "${EXPECT_COMMIT:-}" ] && [ "$head" != "$EXPECT_COMMIT" ]; then die "This copy is at commit $head, not $EXPECT_COMMIT as asked (--expect-commit). Check out that commit, or drop the option."; fi
  if [ "${USE_THIS_CHECKOUT:-0}" = 1 ]; then
    say "NOT A RELEASE: installing this copy of the repository as it is (commit $head${dirty:+, with local changes}), because --use-this-checkout says so. For a trial only."
    INSTALLED_RELEASE="this-checkout"; INSTALLED_COMMIT=$head
    return 0
  fi
  [ -n "$tag" ] || die "This copy's bundle/release.json names no release yet (the first builder release is not out). To try the install from this copy as it is, add --use-this-checkout."
  tagged=$(git -C "$APP_DIR" rev-parse -q --verify "refs/tags/$tag^{commit}" 2>/dev/null || true)
  [ -n "$tagged" ] || die "The release tag $tag is not in this copy. Get it with: git -C $APP_DIR fetch --tags, then git -C $APP_DIR checkout $tag"
  [ "$head" = "$tagged" ] || die "This copy is at commit $head, not at the release $tag ($tagged). Run: git -C $APP_DIR checkout $tag"
  [ -z "$dirty" ] || die "This copy has changes to tracked files, so it is not the release as published. Undo them (git -C $APP_DIR status), or use --use-this-checkout for a trial."
  say "Release ${RELEASE:-$tag}: tag $tag, commit $head, no local changes."
  INSTALLED_RELEASE=$tag; INSTALLED_COMMIT=$head
}

# ---- the Guard image -------------------------------------------------------------------------------------------------------------------------------------

# By digest from the registry once it is published there (a pull by digest is checked by Docker); until then from a file, checked against release.json.
get_guard_image() {
  local ref repo digest want got loaded
  ref=$(release_get guard_image)
  repo=$(release_get guard_registry_repository)
  digest=$(release_get "guard_digest_$ARCH")
  if [ -n "$repo" ] && [ -n "$digest" ]; then
    if docker_q docker image inspect "$repo@$digest" >/dev/null 2>&1; then say "Guard image: $repo@$digest is here."
    else with_docker docker pull "$repo@$digest"; fi
    with_docker docker tag "$repo@$digest" "$ref"
    GUARD_STATE="pulled by digest $digest"
    return 0
  fi
  if [ -n "${GUARD_FILE:-}" ]; then
    [ -r "$GUARD_FILE" ] || die "The Guard image file $GUARD_FILE cannot be read."
    want=$(release_get "guard_file_sha256_$ARCH")
    got=$(sha256sum "$GUARD_FILE" | cut -d' ' -f1)
    if [ -n "$want" ]; then
      [ "$got" = "$want" ] || die "The Guard image file's sha256 is $got, not $want as release.json pins it for $ARCH. It was not loaded. (An Intel or AMD server needs the x86_64 file, an ARM server the arm64 one.)"
      say "Guard image file: sha256 $got, as release.json pins it."
    elif [ "${USE_THIS_CHECKOUT:-0}" = 1 ]; then
      say "Guard image file: sha256 $got. NOT CHECKED: this copy's release.json pins no file (a trial)."
    else
      die "release.json pins no Guard image file for $ARCH, so $GUARD_FILE cannot be checked. Nothing was loaded."
    fi
    loaded=$(with_docker docker load -i "$GUARD_FILE" 2>&1 | tail -n 3 || true)
    printf '%s\n' "$loaded"
    [ "${DRY_RUN:-0}" = 1 ] || docker_q docker image inspect "$ref" >/dev/null 2>&1 || die "The file did not hold $ref (it said: $loaded). This release runs $ref."
    GUARD_STATE="loaded from a file, sha256 $got"
    return 0
  fi
  if docker_q docker image inspect "$ref" >/dev/null 2>&1; then
    say "Guard image: $ref is already on this machine. The install did not check it again; each shop's deploy checks its Guards' limits on the running image."
    GUARD_STATE="already here"
    return 0
  fi
  note "The Guard image $ref is not on this machine, and it is not in a registry yet. The panel starts without it, but no shop can be deployed until it is loaded: run the install again with --guard-image-file <the file Geometer gave you>."
  GUARD_STATE="missing"
}

# ---- pairing and the server folder -----------------------------------------------------------------------------------------------------------------------

geo() { with_docker env GEOMETER_SERVER="$SERVER_DIR" "$NODE_BIN" "$APP_DIR/bundle/geometer.ts" "$@"; }

# The code is spent last, after every local step that can fail, and sent once; the answer is kept at once (fleet_key 0600 and pairing.json, by `geometer pair`).
pair_server() {
  if [ "$PAIR_MODE" = late ]; then pair_late; return 0; fi
  if [ -f "$SERVER_DIR/geometer.json" ]; then say "The server folder $SERVER_DIR is already set up: no pairing is asked again."; return 0; fi
  if [ -f "$SERVER_DIR/pairing.json" ] && [ -f "$SERVER_DIR/fleet_key" ]; then say "This server was paired before (its key is kept in $SERVER_DIR/fleet_key): no new code is needed."; return 0; fi
  case "$PAIR_MODE" in
    code)
      step "Pairing this server with Geometer's fleet (the code is used once)"
      if [ "${DRY_RUN:-0}" = 1 ]; then say "  would send the code once to $FLEET_URL/v1/pair and keep the answer in $SERVER_DIR"; return 0; fi
      # the code reaches `geometer pair` on its standard input: printf is a shell builtin, so the code is in no process's command line
      printf '%s\n' "$PAIRING_CODE" | env GEOMETER_SERVER="$SERVER_DIR" "$NODE_BIN" "$APP_DIR/bundle/geometer.ts" pair "$SERVER_DIR" --fleet-url "$FLEET_URL" || die "The server was not paired (the reason is above). Nothing else was changed in $SERVER_DIR."
      PAIRING_CODE=""
      ;;
    hand)
      [ -r "$FLEET_KEY_FILE" ] || die "The deployment key file $FLEET_KEY_FILE cannot be read."
      if [ -f "$SERVER_DIR/fleet_key" ]; then
        cmp -s "$FLEET_KEY_FILE" "$SERVER_DIR/fleet_key" || die "$SERVER_DIR/fleet_key holds another key already. It is never replaced: move it away first if you mean to."
        say "The deployment key is already in $SERVER_DIR/fleet_key."
        return 0
      fi
      run mkdir -p "$SERVER_DIR"
      run install -m 0600 "$FLEET_KEY_FILE" "$SERVER_DIR/fleet_key"
      say "The deployment key Geometer gave you is in $SERVER_DIR/fleet_key (only you can read it)."
      ;;
    skip) say "Pairing skipped, as asked." ;;
  esac
}

# Follow-up 8 (12 Nov 2026): a server set up with pairing skipped, run again with a code. `geometer pair` checks the folder first (geometer.json readable, no fleet
# section yet), sends the code once, and adds ONLY the fleet section to geometer.json (and takes the trial lease): the folder's id, its containers, volumes, shops and keys
# stay as they are. A pairing kept but not joined yet (pairing.json, no fleet section: the licence keys did not match, say) is joined again with no new code.
pair_late() {
  step "Pairing this server with Geometer's fleet (it was set up without pairing; only its fleet settings are added)"
  if [ "${DRY_RUN:-0}" = 1 ]; then say "  would $([ -n "${PAIRING_CODE:-}" ] && printf 'send the code once to %s/v1/pair, then ' "$FLEET_URL")add the fleet section to $SERVER_DIR/geometer.json"; return 0; fi
  if [ -n "${PAIRING_CODE:-}" ]; then
    # the code reaches `geometer pair` on its standard input, as for a new server: it is in no process's command line
    printf '%s\n' "$PAIRING_CODE" | env GEOMETER_SERVER="$SERVER_DIR" "$NODE_BIN" "$APP_DIR/bundle/geometer.ts" pair "$SERVER_DIR" --fleet-url "$FLEET_URL" || die "The server was not paired (the reason is above). Nothing else was changed in $SERVER_DIR."
  else
    env GEOMETER_SERVER="$SERVER_DIR" "$NODE_BIN" "$APP_DIR/bundle/geometer.ts" pair "$SERVER_DIR" --fleet-url "$FLEET_URL" </dev/null || die "The pairing kept in $SERVER_DIR/pairing.json was not added (the reason is above). Nothing else was changed."
  fi
  PAIRING_CODE=""
}

# A server folder that does not talk to Geometer's fleet yet: geometer.json has no "fleet" section (pairing was skipped, and no key was given by hand).
unpaired_folder() {
  [ -f "$SERVER_DIR/geometer.json" ] && ! grep -Eq '"fleet"[[:space:]]*:' "$SERVER_DIR/geometer.json"
}

make_server_folder() {
  if [ -f "$SERVER_DIR/geometer.json" ]; then
    local had
    had=$(sed -n 's/^[[:space:]]*"domain":[[:space:]]*"\([^"]*\)".*/\1/p' "$SERVER_DIR/geometer.json" | head -n 1)
    say "Server folder: $SERVER_DIR is there; it is kept as it is${had:+ (domain $had)}."
    if [ -n "$had" ] && [ "$had" != "$DOMAIN" ]; then note "The folder says the domain is $had, not $DOMAIN. Nothing was changed: edit \"domain\" in geometer.json and run geometer deploy if you mean to move it."; fi
    return 0
  fi
  step "Making the server folder $SERVER_DIR"
  local args=(init "$SERVER_DIR" --domain "$DOMAIN" --reviewed-by "$REVIEWED_BY" --guard-image "$(release_get guard_image)" --panel --http-port "$HTTP_PORT" --https-port "$HTTPS_PORT")
  if [ "$PAIR_MODE" = hand ]; then
    args+=(--id "$DEPLOYMENT_ID" --fleet-url "$FLEET_URL" --fleet-key-file "$SERVER_DIR/fleet_key")
    args+=(--licence-key "$LICENCE_KEY")
  elif [ "$PAIR_MODE" = skip ]; then
    args+=(--licence-key "$LICENCE_KEY")
  elif [ -f "$SERVER_DIR/pairing.json" ] || { [ "$PAIR_MODE" = code ] && [ "${DRY_RUN:-0}" = 1 ]; }; then
    # paired (now, or by an earlier run): the id, fleet's address, the key, fleet's licence key and the trial lease come from the pairing
    args+=(--pairing)
    if [ -n "$(release_get guard_licence_kid)" ]; then args+=(--guard-licence-kid "$(release_get guard_licence_kid)"); fi
  fi
  run env GEOMETER_SERVER="$SERVER_DIR" "$NODE_BIN" "$APP_DIR/bundle/geometer.ts" "${args[@]}" || die "The server folder was not made (the reason is above)."
  if [ "$PAIR_MODE" = hand ] && [ -n "${LEASE_FILE:-}" ]; then
    run env GEOMETER_SERVER="$SERVER_DIR" "$NODE_BIN" "$APP_DIR/bundle/geometer.ts" licence lease "$LEASE_FILE" || note "The lease file was not kept (the reason is above); the first heartbeat brings one."
  fi
}

# ---- the system service and the `geometer` command -------------------------------------------------------------------------------------------------------

MARK="# Written by Geometer's install.sh"

deployer_unit() {
  cat <<EOF
$MARK. Run the install again to rewrite it; it never replaces a file without this line.
[Unit]
Description=Geometer: the deployer (applies what the panel writes; the nightly snapshot and the weekly restore drill)
After=docker.service network-online.target
Wants=network-online.target
Requires=docker.service

[Service]
User=$USER
SupplementaryGroups=docker
Environment=GEOMETER_SERVER=$SERVER_DIR
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN bundle/geometer.ts apply --watch
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
}

# The `geometer` command: the bundle's command line with the server folder set, plus the whole-server verbs that need systemd. `geometer stop <shop>` stays the
# kill switch for one shop; the whole server is `geometer server stop`, which asks to be confirmed.
shim() {
  cat <<EOF
#!/usr/bin/env bash
$MARK for $USER. Run the install again to rewrite it.
# geometer <command>: the deploy bundle's command line for this server (node $APP_DIR/bundle/geometer.ts, GEOMETER_SERVER=$SERVER_DIR).
#   geometer status | logs [shop] | invite builder|partner | stop <shop> (one shop's kill switch) | start <shop> | deploy | help
#   geometer server status | server start | server stop (EVERY shop stops answering; asks first) | server logs
set -euo pipefail
APP=$(printf '%q' "$APP_DIR")
NODE=$(printf '%q' "$NODE_BIN")
UNIT=geometer-deployer.service
export GEOMETER_SERVER=\${GEOMETER_SERVER:-$(printf '%q' "$SERVER_DIR")}
if [ "\$(id -u)" = 0 ]; then echo "Run geometer as $USER, not as root (files it writes must stay $USER's)." >&2; exit 2; fi
bundle() { "\$NODE" "\$APP/bundle/geometer.ts" "\$@"; }
has_unit() { [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1 && systemctl cat "\$UNIT" >/dev/null 2>&1; }
if [ "\${1:-}" = server ]; then
  case "\${2:-}" in
    stop)
      bundle server stop || [ \$? = 3 ] || exit 1
      if [ "\${3:-}" != --yes ]; then
        if ! { : </dev/tty; } 2>/dev/null; then echo "Nothing was stopped: confirm at a terminal, or add --yes." >&2; exit 1; fi
        printf 'Type stop to stop the whole server: ' >/dev/tty; read -r answer </dev/tty || true
        [ "\$answer" = stop ] || { echo "Nothing was stopped."; exit 1; }
      fi
      if has_unit; then sudo systemctl stop "\$UNIT"; echo "The deployer is stopped."; fi
      exec "\$NODE" "\$APP/bundle/geometer.ts" server stop --confirm ;;
    start)
      bundle server start
      if has_unit; then sudo systemctl start "\$UNIT"; echo "The deployer is running."; fi ;;
    status)
      rc=0; bundle server status "\${@:3}" || rc=\$?
      if has_unit; then echo "deployer (\$UNIT): \$(systemctl is-active "\$UNIT" || true)"; else echo "deployer: no systemd here; run geometer apply --watch yourself"; fi
      exit \$rc ;;
    logs)
      bundle logs --tail 100 || true
      if has_unit; then sudo journalctl -u "\$UNIT" -n 100 --no-pager; fi ;;
    *) exec "\$NODE" "\$APP/bundle/geometer.ts" "\$@" ;;
  esac
  exit 0
fi
exec "\$NODE" "\$APP/bundle/geometer.ts" "\$@"
EOF
}

# Write a root-owned file only when it is new, ours (it has MARK), and different. A file someone else wrote is left alone, and said.
put_system_file() {
  local path=$1 mode=$2 content=$3 tmp
  if [ -f "$path" ] && ! grep -qF "$MARK" "$path"; then note "$path was not written by this install, so it is left as it is. Compare it with what the install would write (bundle/README.md, \"By hand\")."; return 1; fi
  if [ -f "$path" ] && [ "$(cat "$path")" = "$content" ]; then say "$path: as it should be."; return 1; fi
  tmp=$(mktemp)
  printf '%s\n' "$content" >"$tmp"
  as_root install -m "$mode" -o root -g root "$tmp" "$path"
  rm -f "$tmp"
  say "$path: written."
  return 0
}

install_service() {
  put_system_file /usr/local/bin/geometer 0755 "$(shim)" || true
  if [ ! -d /run/systemd/system ] || ! have systemctl; then
    note "There is no systemd here (a container?), so the deployer's service was not installed. Keep it running yourself: geometer apply --watch"
    return 0
  fi
  if put_system_file /etc/systemd/system/geometer-deployer.service 0644 "$(deployer_unit)"; then as_root systemctl daemon-reload; fi
  as_root systemctl enable --now geometer-deployer.service
}

# ---- starting, and the way in ----------------------------------------------------------------------------------------------------------------------------

start_server() {
  step "Starting HTTPS and the panel"
  if [ -f "$SERVER_DIR/state/state.json" ] && grep -q '"applied"' "$SERVER_DIR/state/state.json"; then
    say "Shops are deployed here already; they keep running as they are (geometer status)."
    [ "$PAIR_MODE" = late ] && note "Paired now: the next geometer deploy writes the heartbeat's settings and gives each shop's Guards fleet's lease. Run it when you are ready (nothing else was changed)."
  else
    geo up || die "The server's own services did not start (the reason is above). geometer logs shows what they said."
  fi
  [ "${DRY_RUN:-0}" = 1 ] && return 0
  geo server status --wait 180 || die "The panel or HTTPS did not come up within 3 minutes. geometer logs shows what they said; then run the install again."
  local url="https://$DOMAIN"
  [ "$HTTPS_PORT" = 443 ] || url="$url:$HTTPS_PORT"
  PANEL_URL=$url
  if curl -fsS --max-time 10 --resolve "$DOMAIN:$HTTPS_PORT:127.0.0.1" "$url/healthz" >/dev/null 2>&1; then say "The panel answers at $url, with a good HTTPS certificate."
  elif curl -fsSk --max-time 10 --resolve "$DOMAIN:$HTTPS_PORT:127.0.0.1" "$url/healthz" >/dev/null 2>&1; then say "The panel answers on this server. $(local_domain "$DOMAIN" && printf 'Its certificate is Caddy'"'"'s own (a trial).' || printf 'The HTTPS certificate is not in place yet: Caddy gets it once %s points here, and keeps trying.' "$DOMAIN")"
  else note "The panel does not answer through HTTPS on this server yet. geometer server status and geometer logs say why."; fi
}

# The first builder's way in: the panel's own one-time invitation, made once. Under cloud-init it is not printed into the log, which outlives the link.
invite_first_builder() {
  local record="$SERVER_DIR/state/install.json"
  if [ -f "$record" ] && grep -q '"first_invite_at": "2' "$record"; then say "The first sign-in link was made before. A new one: geometer invite builder"; return 0; fi
  if [ "${YES:-0}" = 1 ] && [ ! -t 1 ]; then say "No sign-in link was printed here (this log is kept). Log in to the server and run: geometer invite builder"; INVITED=""; return 0; fi
  [ "${DRY_RUN:-0}" = 1 ] && { say "  would make a one-time sign-in link: geometer invite builder"; return 0; }
  # role builder: a builder sees every shop on this server and may invite partners (bundle/panel/accounts.ts); the first account is the server's owner
  INVITE=$(geo invite builder --note "first builder, made by install.sh") || die "The panel did not make a sign-in link (the reason is above). Try: geometer invite builder"
  INVITED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
}

record_install() {
  [ "${DRY_RUN:-0}" = 1 ] && return 0
  mkdir -p "$SERVER_DIR/state"
  local first="null"
  if [ -f "$SERVER_DIR/state/install.json" ]; then first=$(sed -n 's/.*"first_invite_at": \("[^"]*"\|null\).*/\1/p' "$SERVER_DIR/state/install.json" | head -n 1); fi
  [ -n "${INVITED:-}" ] && first="\"$INVITED\""
  printf '{\n  "schema": 1,\n  "release": "%s",\n  "commit": "%s",\n  "installed_at": "%s",\n  "guard_image": "%s",\n  "first_invite_at": %s\n}\n' \
    "$INSTALLED_RELEASE" "$INSTALLED_COMMIT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$GUARD_STATE" "${first:-null}" >"$SERVER_DIR/state/install.json"
}

last_words() {
  step "Done"
  say "This server: ${PANEL_URL:-https://$DOMAIN}"
  [ -n "${INVITE:-}" ] && { say ""; say "Your one-time sign-in link (it works once, for 72 hours; send it to nobody else):"; say "$INVITE"; }
  say ""
  say "Left for the panel's first run (or by hand, bundle/README.md \"By hand\" step 5):"
  say "  - the model the shops' agents use, and its key (geometer model-key <file> once \"model\" is in geometer.json);"
  say "  - where the nightly backups go, with a test write (geometer backup-key snapshots <file>);"
  say "  - Google, if a shop uses a calendar (optional)."
  case "$PAIR_MODE" in
    skip|unpaired) say "Not paired: nobody outside hears if this server goes down, and it has no licence lease, so a shop will not start with a production Guard image. Pair it later: get a code on geometer.dev/account and run the install again." ;;
  esac
  [ "${GUARD_STATE:-}" = missing ] && say "The Guard image is not here yet: run the install again with --guard-image-file <file> before the first shop."
  say ""
  say "Every day: geometer status | geometer logs | geometer invite partner | geometer stop <shop> (one shop's kill switch) | geometer server status"
}

# ---- cloud-init's passwordless sudo ---------------------------------------------------------------------------------------------------------------------

# cloud-init gives the user sudo with no password, because nobody is there to type one during the install (bundle/cloud-init.yaml). Left as it is, anything
# that runs as that user is root. So at the end, by default (owner, 11 Nov), the install takes it away and leaves only what the geometer command needs:
# the deployer's service (start, stop, restart), its log, and setting the user's own password, which brings back ordinary sudo (with that password, through
# the sudo group). Only cloud-init's own line for this user is touched, and only after visudo has checked both files.
narrow_sudo() {
  # SUDOERS_DIR is only for the tests, which cannot write /etc
  local dir="${SUDOERS_DIR:-/etc/sudoers.d}" grant narrow tmp
  grant="$dir/90-cloud-init-users" narrow="$dir/geometer-$USER"
  [ "${KEEP_SUDO:-0}" = 1 ] && return 0
  # A dry run runs nothing as root, not even the two read-only looks below, and so cannot know whether cloud-init's line is there: it says what the real run checks and does.
  if [ "${DRY_RUN:-0}" = 1 ]; then
    step "Taking away the passwordless sudo cloud-init gave $USER"
    say "  would look in $grant for cloud-init's passwordless line for $USER and, if it is there, put in $narrow (only the geometer command's verbs and passwd, checked by visudo first) and take that line out (--keep-sudo keeps it)"
    return 0
  fi
  sudo -n test -f "$grant" 2>/dev/null || return 0
  sudo -n grep -Eq "^${USER}[[:space:]]+ALL=\(ALL(:ALL)?\)[[:space:]]+NOPASSWD:[[:space:]]*ALL[[:space:]]*\$" "$grant" 2>/dev/null || return 0
  step "Taking away the passwordless sudo cloud-init gave $USER"
  tmp=$(mktemp)
  printf '%s\n' "$MARK. What the geometer command needs, with no password; everything else needs $USER's own password." \
    "$USER ALL=(root) NOPASSWD: /usr/bin/systemctl start geometer-deployer.service, /usr/bin/systemctl stop geometer-deployer.service, /usr/bin/systemctl restart geometer-deployer.service, /usr/bin/journalctl -u geometer-deployer.service -n 100 --no-pager, /usr/bin/passwd $USER" >"$tmp"
  if [ "${DRY_RUN:-0}" != 1 ] && ! sudo visudo -cqf "$tmp"; then rm -f "$tmp"; note "The narrower sudo rule did not check out, so nothing was changed: $USER keeps passwordless sudo."; return 0; fi
  as_root install -m 0440 -o root -g root "$tmp" "$narrow"
  rm -f "$tmp"
  # -i with the suffix attached works with GNU and BSD sed alike; the copy it leaves has a dot in its name, so sudo never reads it
  as_root sed -i.before-geometer -e "/^${USER}[[:space:]]/d" -e "/^# User rules for $USER\$/d" "$grant"
  if [ "${DRY_RUN:-0}" != 1 ] && ! sudo -n visudo -cq; then as_root cp -p "$grant.before-geometer" "$grant"; note "sudo's settings did not check out after the change, so the old file was put back: $USER keeps passwordless sudo."; return 0; fi
  say "Passwordless sudo is taken away; the geometer command's server verbs still work without a password."
  say "To put it back: sudo passwd $USER (choose a password), then: echo '$USER ALL=(ALL) NOPASSWD:ALL' | sudo tee $grant"
}

# ---- the questions and the plan --------------------------------------------------------------------------------------------------------------------------

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --domain) DOMAIN=${2:-}; shift 2 ;;
      --pairing-code-file) CODE_FILE=${2:-}; shift 2 ;;
      --skip-pairing) PAIR_MODE=skip; shift ;;
      --fleet-key-file) FLEET_KEY_FILE=${2:-}; PAIR_MODE=hand; shift 2 ;;
      --deployment-id) DEPLOYMENT_ID=${2:-}; shift 2 ;;
      --licence-key) LICENCE_KEY=${2:-}; shift 2 ;;
      --lease-file) LEASE_FILE=${2:-}; shift 2 ;;
      --guard-image-file) GUARD_FILE=${2:-}; shift 2 ;;
      --server-dir) SERVER_DIR=${2:-}; shift 2 ;;
      --fleet-url) FLEET_URL=${2:-}; shift 2 ;;
      --reviewed-by) REVIEWED_BY=${2:-}; shift 2 ;;
      --http-port) HTTP_PORT=${2:-}; shift 2 ;;
      --https-port) HTTPS_PORT=${2:-}; shift 2 ;;
      --expect-commit) EXPECT_COMMIT=$(printf '%s' "${2:-}" | tr '[:upper:]' '[:lower:]'); shift 2
        printf '%s' "$EXPECT_COMMIT" | grep -Eq '^[0-9a-f]{40}$' || die "--expect-commit takes a whole commit id (40 hex characters)." ;;
      --use-this-checkout) USE_THIS_CHECKOUT=1; shift ;;
      --keep-sudo) KEEP_SUDO=1; shift ;;
      --dry-run) DRY_RUN=1; shift ;;
      --yes) YES=1; shift ;;
      -h | --help) sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
      *) die "I don't know the option $1. See: bash install.sh --help" ;;
    esac
  done
}

# What goes into a system file or a command must be plain: a path with no spaces or quotes, a user name, a port number.
check_inputs() {
  local p
  for p in "$HTTP_PORT" "$HTTPS_PORT"; do
    if ! printf '%s' "$p" | grep -Eq '^[0-9]{1,5}$' || [ "$p" -lt 1 ] || [ "$p" -gt 65535 ]; then die "\"$p\" is not a port number (1 to 65535)."; fi
  done
  for p in "$SERVER_DIR" "$APP_DIR"; do
    printf '%s' "$p" | grep -Eq '^/[A-Za-z0-9._/+-]+$' || die "The folder \"$p\" must be a full path of letters, digits and . _ / + - only (it goes into a system service file)."
  done
  printf '%s' "$USER" | grep -Eq '^[a-z_][a-z0-9_-]{0,31}$' || die "The user name \"$USER\" is not one the install can write into a service file."
}

# Decision 39 (monorepo ADR-0070): a release's Guard runs a builder's shop only under Geometer's licence, so `init` makes no server folder without fleet's
# licence key. Pairing brings the key; the by-hand path and a skipped pairing must give it. Asked here, with the other answers, so a missing key stops the
# install before Docker or Node is touched rather than at the server folder. A folder that is already there keeps the key it has.
SKIP_NEEDS_KEY="Without pairing, give fleet's licence key yourself: --licence-key <64 hex characters> (Geometer gives it with a deployment key). Or pair: --pairing-code-file <file>."
need_licence_key() {
  [ -f "$SERVER_DIR/geometer.json" ] && return 0
  # the shape init checks (64 hex characters, or a comma-separated few), checked here too so a typo stops the install before anything is installed
  if [ -n "${LICENCE_KEY:-}" ]; then
    printf '%s' "$LICENCE_KEY" | grep -Eq '^[0-9a-fA-F]{64}(,[0-9a-fA-F]{64}){0,3}$' || die "--licence-key must be fleet's licence key as Geometer gave it: 64 hex characters (or up to four, separated by commas). Nothing was changed."
    return 0
  fi
  die "$1 Guard runs a builder's shop only under Geometer's licence, so the server folder is not made without its key. Nothing was changed."
}

# The second run on a folder set up with pairing skipped (follow-up 8): pair it when a code is given or typed; otherwise it stays unpaired, as it was.
ask_late_pairing() {
  if [ -f "$SERVER_DIR/pairing.json" ]; then PAIR_MODE=late; PAIRING_CODE=""; return 0; fi # paired before, not added yet: no new code
  if [ -n "${CODE_FILE:-}" ]; then
    [ -r "$CODE_FILE" ] || die "The pairing code file $CODE_FILE cannot be read."
    PAIRING_CODE=$(head -n 1 "$CODE_FILE" | tr -d '[:space:]')
  elif [ "${YES:-0}" = 1 ]; then
    PAIR_MODE=unpaired; return 0
  else
    say ""
    say "This server is not paired with Geometer's fleet yet (pairing was skipped): no alerts from outside, and no licence lease."
    say "Get a code on geometer.dev/account (\"Add a server\") to pair it now. Nothing else on the server changes."
    PAIRING_CODE=$(ask "Pairing code (or press Enter to leave it unpaired): " | tr -d '[:space:]')
  fi
  if [ -z "$PAIRING_CODE" ] || [ "$PAIRING_CODE" = skip ]; then PAIR_MODE=unpaired; PAIRING_CODE=""; return 0; fi
  printf '%s' "$PAIRING_CODE" | grep -Eiq '^gfp_[a-z0-9-]{24,40}$' || die "That is not a pairing code: it starts with gfp_. Copy it from geometer.dev/account (\"Add a server\")."
  PAIR_MODE=late
}

ask_questions() {
  if [ -z "${DOMAIN:-}" ] && [ -f "$SERVER_DIR/geometer.json" ]; then DOMAIN=$(sed -n 's/^[[:space:]]*"domain":[[:space:]]*"\([^"]*\)".*/\1/p' "$SERVER_DIR/geometer.json" | head -n 1); fi
  if [ -z "${DOMAIN:-}" ]; then
    [ "${YES:-0}" = 1 ] && die "Say the domain: --domain shops.example.com"
    DOMAIN=$(ask "The domain for this server (its A record points here), for example shops.example.com: ")
  fi
  DOMAIN=$(printf '%s' "$DOMAIN" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')
  valid_domain "$DOMAIN" || die "\"$DOMAIN\" is not a domain name. Use the name itself, like shops.example.com (no https://, no path)."

  if [ "$PAIR_MODE" = hand ]; then
    [ -n "${DEPLOYMENT_ID:-}" ] || die "With --fleet-key-file, say the server id Geometer gave with the key: --deployment-id <id>."
    need_licence_key "With --fleet-key-file, also give fleet's licence key Geometer gave with it: --licence-key <64 hex characters>."
    return 0
  fi
  # Follow-up 8: a folder set up with pairing skipped can be paired now, by a second run with a code (or the code asked here); --skip-pairing keeps it as it is
  if unpaired_folder && [ "${PAIR_MODE:-}" != skip ]; then ask_late_pairing; return 0; fi
  if [ -f "$SERVER_DIR/geometer.json" ] || [ -f "$SERVER_DIR/pairing.json" ]; then PAIR_MODE=${PAIR_MODE:-done}; return 0; fi
  if [ "${PAIR_MODE:-}" = skip ]; then need_licence_key "$SKIP_NEEDS_KEY"; return 0; fi
  if [ -n "${CODE_FILE:-}" ]; then
    [ -r "$CODE_FILE" ] || die "The pairing code file $CODE_FILE cannot be read."
    PAIRING_CODE=$(head -n 1 "$CODE_FILE" | tr -d '[:space:]')
  else
    [ "${YES:-0}" = 1 ] && die "Say how to pair: --pairing-code-file <file>, or --skip-pairing."
    say ""
    say "Pairing links this server to your Geometer account: alerts from outside if it goes down, and its licence lease."
    say "Get a code on geometer.dev/account (\"Add a server\"). It works once, for two hours."
    PAIRING_CODE=$(ask "Pairing code (or type skip): " | tr -d '[:space:]')
  fi
  if [ "$PAIRING_CODE" = skip ] || [ -z "$PAIRING_CODE" ]; then PAIR_MODE=skip; PAIRING_CODE=""; need_licence_key "$SKIP_NEEDS_KEY"; return 0; fi
  printf '%s' "$PAIRING_CODE" | grep -Eiq '^gfp_[a-z0-9-]{24,40}$' || die "That is not a pairing code: it starts with gfp_. Copy it from geometer.dev/account (\"Add a server\")."
  PAIR_MODE=code
}

show_plan() {
  step "What the install will do"
  say "  - Docker Engine: $(docker_ready && printf 'already here, kept' || printf 'install from Docker'"'"'s apt repository (key checked against Docker'"'"'s fingerprint)')"
  say "  - Node: $( (have node && [ "$(node --version | sed 's/^v\([0-9]*\).*/\1/')" -ge 26 ]) && printf 'already here (%s), kept' "$(node --version)" || printf 'install %s from nodejs.org (checksum checked twice)' "$(release_get node_version)")"
  say "  - the agents code: this copy, $APP_DIR"
  say "  - the Guard image $(release_get guard_image): $([ -n "${GUARD_FILE:-}" ] && printf 'load %s after checking its sha256' "$GUARD_FILE" || printf 'use the one on this machine, if any')"
  case "$PAIR_MODE" in
    code) say "  - pair with Geometer's fleet at $FLEET_URL: the code is sent once, and this server's key is kept in $SERVER_DIR/fleet_key" ;;
    hand) say "  - use the deployment key in $FLEET_KEY_FILE (server id $DEPLOYMENT_ID)" ;;
    skip) say "  - no pairing: the panel starts, but no alerts from outside and no licence lease, so no shop starts with a production Guard image (fleet's licence key is pinned)" ;;
    late) say "  - pair this server, set up before without pairing, with Geometer's fleet at $FLEET_URL: $([ -n "${PAIRING_CODE:-}" ] && printf 'the code is sent once; ' || printf 'the pairing kept in pairing.json, no new code; ')only the fleet settings are added to geometer.json" ;;
    unpaired) say "  - pairing: not paired (it was skipped), and kept that way" ;;
    *) say "  - pairing: already done" ;;
  esac
  say "  - the server folder: $SERVER_DIR ($([ -f "$SERVER_DIR/geometer.json" ] && printf 'there, kept as it is' || printf 'made for %s, with the panel on' "$DOMAIN"))"
  say "  - reviewed by: $REVIEWED_BY (who reviews the Guards' limits here; --reviewed-by changes it)"
  say "  - the deployer as a system service (geometer-deployer), and the geometer command in /usr/local/bin"
  say "  - start HTTPS and the panel on ports $HTTP_PORT and $HTTPS_PORT, and print a one-time sign-in link"
  say "  Not now: the model's key, backups and Google (the panel's first run)."
}

main() {
  APP_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  RELEASE_FILE="$APP_DIR/bundle/release.json"
  [ -f "$RELEASE_FILE" ] || die "Run this from a copy of the agents repository (bundle/release.json is not next to it): git clone --branch <release tag> https://github.com/GeometerLabs/agents.git ~/geometer/agents && bash ~/geometer/agents/install.sh"
  PAIR_MODE="" HTTP_PORT=80 HTTPS_PORT=443 SERVER_DIR="$HOME/geometer-server"
  parse_args "$@"
  FLEET_URL=${FLEET_URL:-$(release_get fleet_url)}
  USER=${USER:-$(id -un)}
  REVIEWED_BY=${REVIEWED_BY:-$(printf '%s@%s' "$(id -un)" "${HOSTNAME%%.*}" | tr -c 'A-Za-z0-9._:/@+-' '-')}
  SERVER_DIR=${SERVER_DIR%/}
  check_inputs

  say "Geometer: setting up this server for your shops."
  [ "${DRY_RUN:-0}" = 1 ] && say "(Dry run: each step is printed, nothing is changed, and no code is sent.)"
  check_not_root
  check_system
  check_release
  ask_questions
  show_plan
  confirm "Go ahead?" || die "Nothing was changed."

  step "Checking the ports and the domain"
  check_ports
  check_dns
  install_docker
  docker_access
  install_node
  get_guard_image
  pair_server
  make_server_folder
  step "The deployer's service and the geometer command"
  install_service
  start_server
  invite_first_builder
  record_install
  narrow_sudo
  last_words
}

# Everything above is only definitions; this last line runs it. So a `git checkout` that changes this file while it runs cannot change what runs.
# A test sources the file with GEOMETER_INSTALL_LIB=1 to call the functions one at a time.
if [ "${GEOMETER_INSTALL_LIB:-0}" != 1 ]; then main "$@"; exit $?; fi
