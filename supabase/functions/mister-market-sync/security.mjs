const issuer='https://token.actions.githubusercontent.com';
export const audience='https://pyahosamoisqcbpvzwka.supabase.co/functions/v1/mister-market-sync';
const repo='ernestoperezfraga911024/Cuban-league';
export const decode=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
export function validateClaims(c,now=Math.floor(Date.now()/1000)){
 if(c.iss!==issuer||c.aud!==audience||c.repository!==repo||c.repository_id!=='1309155979'||c.ref!=='refs/heads/main'
  ||c.workflow_ref!==`${repo}/.github/workflows/mister-market-sync.yml@refs/heads/main`
  ||!['schedule','workflow_dispatch'].includes(c.event_name)||c.runner_environment!=='github-hosted'
  ||!/^\d+$/.test(c.run_id)||!/^\d+$/.test(c.run_attempt)||!/^[a-f0-9]{40}$/.test(c.sha)
  ||![c.exp,c.iat,c.nbf].every(Number.isFinite)||c.exp<=now||c.iat>now+30||c.nbf>now+30||now-c.iat>600||c.exp-c.iat>900)throw Error('unauthorized');
 return c;
}
export async function verifyToken(token,keys,now){
 if(typeof token!=='string'||token.length>16000)throw Error('unauthorized');
 const parts=token.split('.');if(parts.length!==3)throw Error('unauthorized');
 const h=JSON.parse(new TextDecoder().decode(decode(parts[0])));
 if(h.alg!=='RS256'||h.typ!=='JWT'||typeof h.kid!=='string')throw Error('unauthorized');
 const jwk=keys.find(k=>k.kid===h.kid&&k.kty==='RSA'&&k.alg==='RS256'&&k.use==='sig');if(!jwk)throw Error('unauthorized');
 const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(parts.slice(0,2).join('.'))))throw Error('unauthorized');
 return validateClaims(JSON.parse(new TextDecoder().decode(decode(parts[1]))),now);
}
export async function decryptSession(envelope,privateKey){
 if(envelope?.version!==1||envelope.algorithm!=='RSA-OAEP-256+A256GCM')throw Error('invalid_sealed_session');
 const key=await crypto.subtle.importKey('pkcs8',decode(privateKey),{name:'RSA-OAEP',hash:'SHA-256'},false,['decrypt']);
 const raw=await crypto.subtle.decrypt({name:'RSA-OAEP'},key,decode(envelope.key));
 const aes=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);
 const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(envelope.iv),additionalData:new TextEncoder().encode(audience)},aes,decode(envelope.body));
 const state=JSON.parse(new TextDecoder().decode(plaintext));
 if(!Array.isArray(state.cookies)||!Array.isArray(state.origins))throw Error('invalid_session');
 return state;
}
