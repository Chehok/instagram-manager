/* 내보내기 변형을 처리하는 순수 데이터 함수 */
function fixText(value) {
  var s=String(value||'');
  if(!/[\u0080-\u00ff]/.test(s))return s;
  try { var bytes=Array.from(s,c=>c.charCodeAt(0)); if(bytes.some(b=>b>255))return s; return new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(bytes)); } catch(e){return s;}
}
function accountKey(s){return String(s||'').trim().replace(/^@/,'').toLowerCase()}
function safeProfile(u){return 'https://www.instagram.com/'+encodeURIComponent(u)+'/'}
function extraKind(path){
  var p=path.toLowerCase(),b=p.split('/').pop();
  var names={pending_follow_requests:'pending',recently_unfollowed_profiles:'unfollowed',blocked_profiles:'blocked',restricted_profiles:'restricted',close_friends:'close'};
  for(var n in names)if(new RegExp('^'+n+'(?:_\\d+)?\\.json$').test(b))return names[n];
  if(/^liked_posts(?:_\d+)?\.json$/.test(b))return 'likes';
  if(/^post_comments.*\.json$/.test(b))return 'comments';
  if(/(?:^|\/)story_interactions\/.+\.json$/.test(p)||/^(?:story_likes|(?:story_)?(?:polls|questions|emoji_sliders|quizzes|countdowns))(?:_\d+)?\.json$/.test(b))return 'stories';
  if(/^message_\d+\.json$/.test(b))return 'messages';
  return null;
}
// 관계 목록의 알려진 최상위 키뿐 아니라 중첩된 relationships_* 키도 읽습니다.
function relationshipEntries(data){
  var out=[];
  function visit(x){if(!x||typeof x!=='object')return;
    if(x.string_list_data){out.push(...extractEntries([x]));return;}
    if(Array.isArray(x)){x.forEach(visit);return;}
    Object.values(x).forEach(visit);
  }visit(data);return dedupe(out);
}
function seconds(value){var n=Number(value);if(!Number.isFinite(n)||n<=0)return 0;return n>1e11?n/1000:n;}
function activityEntries(data,kind){
  var out=[];
  function visit(x){
    if(!x||typeof x!=='object')return;
    if(x.string_map_data||x.string_list_data){
      var map=x.string_map_data&&typeof x.string_map_data==='object'?x.string_map_data:{},sl=Array.isArray(x.string_list_data)?x.string_list_data.filter(v=>v&&typeof v==='object'):[];
      var owner=Object.entries(map).find(([k,v])=>v&&typeof v==='object'&&/^(media owner|owner|username|profile|account|사용자|미디어 소유자)$/i.test(k));
      var u=fixText(owner&&(owner[1].value||userFromHref(owner[1].href))||x.title||'');
      if(!u)u=sl.map(s=>userFromHref(s.href)||s.value).find(Boolean)||'';
      // 게시물 URL은 계정 식별자로 해석하지 않습니다.
      if(/^https?:/i.test(u))u=userFromHref(u);
      if(['p','reel','reels','stories','explore'].includes(accountKey(u)))u='';
      var ts=seconds(x.timestamp)||Object.values(map).filter(v=>v&&typeof v==='object').map(v=>seconds(v.timestamp)).find(Boolean)||sl.map(v=>seconds(v.timestamp)).find(Boolean)||0;
      out.push({username:u.trim().replace(/^@/,''),timestamp:ts,kind});return;
    }
    if(Array.isArray(x))x.forEach(visit);else Object.values(x).forEach(visit);
  }visit(data);return out;
}
function emptyActivity(){return {events:[],messages:[],threads:[],available:[],warnings:[]}}
function guessMe(activity){
  var counts=new Map();
  activity.threads.forEach(names=>new Set(names).forEach(n=>counts.set(n,(counts.get(n)||0)+1)));
  return [...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]?.[0]||'';
}
function rankCounts(names){var m=new Map();names.filter(Boolean).forEach(n=>m.set(n,(m.get(n)||0)+1));return [...m].map(([username,count])=>({username,count})).sort((a,b)=>b.count-a.count||a.username.localeCompare(b.username));}
function activitySummary(activity,me){
  var outgoing=rankCounts(activity.events.map(e=>accountKey(e.username)));
  var incoming=rankCounts(activity.messages.filter(m=>m.sender!==me).map(m=>m.sender));
  var dates=activity.events.filter(e=>e.kind!=='stories').map(e=>e.timestamp).concat(activity.messages.filter(m=>m.sender===me).map(m=>m.timestamp)).filter(Boolean);
  var hours=Array(24).fill(0),months={};
  dates.forEach(t=>{var d=new Date(t*1000);if(!Number.isFinite(d.getTime()))return;hours[d.getHours()]++;var k=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');months[k]=(months[k]||0)+1;});
  return {outgoing,incoming,hours,months,interacted:new Set(outgoing.map(e=>accountKey(e.username)).concat(activity.messages.map(m=>accountKey(m.sender))))};
}
function timeline(snaps){
  var ordered=snaps.slice().sort((a,b)=>a.date.localeCompare(b.date)||String(a.id).localeCompare(String(b.id)));
  var events=[],gone=new Set();
  for(var i=1;i<ordered.length;i++){
    var a=ordered[i-1],b=ordered[i],d=diffSnapshots(a.followers,b.followers);
    d.lost.forEach(u=>{gone.add(accountKey(u));events.push({username:u,from:a.date,to:b.date,type:'사라짐',refollowed:false})});
    d.gained.forEach(u=>events.push({username:u,from:a.date,to:b.date,type:'등장',refollowed:gone.has(accountKey(u))}));
  }return events;
}
function normalizeBackup(input){
  var data=Array.isArray(input)?{snapshots:input}:input;
  if(!data||!Array.isArray(data.snapshots))throw new Error('스냅샷 목록이 없습니다');
  var snapshots=data.snapshots.map((s,i)=>{
    if(!s||!/^\d{4}-\d{2}-\d{2}$/.test(s.date)||!Array.isArray(s.followers)||s.followers.some(u=>typeof u!=='string'))throw new Error('스냅샷 형식이 잘못되었습니다');
    var n={id:String(s.id??('import-'+s.date+'-'+i)),date:s.date,followers:[...new Set(s.followers.map(accountKey).filter(Boolean))]};
    if(Array.isArray(s.following))n.following=[...new Set(s.following.filter(u=>typeof u==='string').map(accountKey))];
    return n;
  });
  var tags={};
  if(data.tags&&typeof data.tags==='object')Object.entries(data.tags).forEach(([u,v])=>{
    if(v&&typeof v==='object')Object.defineProperty(tags,accountKey(u),{value:{tag:String(v.tag||'').slice(0,100),memo:String(v.memo||'').slice(0,2000),updatedAt:Number.isFinite(v.updatedAt)?v.updatedAt:0},enumerable:true,configurable:true,writable:true});
  });
  var tombstones={};
  if(data.tombstones&&typeof data.tombstones==='object')Object.entries(data.tombstones).forEach(([id,t])=>{if(Number.isFinite(t)&&t>0)Object.defineProperty(tombstones,id,{value:t,enumerable:true,writable:true,configurable:true})});
  return {app:'igfc',version:3,snapshots:snapshots.filter(s=>!Object.hasOwn(tombstones,s.id)),tags,tombstones};
}
function mergeBackups(a,b){
  a=normalizeBackup(a);b=normalizeBackup(b);
  var tombstones={...a.tombstones};
  Object.entries(b.tombstones).forEach(([id,t])=>Object.defineProperty(tombstones,id,{value:Math.max(t,Object.hasOwn(tombstones,id)?tombstones[id]:0),enumerable:true,writable:true,configurable:true}));
  var snapshots=a.snapshots.filter(s=>!Object.hasOwn(tombstones,s.id));
  b.snapshots.forEach(s=>{if(!Object.hasOwn(tombstones,s.id)&&!snapshots.some(x=>x.id===s.id||x.date===s.date))snapshots.push(s)});
  snapshots.sort((x,y)=>x.date.localeCompare(y.date));
  var tags={...a.tags};
  Object.entries(b.tags).forEach(([u,v])=>{if(!Object.hasOwn(tags,u)||v.updatedAt>=tags[u].updatedAt)Object.defineProperty(tags,u,{value:v,enumerable:true,writable:true,configurable:true})});
  return {app:'igfc',version:3,snapshots,tags,tombstones};
}
function barChart(labels,values,label){
  if(!labels.length)return '<p class="muted">집계할 활동이 없습니다.</p>';
  var width=Math.max(600,labels.length*42),height=220,max=Math.max(1,...values),step=(width-60)/labels.length;
  return '<svg class="chart" role="img" aria-label="'+escapeHtml(label)+'" viewBox="0 0 '+width+' '+height+'"><title>'+escapeHtml(label)+'</title>'+values.map((v,i)=>{
    var h=v/max*150,x=40+i*step;return '<rect x="'+x+'" y="'+(175-h)+'" width="'+Math.max(2,step-8)+'" height="'+h+'" fill="#d62976"><title>'+escapeHtml(labels[i])+': '+v+'</title></rect><text x="'+x+'" y="195">'+escapeHtml(labels[i])+'</text><text x="'+x+'" y="'+(168-h)+'">'+v+'</text>';
  }).join('')+'</svg>';
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
