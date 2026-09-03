const http=require('http');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {URL}=require('url');

const ROOT=__dirname, PUBLIC=path.join(ROOT,'public');
const DATA=process.env.DATA_DIR||path.join(ROOT,'data');
const SEED_PLAYERS=path.join(ROOT,'seed','player-data.json');
const LEAGUES_FILE=path.join(DATA,'leagues.json'), PLAYERS_FILE=path.join(DATA,'player-data.json');
const PORT=process.env.PORT||3000;
const HOST=process.env.HOST||'0.0.0.0';
fs.mkdirSync(DATA,{recursive:true});
if(!fs.existsSync(LEAGUES_FILE))fs.writeFileSync(LEAGUES_FILE,'{}');
if(!fs.existsSync(PLAYERS_FILE)&&fs.existsSync(SEED_PLAYERS))fs.copyFileSync(SEED_PLAYERS,PLAYERS_FILE);
let leagues=loadJSON(LEAGUES_FILE,{}), players=loadJSON(PLAYERS_FILE,[]);
const clients=new Map();

function loadJSON(f,fallback){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return fallback}}
function saveLeagues(){fs.writeFileSync(LEAGUES_FILE,JSON.stringify(leagues,null,2))}
function savePlayers(){fs.writeFileSync(PLAYERS_FILE,JSON.stringify(players,null,2))}
function rand(n=24){return crypto.randomBytes(n).toString('base64url')}
function code(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let c='';do{c=Array.from({length:6},()=>chars[Math.floor(Math.random()*chars.length)]).join('')}while(leagues[c]);return c}
function hashSecret(secret,salt=crypto.randomBytes(16).toString('hex')){return {salt,hash:crypto.scryptSync(String(secret),salt,32).toString('hex')}}
function secretOK(secret,rec){if(!rec||!secret)return false;try{const h=crypto.scryptSync(String(secret),rec.salt,32);return crypto.timingSafeEqual(h,Buffer.from(rec.hash,'hex'))}catch{return false}}
function member(L,token){return (L.members||[]).find(m=>m.token===token)}
function activeTokens(c){return new Set([...(clients.get(c)||[])].map(x=>x.token))}
function publicState(L){
  const online=activeTokens(L.code);
  const memberByTeam=new Map((L.members||[]).filter(m=>m.teamId).map(m=>[m.teamId,m]));
  const teams=L.teams.map(t=>({...t,password:undefined,passwordHash:undefined,online:[...online].some(tok=>member(L,tok)?.teamId===t.id),ready:!!memberByTeam.get(t.id)?.ready}));
  return {code:L.code,league:L.league,teams,picks:L.picks,updated:L.updated,serverNow:Date.now()};
}
function orderForRound(style,r,n){let b=Array.from({length:n},(_,i)=>i+1);if(style==='linear')return b;if(style==='snake')return r%2?b:[...b].reverse();if(style==='3rr'){if(r===2||r===3)return [...b].reverse();return r>3?(r%2?b:[...b].reverse()):b}return b}
function slots(L){let out=[];for(let r=1;r<=L.league.rounds;r++)for(const t of orderForRound(L.league.style,r,L.league.teamCount))out.push({round:r,teamId:t});return out}
function currentSlot(L){return slots(L)[L.picks.length]||null}
function touch(L,{resetClock=true}={}){L.updated=Date.now();if(resetClock)L.league.pickStartedAt=Date.now();saveLeagues();broadcast(L.code)}
function sseWrite(res,event,data){res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)}
function broadcast(c){const L=leagues[c];if(!L)return;for(const cl of clients.get(c)||[]){const m=member(L,cl.token);sseWrite(cl.res,'state',{state:publicState(L),isCommissioner:!!m?.commissioner,self:m?{name:m.name,teamId:m.teamId,ready:!!m.ready}:null})}}
function broadcastAll(event,data){for(const set of clients.values())for(const cl of set)sseWrite(cl.res,event,data)}
function json(res,status,obj){const s=JSON.stringify(obj);res.writeHead(status,{'Content-Type':'application/json','Content-Length':Buffer.byteLength(s),'Cache-Control':'no-store'});res.end(s)}
function body(req){return new Promise((resolve,reject)=>{let b='';req.on('data',d=>{b+=d;if(b.length>5e6)req.destroy()});req.on('end',()=>{try{resolve(b?JSON.parse(b):{})}catch(e){reject(e)}});req.on('error',reject)})}
function mime(f){return f.endsWith('.html')?'text/html; charset=utf-8':f.endsWith('.js')?'text/javascript; charset=utf-8':f.endsWith('.css')?'text/css; charset=utf-8':f.endsWith('.json')?'application/json; charset=utf-8':'application/octet-stream'}
function serveStatic(req,res,u){let p=u.pathname==='/'?'/index.html':u.pathname;const f=path.normalize(path.join(PUBLIC,p));if(!f.startsWith(PUBLIC)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('Not found')}res.writeHead(200,{'Content-Type':mime(f),'Cache-Control':f.endsWith('.html')?'no-store':'public, max-age=300'});fs.createReadStream(f).pipe(res)}
function claimTeam(L,m,teamId,name,password,commissioner=false){
  if(!teamId){m.teamId=null;return}
  const t=L.teams.find(x=>x.id===teamId);if(!t)throw Object.assign(new Error('Invalid team number'),{status:400});
  if(t.owner){if(!commissioner&&!secretOK(password,t.passwordHash))throw Object.assign(new Error('Incorrect team password'),{status:403})}
  else {if(!commissioner&&String(password||'').length<4)throw Object.assign(new Error('Choose a 4+ character team password'),{status:400});t.owner=name;if(password)t.passwordHash=hashSecret(password)}
  for(const mm of L.members||[])if(mm.teamId===teamId&&mm!==m)mm.teamId=null;
  m.teamId=teamId;m.name=name;
}
function autoSkipExpired(){
  for(const L of Object.values(leagues)){
    if(!L.league.started||L.league.paused||!currentSlot(L))continue;
    const secs=Math.max(15,+L.league.pickTimer||90),start=+L.league.pickStartedAt||Date.now();
    if(Date.now()-start>=secs*1000){const sl=currentSlot(L);L.picks.push({overall:L.picks.length+1,round:sl.round,teamId:sl.teamId,player:'— TIMER EXPIRED —',pos:'',ts:Date.now(),automatic:true});touch(L)}
  }
}
setInterval(autoSkipExpired,1000).unref?.();

