// Validation for multi-file project runs (Project mode). Pure functions, no I/O.
export const PROJECT_LIMITS = { files: 100, fileBytes: 100_000, totalBytes: 300_000 };
const PATH_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*(\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/;
const EXT = {
  python: ['.py'], javascript: ['.js', '.mjs', '.cjs'], java: ['.java'],
  c: ['.c'], cpp: ['.cpp', '.cc', '.cxx'],
};
export const HEADER_EXT = ['.h', '.hpp', '.hh'];
export const extOf = (p) => { const i = p.lastIndexOf('.'); return i > 0 ? p.slice(i).toLowerCase() : ''; };
export const isSource = (language, p) => (EXT[language] || []).includes(extOf(p));

// Returns { files, entry } or { error }.
export function validateProject(language, files, entry) {
  if (!EXT[language]) return { error: 'Unsupported language.' };
  if (!Array.isArray(files) || !files.length) return { error: 'A project run needs at least one file.' };
  if (files.length > PROJECT_LIMITS.files) return { error: `A project can run at most ${PROJECT_LIMITS.files} files.` };
  const seen = new Set(); let total = 0; const clean = [];
  for (const f of files) {
    if (!f || typeof f.path !== 'string' || typeof f.content !== 'string') return { error: 'Each file needs a path and content.' };
    if (f.path.length > 200 || !PATH_RE.test(f.path)) return { error: `Invalid file path: ${f.path.slice(0, 60)}` };
    if (seen.has(f.path)) return { error: `Duplicate file path: ${f.path}` };
    const bytes = Buffer.byteLength(f.content, 'utf8');
    if (bytes > PROJECT_LIMITS.fileBytes) return { error: `${f.path} is larger than 100 KB.` };
    total += bytes; seen.add(f.path); clean.push({ path: f.path, content: f.content });
  }
  if (total > PROJECT_LIMITS.totalBytes) return { error: 'Project is larger than 300 KB.' };
  if (typeof entry !== 'string' || !seen.has(entry)) return { error: 'Choose an entry file that exists in the project.' };
  if (!isSource(language, entry)) return { error: `The entry file must be a ${EXT[language].join(' / ')} file.` };
  if (!clean.some((f) => isSource(language, f.path) && f.content.trim())) return { error: 'No code to run.' };
  return { files: clean, entry, totalBytes: total };
}

// Fully-qualified Java main class for the entry file (honours a package declaration).
export function javaMainClass(entry, content) {
  const stem = entry.split('/').pop().replace(/\.java$/i, '');
  const m = /^\s*package\s+([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)\s*;/m.exec(content.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''));
  return m ? `${m[1]}.${stem}` : stem;
}
