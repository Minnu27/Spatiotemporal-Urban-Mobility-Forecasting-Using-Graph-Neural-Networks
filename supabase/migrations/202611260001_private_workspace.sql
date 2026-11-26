-- Run once in a new Supabase project's SQL editor as the database owner.
create schema if not exists extensions;
create extension if not exists vector with schema extensions;
grant usage on schema public,extensions to authenticated,service_role;

create table public.app_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true
);
alter table public.app_members enable row level security;
create policy members_read_self on public.app_members for select to authenticated using(user_id=auth.uid());
grant select on public.app_members to authenticated;
create function public.is_app_member() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.app_members where user_id=auth.uid() and enabled)
$$;
revoke all on function public.is_app_member() from public,anon;
grant execute on function public.is_app_member() to authenticated;

create table public.rag_documents (
  id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check(length(title) between 1 and 180),
  filename text not null check(length(filename) between 1 and 180),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  storage_path text not null, embedding_model text not null,
  status text not null default 'indexing' check(status in ('indexing','ready','deleting')),
  created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '90 days',
  unique(id,owner_id),unique(owner_id,sha256,embedding_model),
  check(storage_path like owner_id::text||'/%')
);
create table public.rag_chunks (
  id bigint generated always as identity primary key,
  document_id uuid not null,owner_id uuid not null,
  ordinal int not null check(ordinal>=0),content text not null check(length(content) between 1 and 2500),
  start_offset int not null,end_offset int not null,
  embedding extensions.vector(1024) not null,embedding_model text not null,
  search_text tsvector generated always as(to_tsvector('english',content)) stored,
  foreign key(document_id,owner_id) references public.rag_documents(id,owner_id) on delete cascade,
  unique(document_id,ordinal)
);
create index rag_chunks_owner on public.rag_chunks(owner_id,document_id);
create index rag_chunks_text on public.rag_chunks using gin(search_text);
alter table public.rag_documents enable row level security;
alter table public.rag_chunks enable row level security;
create policy documents_owner on public.rag_documents for all to authenticated
  using(owner_id=auth.uid() and public.is_app_member()) with check(owner_id=auth.uid() and public.is_app_member());
create policy chunks_read_owner on public.rag_chunks for select to authenticated using(
  owner_id=auth.uid() and public.is_app_member() and exists(select 1 from public.rag_documents d
    where d.id=document_id and d.owner_id=auth.uid() and d.status='ready' and d.expires_at>now())
);
create policy chunks_write_owner on public.rag_chunks for insert to authenticated
  with check(owner_id=auth.uid() and public.is_app_member());
grant select,insert,update,delete on public.rag_documents to authenticated;
grant select,insert on public.rag_chunks to authenticated;
grant usage,select on sequence public.rag_chunks_id_seq to authenticated;
grant usage on schema extensions to authenticated;

create function public.commit_document(p_id uuid,p_chunks jsonb) returns void
language plpgsql security invoker set search_path=public,extensions as $$
declare d public.rag_documents;
begin
  select * into d from public.rag_documents where id=p_id and owner_id=auth.uid() and status='indexing' for update;
  if not found or not public.is_app_member() then raise exception 'Document unavailable'; end if;
  if jsonb_array_length(p_chunks) not between 1 and 80 then raise exception 'Invalid chunk count';end if;
  insert into public.rag_chunks(document_id,owner_id,ordinal,content,start_offset,end_offset,embedding,embedding_model)
    select d.id,auth.uid(),(c->>'ordinal')::int,c->>'content',(c->>'start')::int,(c->>'end')::int,
      (c->>'embedding')::extensions.vector,d.embedding_model from jsonb_array_elements(p_chunks) c;
  update public.rag_documents set status='ready' where id=d.id;
end $$;
revoke all on function public.commit_document(uuid,jsonb) from public,anon;
grant execute on function public.commit_document(uuid,jsonb) to authenticated;

