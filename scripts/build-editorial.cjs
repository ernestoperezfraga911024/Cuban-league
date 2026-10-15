/* Rebuild the presentation-only V175 theme. Never rewrites the legacy CSS.
 * Keep the proven layout/visibility rules; replace the old neon decoration.
 * Runtime has no CSS parser, framework, font request or build dependency.
 */
const fs = require('node:fs');
const path = require('node:path');
const CSSOM = require('rrweb-cssom');
const root = path.join(__dirname, '..');
const colors = /#[\da-f]{8}\b|#[\da-f]{6}\b|#[\da-f]{4}\b|#[\da-f]{3}\b|rgba?\([^)]*\)/gi;
const palette = {ink:'#172b25',muted:'#596b62',green:'#145c46',gold:'#85602c',red:'#ac3541',blue:'#315b78',purple:'#665083',line:'#dce3dc',paper:'#f7f8f3',surface:'#ffffff'};
function rgb(value) {
  if (value[0] === '#') {
    let h = value.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map(x => x+x).join('');
    return [0,2,4].map(i => parseInt(h.slice(i,i+2),16));
  }
  return (value.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
}
function tone(value) {
  const [r,g,b] = rgb(value), max=Math.max(r,g,b), min=Math.min(r,g,b);
  if (max-min<32 || max<65 || min>210) return 'neutral';
  if (r>g*1.2 && r>b*1.25) return 'red';
  if (r>b*1.3 && g>b*1.3 && r>=g*.9) return 'gold';
  if (g>r*1.15 && g>=b*.92) return 'green';
  if (b>g*1.1 && r>g*1.05) return 'purple';
  if (b>r*1.1 || g>r*1.1) return 'blue';
  return 'neutral';
}
function textColor(value) {
  const [r,g,b]=rgb(value), t=tone(value);
  if(Math.min(r,g,b)>190) return palette.ink;
  if(t!=='neutral') return palette[t];
  return Math.max(r,g,b)>95 && Math.max(r,g,b)<200 ? palette.muted : palette.ink;
}
function background(value, selector) {
  if (/^(none|transparent|inherit|initial|unset)$/.test(value.trim())) return value;
  if (/^(\.modal|\.admin-preview-modal|\.backup-restore-modal|\.player-catalog-modal|\.admin-install-modal)(:not\(\[hidden\]\))?$/.test(selector.trim())) return 'rgba(13,30,24,.48)';
  if (/^var\(--(?:bg|surface|panel|text|green|gold|cyan|danger|profile-)/.test(value) && !/gradient|url\(/.test(value)) return value;
  const matches=value.match(colors)||[];
  const t=matches.map(tone).find(x=>x!=='neutral');
  return {red:'#fbefef',green:'#edf3ee',gold:'#f7f1e5',blue:'#edf2f5',purple:'#f3eff7'}[t]||palette.surface;
}
function transformRules(rules) {
  for(const rule of rules) {
    if(rule.cssRules) transformRules(rule.cssRules);
    const style=rule.style;
    if(!style) continue;
    const selector=rule.selectorText||'';
    for(const prop of Array.from({length:style.length},(_,i)=>style[i])) {
      let value=style.getPropertyValue(prop), priority=style.getPropertyPriority(prop);
      if (/^(box-shadow|text-shadow|filter|backdrop-filter|-webkit-backdrop-filter)$/.test(prop)) value='none';
      else if(prop==='background-image') value='none';
      else if(prop==='background-attachment') value='scroll';
      else if(prop==='background'||prop==='background-color') value=background(value,selector);
      else if(prop==='color-scheme') value='light';
      else if(prop==='-webkit-text-fill-color') value='currentColor';
      else if(prop.startsWith('border') && !prop.endsWith('radius')) value=value.replace(colors,()=>palette.line);
      else if(prop.startsWith('--')) {
        if(/shadow|glow/.test(prop)) value='none';
        else if(/url\(/.test(value)) value='none';
        else if(/bg|surface|panel/.test(prop)) value=value.replace(colors,()=>palette.surface);
        else if(/line|border/.test(prop)) value=value.replace(colors,()=>palette.line);
        else value=value.replace(colors,textColor);
      } else value=value.replace(colors,textColor);
      // Historic !important paint rules must not defeat the new hand-designed
      // surfaces. Keep !important on geometry/visibility and form safety rules.
      if(/^(color|background(?:-color|-image|-attachment)?|fill|stroke|-webkit-text-fill-color)$/.test(prop))priority='';
      style.setProperty(prop,value,priority);
    }
  }
}
// Drop only exact duplicate declarations overridden by the same selector in
// the same condition. Do not merge selectors, media ranges or shorthands.
function pruneOverridden(rules,context='',seen=new Map()) {
  for(const rule of [...rules].reverse()) {
    if(rule.cssRules) {
      if(rule.type!==7)pruneOverridden(rule.cssRules,`${context}|${rule.type}:${rule.conditionText||rule.media?.mediaText||''}`,seen);
      continue;
    }
    if(!rule.selectorText||!rule.style)continue;
    const key=`${context}|${rule.selectorText}`;
    if(!seen.has(key))seen.set(key,new Map());
    const later=seen.get(key);
    for(const prop of Array.from({length:rule.style.length},(_,i)=>rule.style[i])) {
      const important=rule.style.getPropertyPriority(prop)==='important';
      if(later.has(prop) && (later.get(prop)||!important))rule.style.removeProperty(prop);
      else later.set(prop,important);
    }
  }
}
function serialize(rules) {
  return rules.map(rule=>{
    if(rule.selectorText&&rule.style.length===0)return '';
    if(rule.type===4)return `@media ${rule.media.mediaText}{${serialize(rule.cssRules)}}`;
    if(rule.type===12)return `@supports ${rule.conditionText}{${serialize(rule.cssRules)}}`;
    return rule.cssText;
  }).filter(Boolean).join('\n');
}
function build(source,overrides,target) {
  const sheet=CSSOM.parse(fs.readFileSync(path.join(root,source),'utf8'));
  transformRules(sheet.cssRules);
  pruneOverridden(sheet.cssRules);
  const legacy=serialize(sheet.cssRules);
  const hand=fs.readFileSync(path.join(root,overrides),'utf8');
  const result=`/* V175 generated: npm run build:design; edit ${overrides}, not this file. */\n${legacy}\n${hand}`.replace(/[\t ]+$/gm,'').trimEnd()+'\n';
  CSSOM.parse(result);
  fs.writeFileSync(path.join(root,target),result);
  return result;
}
if(require.main===module) {
  for(const [source,overrides,target] of [['styles.css','design/editorial-overrides.css','editorial.css'],['admin.css','design/editorial-admin-overrides.css','editorial-admin.css']]) {
    const output=build(source,overrides,target);
    console.log(`${target}: ${Buffer.byteLength(output)} bytes`);
  }
}
module.exports={build,palette,textColor,background};
