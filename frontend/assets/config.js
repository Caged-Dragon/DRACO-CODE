// Local fallback only. The Vercel build generates this file from environment variables.
const dracoIsLocal = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
window.DRACOCODE_CONFIG = Object.freeze({
  BACKEND_URL: dracoIsLocal ? 'http://localhost:8787' : 'https://draco-code-backend.vercel.app',
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: ''
});
window.DRACOSKILL_CONFIG = { BACKEND_URL: window.DRACOCODE_CONFIG.BACKEND_URL };