create function public.search_private_chunks(p_query text,p_vector extensions.vector(1024),p_model text,p_limit int default 5)
returns table(chunk_id bigint,document_id uuid,title text,content text,ordinal int,score double precision)
language sql stable security invoker set search_path=public,extensions as $$
  with eligible as materialized (
    select c.*,d.title from public.rag_chunks c join public.rag_documents d on d.id=c.document_id
    where c.owner_id=auth.uid() and d.owner_id=auth.uid() and public.is_app_member()
      and d.status='ready' and d.expires_at>now() and c.embedding_model=p_model
  ), semantic as (
    select id,row_number() over(order by embedding<=>p_vector) as rank
    from eligible where 1-(embedding<=>p_vector)>=0.25 order by embedding<=>p_vector limit 20
  ), lexical as (
    select id,row_number() over(order by ts_rank(search_text,plainto_tsquery('english',p_query)) desc) as rank
    from eligible where search_text@@plainto_tsquery('english',p_query)
    order by ts_rank(search_text,plainto_tsquery('english',p_query)) desc limit 20
  ), fused as (
    select coalesce(s.id,l.id) id,coalesce(1.0/(60+s.rank),0)+coalesce(1.0/(60+l.rank),0) score
    from semantic s full join lexical l using(id)
  ) select e.id,e.document_id,e.title,e.content,e.ordinal,f.score::double precision
    from fused f join eligible e on e.id=f.id order by f.score desc,e.id limit least(greatest(p_limit,1),8)
$$;
revoke all on function public.search_private_chunks(text,extensions.vector,text,int) from public,anon;
grant execute on function public.search_private_chunks(text,extensions.vector,text,int) to authenticated;

create table public.conversations (
  id uuid primary key,owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check(length(title)<=120),created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '30 days',
  unique(id,owner_id)
);
create table public.messages (
  id bigint generated always as identity primary key,conversation_id uuid not null,owner_id uuid not null,
  role text not null check(role in ('user','assistant')),body text not null check(length(body)<=20000),
  citations jsonb not null default '[]',created_at timestamptz not null default now(),
  foreign key(conversation_id,owner_id) references public.conversations(id,owner_id) on delete cascade
);
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
create policy conversations_owner on public.conversations for all to authenticated
  using(owner_id=auth.uid() and public.is_app_member()) with check(owner_id=auth.uid() and public.is_app_member());
create policy messages_owner on public.messages for all to authenticated
  using(owner_id=auth.uid() and public.is_app_member() and exists(select 1 from public.conversations c where c.id=conversation_id and c.expires_at>now()))
  with check(owner_id=auth.uid() and public.is_app_member());
grant select,insert,update,delete on public.conversations to authenticated;
grant select,insert on public.messages to authenticated;
grant usage,select on sequence public.messages_id_seq to authenticated;
create function public.save_chat_turn(p_id uuid,p_question text,p_answer text,p_citations jsonb) returns void
language plpgsql security invoker set search_path=public as $$
begin
  if not public.is_app_member() then raise exception 'Unauthorized';end if;
  insert into public.conversations(id,owner_id,title) values(p_id,auth.uid(),left(p_question,120)) on conflict(id) do nothing;
  perform 1 from public.conversations where id=p_id and owner_id=auth.uid() and expires_at>now() for update;
  if not found then raise exception 'Conversation unavailable';end if;
  if (select count(*) from public.messages where conversation_id=p_id)>=200 then raise exception 'Conversation full';end if;
  insert into public.messages(conversation_id,owner_id,role,body,citations) values
    (p_id,auth.uid(),'user',p_question,'[]'),(p_id,auth.uid(),'assistant',p_answer,p_citations);
  update public.conversations set updated_at=now() where id=p_id;
end $$;
revoke all on function public.save_chat_turn(uuid,text,text,jsonb) from public,anon;
grant execute on function public.save_chat_turn(uuid,text,text,jsonb) to authenticated;

