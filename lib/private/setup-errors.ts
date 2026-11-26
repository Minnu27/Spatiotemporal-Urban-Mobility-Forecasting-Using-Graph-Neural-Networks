export type SetupIssue={code:string;message:string;action:string};
// Error bodies can contain URLs, headers or provider detail. Only mapped,
// constant messages leave this boundary; never return or log a raw error.
export function databaseIssue(error:unknown,status?:number):SetupIssue{
 const source=error&&typeof error==='object'?error as {code?:unknown;message?:unknown}:{};
 const code=typeof source.code==='string'?source.code:'';
 const message=typeof source.message==='string'?source.message:'';
 if(status===401||code==='PGRST301'||/invalid api key|invalid jwt|jwt expired/i.test(message))
  return {code:'database_credentials',message:'Supabase rejected the credentials.',action:'Check the project URL and matching project keys. The server key must be sb_secret_ or a legacy service_role key. Redeploy after saving.'};
 if(code==='PGRST202'||code==='42883')return {code:'database_function_missing',message:'A required database function is missing or its schema cache is stale.',action:'Apply the initial workspace migration if it has not run, then apply 202611260002_setup_access.sql and reload the PostgREST schema.'};
 if(code==='PGRST205'||code==='42P01')return {code:'database_table_missing',message:'A required workspace table is missing.',action:'Run the initial 202611260001_private_workspace.sql migration on the intended Supabase project.'};
 if(code==='42501'||status===403)return {code:'database_permissions',message:'The database role cannot access a required schema, table or function.',action:'Apply 202611260002_setup_access.sql. Check that the server key belongs to this project and has service_role access.'};
 return {code:'database_unavailable',message:'The database request could not be completed.',action:'Check Supabase project availability, Data API settings and project credentials, then retry.'};
}
