create role anon nologin; create role authenticated nologin;
create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema auth to authenticated, anon; grant usage on schema public to authenticated, anon;
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b');
\i supabase/migrations/20261105090000_draco_projects.sql
\i supabase/migrations/20261105090000_draco_projects.sql
\set ON_ERROR_STOP off
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
insert into draco_projects(name,language) values ('A-proj','python') returning id \gset a_
select 'A created project' as t, :'a_id' is not null as ok;
insert into draco_project_files(project_id,path,content) values (:'a_id','main.py','print(1)'),(:'a_id','src/util.py','x=1');
insert into draco_project_files(project_id,path,is_folder) values (:'a_id','src',true);
select 'A files' t, count(*)=3 ok from draco_project_files;
select 'bad path rejected (..)' t; insert into draco_project_files(project_id,path) values (:'a_id','../etc');
select 'bad path rejected (leading dot)' t; insert into draco_project_files(project_id,path) values (:'a_id','.env');
select 'folder w/ content rejected' t; insert into draco_project_files(project_id,path,is_folder,content) values (:'a_id','d',true,'x');
select 'dup path rejected' t; insert into draco_project_files(project_id,path) values (:'a_id','main.py');
select 'rename folder' t; select draco_rename_path(:'a_id','src','lib');
select 'renamed ok' t, count(*)=2 ok from draco_project_files where path in ('lib','lib/util.py');
select 'sibling-prefix not touched' t; insert into draco_project_files(project_id,path) values (:'a_id','lib2.py'); select draco_rename_path(:'a_id','lib','pkg'); select count(*)=1 ok from draco_project_files where path='lib2.py';
select 'delete folder' t; select draco_delete_path(:'a_id','pkg'); select count(*)=2 ok from draco_project_files;
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000b';
select 'B sees nothing' t, (select count(*) from draco_projects)=0 and (select count(*) from draco_project_files)=0 ok;
select 'B cannot insert into A project' t; insert into draco_project_files(project_id,path) values (:'a_id','evil.py');
select 'B cannot spoof user_id' t; insert into draco_projects(user_id,name,language) values ('00000000-0000-0000-0000-00000000000a','x','python');
select 'B update/delete A = 0 rows' t; with u as (update draco_projects set name='hax' where id=:'a_id' returning 1), d as (delete from draco_project_files where project_id=:'a_id' returning 1) select (select count(*) from u)=0 and (select count(*) from d)=0 ok;
select 'B rename A path = 0 rows' t; select draco_rename_path(:'a_id','main.py','stolen.py');
reset role; select 'A data intact' t, (select name from draco_projects where id=:'a_id')='A-proj' and exists(select 1 from draco_project_files where path='main.py') ok;
set role anon; select 'anon denied' t; select * from draco_projects;
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
select 'oversize file rejected' t; insert into draco_project_files(project_id,path,content) values (:'a_id','big.txt',repeat('x',100001));
select 'project size cap (300KB)' t; insert into draco_project_files(project_id,path,content) select :'a_id','f'||g||'.txt',repeat('x',90000) from generate_series(1,4) g;
select 'cap leaves <=3 big files' t, count(*) filter (where path like 'f%')=3 ok from draco_project_files;
reset role; select 'updated_at bumped' t, (select updated_at from draco_projects where id=:'a_id') > (select created_at from draco_projects where id=:'a_id') ok;
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
do $$ begin for i in 2..25 loop insert into draco_projects(name,language) values ('p'||i,'c'); end loop; end $$;
select '26th project rejected' t; insert into draco_projects(name,language) values ('p26','c');
select 'delete project cascades' t; delete from draco_projects where id=:'a_id'; select count(*)=0 ok from draco_project_files where project_id=:'a_id';
