'use strict';
const {fixtureOf}=require('../../scripts/forecast/editorial-producer.cjs');
function example(team='test-home') {
  const now=Date.now(),at=new Date(now).toISOString();
  const fixture={key:'laliga-2026-27-j13-test-home-test-away',season:'2026-27',home:'test-home',away:'test-away',matchday:13,kickoff_at:new Date(now+86400000).toISOString().replace(/\.\d+Z$/,'Z')};
  const roster=Array.from({length:14},(_,i)=>({id:team+'-'+(i+1),name:'Test player '+(i+1),team}));
  const packet={team,expected_fixture:fixture,docs:{},observations:{},rankings:[],predictions:[],p11_attempted_at:at};
  const review={fixture,availability_reviewed:true,confirmed_out:[],sources:{},predicted11:{fixture_verified:false,reason:'Acceso público no disponible en este test local.'},selection:{formation:'4-2-3-1',players:roster.slice(0,11).map(p=>({id:p.id,alternative_id:roster[11].id}))}};
  for(const id of ['futbolfantasy','jornadaperfecta','comuniate']) {
    const doc={url:'https://www.'+id+'.com/partidos/test',fetched_at:at,sha256:'a'.repeat(64)};
    packet.docs[id]=doc;if(id==='comuniate')packet.docs.comuniate_team=doc;
    packet.observations[id]=roster.slice(0,11).map(p=>({name:p.name,probability:null}));
    review.sources[id]={fixture_sha256:doc.sha256,lineup_sha256:doc.sha256,season:fixture.season,observed_fixture:fixtureOf(fixture),forecast:true,alternatives_complete:true,alternatives:[{name:roster[11].name,probability:null}]};
  }
  packet.comuniate_alternatives={...packet.docs.comuniate_team,players:structuredClone(review.sources.comuniate.alternatives)};
  let offset=0;
  const points=[1,4,2,3,1].flatMap((count,y)=>Array.from({length:count},(_,i)=>({name:roster[offset++].name,kind:'starter',x:100*(i+.5)/count,y})));
  packet.layouts={jornadaperfecta:{...packet.docs.jornadaperfecta,points}};
  review.selection.layout={rows:[1,4,2,3,1].map(()=>({source:'jornadaperfecta',sha256:packet.docs.jornadaperfecta.sha256}))};
  return {packet,review,roster,window:{notBefore:at,observedAt:at,expiresAt:new Date(now+7200000).toISOString()}};
}
module.exports={example};

// Exact source signals behind the De Jong 43 / Bernal 55 inversion, synthetic
// identities/fixture and current timestamps so no live data is published.
function priorityExample(){
 const x=example(),at=x.window.notBefore;
 for(const [source,starter,alternative] of [['futbolfantasy',50,50],['jornadaperfecta',60,40],['comuniate',50,null]]){
  x.packet.observations[source][6].probability=starter;
  x.review.sources[source].alternatives[0].probability=alternative;
 }
 x.packet.comuniate_alternatives.players=structuredClone(x.review.sources.comuniate.alternatives);
 const authors=Array.from({length:7},(_,i)=>({id:String(i+1),rank:i+1,url:'https://www.predicted11.com/es/usuario/'+(i===0?'FutbolFantasy':'author'+i)}));
 x.packet.rankings=['club','global'].map(kind=>({kind,url:'https://www.predicted11.com/es/laliga/'+(kind==='club'?'ranking-equipo/test-home':'ranking-global'),fetched_at:at,authors}));
 x.packet.docs.p11match={url:'https://www.predicted11.com/es/laliga/partido/test',fetched_at:at,sha256:'b'.repeat(64)};
 x.review.predicted11={fixture_verified:true,fixture_sha256:'b'.repeat(64),season:'2026-27',observed_fixture:fixtureOf(x.review.fixture)};
 x.packet.predictions=authors.slice(1).map((a,i)=>({author_id:a.id,url:a.url,fetched_at:at,ballot_fetched_at:at,status:i<5?'complete_unvalidated':'not_created',data:{participacion:x.roster.slice(0,11).map((p,j)=>({nombre:j===6&&i<4?x.roster[11].name:p.name}))}}));
 return x;
}
module.exports.priorityExample=priorityExample;
