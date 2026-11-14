'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const MAX_BYTES=2*1024*1024;
// Large connector responses never travel as a long terminal input line.
async function responseValue(message,{directory,id}){
 if(!Object.hasOwn(message,'result_file'))return message;
 if(Object.hasOwn(message,'result')||Object.hasOwn(message,'error')||message.result_file!==path.join(directory,id+'-response.json'))throw Error('Unexpected response file');
 const info=await fs.lstat(message.result_file);
 if(!info.isFile()||info.isSymbolicLink()||info.size>MAX_BYTES)throw Error('Invalid response file');
 const parsed=JSON.parse(await fs.readFile(message.result_file,'utf8'));
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.hasOwn(parsed,'result')===Object.hasOwn(parsed,'error'))throw Error('Response file needs exactly result or error');
 return parsed;
}
module.exports={responseValue};
