'use strict';
const {randomBytes,publicEncrypt,createCipheriv,constants,createPublicKey}=require('node:crypto');
const audience='https://pyahosamoisqcbpvzwka.supabase.co/functions/v1/mister-market-sync';
function sealSession(state,publicKey){
 const key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(audience));
 const body=Buffer.concat([cipher.update(JSON.stringify(state),'utf8'),cipher.final(),cipher.getAuthTag()]);
 const rsa=createPublicKey({key:Buffer.from(publicKey,'base64'),type:'spki',format:'der'});
 return {version:1,algorithm:'RSA-OAEP-256+A256GCM',key:publicEncrypt({key:rsa,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},key).toString('base64'),iv:iv.toString('base64'),body:body.toString('base64')};
}
module.exports={sealSession};
if(require.main===module){const fs=require('fs'),[input,keyFile,output]=process.argv.slice(2);fs.writeFileSync(output,JSON.stringify(sealSession(JSON.parse(fs.readFileSync(input)),fs.readFileSync(keyFile,'utf8').trim())),{mode:0o600,flag:'wx'});console.log('session_sealed');}
