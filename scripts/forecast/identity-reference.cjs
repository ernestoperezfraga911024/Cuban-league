'use strict';
// Read-only review aids, never inferred mappings or changes to the roster.
const catalog = require('../../catalog/players.json').players;
const aliases = require('../../docs/automation/identity-aliases.json');
const normalized = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
function identityReference(team, roster, names) {
  const candidates = [];
  const players = roster.filter(p => p.team === team).map(p => {
    const entry = catalog.find(c => c.id === p.id && c.club_id === team);
    const profile_url = entry?.mister_source?.url || entry?.source?.url || null;
    const verified = aliases.filter(a => a.team === team && a.id === p.id &&
      a.mister_id === entry?.mister_id && a.catalog_url === profile_url);
    const labels = [p.name,entry?.full_name,...verified.flatMap(a => a.names)].filter(Boolean);
    for (const name of names) if (labels.some(label => normalized(label) === normalized(name))) {
      candidates.push({observed_name:name,id:p.id,name:p.name,profile_url,
        verified_alias:verified.find(a => a.names.some(n => normalized(n) === normalized(name))) || null});
    }
    return {id:p.id,name:p.name,full_name:entry?.full_name || null,profile_url};
  });
  return {players,candidates,requires_review:true};
}
module.exports = {identityReference};
