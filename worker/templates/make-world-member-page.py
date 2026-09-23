"""Turn the published NIBI member page into the World member-page template.

Every NIBI-specific value becomes a {{PLACEHOLDER}} filled per World; the page code itself is
untouched. Tabs whose World has no content (meeting room, common-info graph, personal graph) hide
themselves at runtime, so one template serves every World. Run:

    python3 make-template.py <live-nibi-page.html> <out-template.html>
"""
import sys, re, json

src_path, out_path = sys.argv[1], sys.argv[2]
s = open(src_path).read()
subs = []


def rep(old, new, count=1):
    n = s.count(old)
    assert n == count, f"expected {count} of {old[:70]!r}, found {n}"
    subs.append((old, new))


# ---- the chat package is installed per page by setup_chat_workspace, so the template carries an
# ---- empty slot for it; the portfolio bundle is part of the page and stays.
s = re.sub(r'(const workspaceComponent = "data:text/javascript;base64,)[A-Za-z0-9+/=]+(")', r'\1\2', s, count=1)

# ---- brand and texts -------------------------------------------------------
rep('<title>NIBI | Min side</title>', '<title>{{WORLD_NAME}} | Min side</title>')
rep('<span class="brand-mark" aria-hidden="true">NIBI</span><span>NIBI</span>',
    '<span class="brand-mark" aria-hidden="true">{{WORLD_MARK}}</span><span>{{WORLD_NAME}}</span>')
rep('app-name="NIBI Min side"', 'app-name="{{WORLD_NAME}} Min side"')
rep('<h1>NIBI møte</h1>', '<h1>{{WORLD_NAME}} møte</h1>')
rep('aria-label="NIBI møte"', 'aria-label="{{WORLD_NAME}} møte"')
rep('<h1>Artikler fra NIBI</h1>', '<h1>Artikler fra {{WORLD_NAME}}</h1>')
rep('data-vegvisr-portfolio="NIBI"', 'data-vegvisr-portfolio="{{WORLD_TAG}}"')
rep('<h1>NIBI Felles</h1>', '<h1>{{WORLD_NAME}} Felles</h1>')
rep('for NIBI-medlemmer.', 'for {{WORLD_NAME}}-medlemmer.')
rep('<span>NIBI &middot; Fellesskapet</span>', '<span>{{WORLD_NAME}} &middot; Fellesskapet</span>')
rep('<h3>Varsler fra post@nibi.no</h3>', '<h3>Varsler fra {{FOUNDER_EMAIL}}</h3>')
rep('<strong>Oppdateringer på NIBI-siden</strong>', '<strong>Oppdateringer på {{WORLD_NAME}}-siden</strong>')
rep('melding i NIBI-samtalene dine.', 'melding i {{WORLD_NAME}}-samtalene dine.')

# ---- colours ---------------------------------------------------------------
# Every use of the brand colours, including the copies inside embedded component styles.
rep('#17634b', '{{BRAND_GREEN}}', 5)
rep('#9b334b', '{{BRAND_ACCENT}}', 1)

# ---- World settings at the top of the script -------------------------------
rep("  const worldDomain = 'nibi.no'\n",
    "  const worldDomain = '{{WORLD_DOMAIN}}'\n"
    "  const worldName = '{{WORLD_NAME}}'\n"
    "  const worldTag = '{{WORLD_TAG}}'\n"
    "  const founderEmail = '{{FOUNDER_EMAIL}}'\n"
    "  const commonGraphId = '{{COMMON_GRAPH_ID}}'\n"
    "  const personalGraphId = '{{PERSONAL_GRAPH_ID}}'\n"
    "  const personalUserId = '{{PERSONAL_USER_ID}}'\n"
    "  const worldAlerts = '{{WORLD_ALERTS}}' === '1'\n")
rep("  const teamMeetingId = 'bbb3cdd1-e34c-4b29-86b4-4281c0eecae0'\n",
    "  const teamMeetingId = '{{TEAM_MEETING_ID}}'\n")
rep("""    const sectionTypes = {
      '3a694b63-5a3c-4465-bfe6-540338276904': 'aktuelt',
      '2a02acad-f056-48c3-925c-b0e6b8633ac1': 'kalender',
    }""", "    const sectionTypes = {{SECTION_TYPES}}")

