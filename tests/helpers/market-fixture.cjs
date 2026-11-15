'use strict';
module.exports=()=>({schemaVersion:1,leagueId:'649733',season:'2026-27',snapshotHash:'a'.repeat(64),capturedAt:'2026-11-15T19:05:16.845Z',
 managers:Array.from({length:20},(_,i)=>({id:String(i+1),participantId:i+1,name:'Participante '+(i+1)})),
 players:Array.from({length:100},(_,i)=>({id:String(i+1),name:'Futbolista '+(i+1),position:['PT','DF','MC','DL'][i%4],club:i%2?'Club Ázul':'Club Verde',photo:null,value:(i+1)*1000,ownerId:i<80?String(i%20+1):null,clause:i<80?(i+1)*2000:null})),
 history:{source:'player_profiles',completeSeason:false,reconciliation:'pending',observedAt:'2026-11-15T19:01:54.699Z',events:[
  {reference:'1:row:0',playerId:'1',date:'2026-08-15',from:'1',to:'2',amount:1000},
  {reference:'2:row:0',playerId:'2',date:'2026-08-16',from:'2',to:'1',amount:5000},
  {reference:'3:row:0',playerId:'3',date:'2026-08-16',from:'3',to:'4',amount:5000}
 ]}});
