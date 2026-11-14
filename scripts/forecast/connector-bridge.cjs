'use strict';
// Self-contained factory: load once in code mode; it owns tool arguments and
// chunked file transport. No credentials, network client or external dependency.
function createConnectorBridge(tools) {
  const destination={link_id:'link_6aad67ea13208191b8315f9bb7f2cce7',project_id:'pyahosamoisqcbpvzwka'};
  const quote=s=>"'"+String(s).replace(/'/g,"'\\''")+"'";
  async function command(cmd){
    const r=await tools.exec_command({cmd,login:false,max_output_tokens:16000});
    if(r.exit_code!==0||r.session_id)throw Error('Bridge file command failed');
    return r.output;
  }
  function paths(event){
    if(!event||!/^\d+$/.test(event.id)||!['sql','review'].includes(event.event))throw Error('Invalid bridge event');
    const match=event.path?.match(/^((?:\/tmp|\/var\/tmp)\/forecast-season-[A-Za-z0-9_-]+)\/(\d+)-(sql|review)\.json$/);
    if(!match||match[2]!==event.id||match[3]!==event.event||event.response_path!==`${match[1]}/${event.id}-response.json`)throw Error('Unexpected bridge paths');
  }
  async function readFile(file){
    let text='';
    for(let offset=0;offset<=2097152;offset+=12000){
      const code='import json,sys;from pathlib import Path;s=Path(sys.argv[1]).read_text();o=int(sys.argv[2]);print(json.dumps({"chunk":s[o:o+12000],"done":o+12000>=len(s)}))';
      const part=JSON.parse(await command(`python3 -c ${quote(code)} ${quote(file)} ${offset}`));
      text+=part.chunk;if(part.done)return text;
    }
    throw Error('Bridge file exceeds limit');
  }
  async function writeFile(file,value){
    const text=JSON.stringify(value);if(text.length>2097152)throw Error('Bridge response exceeds limit');
    // Small, shell-quoted chunks never pass through a PTY or interpolate data as code.
    const code='import sys;from pathlib import Path;p=Path(sys.argv[1]);p.open(sys.argv[2],encoding="utf-8").write(sys.argv[3]);p.chmod(0o600)';
    for(let offset=0;offset<text.length;){
      let end=Math.min(offset+12000,text.length);
      if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;
      await command(`python3 -c ${quote(code)} ${quote(file+'.tmp')} ${offset?'a':'w'} ${quote(text.slice(offset,end))}`);
      offset=end;
    }
    await command(`python3 -c ${quote('import json,sys;from pathlib import Path;p=Path(sys.argv[1]);json.loads(p.read_text());p.replace(sys.argv[2])')} ${quote(file+'.tmp')} ${quote(file)}`);
  }
  function requestArgs(request){
    if(!request||Object.keys(request).sort().join(',')!=='link_id,project_id,query'||request.link_id!==destination.link_id||request.project_id!==destination.project_id||typeof request.query!=='string'||!request.query.trim())throw Error('Invalid SQL connector arguments');
    return {link_id:destination.link_id,project_id:destination.project_id,query:request.query};
  }
  function extract(value,depth=0){
    if(depth>12)throw Error('Unsupported SQL response nesting');
    if(value?.isError)throw Error('SQL connector returned an error; inspect the original tool result');
    if(Array.isArray(value)){
      if(value.length!==1||!Object.hasOwn(value[0]||{},'result'))throw Error('SQL response must contain exactly one result row');
      return value[0].result;
    }
    if(value?.structuredContent!=null)return extract(value.structuredContent,depth+1);
    if(value?.content){
      const blocks=value.content.filter(c=>c.type==='text'&&c.text!=='Action completed.');
      if(blocks.length!==1)throw Error('Ambiguous SQL tool response');
      return extract(blocks[0].text,depth+1);
    }
    if(typeof value==='string'){
      try{return extract(JSON.parse(value),depth+1);}catch(error){if(!(error instanceof SyntaxError))throw error;}
      const start=value.match(/<untrusted-data-([a-z0-9-]+)>\s*\n/);
      if(!start)throw Error('Unrecognized SQL response; do not repair it manually');
      const end=value.indexOf(`</untrusted-data-${start[1]}>`,start.index+start[0].length);
      if(end<0)throw Error('Truncated SQL response');
      return extract(JSON.parse(value.slice(start.index+start[0].length,end).trim()),depth+1);
    }
    if(value&&Object.hasOwn(value,'result'))return extract(value.result,depth+1);
    throw Error('SQL result row missing');
  }
  async function reply(event,value,sessionId){
    paths(event);
    if(!value||Object.hasOwn(value,'result')===Object.hasOwn(value,'error'))throw Error('Reply needs result or error');
    await writeFile(event.response_path,value);
    return tools.write_stdin({session_id:sessionId,chars:JSON.stringify({id:event.id,result_file:event.response_path})+'\n',yield_time_ms:1000,max_output_tokens:2000});
  }
  async function sql(event,sessionId){
    paths(event);if(event.event!=='sql')throw Error('Expected SQL event');
    const args=requestArgs(JSON.parse(await readFile(event.path)));
    // No automatic retry of SQL: a lost response may have committed a mutation.
    const response=await tools.mcp__codex_apps__supabase_execute_sql(args);
    let result;
    try{result=extract(response);}catch(error){
      // Preserve the full response for inspection without calling SQL again.
      await writeFile(event.response_path+'.tool',response);throw error;
    }
    return reply(event,{result},sessionId);
  }
  return {sql,reply,requestArgs,extract,readFile};
}
module.exports={createConnectorBridge};
