const fs=require('node:fs'),path=require('node:path'),root=path.join(__dirname,'..');
for(const file of ['index.html','admin.html','sw.js']){
 const p=path.join(root,file);let s=fs.readFileSync(p,'utf8');
 s=s.replace(/(forecast-(?:round-core|pitch)\.js|forecast-publish\.css)\?v=\d+-20261111/g,'$1?v=207-20261111');
 if(file==='index.html')s=s.replace('forecast-public.js?v=206-20261111','forecast-season-public.js?v=207-20261111');
 if(file==='admin.html'){
  s=s.replace('forecast-review.js?v=205-20261111','forecast-review.js?v=207-20261111');
  const marker='<script src="forecast-pitch.js?v=207-20261111"></script>';
  if(!s.includes('forecast-round-config.js'))s=s.replace(marker,'    <script src="forecast-round-config.js?v=206-20261111"></script>\n    <script src="forecast-round-core.js?v=207-20261111"></script>\n'+marker);
  if(!s.includes('forecast-season-admin.js'))s=s.replace('<script src="forecast-review.js?v=207-20261111"></script>','<script src="forecast-season-admin.js?v=207-20261111"></script>\n  <script src="forecast-review.js?v=207-20261111"></script>');
  if(!s.includes('forecast-round-config.js')||!s.includes('forecast-season-admin.js'))throw Error('Missing season admin runtime');
 }
 if(file==='sw.js'){
  s=s.replace('cuban-league-v206-forecast-round','cuban-league-v207-forecast-season');
  s=s.replace("'./forecast-public.js?v=206-20261111',","'./forecast-season-public.js?v=207-20261111',\n  './forecast-season-admin.js?v=207-20261111',");
  s=s.replace('round-(?:core|config)|pitch','round-(?:core|config)|season-(?:public|admin)|delivery|pitch');
 }
 fs.writeFileSync(p,s);
}
const css=path.join(root,'forecast-publish.css');const styles=`
/* Season monitoring stays compact and wraps without horizontal scrolling. */
.fp-delivery[hidden],#forecastManage[hidden]{display:none!important}
.fs-summary{font-size:.85rem;line-height:1.6;font-weight:600}
.fs-teams{display:grid;gap:0;margin:12px 0}
.fs-team{display:grid;grid-template-columns:minmax(145px,1fr) minmax(180px,2fr) auto;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid rgba(127,145,168,.2);font-size:.83rem}
.fs-identity{display:flex;align-items:center;gap:8px;min-width:0}.fs-identity img{object-fit:contain;flex:none}.fs-team-detail{display:grid;gap:4px;min-width:0}.fs-team-detail small{font-size:.72rem;line-height:1.5;overflow-wrap:anywhere}.fs-state{font-weight:700}.fs-reason{color:#c99142}.fs-actions{display:flex;flex-wrap:wrap;gap:5px}.fs-actions button{font-size:.72rem!important;padding:7px 10px!important;min-height:32px}.fs-team button:disabled{opacity:.45}
@media(max-width:680px){.fs-team{grid-template-columns:minmax(0,1fr);gap:7px;padding:13px 0}.fs-actions{justify-content:flex-start}.fs-identity b{font-size:.84rem}}
`;
if(!fs.readFileSync(css,'utf8').includes('.fs-summary'))fs.appendFileSync(css,styles);
console.log('Season assets prepared.');
