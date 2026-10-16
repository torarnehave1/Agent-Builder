#!/bin/zsh
# Runs migrate.mjs for one course manifest. The session token is read from D1 and never printed.
#   zsh scripts/course-migrate/run.sh scripts/course-migrate/enkel-hals.json
set -e
HERE=${0:A:h}
export VEGVISR_TOKEN=$(cd /Volumes/T7/vegvisr-frontend/dev-worker && npx wrangler d1 execute vegvisr_org --remote --json \
  --command "SELECT emailVerificationToken FROM config WHERE email='torarnehave@gmail.com'" 2>/dev/null \
  | python3 -I -c "import json,sys;d=json.load(sys.stdin);d=d if isinstance(d,list) else [d];print(d[0]['results'][0]['emailVerificationToken'])")
export VEGVISR_EMAIL=torarnehave@gmail.com
node "$HERE/migrate.mjs" "${1:A}"
