import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'

// *.rls.test.ts / *.integration.test.ts hit a live local Supabase instance
// (needs `npx supabase start`), so they're excluded from the default `npm test`
// run. Vitest's exclude glob is applied before CLI file filters, so a plain
// `exclude` entry would also hide a file from an explicit
// `npm test -- src/lib/whatever.rls.test.ts` — the argv check below only
// excludes a suffix when a file matching it wasn't the thing being asked for.
const LIVE_DB_SUFFIXES = ['.rls.test.ts', '.integration.test.ts']
const explicitlyTargeted = (suffix: string) => process.argv.some((arg) => arg.includes(suffix))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    exclude: [
      ...configDefaults.exclude,
      ...LIVE_DB_SUFFIXES.filter((suffix) => !explicitlyTargeted(suffix)).map((suffix) => `**/*${suffix}`),
    ],
  },
})