# ---- the World's own graphs, tag and leader --------------------------------
rep("common ? '37772e96-dea0-4c4e-b3d3-b7d4cc4eb6e4' : 'd85adc91-f862-480a-80ae-8d6462f7f153'",
    'common ? commonGraphId : personalGraphId')
rep("common ? '#NIBI #FELLES' : ''", "common ? ('#' + worldTag + ' #FELLES') : ''")
rep("(session.user.user_id !== 'ca3d9d93-3b02-4e49-a4ee-43552ec4ca2b' || session.user.email.toLowerCase() !== 'torarnehave@gmail.com')",
    '(!personalUserId || session.user.user_id !== personalUserId)')
rep("session.user.email.toLowerCase() === 'post@nibi.no'", 'session.user.email.toLowerCase() === founderEmail')

# ---- meeting room texts ----------------------------------------------------
rep("info.meetingTitle || 'NIBI team-møte'", "info.meetingTitle || (worldName + ' team-møte')")
rep("'<div class=\"meeting-waiting-icon\">NIBI</div>'",
    "'<div class=\"meeting-waiting-icon\">' + worldName + '</div>'")
rep("isLeader ? 'Starter NIBI team-rommet ...' : 'Kobler til NIBI team-rommet ...'",
    "isLeader ? ('Starter ' + worldName + ' team-rommet ...') : ('Kobler til ' + worldName + ' team-rommet ...')")
rep("frame.title = 'NIBI møte'", "frame.title = worldName + ' møte'")
rep("common ? 'NIBI Felles: Aktuelt og Kalender' : 'Min medlemsgraf'",
    "common ? (worldName + ' Felles: Aktuelt og Kalender') : 'Min medlemsgraf'")
rep("'Du er deltaker i NIBI team-rommet.'", "('Du er deltaker i ' + worldName + ' team-rommet.')")

# ---- hide what this World does not have ------------------------------------
rep("  element('settings').addEventListener('click', openSettings)\n",
    "  // A World without a meeting room, a common-info graph or personal graphs does not show those\n"
    "  // tabs; a World without e-mail alerts does not show the alert switches.\n"
    "  for (const [name, on] of [['meeting', teamMeetingId], ['common', commonGraphId], ['personal', personalGraphId]]) {\n"
    "    if (on) continue\n"
    "    const index = tabs.indexOf(name)\n"
    "    if (index >= 0) tabs.splice(index, 1)\n"
    "    element(name + 'Tab').hidden = true\n"
    "    element(name + 'Section').hidden = true\n"
    "  }\n"
    "  if (!worldAlerts) element('settingsForm').hidden = true\n"
    "  element('settings').addEventListener('click', openSettings)\n")

for old, new in subs:
    s = s.replace(old, new)

# NIBI_REALTIME_BOOTSTRAP is the message name realtime.vegvisr.org listens for — a protocol name
# shared with that app, not a World value, so it stays as it is.
left = [m.start() for m in re.finditer(r'NIBI(?!_REALTIME_BOOTSTRAP)|nibi\.no|post@nibi', s)]
assert not left, f'NIBI left in template at {left[:5]}: ' + '; '.join(re.sub(r"\s+", " ", s[p-60:p+60]) for p in left[:3])
# Emitted as a JS module (base64 inside) so the worker bundle and plain Node tests load the same
# template; the page contains backticks and ${...}, which a JS string literal could not hold safely.
import base64
payload = base64.b64encode(s.encode('utf-8')).decode('ascii')
module = (
    "// GENERATED — do not edit by hand. Built from the published NIBI member page by\n"
    "// templates/make-world-member-page.py; every World value is a {{PLACEHOLDER}}.\n"
    "// Rebuild: python3 worker/templates/make-world-member-page.py <live-member-page.html> "
    "worker/templates/world-member-page.js\n"
    "const BASE64 = '" + payload + "'\n"
    "const bytes = Uint8Array.from(atob(BASE64), character => character.charCodeAt(0))\n"
    "export default new TextDecoder().decode(bytes)\n"
)
open(out_path, 'w').write(module)
print(json.dumps({'placeholders': sorted(set(re.findall(r'\{\{[A-Z_]+\}\}', s))), 'chars': len(s), 'module': len(module)}))
