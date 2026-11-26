export class AppError extends Error {
  constructor(public status:number,message:string){super(message);}
}
export function privateJson(value:unknown,status=200) {
  return Response.json(value,{status,headers:{'Cache-Control':'private, no-store','Pragma':'no-cache','Expires':'0'}});
}
export function errorResponse(error:unknown) {
  return error instanceof AppError?privateJson({error:error.message},error.status):privateJson({error:'The operation could not be completed. Try again.'},503);
}
export function requireOrigin(request:Request) {
  const origin=request.headers.get('origin');
  if(!origin||origin!==new URL(request.url).origin)throw new AppError(403,'A same-origin request is required.');
}
export async function boundedText(request:Request,maxBytes:number) {
  if(Number(request.headers.get('content-length'))>maxBytes)throw new AppError(413,'Request too large.');
  const reader=request.body?.getReader();if(!reader)return '';
  let bytes=0;const chunks:Uint8Array[]=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>maxBytes)throw new AppError(413,'Request too large.');chunks.push(value);}}
  finally{await reader.cancel();}
  return Buffer.concat(chunks).toString('utf8');
}
