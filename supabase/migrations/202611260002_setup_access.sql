-- Existing PR #8 installations: run this complete file once in SQL Editor.
-- Safe to rerun. It changes access grants, not document contents or ownership.
begin;
grant usage on schema public,extensions to authenticated,service_role;

-- Be explicit: defaults differ between older and newer Supabase projects.
revoke all on public.app_members,public.rag_documents,public.rag_chunks,
 public.conversations,public.messages,public.request_limits,
 public.public_request_limits,public.incident_archive from anon;
grant select on public.app_members,public.incident_archive to authenticated;
grant select,insert,update,delete on public.rag_documents,public.conversations to authenticated;
grant select,insert on public.rag_chunks,public.messages to authenticated;
grant usage,select on sequence public.rag_chunks_id_seq,public.messages_id_seq to authenticated;
grant all on public.app_members,public.rag_documents,public.rag_chunks,
 public.conversations,public.messages,public.request_limits,
 public.public_request_limits,public.incident_archive to service_role;
grant usage,select on all sequences in schema public to service_role;

revoke all on function public.is_app_member(),public.commit_document(uuid,jsonb),
 public.search_private_chunks(text,extensions.vector,text,int),
 public.save_chat_turn(uuid,text,text,jsonb),public.consume_app_limit(text)
 from public,anon,authenticated;
grant execute on function public.is_app_member(),public.commit_document(uuid,jsonb),
 public.search_private_chunks(text,extensions.vector,text,int),
 public.save_chat_turn(uuid,text,text,jsonb),public.consume_app_limit(text)
 to authenticated;

revoke all on function public.consume_public_limit(text),public.orphan_private_objects()
 from public,anon,authenticated;
grant execute on function public.consume_public_limit(text),public.orphan_private_objects()
 to service_role;

-- Refresh PostgREST after grants/functions were installed.
notify pgrst,'reload schema';
commit;
