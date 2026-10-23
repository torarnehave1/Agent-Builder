#!/usr/bin/env bash
# VEmotion orientation: the VEmotion layer graph (contracts, decisions) + the live state of the
# four codebases and three surfaces. Read-only. Prints no secret (no wrangler.toml, no .env, no
# CLAUDE.md token lines).
#
#   orient.sh             contracts + decisions + live state
#   orient.sh --observed  only the live state, formatted as the info of observed-vemotion-surfaces
#                         (write it with the MCP tool update_node; never by hand, never by curl)
set -u
MODE="${1:-}"
LAYER=b8527fde-96e7-4c68-b1fe-d97b82c2e13b

APP=/Volumes/T7/video-generator
MONO=/Volumes/T7/vegvisr-frontend
AB=/Users/torarnehave/Documents/GitHub/Agent-Builder
KG=https://knowledge.vegvisr.org
H=(-H "x-user-email: torarnehave@gmail.com" -H "x-user-role: Superadmin")

section() { printf '\n=== %s ===\n' "$1"; }

if [ "$MODE" != "--observed" ]; then
  section "VEmotion layer graph $LAYER — contracts in full, decisions, observed"
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
        print(" ", n["id"], "|", n.get("label"), "|", m.get("status"), m.get("decidedOn"))
for n in nodes:
    if role(n) == "observed":
        print("\n----- OBSERVED", n["id"], "measuredOn", (n.get("metadata") or {}).get("measuredOn"),
              "— compare with the live state below; if they differ, regenerate it with --observed -----")
' 2>/dev/null || echo "(layer graph not readable — stop and ask)"
fi

section "Repos (path → remote, branch, last commit, uncommitted files)"
for d in "$APP" "$MONO" "$AB"; do
  if [ -d "$d/.git" ]; then
    remote=$(git -C "$d" remote get-url origin 2>/dev/null)
    branch=$(git -C "$d" branch --show-current 2>/dev/null)
    last=$(git -C "$d" log --oneline -1 2>/dev/null)
    dirty=$(git -C "$d" status --short 2>/dev/null | wc -l | tr -d ' ')
    printf '%s\n  %s  [%s]  %s  (%s uncommitted)\n' "$d" "$remote" "$branch" "$last" "$dirty"
  else
    printf '%s  MISSING — paths have moved before; ask the user where it is now\n' "$d"
  fi
done
for w in vemotion-worker dev-worker; do
  [ -f "$MONO/$w/index.js" ] && printf '  %s: last commit touching it: %s\n' "$w" "$(git -C "$MONO" log --oneline -1 -- "$w" 2>/dev/null)"
done

section "Work context ctx-vemotion (what the Agent-Builder agent gets)"
curl -s "$KG/getknowgraph?id=0b61898c-c892-4dbc-9e35-2980e274a5d8" "${H[@]}" | python3 -c '
import sys, json
d = json.load(sys.stdin)
for n in d.get("nodes", []):
    if n.get("id") == "ctx-vemotion":
        m = n.get("metadata", {})
        print("info:", n.get("info"))
        print("tools:", ", ".join(m.get("tools", [])))
        print("starterPrompts:", m.get("starterPrompts"))
' 2>/dev/null || echo "(could not read graph 0b61898c)"

section "Registry node sysworker-vemotion (graph_system_registry)"
curl -s "$KG/getknowgraph?id=graph_system_registry" "${H[@]}" | python3 -c '
import sys, json
d = json.load(sys.stdin)
for n in d.get("nodes", []):
    if n.get("id") == "sysworker-vemotion":
        m = n.get("metadata", {})
        print("info:", n.get("info"))
        print("binding:", m.get("binding"), "| openapi:", m.get("openapi_url"), "| prefix:", m.get("tool_prefix"))
        print("blocklist:", ", ".join(m.get("tool_blocklist", [])))
' 2>/dev/null || echo "(could not read graph_system_registry)"

section "vemotion-worker live routes (api.vegvisr.org/vemotion/openapi.json)"
curl -s https://api.vegvisr.org/vemotion/openapi.json | python3 -c '
import sys, json
d = json.load(sys.stdin)
for p, ops in sorted(d.get("paths", {}).items()):
    print(" ", ",".join(m.upper() for m in ops), p)
' 2>/dev/null || echo "(openapi.json not reachable)"

section "Agent-Builder vemotion tools (tool-definitions.js) and MCP forward allow-list"
grep -oE "name: '(vemotion_[a-z_]+|get_vemotion_reference|get_carousel_reference)'" "$AB/worker/tool-definitions.js" 2>/dev/null | sed "s/name: /  /"
sed -n '/VEMOTION_MCP_TOOLS = new Set/,/\])/p' "$AB/worker/index.js" 2>/dev/null | grep -oE "^ *'[a-z_]+'" | tr -d ' ' | tr '\n' ' ' | sed 's/^/  forwarded to MCP: /'; echo

section "MCP server VEmotion / Instagram tools (dev-worker/mcp/tools.js TOOL_NAMES)"
sed -n '/export const TOOL_NAMES/,/^]/p' "$MONO/dev-worker/mcp/tools.js" 2>/dev/null | grep -oE "'[a-z_]*(vemotion|instagram|media)[a-z_]*'" | tr '\n' ' '; echo

section "App query parameters handled (src/App.tsx, cloud-compositions.ts, auth.ts)"
grep -hoE "searchParams\.get\('[a-zA-Z]+'\)|\.get\('(embed|renderJob|magic|dev|compositionId)'\)" "$APP/src/App.tsx" "$APP/src/lib/cloud-compositions.ts" "$APP/src/lib/auth.ts" 2>/dev/null | sort -u | sed 's/^/  /'

section "App build marker (bump on every push)"
grep -oE "Build marker [A-Z]{2}\"" "$APP/src/components/Dashboard.tsx" 2>/dev/null | head -1 | sed 's/^/  /'