const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost');
  try{
    if(req.method==='GET'&&u.pathname==='/api/health')return json(res,200,{ok:true,version:6,leagues:Object.keys(leagues).length,players:players.length});
    if(req.method==='GET'&&u.pathname==='/api/players')return json(res,200,{players});
    if(req.method==='GET'&&u.pathname==='/api/state'){const c=(u.searchParams.get('code')||'').toUpperCase(),L=leagues[c];if(!L)return json(res,404,{error:'League not found'});return json(res,200,{state:publicState(L)});}
    if(req.method==='GET'&&u.pathname==='/api/events'){
      const c=(u.searchParams.get('code')||'').toUpperCase(),token=u.searchParams.get('token')||'',L=leagues[c],m=L&&member(L,token);if(!L||!m)return json(res,401,{error:'Invalid league session'});
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write(': connected\n\n');
      if(!clients.has(c))clients.set(c,new Set());const cl={res,token};clients.get(c).add(cl);broadcast(c);
      const ping=setInterval(()=>res.write(': ping\n\n'),25000);req.on('close',()=>{clearInterval(ping);clients.get(c)?.delete(cl);broadcast(c)});return;
    }
    if(req.method==='POST'&&u.pathname==='/api/create'){
      const b=await body(req),teamCount=Math.max(2,Math.min(32,+b.teamCount||12));
      if(!String(b.commissionerName||'').trim()||String(b.commissionerPin||'').length<4)return json(res,400,{error:'Commissioner name and a 4+ character PIN are required'});
      const c=code(),token=rand(),teams=Array.from({length:teamCount},(_,i)=>({id:i+1,name:'Team '+(i+1),owner:''}));
      const comm={token,name:String(b.commissionerName).trim().slice(0,60),teamId:null,commissioner:true,ready:true};
      const L=leagues[c]={code:c,league:{name:String(b.leagueName||'NHL 27 League').slice(0,100),teamCount,style:['snake','linear','3rr'].includes(b.style)?b.style:'snake',rounds:Math.max(1,Math.min(30,+b.rounds||18)),pickTimer:Math.max(15,Math.min(600,+b.pickTimer||90)),paused:true,started:false,pickStartedAt:null},teams,picks:[],members:[comm],pin:hashSecret(b.commissionerPin),updated:Date.now()};
      saveLeagues();return json(res,200,{code:c,token,isCommissioner:true,self:{name:comm.name,teamId:null,ready:true},state:publicState(L)});
    }
    if(req.method==='POST'&&u.pathname==='/api/join'){
      const b=await body(req),c=String(b.code||'').toUpperCase(),L=leagues[c];if(!L)return json(res,404,{error:'League not found'});
      const name=String(b.name||'').trim().slice(0,60);if(!name)return json(res,400,{error:'Display name is required'});
      const commissioner=secretOK(b.commissionerPin,L.pin),token=rand(),m={token,name,teamId:null,commissioner,ready:false};L.members.push(m);
      if(b.teamId)claimTeam(L,m,+b.teamId,name,b.teamPassword,commissioner);
      L.updated=Date.now();saveLeagues();broadcast(c);return json(res,200,{token,teamId:m.teamId,isCommissioner:commissioner,self:{name:m.name,teamId:m.teamId,ready:m.ready},state:publicState(L)});
    }
    if(req.method==='POST'&&u.pathname==='/api/action'){
      const b=await body(req),c=String(b.code||'').toUpperCase(),L=leagues[c],m=L&&member(L,b.token);if(!L||!m)return json(res,401,{error:'Invalid league session'});const a=b.action,p=b.payload||{};
      if(a==='claimTeam'){claimTeam(L,m,p.teamId?+p.teamId:null,String(p.name||m.name).trim().slice(0,60),p.teamPassword,m.commissioner);touch(L,{resetClock:false});return json(res,200,{ok:true,teamId:m.teamId})}
      if(a==='ready'){m.ready=!!p.ready;touch(L,{resetClock:false});return json(res,200,{ok:true,ready:m.ready})}
      if(a==='draft'){
        if(!L.league.started)return json(res,409,{error:'Draft has not started'});if(L.league.paused)return json(res,409,{error:'Draft is paused'});const sl=currentSlot(L);if(!sl)return json(res,409,{error:'Draft is complete'});if(!m.commissioner&&m.teamId!==sl.teamId)return json(res,403,{error:'It is not your team’s pick'});const pl=players.find(x=>x.name===p.player);if(!pl)return json(res,404,{error:'Player not found'});if(L.picks.some(x=>x.player===pl.name))return json(res,409,{error:'Player already drafted'});L.picks.push({overall:L.picks.length+1,round:sl.round,teamId:sl.teamId,player:pl.name,pos:pl.position,ts:Date.now()});touch(L);return json(res,200,{ok:true});
      }
      if(a==='undo'){if(!L.picks.length)return json(res,409,{error:'No picks to undo'});const last=L.picks[L.picks.length-1];if(!m.commissioner&&m.teamId!==last.teamId)return json(res,403,{error:'Only commissioner or the team that made the last pick can undo'});L.picks.pop();touch(L);return json(res,200,{ok:true})}
      if(['setup','reset','randomize','pause','skip','renameTeam','replacePlayers','startDraft'].includes(a)&&!m.commissioner)return json(res,403,{error:'Commissioner access required'});
      if(a==='startDraft'){if(!currentSlot(L))return json(res,409,{error:'Draft is complete'});L.league.started=true;L.league.paused=false;touch(L);return json(res,200,{ok:true})}
      if(a==='setup'){L.league.name=String(p.name||L.league.name).slice(0,100);L.league.teamCount=Math.max(2,Math.min(32,+p.teamCount||L.league.teamCount));L.league.style=['snake','linear','3rr'].includes(p.style)?p.style:L.league.style;L.league.rounds=Math.max(1,Math.min(30,+p.rounds||L.league.rounds));L.league.pickTimer=Math.max(15,Math.min(600,+p.pickTimer||L.league.pickTimer));while(L.teams.length<L.league.teamCount)L.teams.push({id:L.teams.length+1,name:'Team '+(L.teams.length+1),owner:''});if(Array.isArray(p.teamNames))for(const n of p.teamNames){const t=L.teams.find(x=>x.id===+n.id);if(t&&n.name)t.name=String(n.name).slice(0,80)}if(p.commissionerPin&&String(p.commissionerPin).length>=4)L.pin=hashSecret(p.commissionerPin);touch(L,{resetClock:false});return json(res,200,{ok:true})}
      if(a==='reset'){L.picks=[];L.league.started=false;L.league.paused=true;L.league.pickStartedAt=null;for(const mm of L.members)if(!mm.commissioner)mm.ready=false;touch(L,{resetClock:false});return json(res,200,{ok:true})}
      if(a==='randomize'){const active=L.teams.slice(0,L.league.teamCount);for(let i=active.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[active[i],active[j]]=[active[j],active[i]]}active.forEach((t,i)=>t.id=i+1);L.teams=[...active,...L.teams.slice(L.league.teamCount)];for(const mm of L.members){if(mm.teamId){const t=L.teams.find(x=>x.owner===mm.name);mm.teamId=t?.id||mm.teamId}}touch(L,{resetClock:false});return json(res,200,{ok:true})}
      if(a==='pause'){L.league.paused=!L.league.paused;if(!L.league.paused)L.league.pickStartedAt=Date.now();touch(L,{resetClock:false});return json(res,200,{ok:true})}
      if(a==='skip'){const sl=currentSlot(L);if(!sl)return json(res,409,{error:'Draft complete'});L.picks.push({overall:L.picks.length+1,round:sl.round,teamId:sl.teamId,player:'— SKIPPED —',pos:'',ts:Date.now()});touch(L);return json(res,200,{ok:true})}
      if(a==='renameTeam'){const t=L.teams.find(x=>x.id===+p.id);if(!t)return json(res,404,{error:'Team not found'});t.name=String(p.name||t.name).slice(0,80);touch(L,{resetClock:false});return json(res,200,{ok:true})}
      if(a==='replacePlayers'){if(!Array.isArray(p.players)||p.players.length<20)return json(res,400,{error:'Invalid player dataset'});players=p.players;savePlayers();broadcastAll('playersUpdated',{count:players.length,ts:Date.now()});return json(res,200,{ok:true,count:players.length})}
      return json(res,400,{error:'Unknown action'});
    }
    return serveStatic(req,res,u);
  }catch(e){console.error(e);return json(res,e.status||500,{error:e.status?e.message:'Server error'})}
});
server.listen(PORT,HOST,()=>console.log(`NHL 27 Draft Room v6.1 running on ${HOST}:${PORT}`));
