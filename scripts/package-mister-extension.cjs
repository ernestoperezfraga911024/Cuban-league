/* Build a deterministic ZIP with Node's standard library (no added dependencies). */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const {createHash} = require('node:crypto');
const root = path.join(__dirname,'..'), extension = path.join(root,'mister-extension');
for (const core of ['mister-import-core.js','second-division-core.js'])
  fs.copyFileSync(path.join(root,core),path.join(extension,core));
const version = JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8')).version;
const crcTable = Array.from({length:256},(_,n) => { for(let k=0;k<8;k++) n = n&1 ? 0xedb88320^(n>>>1) : n>>>1; return n>>>0; });
function crc32(bytes) { let crc=0xffffffff; for(const byte of bytes) crc=crcTable[(crc^byte)&255]^(crc>>>8); return (crc^0xffffffff)>>>0; }
const locals=[], central=[]; let offset=0;
for(const file of fs.readdirSync(extension).sort()) {
  if(!fs.statSync(path.join(extension,file)).isFile()) continue;
  const name=Buffer.from('Cuban-League-Mister/'+file), data=fs.readFileSync(path.join(extension,file)), compressed=zlib.deflateRawSync(data);
  const crc=crc32(data), local=Buffer.alloc(30), entry=Buffer.alloc(46), date=((2026-1980)<<9)|(9<<5)|5;
  local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt16LE(date,12);
  local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
  entry.writeUInt32LE(0x02014b50,0);entry.writeUInt16LE(0x0314,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(8,10);entry.writeUInt16LE(date,14);
  entry.writeUInt32LE(crc,16);entry.writeUInt32LE(compressed.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(name.length,28);
  entry.writeUInt32LE((0o644<<16)>>>0,38);entry.writeUInt32LE(offset,42);
  locals.push(local,name,compressed);central.push(entry,name);offset+=local.length+name.length+compressed.length;
}
const directory=Buffer.concat(central), end=Buffer.alloc(22), count=central.length/2;
end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(count,8);end.writeUInt16LE(count,10);
end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
const archive=Buffer.concat([...locals,directory,end]), destination=path.join(root,'downloads','Cuban-League-Mister-'+version+'.zip');
fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,archive);
console.log(destination);console.log('SHA256 '+createHash('sha256').update(archive).digest('hex'));
