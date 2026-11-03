(function(){
'use strict';
const $=id=>document.getElementById(id),esc=escapeHtml,KEY='igfc_snapshots';
const state={followers:[],following:[],hasFollowers:false,hasFollowing:false,res:null,tab:'nfb',other:{},activity:emptyActivity(),me:''};
let data={app:'igfc',version:2,snapshots:[],tags:{}},mode='local';
const today=new Date();$('exDate').value=fmtDate(today.getTime()/1000);
function toast(text,ok=true){const el=$('toast');el.textContent=text;el.className='toast '+(ok?'tok':'terr');clearTimeout(el._t);el._t=setTimeout(()=>el.className='toast hidden',ok?3500:9000)}
function status(text,error=false){$('status').textContent=text;$('status').className='msg '+(error?'err':'ok')}
function idbAccess(write,value){return new Promise((resolve,reject)=>{
  let r;try{r=indexedDB.open('igfc',1)}catch(e){reject(e);return}
  r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('kv'))r.result.createObjectStore('kv')};r.onerror=()=>reject(r.error);
  r.onsuccess=()=>{const db=r.result;let result;const tx=db.transaction('kv',write?'readwrite':'readonly');const q=write?tx.objectStore('kv').put(value,KEY):tx.objectStore('kv').get(KEY);q.onsuccess=()=>result=q.result;tx.oncomplete=()=>{db.close();resolve(result)};tx.onerror=tx.onabort=()=>{db.close();reject(tx.error||new Error('저장 오류'))}};
})}
async function loadStore(){
  let a=null,b=null;
  try{localStorage.setItem('__igfc_t','1');localStorage.removeItem('__igfc_t');const raw=localStorage.getItem(KEY);if(raw)a=normalizeBackup(JSON.parse(raw))}catch(e){mode='idb'}
  try{const raw=await idbAccess(false);if(raw)b=normalizeBackup(raw)}catch(e){if(mode==='idb')mode='memory'}
  if(a)data=a;else if(b)data=b;
  renderSnaps();
  if(mode==='memory')toast('저장소를 사용할 수 없어 메모리에만 보관합니다. 새로고침 전에 JSON으로 내보내세요.',false);
}
async function persist(){
  if(mode==='local')try{localStorage.setItem(KEY,JSON.stringify(data));try{await idbAccess(true,data)}catch(e){}return true}catch(e){mode='idb'}
  if(mode==='idb')try{await idbAccess(true,data);try{localStorage.removeItem(KEY)}catch(e){}return true}catch(e){mode='memory'}
  toast('기기에 저장하지 못했습니다. 새로고침 전에 JSON으로 내보내세요.',false);return false;
}
function backup(){return JSON.parse(JSON.stringify(data))}
async function importBackup(input){await ready;data=mergeBackups(data,input);const saved=await persist();renderSnaps();if(state.res)refresh();return saved}
function download(name,text,type){const a=document.createElement('a'),url=URL.createObjectURL(new Blob(['\ufeff'+text],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
const driveInfoBtn=$('driveInfoBtn'),driveInfoDialog=$('driveInfoDialog'),driveInfoClose=$('driveInfoClose');
driveInfoBtn.onclick=()=>{if(typeof driveInfoDialog.showModal==='function')driveInfoDialog.showModal();else{driveInfoDialog.setAttribute('open','');driveInfoClose.focus()}};
driveInfoClose.onclick=()=>{if(typeof driveInfoDialog.close==='function')driveInfoDialog.close();else driveInfoDialog.removeAttribute('open');driveInfoBtn.focus()};
driveInfoDialog.addEventListener('cancel',()=>driveInfoBtn.focus());
driveInfoDialog.addEventListener('close',()=>driveInfoBtn.focus());
driveInfoDialog.addEventListener('click',e=>{if(e.target===driveInfoDialog)driveInfoClose.click()});
function fileText(f){if(f.text)return f.text();return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsText(f)})}
async function handle(files){
  await ready;
  try{
    const items=[];
    for(const f of files){
      if(/\.zip$/i.test(f.name)){
        if(typeof JSZip==='undefined')throw new Error('압축 해제 도구를 불러오지 못했습니다. 압축을 풀어 JSON을 선택하세요.');
        const z=await JSZip.loadAsync(f);
        for(const [name,entry] of Object.entries(z.files))if(!entry.dir&&(classify(name)||extraKind(name)))items.push({name,text:await entry.async('string')});
      }else items.push({name:f.name,text:await fileText(f)});
    }
    const followers=[],following=[],other={},activity=emptyActivity(),warnings=[],threadNames=new Map();let gotF=false,gotG=false,extras=0;
    for(const item of items){
      try{
        const result=parseFile(item.name,item.text);
        if(result){if(result.kind==='followers'){gotF=true;followers.push(...result.entries)}else{gotG=true;following.push(...result.entries)}continue}
        const kind=extraKind(item.name);if(!kind)continue;
        const json=JSON.parse(item.text.replace(/^\uFEFF/,''));extras++;
        if(['likes','comments','stories','messages'].includes(kind)){
          if(!activity.available.includes(kind))activity.available.push(kind);
          if(kind==='messages'){
            const messages=(json.messages||[]).filter(m=>m.sender_name).map(m=>({sender:fixText(m.sender_name),timestamp:seconds(m.timestamp_ms||m.timestamp)}));
            activity.messages.push(...messages);const thread=item.name.replace(/\/message_\d+\.json$/i,'');if(!threadNames.has(thread))threadNames.set(thread,new Set());messages.forEach(m=>threadNames.get(thread).add(m.sender));
          }else activity.events.push(...activityEntries(json,kind));
        }else other[kind]=dedupe((other[kind]||[]).concat(relationshipEntries(json)));
      }catch(e){warnings.push(item.name.split('/').pop()+' 해석 실패')}
    }
    if(!gotF&&!gotG&&!extras)throw new Error('지원하는 파일을 찾지 못했습니다. 팔로워 및 팔로잉과 활동을 JSON 형식으로 내보내세요.'+(warnings.length?' '+warnings.join(', '):''));
    if(gotF){state.followers=dedupe(followers);state.hasFollowers=true}if(gotG){state.following=dedupe(following);state.hasFollowing=true}
    // 팔로워 파일을 나누어 선택하는 기존 흐름은 유지하고, 활동은 선택 묶음별로 교체합니다.
    activity.threads=[...threadNames.values()].map(names=>[...names]);state.other=other;state.activity=activity;state.me=guessMe(activity);
    const missing=(!state.hasFollowers?' · 팔로워 파일 없음':'')+(!state.hasFollowing?' · 팔로잉 파일 없음':'');
    status('불러오기 완료: 팔로워 '+state.followers.length+'명, 팔로잉 '+state.following.length+'명'+missing+(warnings.length?' · '+warnings.join(', '):''),!!warnings.length);
    refresh();renderActivity(true);
  }catch(e){status('오류: '+e.message,true)}
}
function currentList(){
  if(!state.res)return [];
  const interacted=state.tab==='ghost'?activitySummary(state.activity,state.me).interacted:null;
  let list=state.tab==='fan'?state.res.fans:state.tab==='ghost'?state.followers.filter(e=>!interacted.has(accountKey(e.username))):state.tab==='other'?(state.other[$('otherKind').value]||[]):state.res.notFollowingBack;
  const q=accountKey($('q').value);list=list.filter(e=>(!q||accountKey(e.username).includes(q))&&(!$('hideTagged').checked||!data.tags[accountKey(e.username)]?.tag));
  return sortList(list,$('sort').value);
}
function refollowed(){const set=new Set(timeline(data.snapshots).filter(e=>e.refollowed).map(e=>accountKey(e.username)));
  if(state.hasFollowers&&data.snapshots.length){const temp={id:'current',date:$('exDate').value,followers:state.followers.map(e=>e.username)};if(temp.date>=data.snapshots.at(-1).date)timeline([...data.snapshots,temp]).filter(e=>e.refollowed).forEach(e=>set.add(accountKey(e.username)))}return set}
function accountRow(e,badges){
  const u=e.username,key=accountKey(u),note=data.tags[key]||{tag:'',memo:''};
  const options=['','지인','브랜드','무시'];if(note.tag&&!options.includes(note.tag))options.push(note.tag);options.push('__custom');
  return '<li class="account-row"><span class="avatar" aria-hidden="true">'+esc(Array.from(u)[0].toUpperCase())+'</span><a href="'+esc(safeProfile(u))+'" target="_blank" rel="noopener noreferrer">@'+esc(u)+'</a>'+(badges?.has(key)?'<span class="badge">재팔로우</span>':'')+'<span class="muted account-date">'+fmtDate(e.timestamp)+'</span><div class="note" data-user="'+esc(key)+'"><select class="tag" aria-label="'+esc(u)+' 태그">'+options.map(t=>'<option value="'+esc(t)+'"'+(t===note.tag?' selected':'')+'>'+esc(t==='__custom'?'직접 입력':t||'태그 없음')+'</option>').join('')+'</select><input class="memo" aria-label="'+esc(u)+' 메모" placeholder="메모" maxlength="2000" value="'+esc(note.memo)+'"></div></li>';
}
function renderList(){
  if(!state.res)return;
  $('otherKind').classList.toggle('hidden',state.tab!=='other');
  $('listHint').textContent=state.tab==='ghost'?'추정: 자료에서 반응 또는 DM 연결이 없는 팔로워입니다. 표시 이름 불일치·자료 누락에 유의하세요.':state.tab==='other'?(state.other[$('otherKind').value]?'제공된 파일에 있는 목록입니다.':'이 목록 파일이 제공되지 않았습니다.'):'태그와 메모는 기기 저장 및 JSON·Drive 백업에 포함됩니다.';
  const list=currentList(),badges=refollowed();$('count').textContent=list.length+'명';$('list').innerHTML=list.map(e=>accountRow(e,badges)).join('')||'<li class="muted">없습니다</li>';
}
function refresh(){state.res=compare(state.followers,state.following);$('results').classList.remove('hidden');$('summary').innerHTML=[['팔로워',state.hasFollowers?state.followers.length:'—'],['팔로잉',state.hasFollowing?state.following.length:'—'],['맞팔 안 함',state.hasFollowers&&state.hasFollowing?state.res.notFollowingBack.length:'—'],['나만 팔로우받음',state.hasFollowers&&state.hasFollowing?state.res.fans.length:'—']].map(([label,count])=>'<div class="stat-card"><span>'+label+'</span><strong>'+count.toLocaleString('ko-KR')+'</strong></div>').join('');renderList();renderDiff()}
function renderDiff(){
  const s=data.snapshots.find(s=>String(s.id)===$('snapSel').value),el=$('diff');
  if(!s||!state.hasFollowers){el.textContent='이전 스냅샷을 선택하고 현재 팔로워 파일을 올리세요.';return}
  const d=diffSnapshots(s.followers,state.followers.map(e=>e.username)),badges=refollowed();
  el.innerHTML='<p>'+esc(s.date)+' ~ '+esc($('exDate').value)+' 사이 · 언팔·삭제·비활성화·차단·아이디 변경일 수 있습니다.</p><h3>사라진 팔로워 '+d.lost.length+'명</h3><div class="result-scroll"><ul class="list">'+d.lost.map(u=>accountRow({username:u},badges)).join('')+'</ul></div><h3>새 팔로워 '+d.gained.length+'명</h3><div class="result-scroll"><ul class="list">'+d.gained.map(u=>accountRow({username:u},badges)).join('')+'</ul></div>';
}
function countChart(){
  const s=data.snapshots;if(!s.length)return '<p class="muted">저장된 스냅샷이 없습니다.</p>';
  const w=Math.max(600,s.length*110),max=Math.max(1,...s.map(x=>x.followers.length),...s.filter(x=>x.following).map(x=>x.following.length));
  let svg='<svg class="chart" role="img" aria-label="팔로워·팔로잉 수 변화" viewBox="0 0 '+w+' 240"><title>팔로워·팔로잉 수 변화</title><text x="20" y="16">분홍: 팔로워 · 파랑: 팔로잉 (구형 백업은 팔로잉 수 없음)</text>';
  for(const [field,color] of [['followers','#d62976'],['following','#2474b6']]){
    let segment=[];const flush=()=>{if(segment.length)svg+='<polyline fill="none" stroke="'+color+'" stroke-width="2" points="'+segment.join(' ')+'"/>';segment=[]};
    s.forEach((x,i)=>{if(!x[field]){flush();return}const px=50+i*(w-110)/Math.max(1,s.length-1),py=190-x[field].length/max*145;segment.push(px+','+py);svg+='<circle cx="'+px+'" cy="'+py+'" r="4" fill="'+color+'"><title>'+esc(x.date)+' '+(field==='followers'?'팔로워':'팔로잉')+' '+x[field].length+'명</title></circle><text x="'+px+'" y="'+(py-8)+'">'+x[field].length+'</text>'});flush();
  }
  svg+=s.map((x,i)=>'<text x="'+(20+i*(w-110)/Math.max(1,s.length-1))+'" y="220">'+esc(x.date)+'</text>').join('');return svg+'</svg>';
}
function renderSnaps(){
  const s=data.snapshots,previous=$('snapSel').value;if(s.length&&!state.res){state.res=compare(state.followers,state.following);$('results').classList.remove('hidden');selectTab('track');}
  $('snapList').innerHTML=s.map(x=>'<li><span>'+esc(x.date)+' · 팔로워 '+x.followers.length+'명 · 팔로잉 '+(x.following?x.following.length+'명':'정보 없음')+'</span><button class="sec ghost" data-del="'+esc(x.id)+'">삭제</button></li>').join('')||'<li>저장된 스냅샷이 없습니다</li>';
  $('snapSel').innerHTML=s.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.date)+'</option>').join('');$('snapSel').value=s.some(x=>String(x.id)===previous)?previous:String(s.at(-1)?.id||'');
  const events=timeline(s);$('timeline').innerHTML=events.map(e=>'<li><span>@'+esc(e.username)+' · '+esc(e.from)+' ~ '+esc(e.to)+' · '+e.type+'</span>'+(e.refollowed?'<span class="badge">재팔로우</span>':'')+'</li>').join('')||'<li>타임라인에는 날짜가 다른 스냅샷이 2개 이상 필요합니다.</li>';
  $('countChart').innerHTML=countChart();renderDiff();renderList();
}
function renderActivity(reset=false){
  const a=state.activity,names=[...new Set(a.messages.map(m=>m.sender))].sort();
  if(reset){$('me').innerHTML='<option value="">선택 안 함</option>'+names.map(n=>'<option>'+esc(n)+'</option>').join('');$('me').value=state.me}
  $('meHint').textContent='여러 대화에서 가장 자주 등장한 발신자를 내 이름으로 추정했습니다. 동명이인·그룹 대화로 틀릴 수 있으니 직접 선택하세요. 선택하지 않으면 보낸 메시지 통계는 제외됩니다.';
  $('activityHint').textContent=a.available.length?'자료에서 읽은 반응 '+a.events.length+'건 · 메시지 '+a.messages.length+'건. 없는 활동 종류는 집계에서 제외합니다.':'활동 자료가 없습니다. 좋아요·댓글·스토리 활동·메시지를 선택하여 JSON으로 내보내세요.';
  const summary=activitySummary(a,state.me);
  $('outRank').innerHTML=summary.outgoing.map(e=>'<li><span>@'+esc(e.username)+'</span><b>'+e.count+'회</b></li>').join('')||'<li>집계 가능한 계정 정보가 없습니다.</li>';
  $('dmRank').innerHTML=(state.me?summary.incoming.map(e=>'<li><span>'+esc(e.username)+'</span><b>'+e.count+'개</b></li>').join(''):'')||'<li>메시지 자료와 내 표시 이름을 확인하세요.</li>';
  $('hourChart').innerHTML=barChart(summary.hours.map((_,i)=>i+'시'),summary.hours,'현지 시간대별 내 활동');
  const months=Object.keys(summary.months).sort();$('monthChart').innerHTML=barChart(months,months.map(k=>summary.months[k]),'월별 내 활동');
  const available=a.events.some(e=>e.username)||a.messages.length>0;$('ghostTab').disabled=!available;$('ghostTab').title=available?'제공된 자료 기준 추정':'식별 가능한 활동 자료가 없어 추정할 수 없습니다';if(!available&&a.available.length)$('activityHint').textContent+=' 계정과 연결할 활동 자료가 없어 유령 팔로워 추정을 사용할 수 없습니다.';
  if(!available&&state.tab==='ghost')selectTab('nfb');renderList();
}
function selectTab(tab){state.tab=tab;document.querySelectorAll('.tabs button').forEach(b=>{b.classList.toggle('on',b.dataset.t===tab);b.setAttribute('aria-pressed',String(b.dataset.t===tab))});$('listPane').classList.toggle('hidden',tab==='track');$('trackPane').classList.toggle('hidden',tab!=='track');renderList();renderDiff()}
$('drop').onclick=()=>$('file').click();$('drop').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('file').click()}};
for(const event of ['dragover','dragenter'])$('drop').addEventListener(event,e=>{e.preventDefault();$('drop').classList.add('over')});
for(const event of ['dragleave','drop'])$('drop').addEventListener(event,e=>{e.preventDefault();$('drop').classList.remove('over')});
$('drop').addEventListener('drop',e=>handle(Array.from(e.dataTransfer.files)));$('file').onchange=function(){handle(Array.from(this.files));this.value=''};
for(const id of ['q','sort','hideTagged','otherKind'])$(id).addEventListener(id==='q'?'input':'change',renderList);
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>selectTab(b.dataset.t));
$('results').addEventListener('change',async e=>{
  const row=e.target.closest('.note');if(!row)return;
  let tag=row.querySelector('.tag').value;
  if(tag==='__custom'){const custom=prompt('태그 이름을 입력하세요');if(custom===null){renderList();renderDiff();return}tag=custom.trim().slice(0,100)}
  const key=row.dataset.user;Object.defineProperty(data.tags,key,{value:{tag,memo:row.querySelector('.memo').value.slice(0,2000)},enumerable:true,writable:true,configurable:true});
  await persist();renderList();renderDiff();
});
$('me').onchange=()=>{state.me=$('me').value;renderActivity()};
$('copyCsv').onclick=()=>{const text=toCsv(currentList());(navigator.clipboard?navigator.clipboard.writeText(text):Promise.reject()).then(()=>toast('CSV를 복사했습니다'),()=>prompt('복사하세요',text))};
$('dlCsv').onclick=()=>download('instagram_'+state.tab+'.csv',toCsv(currentList()),'text/csv');
$('saveSnap').onclick=async()=>{
  await ready;if(!state.hasFollowers)return toast('팔로워 파일을 먼저 올려주세요.',false);
  const date=$('exDate').value;if(!date)return toast('내보내기 날짜를 선택하세요.',false);
  const snap={id:String(Date.now()),date,followers:state.followers.map(e=>e.username)};if(state.hasFollowing)snap.following=state.following.map(e=>e.username);
  if(data.snapshots.some(s=>s.date===date))return toast('같은 날짜의 스냅샷이 있습니다. 다른 날짜를 선택하거나 기존 스냅샷을 삭제하세요.',false);
  data.snapshots.push(snap);data.snapshots.sort((a,b)=>a.date.localeCompare(b.date));const saved=await persist();renderSnaps();$('snapSel').value=snap.id;renderDiff();
  if(saved)toast(date+' 스냅샷을 저장했습니다');else download('instagram_snapshots.json',JSON.stringify(backup()),'application/json');
};
$('snapList').onclick=async e=>{const id=e.target.dataset.del;if(id&&confirm('이 스냅샷을 삭제할까요?')){data.snapshots=data.snapshots.filter(s=>String(s.id)!==id);const saved=await persist();renderSnaps();if(saved)toast('삭제했습니다')}};
$('snapSel').onchange=renderDiff;$('exDate').onchange=()=>{renderDiff();renderList()};
$('expSnap').onclick=()=>download('instagram_snapshots_'+$('exDate').value+'.json',JSON.stringify(backup(),null,2),'application/json');
$('impBtn').onclick=()=>$('impFile').click();$('impFile').onchange=async function(){try{if(!this.files[0])return;const saved=await importBackup(JSON.parse((await fileText(this.files[0])).replace(/^\uFEFF/,'')));if(saved)toast('스냅샷과 메모를 가져왔습니다')}catch(e){toast('올바른 스냅샷 파일이 아닙니다: '+e.message,false)}this.value=''};
const ready=loadStore();
window.IGApp={ready,state,handle,backup,importBackup,toast,selectTab,currentList,get storageMode(){return mode}};
if('serviceWorker' in navigator&&(location.protocol==='https:'||['localhost','127.0.0.1','[::1]'].includes(location.hostname)))navigator.serviceWorker.register('./sw.js').catch(()=>toast('오프라인 준비에 실패했습니다. 온라인에서는 계속 사용할 수 있습니다.',false));
})();
