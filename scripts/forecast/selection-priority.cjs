'use strict';

// Assign each reviewed player to at most one compatible slot. For eleven slots,
// there are at most 2048 occupied-slot masks regardless of the roster size.
function assignDistinct(options, choices, evaluated) {
  const slotsByPlayer = new Map();
  options.forEach((ids, slot) => {
    for (const id of ids) {
      if (!slotsByPlayer.has(id)) slotsByPlayer.set(id, []);
      slotsByPlayer.get(id).push(slot);
    }
  });
  let states = new Map([[0, {score:0, retained:0, ids:[]}]]);
  for (const [id, slots] of slotsByPlayer) {
    const next = new Map(states);
    for (const [mask, state] of states) {
      for (const slot of slots) {
        const bit = 1 << slot;
        if (mask & bit) continue;
        const score = state.score + evaluated.get(id).probability;
        const retained = state.retained + Number(id === choices[slot].id);
        const best = next.get(mask | bit);
        if (best && (best.score > score || best.score === score && best.retained >= retained)) continue;
        const ids = state.ids.slice();
        ids[slot] = id;
        next.set(mask | bit, {score, retained, ids});
      }
    }
    states = next;
  }
  return states.get((1 << choices.length) - 1)?.ids;
}

function prioritizeSlots(choices, evaluated, fail) {
  const options = choices.map((choice, index) => {
    if (choice.alternative_ids != null && !Array.isArray(choice.alternative_ids)) fail(`Las alternativas del puesto ${index + 1} deben ser una lista`);
    const ids = [...new Set([choice.id, choice.alternative_id, ...(choice.alternative_ids || [])].filter(Boolean))];
    for (const id of ids) if (!evaluated.has(id)) fail(`Falta alternativa evaluada para el puesto ${index + 1}: ${id}`);
    return ids.sort((a,b) => evaluated.get(b).probability - evaluated.get(a).probability);
  });
  let starters = options.map(ids => ids[0]);
  if (new Set(starters).size !== starters.length) {
    starters = assignDistinct(options, choices, evaluated);
    if (!starters) fail('Revisar la distribución táctica: faltan titulares distintos para los puestos compatibles.');
  }
  const promotions = [];
  const players = choices.map((choice, slot) => {
    const id = starters[slot], score = evaluated.get(id).probability;
    if (id !== choice.id) promotions.push({slot:slot+1,from:choice.id,to:id,
      from_probability:evaluated.get(choice.id).probability,to_probability:score});
    // A stronger option assigned elsewhere remains in the reviewed links. The
    // public projection displays one alternative and independently validates it.
    const alternative = options[slot].find(other => other !== id && evaluated.get(other).probability <= score);
    return {...choice, id, alternative_id:alternative || null};
  });
  return {players,promotions};
}
module.exports={prioritizeSlots};
