import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';

test('Postgres RLS isolates documents, embeddings, files and chat; limits are shared and atomic',async()=>{
 const pg=await PGlite.create({extensions:{vector}});
 try{
  await pg.exec(`create role authenticated nologin;create role service_role bypassrls nologin;create role anon nologin;
   revoke usage on schema public from public;
   create schema auth;create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema auth to authenticated,service_role;
   create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid primary key,bucket_id text,name text,created_at timestamptz default now()-interval '2 hours');
   alter table storage.objects enable row level security;
   create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
   grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;
  `);
  await pg.exec(await readFile('supabase/migrations/202611260001_private_workspace.sql','utf8'));
  // Older Supabase projects can grant anon explicit function execution by default.
  await pg.exec('grant execute on all functions in schema public to anon');
  const repair=await readFile('supabase/migrations/202611260002_setup_access.sql','utf8');
  await pg.exec(repair);await pg.exec(repair); // Idempotent on an existing installation.
  const reports=await pg.exec(await readFile('supabase/verify-setup.sql','utf8'));
  assert.ok(reports[0].rows.every((row:Record<string,unknown>)=>row.exists&&row.rls_enabled));
  assert.ok(reports[1].rows.every((row:Record<string,unknown>)=>row.public_schema_usage&&row.extensions_schema_usage));
  assert.ok(reports[2].rows.every((row:Record<string,unknown>)=>row.expected_execute===row.actual_execute));
  assert.match(String(reports[3].rows[0].embedding_column_type),/vector\(1024\)/);
  const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',c='33333333-3333-4333-8333-333333333333';
  const doc='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',conversation='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  await pg.query('insert into auth.users values($1),($2),($3)',[a,b,c]);
  await pg.query('insert into public.app_members values($1,true),($2,true)',[a,b]);
  async function user(id:string){await pg.exec('reset role');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await pg.exec('set role authenticated');}
  await user(a);
  await pg.query(`insert into rag_documents(id,owner_id,title,filename,sha256,storage_path,embedding_model) values($1,$2,'Private fare research','notes.txt',repeat('a',64),$3,'test-model')`,[doc,a,`${a}/${doc}/notes.txt`]);
  const embedding=JSON.stringify([1,...Array(1023).fill(0)]);
  await pg.query('select commit_document($1,$2::jsonb)',[doc,JSON.stringify([{ordinal:0,content:'Private fare research only for user A',start:0,end:38,embedding}])]);
  await pg.query('select save_chat_turn($1,$2,$3,$4::jsonb)',[conversation,'Fare question','Private answer [1]','[]']);
  await pg.query('insert into storage.objects(id,bucket_id,name) values($1,$2,$3)',[doc,'rag-private',`${a}/${doc}/notes.txt`]);
  assert.equal((await pg.query('select * from search_private_chunks($1,$2::extensions.vector,$3,5)',['fare',embedding,'test-model'])).rows.length,1);
  await user(b);
  for(const table of ['rag_documents','rag_chunks','conversations','messages','storage.objects'])assert.equal((await pg.query('select * from '+table)).rows.length,0,table);
  assert.equal((await pg.query('select * from search_private_chunks($1,$2::extensions.vector,$3,5)',['fare',embedding,'test-model'])).rows.length,0);
  assert.equal((await pg.query('delete from rag_documents where id=$1 returning id',[doc])).rows.length,0);
  await assert.rejects(pg.query('insert into rag_documents(id,owner_id,title,filename,sha256,storage_path,embedding_model) values($1,$2,$3,$4,$5,$6,$7)',
   ['cccccccc-cccc-4ccc-8ccc-cccccccccccc',a,'Forged','x.txt','b'.repeat(64),`${a}/forged`,'test-model']));
  await assert.rejects(pg.query('select save_chat_turn($1,$2,$3,$4::jsonb)',[conversation,'attack','forged','[]']));
  const limits=await Promise.all(Array.from({length:20},()=>pg.query<{consume_app_limit:boolean}>("select consume_app_limit('chat')")));
  assert.equal(limits.filter(result=>result.rows[0].consume_app_limit).length,15);
  await user(c);assert.equal((await pg.query<{is_app_member:boolean}>('select is_app_member()')).rows[0].is_app_member,false);
  assert.equal((await pg.query<{consume_app_limit:boolean}>("select consume_app_limit('chat')")).rows[0].consume_app_limit,false);
  await assert.rejects(pg.query('select consume_public_limit($1)',['a'.repeat(64)]));
  await assert.rejects(pg.query('select * from orphan_private_objects()'));
  await user(a);await pg.query("update rag_documents set expires_at=now()-interval '1 day' where id=$1",[doc]);
  assert.equal((await pg.query('select * from search_private_chunks($1,$2::extensions.vector,$3,5)',['fare',embedding,'test-model'])).rows.length,0);
  await pg.query("update conversations set expires_at=now()-interval '1 day' where id=$1",[conversation]);
  assert.equal((await pg.query('select * from messages')).rows.length,0);
  await pg.exec('reset role');await pg.query('update app_members set enabled=false where user_id=$1',[a]);
  await user(a);assert.equal((await pg.query('select * from rag_documents')).rows.length,0);assert.equal((await pg.query('select * from storage.objects')).rows.length,0);
  await pg.exec('reset role');await pg.query('update app_members set enabled=true where user_id=$1',[a]);
  await pg.exec('set role service_role');
  const publicLimits=await Promise.all(Array.from({length:20},()=>pg.query<{consume_public_limit:boolean}>('select consume_public_limit($1)',['a'.repeat(64)])));
  assert.equal(publicLimits.filter(result=>result.rows[0].consume_public_limit).length,15);
  await user(a);await pg.query("update rag_documents set status='deleting' where id=$1",[doc]);
  assert.equal((await pg.query('select * from rag_chunks')).rows.length,0);
  await pg.query('delete from rag_documents where id=$1',[doc]);
  await pg.exec('reset role');assert.equal((await pg.query('select * from rag_chunks')).rows.length,0);
  await pg.exec('set role service_role');assert.equal((await pg.query('select * from orphan_private_objects()')).rows.length,1);
 }finally{await pg.close();}
});
