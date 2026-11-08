\set ON_ERROR_STOP off
-- ===== DIRTY legacy data BEFORE the migration (as real users could have created) =====
insert into auth.users values ('00000000-0000-0000-0000-0000000000c1'),('00000000-0000-0000-0000-0000000000c2') on conflict do nothing;
insert into draco_user_languages(user_id,language) values ('00000000-0000-0000-0000-0000000000c1','java') on conflict do nothing;
insert into draco_user_packages(user_id,language,package_name,package_version) values
 ('00000000-0000-0000-0000-0000000000c1','python','numpy',''),
 ('00000000-0000-0000-0000-0000000000c1','python','NumPy',''),           -- case duplicate
 ('00000000-0000-0000-0000-0000000000c1','python','bad name; rm -rf /',''), -- unusable
 ('00000000-0000-0000-0000-0000000000c1','python','pandas','1 2'),        -- bad version
 ('00000000-0000-0000-0000-0000000000c1','c','libsqlite3-dev',''),        -- c not installed for this user
 ('00000000-0000-0000-0000-0000000000c1','java','org.json:json:20240303','');
select 'legacy rows before' t, count(*) from draco_user_packages where user_id='00000000-0000-0000-0000-0000000000c1';
\i supabase/migrations/20261106090000_draco_packages_hardening.sql
\i supabase/migrations/20261106090000_draco_packages_hardening.sql
select 'after migration (x2 run), survivors' t, string_agg(language||':'||package_name, ', ' order by language, package_name) from draco_user_packages where user_id='00000000-0000-0000-0000-0000000000c1';
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-0000000000c2';
select '--- user c2 (the page): add language + packages exactly like the browser ---' t;
insert into draco_user_languages(user_id,language) values (auth.uid(),'java');
select 'java lang added' t, count(*)=1 ok from draco_user_languages;
insert into draco_user_packages(user_id,language,package_name,package_version) values (auth.uid(),'python','requests','');
insert into draco_user_packages(language,package_name) values ('python','pandas');          -- no user_id: default auth.uid()
insert into draco_user_packages(user_id,language,package_name,package_version) values (auth.uid(),'javascript','@scope/pkg','1.2.3');
insert into draco_user_packages(user_id,language,package_name,package_version) values (auth.uid(),'java','com.google.code.gson:gson:2.11.0','');
select 'valid adds accepted (4)' t, count(*)=4 ok from draco_user_packages;
select 'REJECT invalid python name' t; insert into draco_user_packages(language,package_name) values ('python','bad name');
select 'REJECT shell metacharacters' t; insert into draco_user_packages(language,package_name) values ('python','x;rm -rf /');
select 'REJECT case duplicate' t; insert into draco_user_packages(language,package_name) values ('python','Requests');
select 'REJECT bad version' t; insert into draco_user_packages(language,package_name,package_version) values ('python','flask','1.0 beta');
select 'REJECT java non-coordinates' t; insert into draco_user_packages(language,package_name) values ('java','notcoords');
select 'REJECT c package not in catalogue' t; insert into draco_user_languages(language) values ('c'); insert into draco_user_packages(language,package_name) values ('c','libfoo-dev');
select 'ACCEPT c catalogue package once language added' t; insert into draco_user_packages(language,package_name) values ('c','libsqlite3-dev');
select 'REJECT cpp package when cpp language NOT added' t; insert into draco_user_packages(language,package_name) values ('cpp','libfmt-dev');
select 'REJECT unknown language' t; insert into draco_user_packages(language,package_name) values ('ruby','rails');
do $$ begin for i in 1..20 loop begin insert into draco_user_packages(language,package_name) values ('python','pkg'||i); exception when others then null; end; end loop; end $$;
select 'python capped at 20 per language' t, count(*)=20 ok from draco_user_packages where language='python';
select 'REJECT 21st python package (friendly message)' t; insert into draco_user_packages(language,package_name) values ('python','onetoomany');
select 'removing the C language removes its packages' t; delete from draco_user_languages where language='c'; select count(*)=0 ok from draco_user_packages where language='c';
select 'other user c1 untouched / invisible to c2' t, (select count(*) from draco_user_packages where user_id='00000000-0000-0000-0000-0000000000c1')=0 ok;
select 'user_id spoof rejected by RLS' t; insert into draco_user_packages(user_id,language,package_name) values ('00000000-0000-0000-0000-0000000000c1','python','spoof');
reset role; set role anon; select 'anon denied' t; select * from draco_user_packages;
