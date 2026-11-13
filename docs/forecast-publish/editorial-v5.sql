-- Authorized Comuniate fallback change. Version old assessments instead of rewriting them.
-- Existing rows, source evidence, permissions, schedules and publication dates remain intact.
do $guard$ begin
 if md5(pg_get_functiondef('forecast_publish.assess(jsonb)'::regprocedure))<>'08ed7deb71622601b08a3dc9e465c2ff'
 or md5(pg_get_functiondef('forecast_season.build_team(jsonb,interval)'::regprocedure))<>'6ae8dd0d18f6a80788d42b526b9faee5'
 then raise exception 'Editorial functions changed since review';end if;
end;$guard$;

do $v5$
declare assessment text; builder text;
begin
 assessment:=pg_get_functiondef('forecast_publish.assess(jsonb)'::regprocedure);
 assessment:=replace(assessment,
  'if e->>''method'' in (''editorial-v3'',''editorial-v4'') then',
  'if e->>''method'' in (''editorial-v3'',''editorial-v4'',''editorial-v5'') then');
 assessment:=replace(assessment,
  'signal:=case when s->''probability''=''null''::jsonb then case s->>''prediction'' when ''starter'' then 90 when ''alternative'' then 40 else 25 end else (s->>''probability'')::numeric end;',
  'signal:=case when s->''probability''=''null''::jsonb then case s->>''prediction'' when ''starter'' then case when e->>''method''=''editorial-v5'' and s->>''id''=''comuniate'' then 50 else 90 end when ''alternative'' then 40 else 25 end else (s->>''probability'')::numeric end;');
 execute assessment;

 builder:=pg_get_functiondef('forecast_season.build_team(jsonb,interval)'::regprocedure);
 builder:=replace(builder,
  '(''editorial-v3'',''editorial-v4'')',
  '(''editorial-v3'',''editorial-v4'',''editorial-v5'')');
 builder:=replace(builder,
  '(''editorial-v2'',''editorial-v3'',''editorial-v4'')',
  '(''editorial-v2'',''editorial-v3'',''editorial-v4'',''editorial-v5'')');
 builder:=replace(builder,
  'p->>''method_version'' is distinct from ''editorial-v4'' or jsonb_typeof(p#>''{proposal,candidates}'')',
  'not coalesce(p->>''method_version'' in (''editorial-v4'',''editorial-v5''),false) or jsonb_typeof(p#>''{proposal,candidates}'')');
 builder:=replace(builder,
  'Candidatos requieren evaluación editorial-v4',
  'Candidatos requieren evaluación editorial-v4 o editorial-v5');
 builder:=replace(builder,
  'x#>>''{assessment,method}'' is distinct from ''editorial-v4''',
  'x#>>''{assessment,method}'' is distinct from p->>''method_version''');
 builder:=replace(builder,
  '''reason'',x->>''reason'',''method'',''editorial-v4''',
  '''reason'',x->>''reason'',''method'',p->>''method_version''');
 execute builder;
end;$v5$;

