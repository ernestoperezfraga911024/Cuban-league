
async function loadLeague(){
  const response = await fetch('data.json');
  const data = await response.json();
  const sorted = [...data.participants].sort((a,b)=>b.points-a.points || a.name.localeCompare(b.name));
  document.getElementById('season').textContent=data.season;
  document.getElementById('updated').textContent=data.lastUpdated;
  document.getElementById('total').textContent=sorted.length;
  document.getElementById('leader').textContent=sorted[0]?.name || '—';
  document.getElementById('standings').innerHTML=sorted.map((p,i)=>`
    <div class="row">
      <span class="position">${i+1}</span>
      <div class="team"><img src="${p.shield}" alt=""><span class="team-name">${p.name}</span></div>
      <span class="played">${p.played}</span>
      <span class="points">${p.points}</span>
    </div>`).join('');
}
document.getElementById('shareButton').addEventListener('click',async()=>{
  const payload={title:'Cuban League',text:'Consulta la clasificación de la Cuban League',url:location.href};
  if(navigator.share){await navigator.share(payload)}else{await navigator.clipboard.writeText(location.href);alert('Enlace copiado')}
});
loadLeague().catch(()=>document.getElementById('standings').innerHTML='<p style="padding:20px">Abre esta web desde un servidor local o desde GitHub Pages.</p>');
