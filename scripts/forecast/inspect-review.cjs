'use strict';
// Read-only evidence index. It neither validates a fixture nor chooses players.
const fs=require('node:fs'),crypto=require('node:crypto');
const {JSDOM,VirtualConsole}=require('jsdom');
const catalog=require('../../catalog/players.json').players;
const clean=node=>node?.textContent.replace(/\s+/g,' ').trim()||'';
const direct=node=>[...(node?.childNodes||[])].filter(n=>n.nodeType===3).map(clean).join(' ').trim();
const pct=value=>/^\d{1,3}%?$/.test(value||'')&&Number(value.replace('%',''))<=100?Number(value.replace('%','')):null;
const key=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const unique=rows=>[...new Map(rows.map(r=>[JSON.stringify(r),r])).values()];
const signals=text=>[
 ['available',/disponible para|alta m[eé]dica/i],['doubt',/duda|tocado|molestias|pendiente de evoluci[oó]n/i],
 ['out',/\bbaja\b|lesionado|sancionado|rotura|fuera de la convocatoria/i],
 ['partial_training',/una parte con el grupo|parcial|parte del entrenamiento/i]
].filter(([,re])=>re.test(text)).map(([signal])=>signal);
function parseSource(source,body,{side}){
 const dom=new JSDOM(body,{virtualConsole:new VirtualConsole()});
 try{
  const d=dom.window.document;d.querySelectorAll('script,style,nav,footer').forEach(n=>n.remove());
  const result={title:d.title,fixture_text:[],health:[],news:[],alternative_pairs:[],scope:null};
  const fixtureSelector=source==='futbolfantasy'?'.fecha':source==='jornadaperfecta'?'.partido-marcador-jornada,time':source==='comuniate_team'?'h1,.cm-match__date':source==='comuniate'?'h1,.label-jornada-slim,.cm-match-context__description':'h1,time';
  result.fixture_text=unique([...d.querySelectorAll(fixtureSelector)].map(n=>({text:clean(n),datetime:n.getAttribute('datetime')})).filter(n=>n.text&&n.text.length<240));
  if(source==='p11match')result.fixture_text.push(...[...d.querySelectorAll('p')].map(clean).filter(text=>/Consulta las alineaciones/.test(text)&&/Fecha:/.test(text)&&text.length<600).map(text=>({text,datetime:null})));
  if(source==='futbolfantasy'){
   const root=d.querySelector(`.match-p11-side.row-${side}`),widgets=[...d.querySelectorAll(`.physical-status-widget.${side}`)];
   const teamId=root?.getAttribute('data-match-p11-team');
   const benches=[...d.querySelectorAll(`.match-p11-suplentes-side.${side}`)].filter(n=>!teamId||n.getAttribute('data-match-p11-team')===teamId);
   result.scope={lineup_found:!!root,health_sections:widgets.length,bench_sections:benches.length,side};
   for(const widget of widgets)for(const row of widget.querySelectorAll('.elemento')){
    const name=clean(row.querySelector('.jugador')),text=clean(row.querySelector('.datos')||row);
    if(name)result.health.push({name,text,signals:signals(text),links:[...row.querySelectorAll('a[href]')].map(a=>({label:clean(a),url:a.getAttribute('href')}))});
   }
   const cards=[...(root?.querySelectorAll('[data-onceff="titular"],[data-onceff="suplente"]')||[]),...benches.flatMap(n=>[...n.querySelectorAll('[data-onceff="suplente"]')])];
   for(const cell of cards.filter(n=>n.dataset.onceff==='titular')){
    const names=[...cell.querySelectorAll('.truncate-name')].map(clean),starter=names[0];
    for(const alternative of names.slice(1)){
     const probabilities=[...new Set(cards.filter(n=>clean(n.querySelector('.truncate-name'))===alternative).map(n=>pct(n.querySelector('a[data-probabilidad]')?.getAttribute('data-probabilidad'))).filter(n=>n!==null))];
     result.alternative_pairs.push({starter,alternative,probability:probabilities.length===1?probabilities[0]:null,observed_probabilities:probabilities,
      probability_ambiguous:probabilities.length>1,probability_origin:'same_side_player_card',x:cell.dataset.onceffX||null,y:cell.dataset.onceffY||null});
    }
   }
  }else if(source==='jornadaperfecta'){
   const field=d.querySelectorAll('.campo-futbol')[side==='local'?0:1],news=[...d.querySelectorAll(`.partido-ultimas-noticias.${side}`)];
   result.scope={lineup_found:!!field,news_sections:news.length,side};
   for(const section of news)for(const li of section.querySelectorAll('li')){
    const a=li.querySelector('a[href]'),title=clean(a?.querySelector('span'))||clean(a),age=clean(li.querySelector('.partido-ultimas-noticias-fecha'));
    if(a&&title)result.news.push({title,age,url:a.getAttribute('href'),signals:signals(title)});
   }
   [...(field?.querySelectorAll('table')||[])].forEach((table,y)=>{
    const cells=[...table.querySelectorAll('.campo-fila')];
    cells.forEach((cell,i)=>{
     const starter=clean(cell.querySelector('.player-name-pintar > a'));
     for(const alt of cell.querySelectorAll('.alternatives-container .alternative')){
      const label=clean(alt),match=label.match(/(?:^|\s)(\d{1,3})%\s*$/);
      const alternative=(clean(alt.querySelector('.player-name-pintar > a'))||clean(alt.querySelector('a[title]'))||label).replace(/\s+\d{1,3}%\s*$/,'');
      if(alternative)result.alternative_pairs.push({starter,alternative,probability:match?pct(match[1]):null,x:100*(i+.5)/cells.length,y});
     }
    });
   });
  }else if(source==='comuniate_team'||source==='comuniate'){
   const columns=[...d.querySelectorAll('.cm-lineup-col')];
   const root=source==='comuniate_team'?d:columns.length===2?columns[side==='local'?0:1]:null;
   result.scope={team_page:source==='comuniate_team',lineup_columns:columns.length,health_scope_found:!!root,side};
   for(const row of root?.querySelectorAll('.ficha-player')||[]){
    const name=clean(row.querySelector('.player-name')),text=clean(row.querySelector('.player-row')||row);
    const labels=[...row.querySelectorAll('.player-status-icon[alt]')].map(n=>n.getAttribute('alt'));
    const detected=signals(text+' '+labels.join(' '));
    if(name&&detected.length)result.health.push({name,text,status_labels:labels,signals:detected});
   }
   for(const cell of root?.querySelectorAll('.cuerpo_campo .jugador_campo')||[]){
    const starter=direct(cell.querySelector('.nombre_jugador'));
    for(const alt of cell.querySelectorAll('.alternativo')){
     const label=clean(alt),match=label.match(/(?:^|\s)(\d{1,3})%\s*$/);
     result.alternative_pairs.push({starter,alternative:label.replace(/\s*\d{1,3}%\s*$/,'').trim(),probability:match?pct(match[1]):null});
    }
   }
  }
  result.health=unique(result.health);result.news=unique(result.news);result.alternative_pairs=unique(result.alternative_pairs);
  return result;
 }finally{dom.window.close();}
}
function inspectReview(request,{review=null,readFile=path=>fs.readFileSync(path),catalogPlayers=catalog}={}){
 const p=request.packet,side=p.team===p.expected_fixture?.home?'local':'visitante';
 const roster=request.roster||[],byId=new Map(roster.map(r=>[r.id,r]));
 const resolve=name=>{const same=roster.filter(r=>r.name===name),id=review?.identities?.[name]??(same.length===1?same[0].id:null);return byId.has(id)?id:null;};
 const report={team:p.team,planned_fixture:p.expected_fixture,fixture_verified:false,correction:request.correction||null,
  observations:p.observations,layouts:Object.fromEntries(Object.entries(p.layouts||{}).map(([k,v])=>[k,{sha256:v.sha256,points:v.points}])),
  identities:request.identity_names,roster:roster.map(r=>{const c=catalogPlayers.find(c=>c.id===r.id&&c.club_id===p.team);return {...r,catalog_position_hint:c?.position||null,profile_url:c?.mister_source?.url||c?.source?.url||null};}),
  identity_reference:request.identity_reference,sources:[],potential_availability_conflicts:[],alternative_checks:[],errors:[...(p.errors||[])],
  limitations:['Texto e indicios extraídos, no verificación semántica ni confirmación médica.','Una sección ausente no acredita ausencia de bajas.','Las posiciones del catálogo son pistas amplias: no invalidan una pareja táctica documentada.','Las contradicciones solo se agrupan por nombre normalizado o identidad explícita; ausencia de alerta no prueba acuerdo.']};
 const records=[];
 for(const source of ['futbolfantasy','jornadaperfecta','comuniate','comuniate_team','p11match']){
  const doc=p.docs?.[source];if(!doc)continue;
  try{
   const bytes=readFile(doc.path),sha=crypto.createHash('sha256').update(bytes).digest('hex');
   if(sha!==doc.sha256)throw Error('Body hash mismatch; inspect original captured file');
   const value={source,url:doc.url,sha256:doc.sha256,fetched_at:doc.fetched_at,...parseSource(source,bytes.toString('utf8'),{side})};
   for(const row of value.health){row.resolved_id=resolve(row.name);records.push({...row,source});}
   for(const row of value.alternative_pairs){row.starter_id=resolve(row.starter);row.alternative_id=resolve(row.alternative);}
   for(const row of value.news){
    row.literal_name_mentions=(request.identity_names||[]).filter(name=>name&&(' '+key(row.title)+' ').includes(' '+key(name)+' '));
    for(const name of row.literal_name_mentions)records.push({name,resolved_id:resolve(name),source,text:row.title,signals:row.signals});
   }
   report.sources.push(value);
  }catch(error){report.errors.push({source,kind:'inspection_error',message:error.message});}
 }
 const groups=new Map();
 for(const r of records){const id=r.resolved_id?'id:'+r.resolved_id:'name:'+key(r.name);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(r);}
 for(const [group,evidence] of groups){
  const observed=new Set(evidence.flatMap(r=>r.signals));
  if(observed.has('out')&&['available','doubt','partial_training'].some(s=>observed.has(s)))report.potential_availability_conflicts.push({group,resolved_id:evidence.find(r=>r.resolved_id)?.resolved_id||null,requires_review:true,evidence});
 }
 for(const choice of Array.isArray(review?.selection?.players)?review.selection.players:[]){
  if(!choice?.alternative_id)continue;
  const evidence=report.sources.flatMap(s=>s.alternative_pairs.filter(pair=>
   pair.starter_id===choice.id&&pair.alternative_id===choice.alternative_id||pair.starter_id===choice.alternative_id&&pair.alternative_id===choice.id
  ).map(pair=>({source:s.source,sha256:s.sha256,fetched_at:s.fetched_at,...pair})));
  report.alternative_checks.push({player_id:choice.id,alternative_id:choice.alternative_id,
   player_position_hint:report.roster.find(p=>p.id===choice.id)?.catalog_position_hint||null,
   alternative_position_hint:report.roster.find(p=>p.id===choice.alternative_id)?.catalog_position_hint||null,
   direct_pair_evidence:evidence,requires_tactical_explanation:!evidence.length,
   note:'Se comprueba la compatibilidad editorial si esta alternativa es necesaria tras el cálculo; una ausencia de pareja directa no prueba incompatibilidad.'});
 }
 const ballots=new Map();for(const prediction of p.predictions||[]){const names=prediction.data?.participacion?.map(x=>x.nombre?.trim()).sort()||[];const k=JSON.stringify([prediction.status,names]);if(!ballots.has(k))ballots.set(k,{status:prediction.status,names,author_ids:[]});ballots.get(k).author_ids.push(prediction.author_id);}
 report.ballots=[...ballots.values()];
 return report;
}
if(require.main===module){
 try{
  const request=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  const raw=process.argv[3]?JSON.parse(fs.readFileSync(process.argv[3],'utf8')):null;
  process.stdout.write(JSON.stringify(inspectReview(request,{review:raw?.result||raw}))+'\n');
 }catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
module.exports={inspectReview,parseSource};
