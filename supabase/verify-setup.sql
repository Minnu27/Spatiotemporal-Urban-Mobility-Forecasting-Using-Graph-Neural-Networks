-- Read-only setup checks. Run in Supabase SQL Editor. No keys or source text.
select expected.name as table_name,to_regclass('public.'||expected.name) is not null as exists,
 coalesce(c.relrowsecurity,false) as rls_enabled
from (values('app_members'),('rag_documents'),('rag_chunks'),('conversations'),('messages'),
 ('request_limits'),('public_request_limits'),('incident_archive')) expected(name)
left join pg_class c on c.oid=to_regclass('public.'||expected.name);

select role_name,has_schema_privilege(role_name,'public','usage') as public_schema_usage,
 has_schema_privilege(role_name,'extensions','usage') as extensions_schema_usage
from (values('authenticated'),('service_role')) roles(role_name);

select signature,role_name,expected_execute,
 case when to_regprocedure(signature) is null then false
 else has_function_privilege(role_name,to_regprocedure(signature),'execute') end as actual_execute
from (values
 ('public.consume_public_limit(text)','service_role',true),
 ('public.consume_public_limit(text)','authenticated',false),
 ('public.consume_public_limit(text)','anon',false),
 ('public.orphan_private_objects()','service_role',true),
 ('public.orphan_private_objects()','authenticated',false),
 ('public.orphan_private_objects()','anon',false),
 ('public.consume_app_limit(text)','authenticated',true),
 ('public.consume_app_limit(text)','anon',false)
) checks(signature,role_name,expected_execute);

select format_type(atttypid,atttypmod) as embedding_column_type
from pg_attribute where attrelid=to_regclass('public.rag_chunks') and attname='embedding';
