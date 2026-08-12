import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// Build stamp for the version pill in the top nav. On Cloudflare Pages the commit and
// branch come from the build environment; locally they come from git. Baked in at build
// time, so what the pill shows is what that bundle was built from — not a runtime lookup.
function git(cmd: string): string {
  try { return execSync(`git ${cmd}`, { encoding: 'utf8' }).trim() } catch { return '' }
}
const BUILD_SHA = process.env.CF_PAGES_COMMIT_SHA || git('rev-parse HEAD') || 'unknown'
const BUILD_BRANCH = process.env.CF_PAGES_BRANCH || git('rev-parse --abbrev-ref HEAD') || 'unknown'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
    __BUILD_BRANCH__: JSON.stringify(BUILD_BRANCH),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __BUILD_ENV__: JSON.stringify(process.env.CF_PAGES ? 'pages' : 'local'),
  },
})
