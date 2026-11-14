'use strict';
// Screen coordinates, never DOM enumeration order, define left/right.
// This module does not select a formation, XI, probabilities or alternatives.
function orderSelection(packet, selection, resolve) {
  const fail = message => { throw Error(`${packet.team}: colocación pendiente: ${message}`); };
  const sizes = [1, ...selection.formation.split('-').map(Number)];
  if (selection.layout?.rows?.length !== sizes.length) fail('falta una referencia por fila, incluida portería');
  const result = [], audit = [], usedAnchors = new Set(); let offset = 0;
  for (const [row, size] of sizes.entries()) {
    const ref = selection.layout.rows[row], source = ref?.source;
    const captured = packet.layouts?.[source], doc = packet.docs[source];
    if (!['futbolfantasy','jornadaperfecta'].includes(source) || !captured || !doc ||
        captured.sha256 !== doc.sha256 || ref.sha256 !== doc.sha256 ||
        captured.url !== doc.url || captured.fetched_at !== doc.fetched_at) fail(`fila ${row}: geometría sin cuerpo y fecha verificados`);
    const choices = selection.players.slice(offset,offset+size), anchors = ref.anchors || [];
    if (!Array.isArray(anchors) || new Set(anchors.map(a=>a.id)).size !== anchors.length ||
        anchors.some(a=>!choices.some(p=>p.id===a.id))) fail(`fila ${row}: sustituciones ajenas o duplicadas`);
    const points = new Map();
    // A primary appearance takes precedence over an alternative in another slot.
    for (const kind of ['starter','alternative']) for (const p of captured.points) {
      if (p.kind !== kind) continue;
      let id; try { id = resolve(p.name); } catch { continue; } // Optional unknowns cannot place a mandatory player.
      if (!choices.some(p=>p.id===id) && !anchors.some(a=>a.source_name===p.name)) continue;
      if (points.has(id) && points.get(id).kind === 'starter' && kind === 'alternative') continue;
      if (![p.x,p.y].every(Number.isFinite) || p.x < 0 || p.x > 100) fail(`coordenadas inválidas de ${p.name}`);
      const previous = points.get(id);
      if (previous && (previous.x !== p.x || previous.y !== p.y)) fail(`posición ambigua de ${p.name}`);
      points.set(id,p);
    }
    const placed = choices.map(choice => {
      let point = points.get(choice.id); const anchor = anchors.find(a=>a.id===choice.id);
      if (anchor) {
        if (point || typeof anchor.reason !== 'string' || anchor.reason.trim().length < 10) fail(`sustitución injustificada de ${choice.id}`);
        const observed = captured.points.find(p=>p.name===anchor.source_name);
        if (!observed) fail(`ancla no observada: ${anchor.source_name}`);
        let anchorId; try { anchorId = resolve(anchor.source_name); } catch { fail(`identidad del ancla: ${anchor.source_name}`); }
        if (selection.players.some(p=>p.id===anchorId)) fail(`ancla ocupada por otro titular: ${anchor.source_name}`);
        if (usedAnchors.has(anchorId)) fail(`ancla reutilizada: ${anchor.source_name}`);
        usedAnchors.add(anchorId);
        point = points.get(anchorId);
      }
      if (!point) fail(`sin posición observada o sustitución revisada para ${choice.id}`);
      return {choice,point};
    });
    if (new Set(placed.map(p=>p.point.x)).size !== size) fail(`fila ${row}: posiciones horizontales ambiguas; revisar otra fuente`);
    placed.sort((a,b)=>a.point.x-b.point.x);
    result.push(...placed.map(p=>p.choice));
    audit.push({source,sha256:doc.sha256,ids:placed.map(p=>p.choice.id),anchors});
    offset += size;
  }
  return {players:result,audit:{direction:'left-to-right',rows:audit,reordered:result.some((p,i)=>p.id!==selection.players[i].id)}};
}
module.exports = {orderSelection};
