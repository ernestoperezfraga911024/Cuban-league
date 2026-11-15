import {audience,verifyToken,decryptSession} from './security.mjs';
let keys:any[]=[];let keyTime=0;
async function getKeys(){
 if(!keys.length||Date.now()-keyTime>3600000){
  const r=await fetch('https://token.actions.githubusercontent.com/.well-known/jwks',{signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('identity_provider_unavailable');
  keys=(await r.json()).keys;keyTime=Date.now();
 }
 return keys;
}
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return json({error:'method_not_allowed'},405);
 let claims:any;
 try{claims=await verifyToken(req.headers.get('Authorization')?.replace(/^Bearer /,''),await getKeys());}catch{return json({error:'unauthorized'},401);}
 try{
  const reader=req.body?.getReader();if(!reader)throw Error('invalid_request');
  const chunks:Uint8Array[]=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4000000){await reader.cancel();throw Error('request_too_large');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  const body=JSON.parse(new TextDecoder().decode(bytes));
  if(!['begin','finish','fail'].includes(body.action))throw Error('invalid_action');
  const data=body.data||{};
  if(body.action==='begin')data.mode=claims.event_name==='schedule'?'sync':data.mode;
  const base=Deno.env.get('SUPABASE_URL')!;const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  if(base!=='https://pyahosamoisqcbpvzwka.supabase.co'||!key)throw Error('configuration_error');
  const response=await fetch(`${base}/rest/v1/rpc/mister_market_worker`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({p_action:body.action,p_run:`${claims.run_id}:${claims.run_attempt}`,p_sha:claims.sha,p_data:data}),signal:AbortSignal.timeout(60000)});
  if(!response.ok){const error=await response.json();return json({error:/^[a-z_]+$/.test(error.message)?error.message:'database_rejected'},409);}
  const result=await response.json();
  if(body.action==='begin'&&!result.skipped){
   // The Vault private key and sealed packet never leave this function.
   const {privateKey,sealedSession,...safe}=result;
   return json({...safe,storageState:await decryptSession(sealedSession,privateKey)});
  }
  return json(result);
 }catch{return json({error:'worker_request_failed'},500);}
});
