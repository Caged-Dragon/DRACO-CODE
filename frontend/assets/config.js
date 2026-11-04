// Centralized backend URL: local development is opt-in by hostname; production uses the official Vercel API.
const dracoIsLocal = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
window.DRACOCODE_CONFIG = {
  BACKEND_URL: dracoIsLocal ? 'http://localhost:8787' : 'https://draco-code-backend.vercel.app'
};
// Backward compatibility for retained server-status helpers.
window.DRACOSKILL_CONFIG = { BACKEND_URL: window.DRACOCODE_CONFIG.BACKEND_URL };
