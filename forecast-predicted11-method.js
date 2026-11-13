(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.CubanForecastPredicted11=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const METHOD='editorial-v5';
  const WEIGHTS={futbolfantasy:30,jornadaperfecta:20,comuniate:20,predicted11:30};
  const SIGNALS={starter:90,alternative:40,not_listed:25};
  const ADJUSTMENTS={availability:{clear:0,concern:-8,unknown:-4},rotation:{low:0,possible:-3,high:-8},horizon:{near:0,medium:-1,distant:-2}};
  const validRef=(s,id)=>{try{const u=new URL(s);return u.origin==='https://www.'+id+'.com'&&!u.username&&!u.password;}catch{return false;}};
  const referenced=s=>s&&typeof s.reason==='string'&&s.reason.trim()&&Array.isArray(s.refs)&&s.refs.length&&s.refs.every(r=>typeof r==='string'&&r.startsWith('https://'));
  const integer=(v,max)=>Number.isInteger(v)&&v>=0&&v<=max;
  function selectAuthors(club,global){
    if(!Array.isArray(club)||!Array.isArray(global)||club.length!==7||global.length!==7)throw Error('Se requieren los siete primeros de cada ranking.');
    const authors=new Map();
    for(const list of [club,global]){
      if(new Set(list.map(a=>a.id)).size!==7||new Set(list.map(a=>a.rank)).size!==7)throw Error('Ranking duplicado.');
      for(const a of list){
        if(!/^[1-9][0-9]*$/.test(a.id)||!integer(a.rank,7)||a.rank<1||!validRef(a.url,'predicted11')||!/^\/es\/usuario\//.test(new URL(a.url).pathname))throw Error('Autor o posición de ranking inválidos.');
        if(decodeURIComponent(new URL(a.url).pathname).toLowerCase().replace(/\/$/,'')==='/es/usuario/futbolfantasy')continue;
        if(!authors.has(a.id))authors.set(a.id,a);
      }
    }
    return [...authors.values()];
  }
  function aggregate(authors,predictions,roster){
    if(new Set(authors.map(a=>a.id)).size!==authors.length||new Set(predictions.map(p=>p.author_id)).size!==predictions.length||predictions.length!==authors.length)throw Error('Autores repetidos o sin comprobación.');
    const counts=new Map();let ballots=0;
    for(const p of predictions){
      if(!authors.some(a=>a.id===p.author_id)||!['read','not_created','incomplete','unavailable'].includes(p.status))throw Error('Pronóstico ajeno a la selección.');
      if(p.status!=='read')continue;
      if(!Array.isArray(p.starter_ids)||p.starter_ids.length!==11||new Set(p.starter_ids).size!==11||p.starter_ids.some(id=>!roster.has(id)))throw Error('Once o identidad inválidos.');
      ballots++;for(const id of p.starter_ids)counts.set(id,(counts.get(id)||0)+1);
    }
    return {ballots,counts};
  }
  function evaluate(e){
    if(![METHOD,'editorial-v4','editorial-v3'].includes(e?.method)||e.confirmed_out!==false||Object.hasOwn(e,'role'))throw Error('Método editorial sin rol o baja confirmada.');
    if(!Array.isArray(e.sources)||e.sources.length!==4||new Set(e.sources.map(s=>s.id)).size!==4)throw Error('Se requieren cuatro comprobaciones de fuentes.');
    let numerator=0,denominator=0;const trace=[];
    for(const s of e.sources){
      if(!Object.hasOwn(WEIGHTS,s.id)||!referenced(s)||!s.refs.some(r=>validRef(r,s.id)))throw Error('Fuente o referencias inválidas.');
      let signal=null;
      if(s.id==='predicted11'){
        if(s.probability!==null||!integer(s.ballots,14))throw Error('No atribuyas un porcentaje editorial a Predicted11.');
        if(s.ballots===0){
          if(s.prediction!=='not_available'||s.votes!==null)throw Error('Sin pronósticos no existe una señal negativa.');
        }else{
          if(s.prediction!=='consensus'||!integer(s.votes,s.ballots))throw Error('Recuento de autores inválido.');
          signal=100*s.votes/s.ballots;
        }
      }else{
        if(!Object.hasOwn(SIGNALS,s.prediction)||(s.probability!==null&&!integer(s.probability,100)))throw Error('Observación inválida.');
        // v3/v4 retain their original calculations; a published percentage, including zero, always wins.
        signal=s.probability??(e.method==='editorial-v5'&&s.id==='comuniate'&&s.prediction==='starter'?50:SIGNALS[s.prediction]);
      }
      if(signal!==null){numerator+=WEIGHTS[s.id]*signal;denominator+=WEIGHTS[s.id];}
      trace.push({id:s.id,signal,nominal_weight:WEIGHTS[s.id]});
    }
    let score=numerator/denominator;
    for(const [key,values] of Object.entries(ADJUSTMENTS)){
      if(!referenced(e[key])||!Object.hasOwn(values,e[key].value))throw Error('Evidencia incompleta: '+key);
      if(e.method==='editorial-v3'||key==='rotation')score+=values[e[key].value];
    }
    if(!referenced(e.context)||!Number.isInteger(e.context.points)||Math.abs(e.context.points)>10)throw Error('Contexto inválido.');
    score+=e.context.points;
    for(const t of trace)t.effective_weight=t.signal===null?0:100*t.nominal_weight/denominator;
    return {method:e.method,probability:Math.max(5,Math.min(e.method==='editorial-v3'&&e.horizon.value==='distant'?90:95,Math.round(score))),probability_kind:'editorial_uncalibrated',trace};
  }
  return {METHOD,WEIGHTS,selectAuthors,aggregate,evaluate};
});

