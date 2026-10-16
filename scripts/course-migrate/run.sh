#!/bin/zsh
# Runs migrate.mjs for one course manifest. The session token is read from D1 and never printed.
#   zsh scripts/course-migrate/run.sh scripts/course-migrate/enkel-hals.json
set -e
HERE=${0:A:h}
# One D1 read, retried: a single failed remote query aborted a run on 2026-10-16.
d1() {
  local out
  for i in 1 2 3; do
    out=$(cd /Volumes/T7/vegvisr-frontend/dev-worker && npx wrangler d1 execute vegvisr_org --remote --json --command "$1" 2>/dev/null \
      | python3 -I -c "import json,sys;d=json.load(sys.stdin);d=d if isinstance(d,list) else [d];print(d[0]['results'][0]['v'])" 2>/dev/null) && [ -n "$out" ] && { print -r -- "$out"; return 0 }
    sleep 3
  done
  echo "D1 lookup failed three times" >&2; return 1
}
export VEGVISR_TOKEN=$(d1 "SELECT emailVerificationToken AS v FROM config WHERE email='torarnehave@gmail.com'")
export VEGVISR_USER_ID=$(d1 "SELECT user_id AS v FROM config WHERE email='torarnehave@gmail.com'")
export VEGVISR_EMAIL=torarnehave@gmail.com
node "$HERE/migrate.mjs" "${1:A}"
