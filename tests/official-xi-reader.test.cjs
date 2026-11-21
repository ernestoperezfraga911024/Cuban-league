const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fixture={home:'osasuna',away:'athletic-club',matchday:12,season:'2026-27',kickoff_at:'2026-11-07T17:30:00Z'};
test('only confirmed starting shirts from the registered match can enter history',async()=>{
  const {readMatch}=await import('../supabase/functions/official-xi-reader/parser.mjs');
  const participants=[], profiles={};
  function pitch(team,side){
    let shirts='';
    for(let i=0;i<11;i++){
      const id=team+'-'+i;
      participants.push({id,team,name:id});
      profiles[id]=[id];
      shirts+='<div class="camiseta-wrapper" data-onceFF="titular"><a class="camiseta" href="https://www.futbolfantasy.com/jugadores/'+id+'/laliga-26-27"></a></div>';
    }
    return '<div class="match-p11-side"><div class="campo-wrapper confirmed definitive '+side+'">'+shirts+'</div></div>';
  }
  const html='<div class="encabezado-partido"><div class="fecha"><strong>LaLiga 2026/27 - Jornada 12</strong></div><div class="fecha">Sábado, 07 de noviembre del 2026 a las 18:30h</div><div class="resultado"><div class="equipo local"><a href="https://www.futbolfantasy.com/laliga/equipos/osasuna"></a></div><div class="equipo visitante"><a href="https://www.futbolfantasy.com/laliga/equipos/athletic"></a></div></div><script>function getMinute(){var parte = 4;}</script></div><section class="alineaciones"><header>Alineaciones confirmadas</header>'+pitch('osasuna','local')+pitch('athletic-club','visitante')+'<div class="suplentes"><a class="camiseta">Banquillo</a></div></section>';
  const parse=source=>readMatch(new JSDOM(source).window.document,fixture,participants,profiles);
  const r=parse(html);
  assert.equal(r.state,'finished');
  for(const team of [fixture.home,fixture.away]) assert.equal(r.teams[team].starters.length,11);
  assert.equal(parse(html.replace('parte = 4','parte = 0')).reason,'pendiente_de_confirmacion');
  assert.equal(parse(html.replace('Alineaciones confirmadas','Posibles alineaciones')).reason,'pendiente_de_confirmacion');
  assert.equal(parse(html.replace('osasuna-10/laliga','osasuna-1/laliga')).teams.osasuna.reason,'titular_duplicado');
  assert.equal(parse(html.replace('osasuna-10/laliga','desconocido/laliga')).teams.osasuna.reason,'identidad_pendiente_desconocido');
  assert.throws(()=>parse(html.replace('18:30h','19:00h')),/calendario_distinto/);
});

test('the confirmed Espanyol keeper profile resolves only to Ángel Fortuño',()=>{
  const profiles=require('../supabase/functions/official-xi-reader/profiles.json');
  const owners=Object.keys(profiles).filter(id=>profiles[id].includes('ngel-fortuno'));
  assert.deepEqual(owners,['a-fortuno']);
});

test('the three Alavés J13 profile variants resolve within the authorized club roster',()=>{
  const profiles=require('../supabase/functions/official-xi-reader/profiles.json');
  const roster=require('../catalog/players.json').players.filter(p=>p.club_id==='alaves');
  for(const [slug,id] of [['jonny-castro','j-otto'],['antonio-martinez','t-martinez'],['angel-perez-1','a-perez-alaves']]){
    assert.deepEqual(roster.filter(p=>profiles[p.id]?.includes(slug)).map(p=>p.id),[id]);
  }
});
