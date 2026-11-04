# Existing CAGED_DRAGON Supabase integration

Draco Code uses the existing Supabase project only. It does not create a replacement project and this change set does not apply database migrations.

- Project: `CAGED_DRAGON`
- Project reference: `gbeurqibcfvquacasofq`
- Project URL: `https://gbeurqibcfvquacasofq.supabase.co`
- Region: `ap-south-1`

## Existing execution objects

The live project already contains these objects:

- `public.code_rate_limit_windows` — persistent rate-limit windows, with RLS enabled and no public row policies.
- `public.code_execution_events` — aggregate execution metadata, with RLS enabled and no public row policies.
- `public.code_consume_run(p_backend_secret, p_fingerprint_hash, p_limit, p_window_seconds)` — atomically consumes a run allowance and returns allow/remaining/reset values.
- `public.code_record_execution(...)` — stores request metadata only; source code and stdin are not stored.

The backend calls these RPCs using the public anon key plus `CODE_BACKEND_SHARED_SECRET`. The SQL functions verify the supplied backend secret against a SHA-256 hash kept in the non-exposed `code_private` schema. Keep the shared secret on the backend only.

## Existing migration history

The live database reports these code-execution migrations:

- `20261104122301_code_execution_observability`
- `20261104122618_code_execution_retention`
- `20261104123320_code_retention_maintenance`
- `20261104125515_code_backend_rpc_authentication`

The migration SQL files were not present in the uploaded Git repository and the connected database API exposes migration history, not historical migration source files. They are therefore documented here rather than reconstructed or reapplied. Obtain the authoritative migration files from the database's original migration source before managing future schema changes through the Supabase CLI.

## Runtime configuration

Set these variables in the **backend Vercel project only**:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `CODE_BACKEND_SHARED_SECRET`
- `CODE_RATE_LIMIT_SECRET`

`ALLOWED_ORIGINS` belongs on the backend too. The browser must never receive either backend secret or a Supabase service-role key. See `backend/.env.example` for safe placeholders.

No user source code, stdin, or full compiler output is persisted to Supabase by the Draco Code API. Only language, status, runtime duration, byte counts, timeout/compile flags, and a keyed pseudonymous fingerprint are recorded.


## Supabase Auth: registration and sign-in

The frontend uses the Supabase Auth browser client. New registrations are created by
`supabase.auth.signUp()` and are stored by Supabase in `auth.users`; passwords are
handled by Supabase Auth and must never be copied into an application table. Returning
users sign in with `signInWithPassword()`. The browser client persists and refreshes the
session, and `onAuthStateChange()` restores the account UI after a confirmation-link
redirect or token refresh.

Before accepting production signups, configure the Supabase project at
**Authentication → URL Configuration**:

- Set **Site URL** to `https://draco-code.vercel.app/`.
- Add `https://draco-code.vercel.app/` to **Redirect URLs**.

The app sends email-confirmation links back to that production URL. If a custom production
domain is adopted later, add its exact HTTPS URL to the allow-list and update
`authRedirectUrl()` in `frontend/app/app.js` to the canonical domain. Do not add a broad
`*.vercel.app` wildcard to production auth redirects unless preview signups are deliberately
needed.

Email/password sign-in is enabled in Supabase Auth by default for hosted projects; keep
email confirmation enabled unless the product owner deliberately chooses auto-confirm.
