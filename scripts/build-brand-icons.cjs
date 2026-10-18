/* Rasterize the approved vector once, at build time. No runtime dependencies. */
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..');
const source=path.join(root,'cuban-league-f05-logo.svg');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'cuban-f05-icons-'));
try{
  const vector=fs.readFileSync(source,'utf8').replace(/<svg\b[^>]*>/,'').replace(/<\/svg>\s*$/,'');
  // 80% scale places the complete shield inside the maskable safe circle.
  const mask=path.join(temporary,'maskable.svg');
  fs.writeFileSync(mask,`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#071910"/><g transform="translate(51.2 51.2) scale(.8)">${vector}</g></svg>`);
  for(const [name,size,input] of [
    ['icon-f05-192.png',192,source],
    ['icon-f05-512.png',512,source],
    ['apple-touch-icon-f05.png',180,source],
    ['favicon-f05-32.png',32,source],
    ['icon-f05-maskable-512.png',512,mask]
  ]){
    execFileSync('inkscape',[input,'--export-type=png',`--export-filename=${path.join(root,name)}`,`--export-width=${size}`,`--export-height=${size}`,'--export-background=#071910','--export-background-opacity=1'],{stdio:'pipe'});
    console.log(`${name}: ${fs.statSync(path.join(root,name)).size} bytes`);
  }
}finally{
  fs.rmSync(temporary,{recursive:true,force:true});
}
