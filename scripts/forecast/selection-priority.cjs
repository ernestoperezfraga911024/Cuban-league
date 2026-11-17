'use strict';
// Compare final source-only scores within each reviewed tactical slot. Never
// sort the whole XI by score or use medical status to resolve a position.
function prioritizeSlots(choices, evaluated, fail) {
  const promotions = [];
  const players = choices.map((choice, index) => {
    if (choice.alternative_ids != null && !Array.isArray(choice.alternative_ids)) fail(`Las alternativas del puesto ${index + 1} deben ser una lista`);
    const ids = [...new Set([choice.id, choice.alternative_id, ...(choice.alternative_ids || [])].filter(Boolean))];
    for (const id of ids) if (!evaluated.has(id)) fail(`Falta alternativa evaluada para el puesto ${index + 1}: ${id}`);
    // Stable sort: ties retain the original starter, then the reviewed order.
    ids.sort((a,b) => evaluated.get(b).probability - evaluated.get(a).probability);
    if (ids[0] !== choice.id) promotions.push({slot:index+1,from:choice.id,to:ids[0],
      from_probability:evaluated.get(choice.id).probability,to_probability:evaluated.get(ids[0]).probability});
    return {...choice,id:ids[0],alternative_id:ids[1] || null};
  });
  // A starter may also be an alternative elsewhere. If promoting that player
  // would occupy two slots, require a compatible redistribution; never demote
  // the better option, duplicate a starter or silently discard the relation.
  const occupied = new Set();
  for (const player of players) {
    if (occupied.has(player.id)) fail(`Mayor porcentaje exige revisar la distribución táctica: ${player.id} ocuparía dos puestos; conservar once únicos y revisar las opciones compatibles.`);
    occupied.add(player.id);
  }
  return {players,promotions};
}
module.exports={prioritizeSlots};