create table public.request_limits (
  owner_id uuid not null references auth.users(id) on delete cascade,scope text not null,
  window_at timestamptz not null,used int not null,primary key(owner_id,scope,window_at)
);
alter table public.request_limits enable row level security;
create function public.consume_app_limit(p_scope text) returns boolean
language plpgsql security definer set search_path=public as $$
declare limit_per_minute int;limit_per_day int;n int;
begin
  if not public.is_app_member() then return false;end if;
  case p_scope when 'chat' then limit_per_minute:=15;limit_per_day:=500;
    when 'upload' then limit_per_minute:=3;limit_per_day:=30;
    when 'read' then limit_per_minute:=60;limit_per_day:=3000;
    else return false;end case;
  delete from public.request_limits where window_at<now()-interval '2 days';
  insert into public.request_limits values(auth.uid(),p_scope,date_trunc('minute',now()),1)
    on conflict(owner_id,scope,window_at) do update set used=request_limits.used+1
    where request_limits.used<limit_per_minute returning used into n;
  if n is null then return false;end if;
  n:=null;
  insert into public.request_limits values(auth.uid(),p_scope||':day',date_trunc('day',now()),1)
    on conflict(owner_id,scope,window_at) do update set used=request_limits.used+1
    where request_limits.used<limit_per_day returning used into n;
  return n is not null;
end $$;
revoke all on function public.consume_app_limit(text) from public,anon;
grant execute on function public.consume_app_limit(text) to authenticated;

-- Only the server may consume anonymous limits; no raw IP addresses are stored.
create table public.public_request_limits (
  client_hash text not null,window_at timestamptz not null,used int not null,
  primary key(client_hash,window_at)
);
alter table public.public_request_limits enable row level security;
create function public.consume_public_limit(p_hash text) returns boolean
language plpgsql security definer set search_path=public as $$
declare n int;begin
 if p_hash !~ '^[a-f0-9]{64}$' then return false;end if;
 delete from public.public_request_limits where window_at<now()-interval '2 days';
 insert into public.public_request_limits values(p_hash,date_trunc('minute',now()),1)
 on conflict(client_hash,window_at) do update set used=public_request_limits.used+1
 where public_request_limits.used<15 returning used into n;
 return n is not null;
end $$;
revoke all on function public.consume_public_limit(text) from public,anon,authenticated;
grant execute on function public.consume_public_limit(text) to service_role;

create table public.incident_archive (
  fingerprint text primary key,source_id text not null,payload jsonb not null,
  fetched_at timestamptz not null,expires_at timestamptz not null default now()+interval '30 days',
  search_text tsvector generated always as(to_tsvector('english',coalesce(payload->>'title','')||' '||coalesce(payload->>'description',''))) stored
);
create index incident_archive_search on public.incident_archive using gin(search_text);
alter table public.incident_archive enable row level security;
create policy incidents_member_read on public.incident_archive for select to authenticated using(public.is_app_member());
grant select on public.incident_archive to authenticated;

-- Private originals; access requires an approved user AND their own path prefix.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('rag-private','rag-private',false,131072,array['text/plain','text/markdown'])
 on conflict(id) do update set public=false,file_size_limit=131072,allowed_mime_types=array['text/plain','text/markdown'];
create policy private_files_owner on storage.objects for all to authenticated
  using(bucket_id='rag-private' and (storage.foldername(name))[1]=auth.uid()::text and public.is_app_member())
  with check(bucket_id='rag-private' and (storage.foldername(name))[1]=auth.uid()::text and public.is_app_member());

-- Access for maintenance only. This key must never be NEXT_PUBLIC_*.
grant all on public.app_members,public.rag_documents,public.rag_chunks,public.conversations,public.messages,
 public.request_limits,public.public_request_limits,public.incident_archive to service_role;
grant usage,select on all sequences in schema public to service_role;

-- Storage API performs deletion; SQL only identifies orphaned object names.
-- Includes account-deletion orphans and direct uploads without document metadata.
create function public.orphan_private_objects() returns table(storage_path text)
language sql stable security definer set search_path=public as $$
 select o.name from storage.objects o left join public.rag_documents d on d.storage_path=o.name
 where o.bucket_id='rag-private' and d.id is null and o.created_at<now()-interval '1 hour'
 order by o.created_at limit 50
$$;
revoke all on function public.orphan_private_objects() from public,anon,authenticated;
grant execute on function public.orphan_private_objects() to service_role;

-- RLS remains the row boundary; anonymous callers also have no table grants.
revoke all on public.app_members,public.rag_documents,public.rag_chunks,public.conversations,
 public.messages,public.request_limits,public.public_request_limits,public.incident_archive from anon;
