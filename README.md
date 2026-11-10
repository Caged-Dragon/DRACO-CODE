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


## Package installs never break a run (update)

Packages are installed best-effort, once per run, inside a 60 second shared budget. A package that cannot be installed is skipped and reported ("Package X: could not be installed ... It was skipped"); the program still runs, and the network is always closed again before your code starts (if it cannot be closed, the code is not run). Sandbox timeouts are reported as timeouts (HTTP 504), no longer as "used up the free allowance". The database enforces package and language rules itself (see `supabase/README.md`).

## Logo

The site logo is `frontend/assets/draco-code-logo.png` (top bar, menu, sign-in dialog, Project mode) and `frontend/assets/icons/favicon-32.png` / `favicon-64.png`.


## Branding and themes (update)

- **Logos.** `brand/Draco-Code.ico` (product) and `brand/cageddragon_logo.ico` (company) are the source files. The page uses each icon's own hand-tuned frame for the size shown: Draco Code in the top bar, menu, sign-in dialog and Project mode; the CagedDragon badge beside the brand, in the footer, the menu and the About dialog. `frontend/favicon.ico` keeps all six original frames; PNG favicons are also provided.
- **Themes.** Light mode is **gold** (warm ivory surfaces, gold accent, deep-gold text); dark mode is **purple** (deep violet surfaces, violet accent). Both are driven by the tokens in `frontend/assets/design.css` and keep WCAG AA contrast for text. The site follows the device setting until the visitor chooses; Settings can pin Light, Dark or System.

## New features (update)

- **Command palette** (Ctrl/Cmd+K, or the search icon): every action, program, language switch and example, with fuzzy search. In Project mode it also offers project commands.
- **Settings** (menu): theme, font size 11 to 20 and tab width 2/4/8, applied live to the editor and terminal and remembered on this device.
- **Examples**: 20 ready-to-run programs (4 per language) that open as new programs; each is executed by the test suite.
- **Keyboard shortcuts** (`?`) and **About** dialogs.
- **Terminal Copy** button.
- **Project mode**: search across files (Ctrl/Cmd+Shift+F), download the project as a `.zip`, upload files (button or drag and drop).


## Using new languages and packages (update)

- **Switching language never leaves foreign code behind.** Picking Java on an untouched Python starter gives a Java starter; if you have written code, a new Java program opens and your Python program is kept.
- **Account panel:** each language shows whether it is ready and has a one-click **Use Java** button; each package shows **Works** or the real reason it failed, and has a **Test** button (it is tested automatically when added). A package that cannot be installed never stops a run.
- **First use of Java / C / C++:** if the backend's compiler snapshot has never been built, the backend now starts the one-time setup by itself when a user first needs it (or adds the language). The page shows progress and runs the program automatically when it is ready. Opening `/setup` by hand is no longer required.
- **Backend:** `POST /packages/check` (sign-in required, rate limited, uses the run quota) tests one package. Installs are best-effort: `pip` is bootstrapped if missing, C/C++ libraries work on `apt` and `dnf` images and are skipped if already in the snapshot, and failures report the actual error line.
- **Accessibility:** zero axe-core violations (WCAG 2.2 AA) over every main screen in both themes; skip link, page heading and landmarks, keyboard-operable editor tabs, high-contrast tokens (`html[data-contrast="high"]`), reduced-motion and forced-colours support (`frontend/app/a11y.css`).
