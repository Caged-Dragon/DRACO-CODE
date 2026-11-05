// Draco Code Project mode: Supabase data access. Every call runs as the signed-in user, so
// row-level security (see supabase/migrations/*_draco_projects.sql) decides what is visible.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./project-core.js'));
  else root.DracoProjectData = factory(root.DracoProjectCore);
})(typeof self !== 'undefined' ? self : this, function (core) {
  'use strict';

  function friendly(error, fallback) {
    var m = String((error && error.message) || '');
    if (/Project limit reached|at most 100|larger than 300 KB/i.test(m)) return m;
    if (/duplicate key|already exists/i.test(m)) return 'A file or folder with that name already exists.';
    if (/row-level security|permission denied|JWT/i.test(m)) return 'Your session expired. Sign in again to continue.';
    if (/path_check/i.test(m)) return 'That name is not allowed. Use letters, numbers, dot, dash and underscore.';
    if (/content_check/i.test(m)) return 'That file is larger than 100 KB.';
    if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Could not reach the database. Check your connection.';
    return fallback || m || 'Something went wrong. Please try again.';
  }
  function fail(error, fallback) { var e = new Error(friendly(error, fallback)); e.cause = error; throw e; }
  async function check(promise, fallback) { var r = await promise; if (r.error) fail(r.error, fallback); return r.data; }

  function create(client) {
    return {
      friendly: friendly,
      async listProjects() {
        return check(client.from('draco_projects').select('id,name,language,entry_path,updated_at').order('updated_at', { ascending: false }), 'Could not load your projects.');
      },
      async createProject(name, language) {
        var starter = core.STARTERS[language];
        if (!starter) throw new Error('Choose a language.');
        var project = await check(client.from('draco_projects').insert({ name: name.trim(), language: language, entry_path: starter.entry }).select('id,name,language,entry_path,updated_at').single(), 'Could not create the project.');
        try {
          await check(client.from('draco_project_files').insert(starter.files.map(function (f) { return { project_id: project.id, path: f.path, content: f.content }; })), 'Could not add the starter files.');
        } catch (e) {
          await client.from('draco_projects').delete().eq('id', project.id); // do not leave an empty shell behind
          throw e;
        }
        return project;
      },
      async loadFiles(projectId) {
        return check(client.from('draco_project_files').select('id,path,is_folder,content,updated_at').eq('project_id', projectId).order('path'), 'Could not load the project files.');
      },
      async renameProject(id, name) { await check(client.from('draco_projects').update({ name: name.trim() }).eq('id', id), 'Could not rename the project.'); },
      async deleteProject(id) { await check(client.from('draco_projects').delete().eq('id', id), 'Could not delete the project.'); },
      async setEntry(id, path) { await check(client.from('draco_projects').update({ entry_path: path }).eq('id', id), 'Could not set the entry file.'); },
      async createFile(projectId, path, content) {
        return check(client.from('draco_project_files').insert({ project_id: projectId, path: path, content: content || '' }).select('id,path,is_folder,content,updated_at').single(), 'Could not create the file.');
      },
      async createFolder(projectId, path) {
        return check(client.from('draco_project_files').insert({ project_id: projectId, path: path, is_folder: true }).select('id,path,is_folder,content,updated_at').single(), 'Could not create the folder.');
      },
      async saveFile(fileId, content) {
        var rows = await check(client.from('draco_project_files').update({ content: content }).eq('id', fileId).select('id'), 'Could not save the file.');
        if (!rows || !rows.length) throw new Error('This file no longer exists. Reload the project.');
      },
      async renamePath(projectId, oldPath, newPath) { await check(client.rpc('draco_rename_path', { p_project: projectId, p_old: oldPath, p_new: newPath }), 'Could not rename.'); },
      async deletePath(projectId, path) { await check(client.rpc('draco_delete_path', { p_project: projectId, p_path: path }), 'Could not delete.'); }
    };
  }
  return { create: create, friendly: friendly };
});
