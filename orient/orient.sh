#!/usr/bin/env bash
# Orientation for one system: its layer graph (contracts, decisions) + the live state of its
# codebases and surfaces. Read-only. Prints no secret (no wrangler.toml, no .env, no CLAUDE.md
# token lines).
#
#   orient.sh <system>             contracts + decisions + live state
#   orient.sh <system> --observed  only the live state, formatted as the info of the system's
#                                  observed node (write it with the MCP tool update_node; never by
#                                  hand, never by curl)
#   orient.sh --list               the systems that have a config in orient/systems/
#
# What differs per system lives in orient/systems/<system>.conf. This file holds only the parts
# every system shares.
#
# Repo paths: each config names a repo by its GitHub name and its path on Tor Arne's Mac. Set
# ORIENT_ROOT to a folder holding fresh clones (named as on GitHub) to run it elsewhere, e.g.
#   ORIENT_ROOT=/home/claude orient.sh vemotion --observed
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KG=https://knowledge.vegvisr.org
H=(-H "x-user-email: torarnehave@gmail.com" -H "x-user-role: Superadmin")

if [ "${1:-}" = "--list" ] || [ -z "${1:-}" ]; then
  echo "systems:"; for f in "$HERE"/systems/*.conf; do printf '  %s\n' "$(basename "$f" .conf)"; done
  [ -z "${1:-}" ] && echo "usage: orient.sh <system> [--observed]"
  exit 0
fi
SYSTEM="$1"; MODE="${2:-}"
CONF="$HERE/systems/$SYSTEM.conf"
[ -f "$CONF" ] || { echo "no config for '$SYSTEM' — expected $CONF"; exit 1; }

section() { printf '\n=== %s ===\n' "$1"; }

# repo_path <github-name> — the folder that holds that repo, honouring ORIENT_ROOT.
declare -A REPO_PATH
repo_path() { printf '%s' "${REPO_PATH[$1]:-}"; }

# ---- shared sections; a config calls these from run_sections ----

# The layer graph: contracts in full, decisions as one line each, the observed node's stamp.
section_layer() {
  section "$LAYER_TITLE $LAYER — contracts in full, decisions, observed"
  curl -s "$KG/getknowgraph?id=$LAYER" "${H[@]}" | python3 -c '
import sys, json
d = json.load(sys.stdin)
nodes = d.get("nodes", [])
if not nodes:
    print("LAYER GRAPH NOT READABLE — stop and ask the user; do not answer from memory"); sys.exit()
role = lambda n: (n.get("metadata") or {}).get("role")
for n in nodes:
    if role(n) == "contract":
        print("\n----- CONTRACT", n["id"], "-----\n" + n.get("info", ""))
print("\n----- DECISIONS (read the node when one matters) -----")
for n in nodes:
    if role(n) == "decision":
        m = n.get("metadata") or {}
        print(" ", n["id"], "|", n.get("label"), "|", m.get("status"), m.get("decidedOn") or m.get("foundOn"))
obs = [n for n in nodes if role(n) == "observed"]
for n in obs:
    print("\n----- OBSERVED", n["id"], "measuredOn", (n.get("metadata") or {}).get("measuredOn"),
          "— compare with the live state below; if they differ, regenerate it with --observed -----")
if not obs:
    print("\n----- NO OBSERVED NODE YET — the live state below is what one would hold -----")
' 2>/dev/null || echo "(layer graph not readable — stop and ask)"
}

# section_repos — every repo in REPOS: remote, branch, last commit, uncommitted files.
section_repos() {
  section "Repos (path → remote, branch, last commit, uncommitted files)"
  local spec name d
  for spec in "${REPOS[@]}"; do
    name="${spec%%|*}"; d="$(repo_path "$name")"
    if [ -d "$d/.git" ]; then
      printf '%s\n  %s  [%s]  %s  (%s uncommitted)\n' "$d" \
        "$(git -C "$d" remote get-url origin 2>/dev/null)" "$(git -C "$d" branch --show-current 2>/dev/null)" \
        "$(git -C "$d" log --oneline -1 2>/dev/null)" "$(git -C "$d" status --short 2>/dev/null | wc -l | tr -d ' ')"
    else
      printf '%s  MISSING — paths have moved before; ask the user where it is now\n' "$d"
    fi
  done
}

# section_worker_commits <repo> <dir>... — last commit touching each worker folder (printed
# under the repos, so no header of its own).
section_worker_commits() {
  local d; d="$(repo_path "$1")"; shift
  local w
  for w in "$@"; do
    [ -e "$d/$w" ] && printf '  %s: last commit touching it: %s\n' "$w" "$(git -C "$d" log --oneline -1 -- "$w" 2>/dev/null)"
  done
}

# section_graph_node <title> <graphId> <nodeId> [line...] — one node's info plus metadata.
# Each line is "label:key" pairs joined by '|', printed on one line as "label: value | ...";
# a list value is joined with ", " — or printed as-is when the key ends in "~".
section_graph_node() {
  section "$1"
  local g="$2" id="$3"; shift 3
  curl -s "$KG/getknowgraph?id=$g" "${H[@]}" | python3 -c '
import sys, json
nid, lines = sys.argv[1], sys.argv[2:]
d = json.load(sys.stdin)
for n in d.get("nodes", []):
    if n.get("id") == nid:
        m = n.get("metadata") or {}
        print("info:", n.get("info"))
        def val(key):
            raw = key.endswith("~"); v = m.get(key.rstrip("~"))
            return ", ".join(map(str, v)) if isinstance(v, list) and not raw else v
        for line in lines:
            parts = [p.split(":", 1) for p in line.split("|")]
            print(" | ".join("%s: %s" % (label, val(key)) for label, key in parts))
        break
else:
    print("(node", nid, "not found)")
' "$id" "$@" 2>/dev/null || echo "(could not read graph $g)"
}

# section_openapi <title> <url> — the routes a live worker says it serves.
section_openapi() {
  section "$1"
  curl -s -m 20 "$2" | python3 -c '
import sys, json
d = json.load(sys.stdin)
for p, ops in sorted(d.get("paths", {}).items()):
    print(" ", ",".join(m.upper() for m in ops if m in ("get","post","put","patch","delete","head","options")), p)
' 2>/dev/null || echo "(openapi.json not reachable)"
}

# section_mcp_tools <title> <regex> — MCP server tools (dev-worker/mcp/tools.js TOOL_NAMES)
# whose name matches the regex.
section_mcp_tools() {
  section "$1"
  sed -n '/export const TOOL_NAMES/,/^]/p' "$(repo_path vegvisr-frontend)/dev-worker/mcp/tools.js" 2>/dev/null \
    | grep -oE "'[a-z_]+'" | grep -E "$2" | tr '\n' ' '; echo
}

# ---- load the system's config, resolve paths, run ----
# shellcheck source=/dev/null
. "$CONF"
for spec in "${REPOS[@]}"; do
  name="${spec%%|*}"; local_path="${spec#*|}"
  REPO_PATH[$name]="${ORIENT_ROOT:+$ORIENT_ROOT/$name}"; REPO_PATH[$name]="${REPO_PATH[$name]:-$local_path}"
done

[ "$MODE" != "--observed" ] && section_layer
run_sections
