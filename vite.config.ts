import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'

// *.rls.test.ts hits a live local Supabase instance (needs `npx supabase start`),
// so it's excluded from the default `npm test` run. Vitest's exclude glob is
// applied before CLI file filters, so a plain `exclude` entry would also hide
// the file from an explicit `npm test -- src/lib/assignments.rls.test.ts` — the
// argv check below only excludes it when it wasn't the thing being asked for.
const rlsExplicitlyTargeted = process.argv.some((arg) => arg.includes('.rls.test.ts'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    exclude: rlsExplicitlyTargeted
      ? [...configDefaults.exclude]
      : [...configDefaults.exclude, '**/*.rls.test.ts'],
  },
})
