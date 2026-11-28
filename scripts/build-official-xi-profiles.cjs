// Exact profile slugs only. The runtime also checks the current team's authorized roster.
const fs=require('node:fs');
const path=require('node:path');
const catalog=require('../catalog/players.json').players;
const aliases=require('../docs/automation/identity-aliases.json');
const verified={
  'f-boyomo':['boyomo'], 'd-vivian':['dani-vivian'], 'a-djalo':['lvaro-djalo'],
  'r-fernandez':['roberto-fernandez-1'], 'mister-5521760':['alejandro-santiago'],
  'j-hernandez':['javier-hernandez'], 'r-bauza':['rafel-bauza'],
  'm-fernandez-espanyol':['marcos-fernandez-1'], 'u-gonzalez':['urko-gonzalez-de-zarate'],
  'a-calatrava':['lex-calatrava'], 'a-fortuno':['ngel-fortuno'],
  'j-otto':['jonny-castro'], 't-martinez':['antonio-martinez'], 'a-perez-alaves':['angel-perez-1'],
  'g-tsitaishvili':['georgiy-tsitaishvili'], 'a-ratiu':['andrei-florin'],
  'j-copete':['jose-manuel-copete'], 'j-guerra':['javi-guerra-1'], 'd-raba':['daniel-raba'],
  'n-souza':['natan'], 'isco':['isco-alarcon'],
  'a-guler':['arda-gler'], 'a-carreras':['lvaro-fernandez-1'],
  'h-alvarez':['hugo-lvarez-'], 'i-radu':['andrei-radu'],
  'jeanuel-belocian':['jeanul-belocian'], 'o-oskarsson':['orri-steinn-skarsson'],
  'a-pastor':['lex-pastor'],
  'm-ryan':['mat-ryan'], 'd-requena':['dani-requena'],
  'n-perez':['nacho-perez-1'], 'v-garcia':['victor-garcia-1'],
  'd-lorenzo':['dani-lorenzo-1'], 'jens-lys-cajuste':['jens-cajuste'],
  'pedri':['pedri-gonzalez']
};
const profiles={};
for(const p of catalog){
  const slugs=new Set(verified[p.id]||[]);
  for(const url of [p.mister_source?.url,p.source?.url,...aliases.filter(a=>a.id===p.id && a.team===p.club_id && a.mister_id===p.mister_id).map(a=>a.profile_url)]){
    if(!url) continue;
    const match=/^https:\/\/(?:mister\.mundodeportivo\.com\/players\/\d+|www\.futbolfantasy\.com\/jugadores)\/([a-z0-9-]+)(?:\/laliga-26-27)?\/?$/.exec(url);
    if(match) slugs.add(match[1]);
  }
  if(slugs.size) profiles[p.id]=[...slugs].sort();
}
fs.writeFileSync(path.join(__dirname,'../supabase/functions/official-xi-reader/profiles.json'),JSON.stringify(profiles,null,1)+'\n');
