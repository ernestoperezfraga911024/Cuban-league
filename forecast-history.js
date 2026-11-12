/* Public history is loaded only when opened; club and metric changes use local data. */
(() => {
 'use strict';
 const section=document.getElementById('forecasts'),panel=document.getElementById('forecastHistoryPanel');if(!section||!panel)return;
 const $=id=>document.getElementById(id),core=window.CubanForecastHistoryCore,round=window.CubanForecastRoundCore,teams=round.config.teams;
 const summaryColumns='team,fixture_key,season,matchday,home,away,kickoff_at,status,hits,verification_stage';
 const detailColumns=summaryColumns+',prediction,prediction_published_at,cutoff_at,official_starters,correct_ids,missed_ids,unexpected_starters,verified_at,source_url,published_at';
 let selected='real-madrid',matchday=13,metric='round',active=false,sequence=0,controller,catalog=null,summaries=null,details=[];
 const requested=new URL(location.href).searchParams.get('forecast_team');if(teams.some(t=>t.id===requested))selected=requested;
 const club=id=>teams.find(t=>t.id===id),date=value=>value?new Intl.DateTimeFormat('es',{dateStyle:'short',timeStyle:'short',timeZone:'America/New_York'}).format(new Date(value))+' Miami':'Pendiente';
 function el(tag,text,cls){const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;}
 function crest(team){const img=el('img');img.src=team.crest;img.alt='';img.width=28;img.height=32;img.decoding='async';img.addEventListener('error',()=>img.remove(),{once:true});return img;}
 function portrait(player){
  const box=el('span',null,'fh-portrait'),initials=el('span',player.name.split(/\s+/).slice(0,2).map(x=>x[0]).join(''),'fh-initials');box.setAttribute('aria-hidden','true');box.append(initials);
  const photo=catalog?.playersById?.get(player.id)?.photo;
  if(photo&&(/^catalog\/faces\/[a-z0-9-]+\.webp$/.test(photo)||/^https:\/\/cdn-mister\.mundodeportivo\.com\/file\/cdn-common\/players\/\d+\.png(?:\?version=\d+)?$/.test(photo))){const img=el('img');img.src=photo;img.alt='';img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';img.addEventListener('load',()=>{initials.hidden=true;});img.addEventListener('error',()=>{img.remove();initials.hidden=false;},{once:true});box.append(img);}
  return box;
 }
 function clubScores(){
  for(const button of $('forecastHistoryClubs').querySelectorAll('[data-history-team]')){
   const stats=core.aggregate(summaries||[],button.dataset.historyTeam,metric==='round'?matchday:null),score=button.querySelector('.fh-club-score');score.textContent=core.percentage(stats.percentage);
   button.setAttribute('aria-pressed',String(button.dataset.historyTeam===selected));
   button.setAttribute('aria-label',club(button.dataset.historyTeam).name+', '+(stats.matches?score.textContent+' de acierto, '+stats.matches+' partidos evaluados':'sin partidos evaluados'));
   button.title=stats.matches?stats.hits+'/'+stats.total+' titulares · '+stats.matches+' partidos':'Pendiente de comparación';
  }
  $('forecastHistoryMetricNote').textContent=metric==='round'?'Acierto de titulares · Jornada '+matchday:'Acierto acumulado desde la J13 · Solo partidos evaluados';
 }
 function note(text){$('forecastHistoryStatus').textContent=text;}
 function render(){
  clubScores();const host=$('forecastHistoryBody');host.replaceChildren();const row=details.find(r=>r.team===selected);
  if(!row){host.append(el('p','Todavía no hay historial público de '+club(selected).name+' para esta jornada.','fh-empty'));return;}
  core.detail(row);
  const card=el('article',null,'fp-card fh-card'),header=el('header',null,'fp-match');header.append(el('span','HISTORIAL · JORNADA '+row.matchday,'fp-eyebrow'));
  const title=el('h2'),match=el('span',null,'fp-match-title');for(const id of [row.home,row.away]){if(match.children.length)match.append(el('span','vs','fp-versus'));const team=el('span',null,'fp-match-team');team.append(crest(club(id)),el('span',club(id).name));match.append(team);}title.append(match);header.append(title,el('p',date(row.kickoff_at),'fp-meta'));
  const label=row.status==='pending'?'Pendiente de once confirmado':row.status==='no_prediction'?'Sin pronóstico comparable':row.verification_stage==='final'?'Comparación final verificada':'Comparación inicial · pendiente de revisión final';header.append(el('p',label,'fh-state'));card.append(header);
  const layout=el('div',null,'fh-layout');
  if(row.prediction){
   const pitch=el('div',null,'fp-field fh-field');pitch.setAttribute('aria-label','Pronóstico guardado de '+club(row.team).name);pitch.append(el('span',row.prediction.formation,'fp-formation'));const markings=el('span',null,'fp-markings');markings.setAttribute('aria-hidden','true');pitch.append(markings);
   for(const slots of round.lines(row.prediction.formation).reverse()){
    const line=el('div',null,'fp-line');for(const slot of slots){const player=row.prediction.players.find(x=>x.slot===slot),state=row.status==='evaluated'?(row.correct_ids.includes(player.id)?'hit':'miss'):'pending',node=el('div',null,'fh-player fh-'+state);const photo=portrait(player);const badge=el('span',state==='hit'?'✓':state==='miss'?'×':'·','fh-result');badge.setAttribute('aria-hidden','true');photo.append(badge);node.append(photo,el('span',player.name,'fp-name'),el('span',player.probability+'% previsto','fh-original-prob'),el('span',state==='hit'?'Acierto: fue titular':state==='miss'?'Fallo: no fue titular':'Pendiente de verificar','fh-sr'));line.append(node);}pitch.append(line);
   }
   const legend=el('p',null,'fh-legend');legend.append(el('span','✓ Acierto','fh-positive'),el('span','× No fue titular','fh-negative'));pitch.append(legend);layout.append(pitch);
  }else layout.classList.add('fh-no-pitch');
  const side=el('section',null,'fh-result-panel'),evaluated=row.status==='evaluated';side.append(el('span','ACIERTOS DEL PRONÓSTICO','fp-eyebrow'),el('strong',evaluated?core.percentage(100*row.hits/11):'—','fh-accuracy'),el('p',evaluated?row.hits+' de 11 titulares':'Este partido todavía no puntúa.','fh-count'));
  if(evaluated){
   const bar=el('div',null,'fh-score-bar');bar.setAttribute('aria-hidden','true');for(let n=0;n<11;n++)bar.append(el('i',null,n<row.hits?'fh-hit':'fh-miss'));side.append(bar);
   const counts=el('div',null,'fh-counts');counts.append(el('span','✓ '+row.hits+' aciertos','fh-positive'),el('span','× '+(11-row.hits)+' fallos','fh-negative'));side.append(counts);
   if(row.missed_ids.length){side.append(el('h3','Diferencias con el oficial'));for(const id of row.missed_ids){const player=row.prediction.players.find(x=>x.id===id);side.append(el('p','× '+player.name+' · No titular','fh-difference'));}side.append(el('h4','Titulares no previstos'));const replacements=el('div',null,'fh-chips');for(const player of row.unexpected_starters)replacements.append(el('span',player.name));side.append(replacements);}
   else side.append(el('p','Los once jugadores previstos fueron titulares.','fh-positive'));
   const link=el('a','Ver once confirmado en FutbolFantasy','fp-link');link.href=core.sourceUrl(row.source_url);link.target='_blank';link.rel='noopener noreferrer';side.append(link);
  }else side.append(el('p',row.status==='no_prediction'?'No se conserva un pronóstico válido anterior al cierre preventivo. Se excluye del porcentaje de acierto.':'Se comparará cuando se verifiquen los once titulares. La ausencia de datos no cuenta como fallo.','fp-meta'));
  const cumulative=core.aggregate(summaries||[],selected);side.append(el('p','Desde la J13: '+core.percentage(cumulative.percentage)+' · '+cumulative.matches+' partidos evaluados'+(cumulative.initial?' · '+cumulative.initial+' con revisión final pendiente':''),'fh-total'));
  layout.append(side);card.append(layout);
  const foot=el('div',null,'fh-evidence');foot.append(el('p','Pronóstico publicado: '+date(row.prediction_published_at)),el('p','Cierre preventivo: '+date(row.cutoff_at)+' · Como máximo, dos horas antes del partido.'),el('p','Once real consultado: '+date(row.verified_at)));
  const explanation=el('details');explanation.append(el('summary','Cómo se mide el acierto'),el('p','Se conserva el último pronóstico publicado antes del cierre preventivo. Se compara quién empezó como titular; entrar desde el banquillo no cuenta. Acierto = titulares acertados ÷ 11. El acumulado suma los aciertos de todos los partidos evaluados. Los porcentajes previstos de cada jugador se conservan y no son el porcentaje de acierto.'));foot.append(explanation);card.append(foot);host.append(card);
 }
 async function request(columns,signal,day){const config=window.CUBAN_LEAGUE_SUPABASE;if(!config?.url||!config.publishableKey)throw Error('Conexión no disponible');const url=new URL(config.url+'/rest/v1/forecast_history_public');const params={select:columns,season:'eq.2026-27',order:'matchday.asc,team.asc',limit:day===undefined?'521':'21'};if(day!==undefined)params.matchday='eq.'+day;url.search=new URLSearchParams(params);const r=await fetch(url,{headers:{apikey:config.publishableKey},cache:'no-store',signal});if(!r.ok)throw Error('No se pudo leer el historial');return r.json();}
 async function load(){
  controller?.abort();controller=new AbortController();const current=++sequence,abort=controller,day=matchday;const timeout=setTimeout(()=>abort.abort(),15000);
  details=[];summaries=null;$('forecastHistoryBody').replaceChildren();clubScores();note('Consultando el historial publicado.');$('forecastPublicReload').disabled=true;panel.setAttribute('aria-busy','true');
  try{
   const [summary,full]=await Promise.all([request(summaryColumns,abort.signal),request(detailColumns,abort.signal,day)]);
   core.rows(summary);core.rows(full,true);if(full.length>20||full.some(r=>r.matchday!==day))throw Error('Jornada incorrecta');
   if(current!==sequence||!active)return;summaries=summary;details=full;
   if(!catalog)try{catalog=await window.CubanLeaguePlayerCatalog.load();}catch{/* Initials preserve player identity. */}
   if(current!==sequence||!active)return;render();note('Jornada '+day+' · '+full.filter(r=>r.status==='evaluated').length+' equipos evaluados · '+full.filter(r=>r.status==='pending').length+' pendientes'+(full.some(r=>r.status==='no_prediction')?' · '+full.filter(r=>r.status==='no_prediction').length+' sin pronóstico comparable':''));
  }catch{if(current===sequence&&active){summaries=null;details=[];clubScores();$('forecastHistoryBody').replaceChildren();note('No se pudo verificar el historial. Pulsa Actualizar para reintentar.');}}
  finally{clearTimeout(timeout);if(current===sequence){$('forecastPublicReload').disabled=false;panel.setAttribute('aria-busy','false');}}
 }
 function chooseView(view){document.body.dataset.forecastView=view;const history=view==='history';$('forecastCurrentPanel').hidden=history;panel.hidden=!history;$('forecastViewCurrent').setAttribute('aria-pressed',String(!history));$('forecastViewHistory').setAttribute('aria-pressed',String(history));$('forecastPublicTitle').textContent=history?'Historial de alineaciones':'Alineaciones probables';$('forecastPublicSubtitle').textContent=history?'LaLiga 2026/27 · Desde la jornada 13':'El once previsto, jugador a jugador.';}
 function observe(){const next=document.body.dataset.section==='forecasts'&&document.body.dataset.forecastView==='history';if(next&&!active){active=true;load(true);}else if(!next&&active){active=false;sequence++;controller?.abort();summaries=null;details=[];$('forecastHistoryBody').replaceChildren();clubScores();$('forecastPublicReload').disabled=false;panel.setAttribute('aria-busy','false');}}
 for(let n=13;n<=38;n++){const option=el('option','Jornada '+n);option.value=String(n);$('forecastHistoryRound').append(option);}
 for(const team of [...teams].sort((a,b)=>a.name.localeCompare(b.name,'es'))){const button=el('button');button.type='button';button.dataset.historyTeam=team.id;button.setAttribute('aria-controls','forecastHistoryBody');button.append(el('strong','—','fh-club-score'),crest(team),el('span',team.name,'fh-club-name'));button.addEventListener('click',()=>{selected=team.id;render();document.dispatchEvent(new CustomEvent('forecast:team-selected',{detail:{team:selected}}));});$('forecastHistoryClubs').append(button);}
 $('forecastHistoryRound').addEventListener('change',()=>{matchday=Number($('forecastHistoryRound').value);if(active)load();});
 for(const [id,value] of [['forecastHistoryThisRound','round'],['forecastHistoryAccumulated','all']])$(id).addEventListener('click',()=>{metric=value;$('forecastHistoryThisRound').setAttribute('aria-pressed',String(value==='round'));$('forecastHistoryAccumulated').setAttribute('aria-pressed',String(value==='all'));clubScores();});
 $('forecastViewCurrent').addEventListener('click',()=>chooseView('current'));$('forecastViewHistory').addEventListener('click',()=>chooseView('history'));
 $('forecastPublicReload').addEventListener('click',()=>{if(active)load(true);});document.addEventListener('visibilitychange',()=>{if(active&&!document.hidden)load(true);});
 document.addEventListener('forecast:team-selected',e=>{if(teams.some(t=>t.id===e.detail?.team)){selected=e.detail.team;if(active)render();}});
 new MutationObserver(observe).observe(document.body,{attributes:true,attributeFilter:['data-section','data-forecast-view']});chooseView('current');clubScores();observe();
})();
