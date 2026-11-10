# Browser end-to-end tests (reference scripts)

These drive a real Chromium (Playwright) against the real UI.

- `servers2.mjs` serves the frontend and runs the REAL backend handler (`backend/api/index.js`) with Supabase redirected to a local PostgREST in front of a scratch Postgres; only the sandbox is a stand-in. It can simulate a backend whose compiler setup never ran (`/tmp/e2e/NO_TOOLCHAIN`) and its completion (`/tmp/e2e/SETUP_DONE`).
- `langpkg2.py` - add a language, use it, switch languages, add good/bad packages and watch them being tested, first-time compiler setup.
- `a11y.py` - axe-core audit (WCAG 2.0/2.1/2.2 AA + best practices) over 18 screens in both themes. Expected result: 0 violations.
- `ui.py` - shared helpers and the Project mode flow.

They need Postgres + PostgREST + `@supabase/supabase-js` + `axe-core` installed as described in `supabase/test/README.md`; adjust the `/tmp/e2e` and `/home/claude/draco` paths for your machine. They are not part of `npm test`.
