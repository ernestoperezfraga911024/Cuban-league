const clubs = {
  'athletic-club':['athletic'], 'fc-barcelona':['barcelona'], 'rayo-vallecano':['rayo','rayo-vallecano'],
  'atletico-madrid':['atletico','atletico-de-madrid'], 'real-betis':['betis','real-betis'],
  'deportivo-la-coruna':['deportivo','deportivo-la-coruna'], 'racing-santander':['racing','racing-santander'],
  'celta-vigo':['celta','celta-de-vigo']
};
const clean = text => text.trim().replace(/\s+/g,' ');
const norm = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
function one(node, selector) {
  const matches=node.querySelectorAll(selector);
  if(matches.length!==1) throw Error('estructura_inesperada');
  return matches[0];
}
export function readMatch(document, fixture, roster, profiles) {
  const head=one(document,'.encabezado-partido');
  const league=clean(one(head,'.fecha strong').textContent);
  const date=new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(fixture.kickoff_at));
  const p=Object.fromEntries(date.map(x=>[x.type,x.value]));
  const dates=[...head.querySelectorAll('.fecha')].map(x=>clean(x.textContent));
  if(league!=='LaLiga '+fixture.season.replace(/-(\d\d)$/,'/$1')+' - Jornada '+fixture.matchday ||
     !dates.some(x=>x.includes(p.day+' de '+p.month+' del '+p.year+' a las '+p.hour+':'+p.minute+'h'))) throw Error('calendario_distinto');
  const sides=[['local',fixture.home],['visitante',fixture.away]];
  for(const [side,team] of sides){
    const link=one(head,'.resultado .equipo.'+side+' a').getAttribute('href');
    if(![team,...(clubs[team]||[])].some(slug=>link==='https://www.futbolfantasy.com/laliga/equipos/'+slug)) throw Error('rivales_distintos');
  }
  const scripts=[...head.querySelectorAll('script')].filter(x=>x.textContent.includes('function getMinute('));
  const phase=scripts.length===1 && /\bvar parte\s*=\s*(\d+)\s*;/.exec(scripts[0].textContent)?.[1];
  const state=['4','10'].includes(phase)?'finished':['1','2','3','5','6','7','8','9'].includes(phase)?'in_progress':null;
  const sections=[...document.querySelectorAll('section.alineaciones')].filter(s=>/^Alineaciones confirmadas\b/i.test(clean(s.querySelector('header')?.textContent||'')));
  if(!state || !sections.length) return {reason:'pendiente_de_confirmacion',teams:{}};
  if(sections.length!==1) throw Error('secciones_ambiguas');
  const teams={};
  for(const [side,team] of sides){
    try{
      const pitch=one(sections[0],'.match-p11-side .campo-wrapper.confirmed.definitive.'+side);
      const shirts=[...pitch.querySelectorAll('.camiseta-wrapper > a.camiseta')].filter(a=>
        (a.parentElement.getAttribute('data-onceff')||a.parentElement.getAttribute('data-onceFF'))==='titular');
      if(shirts.length!==11) throw Error('once_incompleto');
      const players=roster.filter(p=>p.team===team);
      const starters=shirts.map(shirt=>{
        const href=shirt.getAttribute('href')||'';
        const match=/^https:\/\/www\.futbolfantasy\.com\/jugadores\/([a-z0-9-]+)\/laliga-26-27\/?$/.exec(href);
        if(!match) throw Error('perfil_invalido');
        const slug=match[1];
        const matches=players.filter(p=>profiles[p.id]?.includes(slug)||norm(p.name)===slug);
        if(matches.length!==1) throw Error('identidad_pendiente_'+slug);
        return {id:matches[0].id,name:matches[0].name};
      });
      if(new Set(starters.map(p=>p.id)).size!==11) throw Error('titular_duplicado');
      teams[team]={starters};
    }catch(error){teams[team]={reason:error.message};}
  }
  return {state,teams};
}
