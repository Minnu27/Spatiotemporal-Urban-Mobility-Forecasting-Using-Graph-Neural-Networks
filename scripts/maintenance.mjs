// Run hourly from a trusted scheduler. Never log the bearer secret.
const base=process.env.URBANFLOW_URL,token=process.env.MAINTENANCE_TOKEN;
if(!base||!token){console.error('Set URBANFLOW_URL and MAINTENANCE_TOKEN.');process.exit(1);}
const url=new URL('/api/maintenance',base);
if(url.protocol!=='https:'&&url.hostname!=='localhost'){console.error('Use an HTTPS deployment URL.');process.exit(1);}
try{
 const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(65000)});
 if(!response.ok||response.status===207)throw Error('Maintenance incomplete; inspect the protected endpoint and retry.');
 const data=await response.json();console.log(JSON.stringify(data));
}catch{console.error('Maintenance failed. Check configuration and database/storage availability; retry to finish cleanup.');process.exit(1);}
