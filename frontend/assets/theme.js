// Theme: follow the system until the person chooses; remember the choice. Runs in <head> so there is no flash.
(function () {
  var KEY = 'draco-theme', root = document.documentElement;
  function stored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function apply(t) {
    root.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]');       // Keep the browser tab and UI chrome aligned with the selected theme.
    if (m) m.setAttribute('content', t === 'light' ? '#F6EFDD' : '#130E22');
  }
  function system() { return (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark'; }
  function mode() { var s = stored(); return s === 'light' || s === 'dark' ? s : 'system'; }
  function setMode(m) {                       // 'system' | 'light' | 'dark'
    if (m === 'light' || m === 'dark') { try { localStorage.setItem(KEY, m); } catch (e) { /* not remembered */ } apply(m); }
    else { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } apply(system()); }
    document.querySelectorAll('[data-theme-toggle]').forEach(label);
  }
  apply(mode() === 'system' ? system() : mode());
  if (window.matchMedia) { try { matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () { if (mode() === 'system') apply(system()); }); } catch (e) { /* old browsers */ } }
  function toggle() { setMode(root.getAttribute('data-theme') === 'light' ? 'dark' : 'light'); }
  function label(b) { b.setAttribute('aria-label', root.getAttribute('data-theme') === 'light' ? 'Switch to dark theme (purple)' : 'Switch to light theme (gold)'); }
  document.addEventListener('DOMContentLoaded', function () {
    apply(root.getAttribute('data-theme'));
    document.querySelectorAll('[data-theme-toggle]').forEach(function (b) { label(b); b.addEventListener('click', toggle); });
  });
  window.DracoTheme = { toggle: toggle, set: setMode, mode: mode };
})();
