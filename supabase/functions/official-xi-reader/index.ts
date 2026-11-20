import {parseHTML} from 'npm:linkedom@0.18.12';
import {readMatch} from './parser.mjs';
import profiles from './profiles.json' with {type:'json'};

const base=Deno.env.get('SUPABASE_URL')!;
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
async function rpc(action:string,ticket:string,data:unknown=null){
  const res=await fetch(base+'/rest/v1/rpc/official_xi_worker',{
    method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
    body:JSON.stringify({action,ticket,data}),signal:AbortSignal.timeout(10000)
  });
  if(!res.ok) throw Error('base_no_disponible');
  return await res.json();
}
const respond=(status:number)=>new Response(null,{status});
Deno.serve(async(req:Request)=>{
  if(req.method!=='POST') return respond(405);
  const ticket=req.headers.get('X-XI-Ticket')||'';
  if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(ticket)) return respond(401);
  try{
    const job=await rpc('claim',ticket);
    if(!job) return respond(401);
    let result;
    try{
      if(!/^https:\/\/www\.futbolfantasy\.com\/partidos\/[0-9]+-[a-z0-9-]+$/.test(job.fixture.source_url)) throw Error('url_invalida');
      const page=await fetch(job.fixture.source_url,{redirect:'error',signal:AbortSignal.timeout(18000),headers:{Accept:'text/html'}});
      if(!page.ok){
        const retry=page.headers.get('Retry-After')||'';
        const seconds=/^\d+$/.test(retry)?Number(retry):(Date.parse(retry)-Date.now())/1000;
        result={teams:{},reason:'http_'+page.status,retry_seconds:Number.isFinite(seconds)?Math.max(0,Math.ceil(seconds)):null};
        await page.body?.cancel();
      }else{
        const reader=page.body!.getReader(), decoder=new TextDecoder();
        let size=0, html='';
        for(;;){
          const {done,value}=await reader.read();
          if(done) break;
          size+=value.length;
          if(size>7000000){await reader.cancel();throw Error('pagina_demasiado_grande');}
          html+=decoder.decode(value,{stream:true});
        }
        html+=decoder.decode();
        const fetched_at=new Date().toISOString();
        result={...readMatch(parseHTML(html).document,job.fixture,job.roster,profiles),fetched_at};
      }
    }catch(error){
      const known=['estructura_inesperada','calendario_distinto','rivales_distintos','secciones_ambiguas','pagina_demasiado_grande','url_invalida'];
      const msg=error instanceof Error?error.message:'';
      result={teams:{},reason:known.includes(msg)?msg:'lectura_no_disponible'};
    }
    await rpc('finish',ticket,result);
    return respond(204);
  }catch{return respond(503);}
});
