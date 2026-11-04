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

The browser workspace autosaves drafts in local storage. Code is only sent to the backend when Run is pressed. User source code is not stored in Supabase; the database is used by the backend for run-rate enforcement and execution metadata.

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

The backend production environment must contain the keys listed in `backend/.env.example`. Keep `CODE_BACKEND_SHARED_SECRET`, `CODE_RATE_LIMIT_SECRET`, and all Supabase credentials private to the backend project. The frontend only calls the fixed public API URL in `frontend/assets/config.js`.

The existing database already contains the `code_consume_run` and `code_record_execution` RPC functions and the `code_rate_limit_windows` / `code_execution_events` tables. Do not recreate the database or apply destructive migrations.


## Accounts and packages

Guests can execute Python and JavaScript. Signed-in users can add Java, C and C++ from the sandwich menu. Language grants and package selections are saved per user in the existing CAGED_DRAGON Supabase project with row-level security. Package downloads use a temporary, registry-restricted network window; user code runs only after the sandbox network policy is restored to deny-all.
