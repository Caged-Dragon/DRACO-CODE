# Draco Code execution backend

This is the production Vercel backend used by Draco Code. It runs user programs in fresh Vercel Sandbox microVMs and supports Python, JavaScript, Java, C and C++.

**Production API:** <https://draco-code-backend.vercel.app>

## Routes

| Route | Purpose |
| --- | --- |
| `GET /health` | Liveness and presence of required database configuration |
| `GET /sandboxes` | Reports whether each language is available from the verified toolchain snapshot |
| `GET /setup` | Starts/checks the one-time compiler image setup page |
| `GET /setup/status` | Reads compiler setup state |
| `POST /setup/start` | Starts compiler installation and snapshot creation |
| `GET /selfcheck` | Runs real randomized programs through the five toolchains |
| `POST /execute` | Executes `{ "language", "code", "stdin?" }` and returns stdout, stderr, exit code, duration, timeout and compile status |

The only execution languages accepted by the Vercel API are `python`, `javascript`, `java`, `c` and `cpp`. Legacy account, problem, terminal and certificate routes are not part of this service.

## Local development

Use Node.js 24.x (the Vercel projects are configured for Node 24). Install the pinned dependencies from `package-lock.json`, link the existing backend Vercel project, and use `vercel dev --listen 8787` with local values from `.env.example`. For a browser served on localhost, `frontend/assets/config.js` selects `http://localhost:8787`; production always selects the official backend alias.

Never put actual secrets in source control. `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `CODE_BACKEND_SHARED_SECRET` and `CODE_RATE_LIMIT_SECRET` are backend-only. The API validates the Supabase hostname against the existing `CAGED_DRAGON` project and fails closed if production database configuration is missing.

## Execution security

Each execution is delegated to the Vercel Sandbox SDK, not spawned as a process inside the API function. The runner writes source files to a fresh sandbox, uses fixed executable commands and argument arrays, sets wall-clock limits, caps source/input/output sizes, records compile/runtime status, and stops the sandbox in a `finally` block. The intended Vercel Sandbox isolation includes a separate microVM per run and blocked outbound network access as reported by `/sandboxes`.

CORS is an origin allowlist, not authentication. Production permits the official frontend alias and preview hostnames belonging to this exact frontend Vercel project; it rejects unrelated website origins. Non-browser clients can omit `Origin`, so run throttling remains enforced independently in Supabase.

## Supabase rate limits and observability

The live database objects are documented in [`../supabase/README.md`](../supabase/README.md). The backend calls the existing `code_consume_run` RPC before it allocates a sandbox and `code_record_execution` afterward. Event records contain aggregate metadata only. Do not create replacement tables, migrate the database to a different project, or expose backend secrets to the browser.

## Tests

```bash
npm ci
npm run test:all
```

`npm test` runs the backend runner/API tests with a local fake Sandbox adapter. These tests verify our orchestration and request validation but do not test Vercel's cloud microVM infrastructure. `npm run test:frontend` checks frontend DOM references, shell assets, language starter metadata and absence of install/manifest code. After deployment, use `/selfcheck` and actual `/execute` calls to test the real Vercel Sandbox runtime for all five languages.

The separate `python-server/` directory is an optional historical full Python/SQLite service. It is not used by either Vercel project and is not on the production execution request path.
