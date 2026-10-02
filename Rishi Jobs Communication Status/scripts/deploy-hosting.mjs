/** Publishes the built app (dist/) to https://rishijobs-workflow.web.app using serviceAccountKey.json. */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const env = { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS || join(root, 'serviceAccountKey.json') }
const r = spawnSync('npx --yes firebase-tools@latest deploy --only hosting --project rishijobs-workflow --non-interactive', {
  cwd: root,
  env,
  stdio: 'inherit',
  shell: true,
})
process.exit(r.status ?? 1)
