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


  // ---------- search across project files (literal text) ----------
  // files: [{path, content}] -> [{path, line, col, text}] (max 300), grouped by file order then line.
  function searchFiles(files, query, opts) {
    opts = opts || {}; var out = [], q = String(query || ''); if (!q) return out;
    var needle = opts.caseSensitive ? q : q.toLowerCase();
    var list = files.slice().sort(function (a, b) { return a.path < b.path ? -1 : 1; });
    for (var f = 0; f < list.length; f++) {
      var lines = String(list[f].content).split('\n');
      for (var i = 0; i < lines.length; i++) {
        var hay = opts.caseSensitive ? lines[i] : lines[i].toLowerCase(), from = 0, at;
        while ((at = hay.indexOf(needle, from)) !== -1) {
          var from0 = lines[i].length > 200 ? Math.max(0, at - 60) : 0;
          out.push({ path: list[f].path, line: i + 1, col: at + 1, length: needle.length, start: at - from0, text: lines[i].length > 200 ? lines[i].slice(from0, at + 140) : lines[i] });
          if (out.length >= 300) return out;
          from = at + Math.max(1, needle.length);
        }
      }
    }
    return out;
  }

  // ---------- upload helpers ----------
  function sanitizeUploadName(name) {
    var base = String(name || '').split(/[\\/]/).pop().replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^[._-]+/, '').slice(0, 120);
    return base || null;
  }
  function looksLikeText(s) { return String(s).indexOf('\u0000') === -1 && String(s).indexOf('\uFFFD') === -1; }

  // ---------- ZIP (store method, UTF-8 names) so a project can be downloaded without any library ----------
  var CRC_TABLE = (function () { var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(bytes) { var c = 0xFFFFFFFF; for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  // files: [{path, content}] -> Uint8Array
  function makeZip(files, when) {
    var enc = new TextEncoder(), d = when || new Date();
    var dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    var dosDate = (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    var parts = [], central = [], offset = 0;
    function u16(v) { return [v & 255, (v >>> 8) & 255]; } function u32(v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }
    files.forEach(function (f) {
      var name = enc.encode(f.path), data = enc.encode(f.content), crc = crc32(data);
      var local = [].concat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      parts.push(new Uint8Array(local), name, data);
      central.push({ name: name, crc: crc, size: data.length, offset: offset });
      offset += local.length + name.length + data.length;
    });
    var cdStart = offset, cdSize = 0;
    central.forEach(function (e) {
      var h = [].concat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate), u32(e.crc), u32(e.size), u32(e.size), u16(e.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(e.offset));
      parts.push(new Uint8Array(h), e.name); cdSize += h.length + e.name.length;
    });
    parts.push(new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(cdSize), u32(cdStart), u16(0))));
    var total = parts.reduce(function (n, p) { return n + p.length; }, 0), out = new Uint8Array(total), at = 0;
    parts.forEach(function (p) { out.set(p, at); at += p.length; });
    return out;
  }

  return { LIMITS: LIMITS, PATH_RE: PATH_RE, LANGS: LANGS, LABELS: LABELS, STARTERS: STARTERS, ext: ext, baseName: baseName, parentPath: parentPath, joinPath: joinPath, highlightLang: highlightLang, isSource: isSource, pathError: pathError, buildTree: buildTree, defaultEntry: defaultEntry, parseDiagnostics: parseDiagnostics, searchFiles: searchFiles, sanitizeUploadName: sanitizeUploadName, looksLikeText: looksLikeText, crc32: crc32, makeZip: makeZip };
});
