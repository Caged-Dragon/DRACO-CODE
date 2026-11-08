# Database tests for Project mode (optional, local only)

- `rls.test.sql` — run against a scratch Postgres that has stub `auth.users` / `auth.uid()` and the `anon` / `authenticated` roles. Verifies RLS isolation, path rules, limits, folder functions and that the migration is re-runnable.
- `data.test.mjs` — runs the real browser data layer (`frontend/app/project-data.js`) through `@supabase/supabase-js` against PostgREST on that scratch database, as two different users.

Never run these against the production project.
- `packages.test.sql` — seeds deliberately dirty legacy package rows, runs `20261106090000_draco_packages_hardening.sql` twice, and checks the new rules (valid names only, no case duplicates, 20 per language, language must be added first, owner-only access). Run after `rls.test.sql`'s stub setup.
