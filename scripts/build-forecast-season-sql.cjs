// Keep the existing, strict player/source validator and change only fixture lookup/scope.
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),file=path.join(root,'docs/forecast-publish/season.sql');
const source=fs.readFileSync(path.join(root,'docs/forecast-publish/round.sql'),'utf8');
let body=source.slice(source.indexOf('create function forecast_league.build_team'),source.indexOf('create function forecast_league.save_batch')).trim();
function replace(from,to){if(!body.includes(from))throw Error('Validator drift: '+from);body=body.replace(from,to);}
replace('forecast_league.build_team(p jsonb)','forecast_season.build_team(p jsonb,p_max_age interval default interval \'2 hours\')');
replace('cfg forecast_league.teams%rowtype','cfg record');
replace("select * into cfg from forecast_league.teams where team=p->>'team';",`if p_max_age not in (interval '2 hours',interval '24 hours') then raise exception 'Vigencia inválida' using errcode='22023'; end if;
 select t.team,jsonb_build_object('key',f.key,'home',f.home,'away',f.away,'matchday',f.matchday,'kickoff_at',to_char(f.kickoff_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'sources',f.source_urls) as fixture,
 f.source_urls||jsonb_build_object('comuniate',t.source_urls->'comuniate') as source_urls into cfg
 from forecast_league.teams t join forecast_season.fixtures f on f.key=p->>'fixture_key' and t.team in(f.home,f.away) where t.team=p->>'team';`);
replace("p->'schema_version' is distinct from '2'::jsonb","p->'schema_version' is distinct from '3'::jsonb or p->>'season' is distinct from '2026-27'");
replace("p->'matchday' is distinct from '13'::jsonb","p->'matchday' is distinct from cfg.fixture->'matchday'");
replace("s->>'url' is distinct from cfg.source_urls->>(s->>'id')","(s->>'url' is distinct from cfg.source_urls->>(s->>'id') and not(s->>'id'='comuniate' and s->>'url'=cfg.fixture->'sources'->>'comuniate'))");
replace("now()-interval '2 hours'","now()-p_max_age");
replace("'matchday',13,'kickoff_at'","'matchday',cfg.fixture->'matchday','kickoff_at'");
replace(" if cfg.team='real-madrid' and p->'proposal'->>'formation'<>'4-2-3-1' then raise exception 'Madrid conserva 4-2-3-1' using errcode='22023'; end if;\n",'');
replace("jsonb_build_object('schema_version',2,","jsonb_build_object('schema_version',3,'season','2026-27',");
replace("'matchday',13,'kickoff_at'","'matchday',cfg.fixture->'matchday','kickoff_at'");
const target=fs.readFileSync(file,'utf8'),generated='-- BEGIN GENERATED VALIDATOR\n'+body+'\n-- END GENERATED VALIDATOR';
const marker='-- BUILD_TEAM is inserted here by scripts/build-forecast-season-sql.cjs.';
if(target.includes(marker))fs.writeFileSync(file,target.replace(marker,()=>generated));
else if(target.includes('-- BEGIN GENERATED VALIDATOR'))fs.writeFileSync(file,target.replace(/-- BEGIN GENERATED VALIDATOR[\s\S]*?-- END GENERATED VALIDATOR/,()=>generated));
else throw Error('Missing insertion marker');
console.log('Season validator generated from J13 validator.');
