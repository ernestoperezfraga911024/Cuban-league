(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.CubanForecastSourceMethod=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const METHOD='editorial-v2';
  const IDS=['futbolfantasy','jornadaperfecta','comuniate'];
  const SIGNALS={starter:90,alternative:40,not_listed:25};
  const WEIGHTS={availability:{clear:0,concern:-8,unknown:-4},rotation:{low:0,possible:-3,high:-8},horizon:{near:0,medium:-1,distant:-2}};
  function reference(item){
    return item&&typeof item.reason==='string'&&item.reason.trim()&&Array.isArray(item.refs)&&item.refs.length&&item.refs.every(ref=>typeof ref==='string'&&/^https:\/\//.test(ref));
  }
  function evaluate(e){
    if(e?.method!==METHOD||e.confirmed_out!==false)throw Error('Evaluación editorial v2 incompleta o baja confirmada.');
    if(!Array.isArray(e.sources)||e.sources.length!==3||new Set(e.sources.map(s=>s.id)).size!==3)throw Error('Se requieren tres fuentes distintas.');
    const trace=[];let sum=0;
    for(const s of e.sources){
      if(!IDS.includes(s.id)||!Object.hasOwn(SIGNALS,s.prediction)||!reference(s)||!s.refs.some(ref=>{try{const u=new URL(ref);return u.origin==='https://www.'+({futbolfantasy:'futbolfantasy.com',jornadaperfecta:'jornadaperfecta.com',comuniate:'comuniate.com'}[s.id]);}catch{return false;}})
        ||(s.probability!==null&&(!Number.isInteger(s.probability)||s.probability<0||s.probability>100)))throw Error('Observación de fuente inválida.');
      const signal=s.probability??SIGNALS[s.prediction];sum+=signal;
      trace.push({factor:s.id,value:s.prediction,points:signal*.8/3,reason:s.reason+(s.probability===null?' Señal editorial '+signal+'/100; la fuente no publica un porcentaje.':' Porcentaje observado: '+signal+'%.'),refs:[...s.refs]});
    }
    if(!reference(e.role)||!Number.isInteger(e.role.value)||e.role.value<0||e.role.value>100)throw Error('Falta la valoración del rol.');
    let score=.8*sum/3+.2*e.role.value;
    trace.push({factor:'Rol / continuidad · 20%',value:e.role.value,points:.2*e.role.value,reason:e.role.reason,refs:[...e.role.refs]});
    for(const [key,values] of Object.entries(WEIGHTS)){
      const item=e[key];if(!reference(item)||!Object.hasOwn(values,item.value))throw Error('Evidencia incompleta: '+key);
      score+=values[item.value];trace.push({factor:key,value:item.value,points:values[item.value],reason:item.reason,refs:[...item.refs]});
    }
    if(!reference(e.context)||!Number.isInteger(e.context.points)||Math.abs(e.context.points)>10)throw Error('Ajuste contextual inválido.');
    score+=e.context.points;trace.push({factor:'Contexto específico',value:e.context.points,points:e.context.points,reason:e.context.reason,refs:[...e.context.refs]});
    const probability=Math.max(5,Math.min(e.horizon.value==='distant'?90:95,Math.round(score)));
    return {method:METHOD,probability_kind:'editorial_uncalibrated',probability,trace};
  }
  return {METHOD,evaluate};
});
