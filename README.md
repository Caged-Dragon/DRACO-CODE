# Draco Code

Draco Code is the CAGED DRAGON browser-based compiler for **Python, JavaScript, Java, C and C++**.

## Production URLs

- Frontend: <https://draco-code.vercel.app>
- Execution API: <https://draco-code-backend.vercel.app>
- Supabase: the existing `CAGED_DRAGON` project (`gbeurqibcfvquacasofq`)

## Repository layout

- `frontend/` — static editor, syntax highlighting, local workspace, offline app shell and Vercel configuration.
- `backend/` — Vercel serverless API, execution runner, Vercel Sandbox lifecycle, setup and self-check tools, tests.
- `backend/.env.example` — safe variable names and placeholders only.
- `supabase/README.md` — existing CAGED_DRAGON database objects and RPC contract; no replacement schema is created.

## Local development

1. Use Node.js 24.x (the Vercel projects are configured for Node 24).
2. Start the frontend from `frontend/` with a static file server (for example `npx serve .`).
3. Start the backend from `backend/` with the Vercel development runtime after linking the existing backend project and setting its environment variables; the frontend's localhost-only config points to `http://localhost:8787`.
4. Do not copy production secrets into source control. Use `backend/.env.example` as a key checklist and supply local values privately.

The browser workspace autosaves drafts in local storage. The frontend Vercel build generates `assets/config.js` from `DRACO_BACKEND_URL`, `SUPABASE_URL`, and `SUPABASE_ANON_KEY`; set those public configuration values in the frontend project environment. The backend uses the same Supabase URL and publishable/anon key plus its private `CODE_BACKEND_SHARED_SECRET` and `CODE_RATE_LIMIT_SECRET`. Never expose the backend secrets or a Supabase secret/service-role key to the browser. Code is only sent to the backend when Run is pressed. User source code is not stored in Supabase; the database is used by the backend for run-rate enforcement and execution metadata.

## Testing

Run backend unit and sandbox-runner mock tests:

```bash
cd backend
npm ci
npm run test:all
```

The backend tests use a fake sandbox adapter to verify runner orchestration and API logic; they do not validate Vercel microVM infrastructure. The frontend static smoke test checks DOM references, language templates and removed install code. Real compiler verification must also use the deployed `/selfcheck` endpoint and actual `/execute` calls.

## Vercel deployment

Use the two existing Vercel projects connected to `Caged-Dragon/DRACO-CODE`:

- Frontend project root: `frontend/`
- Backend project root: `backend/`

The backend production environment must contain the keys listed in `backend/.env.example`. Keep `CODE_BACKEND_SHARED_SECRET`, `CODE_RATE_LIMIT_SECRET`, and all Supabase credentials private to the backend project. The frontend API URL and Supabase browser configuration are generated at build time from Vercel environment variables. The frontend and backend projects should both have the same `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `DRACO_BACKEND_URL` values; only the frontend embeds these public values. Keep `CODE_BACKEND_SHARED_SECRET` and `CODE_RATE_LIMIT_SECRET` only in the backend project.

The existing database already contains the `code_consume_run` and `code_record_execution` RPC functions and the `code_rate_limit_windows` / `code_execution_events` tables. Do not recreate the database or apply destructive migrations.


## Accounts and packages

Guests can execute Python and JavaScript. Signed-in users can add Java, C and C++ from the sandwich menu. Language grants and package selections are saved per user in the existing CAGED_DRAGON Supabase project with row-level security. Package downloads use a temporary, registry-restricted network window; user code runs only after the sandbox network policy is restored to deny-all.


## Environment variable setup

The frontend is a static site, so its Vercel build runs `frontend/scripts/build.mjs` and generates `dist/assets/config.js` from these Vercel variables:

- `DRACO_BACKEND_URL` — public API origin.
- `SUPABASE_URL` — public Supabase project URL.
- `SUPABASE_ANON_KEY` — public Supabase publishable/anon key only.

Set the same three values on both existing Vercel projects for each environment (Production, Preview, Development). The frontend build embeds them in the browser bundle; the backend reads the Supabase values server-side. The backend also requires `CODE_BACKEND_SHARED_SECRET` and `CODE_RATE_LIMIT_SECRET`; never add those to the frontend project. Never put a Supabase secret/service-role key in the frontend. Vercel environment-variable changes require a new deployment.

For local frontend builds, export those three variables before running `node scripts/build.mjs` from `frontend/`. The tracked `assets/config.js` is only a localhost fallback and intentionally contains no Supabase key.


## Project mode and the new top bar (update)

- The top bar now reads **menu button → Sign in → brand** at the left edge. Sign in opens a dedicated sign-in / create-account dialog.
- The menu has **Compiler**, **Project mode** and **Languages and packages**. Project mode is a VS Code-style workspace for signed-in users: projects, folders, multiple files and tabs, autosave to Supabase, run the whole project (entry file), Problems panel, stdin.
- Data lives in `public.draco_projects` and `public.draco_project_files` with row-level security (`supabase/migrations/20261105090000_draco_projects.sql`). **Apply this migration once** (Supabase Dashboard → SQL Editor → paste → Run, or `supabase db push`). It is additive and safe to run twice.
- The backend `POST /execute` also accepts `{ language, files:[{path,content}], entry, stdin }` for project runs. This requires a signed-in user and the same per-language account checks as single-file runs.
- Not included on purpose: an interactive terminal. Each run is a fresh, network-isolated sandbox, so there is no persistent shell.


## Interactive terminal (update)

The console is now a real terminal. The program keeps running in its sandbox while you type: prompts from `input()`, `scanf`, `cin`, `Scanner` and `readline` appear immediately, and your answers go straight into the running program. Ctrl+C stops it, Ctrl+D ends input, Ctrl+L clears, Up/Down recall earlier lines. Stacked view (editor on top, terminal below) is the default.

- Backend: `POST /session/start | /session/poll | /session/input | /session/eof | /session/stop` (`backend/lib/interactive.js`). `start` applies the same sign-in, language and run-quota rules as `/execute`; the other calls are authorised by an HMAC-signed, expiring session token. One program lives at most `DRACO_SESSION_SECONDS` (default 120) and 100 KB of output.
- Frontend: `frontend/app/terminal.js`, used by the compiler page and by Project mode. If the backend has no `/session/*` routes yet (frontend deployed first), the page falls back to the old one-shot `/execute` run automatically.
- Optional environment variable: `DRACO_SESSION_SECONDS` (backend). No new secrets are needed; tokens are signed with `CODE_RATE_LIMIT_SECRET`.
- Not a full terminal emulator: programs that draw full-screen UIs (curses, vim) are not supported. Colour codes are stripped.
