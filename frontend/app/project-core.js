// Draco Code Project mode: pure logic (no DOM, no network). Loaded by the browser and by tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DracoProjectCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // These mirror the database constraints (supabase/migrations/*_draco_projects.sql) and the backend (lib/project.js).
  var LIMITS = { projects: 25, entries: 100, fileBytes: 100000, totalBytes: 300000, nameLength: 80 };
  var PATH_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*(\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/;
  var LANGS = ['python', 'javascript', 'java', 'c', 'cpp'];
  var LABELS = { python: 'Python', javascript: 'JavaScript', java: 'Java', c: 'C', cpp: 'C++' };
  var SOURCE_EXT = { python: ['.py'], javascript: ['.js', '.mjs', '.cjs'], java: ['.java'], c: ['.c'], cpp: ['.cpp', '.cc', '.cxx'] };
  var HL = { '.py': 'python', '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.java': 'java', '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hh': 'cpp' };

  function ext(p) { var i = p.lastIndexOf('.'); return i > 0 ? p.slice(i).toLowerCase() : ''; }
  function baseName(p) { return p.slice(p.lastIndexOf('/') + 1); }
  function parentPath(p) { var i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }
  function joinPath(dir, name) { return dir ? dir + '/' + name : name; }
  function highlightLang(p) { return HL[ext(p)] || 'text'; }
  function isSource(language, p) { return (SOURCE_EXT[language] || []).indexOf(ext(p)) !== -1; }

  // Returns an error message, or '' when the path is valid.
  function pathError(p) {
    if (!p) return 'Enter a name.';
    if (p.length > 200) return 'That path is too long (200 characters max).';
    if (!PATH_RE.test(p)) return 'Use letters, numbers, dot, dash and underscore. Names cannot start with a dot or dash.';
    if (p.split('/').length > 8) return 'Folders can be nested at most 8 levels deep.';
    return '';
  }

  // rows: [{path, is_folder}] -> nested tree, folders first, then A-Z. Implicit parent folders are created.
  function buildTree(rows) {
    var rootNode = { name: '', path: '', folder: true, children: [] }, index = { '': rootNode };
    function ensureFolder(path) {
      if (index[path]) return index[path];
      var parent = ensureFolder(parentPath(path)), node = { name: baseName(path), path: path, folder: true, children: [] };
      parent.children.push(node); index[path] = node; return node;
    }
    rows.slice().sort(function (a, b) { return a.path < b.path ? -1 : 1; }).forEach(function (row) {
      if (row.is_folder) { ensureFolder(row.path); return; }
      var parent = ensureFolder(parentPath(row.path));
      parent.children.push({ name: baseName(row.path), path: row.path, folder: false, id: row.id });
    });
    (function sort(n) {
      n.children.sort(function (a, b) { return a.folder !== b.folder ? (a.folder ? -1 : 1) : a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
      n.children.forEach(function (c) { if (c.folder) sort(c); });
    })(rootNode);
    return rootNode;
  }

  function defaultEntry(language, files) {
    var names = { python: ['main.py'], javascript: ['main.js', 'index.js'], java: ['Main.java'], c: ['main.c'], cpp: ['main.cpp'] }[language] || [];
    var paths = files.map(function (f) { return f.path; });
    for (var i = 0; i < names.length; i++) if (paths.indexOf(names[i]) !== -1) return names[i];
    var any = paths.filter(function (p) { return isSource(language, p); }).sort()[0];
    return any || null;
  }

  // Multi-file starters on purpose: they show the project actually spans files. Every one prints `expected`.
  var STARTERS = {
    python: { entry: 'main.py', expected: 'Hello, Draco!\n5 + 7 = 12\n', files: [
      { path: 'main.py', content: 'from utils import greet, add\n\nprint(greet("Draco"))\nprint("5 + 7 =", add(5, 7))\n' },
      { path: 'utils.py', content: 'def greet(name):\n    return f"Hello, {name}!"\n\n\ndef add(a, b):\n    return a + b\n' }] },
    javascript: { entry: 'main.js', expected: 'Hello, Draco!\n5 + 7 = 12\n', files: [
      { path: 'main.js', content: 'const { greet, add } = require("./utils");\n\nconsole.log(greet("Draco"));\nconsole.log("5 + 7 =", add(5, 7));\n' },
      { path: 'utils.js', content: 'function greet(name) {\n  return `Hello, ${name}!`;\n}\n\nfunction add(a, b) {\n  return a + b;\n}\n\nmodule.exports = { greet, add };\n' }] },
    java: { entry: 'Main.java', expected: 'Hello, Draco!\n5 + 7 = 12\n', files: [
      { path: 'Main.java', content: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println(Greeter.greet("Draco"));\n        System.out.println("5 + 7 = " + Greeter.add(5, 7));\n    }\n}\n' },
      { path: 'Greeter.java', content: 'public class Greeter {\n    static String greet(String name) {\n        return "Hello, " + name + "!";\n    }\n\n    static int add(int a, int b) {\n        return a + b;\n    }\n}\n' }] },
    c: { entry: 'main.c', expected: 'Hello, Draco!\n5 + 7 = 12\n', files: [
      { path: 'main.c', content: '#include <stdio.h>\n#include "greet.h"\n\nint main(void) {\n    greet("Draco");\n    printf("5 + 7 = %d\\n", add(5, 7));\n    return 0;\n}\n' },
      { path: 'greet.h', content: '#ifndef GREET_H\n#define GREET_H\n\nvoid greet(const char *name);\nint add(int a, int b);\n\n#endif\n' },
      { path: 'greet.c', content: '#include <stdio.h>\n#include "greet.h"\n\nvoid greet(const char *name) {\n    printf("Hello, %s!\\n", name);\n}\n\nint add(int a, int b) {\n    return a + b;\n}\n' }] },
    cpp: { entry: 'main.cpp', expected: 'Hello, Draco!\n5 + 7 = 12\n', files: [
      { path: 'main.cpp', content: '#include <iostream>\n#include "greeter.hpp"\n\nint main() {\n    std::cout << greet("Draco") << std::endl;\n    std::cout << "5 + 7 = " << add(5, 7) << std::endl;\n    return 0;\n}\n' },
      { path: 'greeter.hpp', content: '#pragma once\n#include <string>\n\nstd::string greet(const std::string &name);\nint add(int a, int b);\n' },
      { path: 'greeter.cpp', content: '#include "greeter.hpp"\n\nstd::string greet(const std::string &name) {\n    return "Hello, " + name + "!";\n}\n\nint add(int a, int b) {\n    return a + b;\n}\n' }] }
  };

  // Turn compiler / interpreter output into clickable problems: [{file, line, col, severity, message}].
  function parseDiagnostics(language, text, knownFiles) {
    var out = [], seen = {}, known = knownFiles || null, lines = String(text || '').split('\n');
    function clean(f) { f = String(f).replace(/^(\.\/)+/, '').replace(/^.*\/proj\//, ''); return f; }
    function ok(f) { return !known || known.indexOf(f) !== -1; }
    function add(file, line, col, severity, message) {
      file = clean(file); if (!ok(file)) return;
      var key = file + ':' + line + ':' + col + ':' + message; if (seen[key]) return; seen[key] = 1;
      out.push({ file: file, line: Number(line), col: col ? Number(col) : 1, severity: severity, message: String(message).trim() });
    }
    var m, i;
    for (i = 0; i < lines.length; i++) {
      var l = lines[i];
      if ((m = /^(.+?):(\d+):(\d+):\s*(fatal error|error|warning):\s*(.+)$/.exec(l))) add(m[1], m[2], m[3], m[4] === 'warning' ? 'warning' : 'error', m[5]); // gcc / g++
      else if ((m = /^(.+?\.java):(\d+):\s*(error|warning):\s*(.+)$/.exec(l))) add(m[1], m[2], 1, m[3], m[4]); // javac
      else if ((m = /^\s*File "(.+?)", line (\d+)/.exec(l)) && language === 'python') { // python traceback: message is the next non-indented line
        var j = i + 1; while (j < lines.length && /^\s/.test(lines[j])) j++;
        var msg = lines[j] || 'Error';
        // keep the innermost frame in a project file: later frames overwrite by being added last
        add(m[1], m[2], 1, 'error', msg);
      } else if ((m = /^(?:\s*at .*?\()?(.+?\.(?:m|c)?js):(\d+)(?::(\d+))?\)?$/.exec(l)) && language === 'javascript') {
        var k = i + 1; var body = '';
        for (; k < lines.length && k < i + 8; k++) if (/^\w*Error\b/.test(lines[k])) { body = lines[k]; break; }
        add(m[1], m[2], m[3] || 1, 'error', body || 'Error');
      }
    }
    return out;
  }

  return { LIMITS: LIMITS, PATH_RE: PATH_RE, LANGS: LANGS, LABELS: LABELS, STARTERS: STARTERS, ext: ext, baseName: baseName, parentPath: parentPath, joinPath: joinPath, highlightLang: highlightLang, isSource: isSource, pathError: pathError, buildTree: buildTree, defaultEntry: defaultEntry, parseDiagnostics: parseDiagnostics };
});
