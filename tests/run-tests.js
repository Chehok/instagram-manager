'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM,VirtualConsole,requestInterceptor}=require('jsdom');
const root=path.resolve(__dirname,'..');
const tick=()=>new Promise(r=>setTimeout(r,20));
let configured=false,gisLoads=0;
const localResources={interceptors:[requestInterceptor(request=>{
 if(request.url==='https://accounts.google.com/gsi/client'){gisLoads++;return new Response("window.google={accounts:{oauth2:{initTokenClient:function(o){return {requestAccessToken:function(){o.callback({access_token:'fake-token'})}}}}}}",{headers:{'Content-Type':'application/javascript'}})}
 if(/^https?:\/\/gc\.zgo\.at\/count\.js$/.test(request.url))return new Response('',{headers:{'Content-Type':'application/javascript'}});
 const name=new URL(request.url).pathname.replace(/^\/instagram-manager\//,'');
 const file=path.resolve(root,name);if(!file.startsWith(root+path.sep))throw new Error('잘못된 경로');
 const body=name==='config.js'?(configured?"const GOOGLE_CLIENT_ID='fake-client';":"const GOOGLE_CLIENT_ID='';"):fs.readFileSync(file);
 return new Response(body,{headers:{'Content-Type':name.endsWith('.css')?'text/css':'application/javascript'}});
})]};
async function page(options={}){
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e));
 const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:options.url||'https://example.test/instagram-manager/',runScripts:'dangerously',resources:localResources,virtualConsole:vc,beforeParse(w){
  w.setImmediate=setImmediate;w.clearImmediate=clearImmediate;w.TextDecoder=TextDecoder;w.swRegistrations=[];Object.defineProperty(w.navigator,'serviceWorker',{value:{register:async url=>{w.swRegistrations.push(url)}}});w.prompt=()=>null;w.confirm=()=>true;w.URL.createObjectURL=()=> 'blob:fake';w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){w.lastDownload=this.download};
  if(!w.HTMLDialogElement.prototype.showModal)w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');this.dispatchEvent(new w.Event('beforetoggle'))};
  if(!w.HTMLDialogElement.prototype.close)w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'))};
  if(options.storage)for(const [key,value] of Object.entries(options.storage))w.localStorage.setItem(key,typeof value==='string'?value:JSON.stringify(value));
  if(options.fetch)w.fetch=options.fetch;
  if(options.auth)w.google={accounts:{oauth2:{initTokenClient:o=>({requestAccessToken:params=>options.auth(o,params)})}}};
  if(options.noLocal)Object.defineProperty(w,'localStorage',{get(){throw new Error('blocked')}});
  if(options.indexedDB)w.indexedDB=options.indexedDB;
 }});
 await new Promise(r=>dom.window.addEventListener('load',r,{once:true}));await dom.window.IGApp.ready;
 assert.deepEqual(errors,[],'스크립트 로드 오류');return dom;
}
function fakeIDB(){
 let value;
 return {open(){const req={};setTimeout(()=>{req.result={close(){},transaction(){const tx={objectStore(){return {get(){const q={};setTimeout(()=>{q.result=value;q.onsuccess?.();setTimeout(()=>tx.oncomplete?.(),0)},0);return q},put(v){value=JSON.parse(JSON.stringify(v));setTimeout(()=>tx.oncomplete?.(),0);return {}}}}};return tx}};req.onsuccess()},0);return req}};
}
async function main(){
 await require('./drive-tests')();
 const dom=await page(),w=dom.window,app=w.IGApp,$=id=>w.document.getElementById(id);
 assert.equal(app.storageMode,'local');assert.deepEqual(Array.from(w.swRegistrations),['./sw.js']);assert.equal($('driveConnect').disabled,true);assert.equal($('heroDrive').disabled,true);
 assert.equal($('results').classList.contains('hidden'),true);assert.equal($('hero').classList.contains('hidden'),false);
 $('heroImport').click();$('hero').querySelector('[data-dialog]').click();assert.equal($('guideDialog').open,true);$('guideDialog').querySelector('[data-close]').click();assert.equal($('guideDialog').open,false);
 $('driveInfoBtn').click();assert.equal($('driveInfoDialog').open,true,'Drive 미설정 상태에서도 안내 열기');$('driveInfoClose').click();assert.equal($('driveInfoDialog').open,false,'닫기 버튼');assert.equal(w.document.activeElement,$('driveInfoBtn'),'닫은 뒤 버튼으로 포커스 복귀');
 $('driveInfoBtn').click();$('driveInfoDialog').dispatchEvent(new w.Event('cancel',{cancelable:true}));$('driveInfoDialog').close();assert.equal($('driveInfoDialog').open,false,'Esc/cancel 닫기');assert.equal(w.document.activeElement,$('driveInfoBtn'),'Esc 뒤 버튼으로 포커스 복귀');
 assert.equal(w.document.querySelector('script[src*="gsi"]'),null,'GIS는 지연 로드');
 const read=name=>JSON.parse(fs.readFileSync(path.join(root,'samples',name),'utf8'));
 await app.importBackup(read('sample_snapshot_backup.json'));assert.equal(app.backup().snapshots.length,1);$('snapList').querySelector('[data-del]').click();await tick();assert.equal(app.backup().snapshots.length,0);assert.ok(app.backup().tombstones['1']);await app.importBackup(read('sample_snapshot_backup.json'));assert.equal(app.backup().snapshots.length,0,'삭제한 스냅샷은 다시 가져와도 복구되지 않음');
 await app.importBackup(read('sample_snapshot_backup_full.json'));await app.importBackup(read('sample_snapshot_backup_full.json'));
 assert.equal(app.backup().snapshots.length,3);assert.equal(app.backup().tags.sample_brand.tag,'브랜드');
 assert.match($('timeline').textContent,/sample_return.*재팔로우/s);assert.ok($('countChart').querySelector('svg'));assert.match($('countChart').textContent,/정보|팔로잉/);
 // 날짜가 같고 ID가 다른 백업도 중복을 만들지 않습니다.
 await app.importBackup({snapshots:[{id:'other-id',date:'2026-11-01',followers:['fake']}],tags:{}});assert.equal(app.backup().snapshots.length,3);
 const file=new w.File([fs.readFileSync(path.join(root,'samples/sample_export_full.zip'))],'sample_export_full.zip');
 await app.handle([file]);assert.equal(app.state.followers.length,4);assert.equal(app.state.following.length,2);
 assert.equal($('hero').classList.contains('hidden'),true);assert.equal($('resultsHeader').classList.contains('hidden'),false);
 const sections=[...w.document.querySelectorAll('[data-section]')];for(const button of sections){button.click();assert.equal(button.getAttribute('aria-current'),'page');assert.equal(w.document.querySelectorAll('[data-panel]:not(.hidden)').length,1);assert.equal($(button.getAttribute('aria-controls')).hidden,false)}
 sections[0].focus();sections[0].dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.equal(w.document.activeElement,sections[1]);assert.equal(sections[1].getAttribute('aria-current'),'page');
 let opened=0;$('file').click=()=>opened++;$('uploadAgain').click();assert.equal(opened,1);
 assert.equal(app.state.res.notFollowingBack[0].username,'sample_brand');assert.equal(app.state.res.fans.length,3);
 assert.equal(app.state.me,'가상 나');assert.equal(app.state.activity.messages.length,6);assert.equal(app.state.activity.events.length,11);
 const stats=w.activitySummary(app.state.activity,app.state.me);
 assert.equal(stats.outgoing.find(e=>e.username==='sample_brand').count,7);assert.equal(stats.incoming.find(e=>e.username==='sample_ari').count,2);
 assert.equal(stats.hours.reduce((a,b)=>a+b,0),7);assert.equal(Object.keys(stats.months).length,2);
 assert.equal($('hourChart').querySelectorAll('rect').length,24);assert.equal($('monthChart').querySelectorAll('rect').length,2);
 assert.equal($('ghostTab').disabled,false);app.selectTab('ghost');assert.deepEqual(Array.from(app.currentList(),e=>e.username).sort(),['sample_ghost','sample_return']);assert.match($('list').textContent,/재팔로우/);
 app.selectTab('other');for(const k of ['pending','unfollowed','blocked','restricted','close']){$('otherKind').value=k;$('otherKind').dispatchEvent(new w.Event('change'));assert.equal(app.currentList().length,1)}
 app.selectTab('nfb');$('hideTagged').checked=true;$('hideTagged').dispatchEvent(new w.Event('change'));assert.equal(app.currentList().length,0);$('hideTagged').checked=false;$('hideTagged').dispatchEvent(new w.Event('change'));
 let memo=$('list').querySelector('.memo');memo.value='새 메모 <가상>';memo.dispatchEvent(new w.Event('change',{bubbles:true}));await tick();assert.equal(app.backup().tags.sample_brand.memo,'새 메모 <가상>');
 w.prompt=()=> '직접 태그';const tag=$('list').querySelector('.tag');tag.value='__custom';tag.dispatchEvent(new w.Event('change',{bubbles:true}));await tick();assert.equal(app.backup().tags.sample_brand.tag,'직접 태그');
 assert.equal(JSON.parse(w.localStorage.getItem('igfc_snapshots')).tags.sample_brand.tag,'직접 태그');
 $('expSnap').click();assert.match(w.lastDownload,/instagram_snapshots/);assert.match(w.toCsv(app.currentList()),/sample_brand/);
 $('q').value='nothing';$('q').dispatchEvent(new w.Event('input'));assert.equal(app.currentList().length,0);$('q').value='';
 // 스냅샷 저장·선택 비교, 빈 팔로워 스냅샷까지 지원합니다.
 $('exDate').value='2026-12-01';$('saveSnap').click();await tick();assert.equal(app.backup().snapshots.length,4);
 app.selectTab('track');$('snapSel').value='fake-2';$('snapSel').dispatchEvent(new w.Event('change'));assert.match($('diff').textContent,/새 팔로워 2명/);
 $('snapList').querySelector('[data-del="fake-1"]').click();await tick();assert.equal(app.backup().snapshots.length,3);
 // 파일 선택 입력 경로로도 이전 단일 JSON / HTML 기능을 검증합니다.
 const followers=new w.File([fs.readFileSync(path.join(root,'samples/followers_1.json'))],'followers_1.json');
 // Chromium clears the live FileList when the input is reset, before handle resumes.
 const selectedFiles=[followers];let inputResets=0;
 Object.defineProperty($('file'),'files',{value:selectedFiles,configurable:true});
 Object.defineProperty($('file'),'value',{set(value){assert.equal(value,'');selectedFiles.length=0;inputResets++},configurable:true});
 $('file').dispatchEvent(new w.Event('change'));assert.equal(inputResets,1);assert.equal(selectedFiles.length,0);await tick();
 assert.match($('status').textContent,/^불러오기 완료/);assert.equal(app.state.followers.length,read('followers_1.json').length);
 delete $('file').files;delete $('file').value;
 assert.equal($('ghostTab').disabled,true);assert.match($('activityHint').textContent,/자료가 없습니다/);
 // A drop's FileList is only available during event dispatch.
 const droppedFiles=[followers],dropEvent=new w.Event('drop',{cancelable:true});
 Object.defineProperty(dropEvent,'dataTransfer',{value:{files:droppedFiles}});
 $('drop').dispatchEvent(dropEvent);droppedFiles.length=0;await tick();
 assert.match($('status').textContent,/^불러오기 완료/);assert.equal(app.state.followers.length,read('followers_1.json').length);
 await app.handle([new w.File([fs.readFileSync(path.join(root,'samples/sample_export.zip'))],'sample_export.zip')]);assert.ok(app.state.followers.length);
 assert.equal(w.parseHtmlList('<a href="https://www.instagram.com/sample_html/">sample_html</a>').length,1);
 await app.handle([new w.File(['[]'],'followers_1.json')]);$('exDate').value='2027-01-01';$('saveSnap').click();await tick();assert.equal(app.backup().snapshots.at(-1).followers.length,0);
 await app.handle([new w.File(['{broken'],'liked_posts.json'),new w.File(['[]'],'followers_1.json')]);assert.match($('status').textContent,/해석 실패/);assert.equal($('ghostTab').disabled,true);
 await app.handle([new w.File(['{"likes_media_likes":[]}'],'liked_posts.json')]);assert.equal($('ghostTab').disabled,true);
 await assert.rejects(()=>app.importBackup({snapshots:[{date:'bad',followers:[]}]}));
 // 입력 문자열을 HTML로 실행하지 않습니다.
 await app.importBackup({snapshots:[],tags:{sample_brand:{memo:'<img src=x onerror=alert(1)>',tag:'<script>'}}});
 assert.equal(w.document.querySelector('.note img'),null);
 dom.window.close();
 const fallback=await page({noLocal:true,indexedDB:fakeIDB(),url:'http://example.test/instagram-manager/'});assert.equal(fallback.window.swRegistrations.length,0);assert.equal(fallback.window.IGApp.storageMode,'idb');await fallback.window.IGApp.importBackup(read('sample_snapshot_backup_full.json'));assert.equal(fallback.window.IGApp.backup().snapshots.length,3);fallback.window.close();
 const memory=await page({noLocal:true,url:'http://localhost/instagram-manager/'});assert.equal(memory.window.swRegistrations[0],'./sw.js');assert.equal(memory.window.IGApp.storageMode,'memory');assert.equal(await memory.window.IGApp.importBackup(read('sample_snapshot_backup_full.json')),false);assert.equal(memory.window.IGApp.backup().snapshots.length,3);memory.window.close();
 // Google 호출은 가짜 GIS·fetch로 검사하며 실제 계정에 접근하지 않습니다.
 configured=true;const drive=await page(),d=drive.window,da=d.IGApp,ds=id=>d.document.getElementById(id);let calls=[],remote=read('sample_snapshot_backup_full.json');
 const waitSync=()=>new Promise(r=>setTimeout(r,2150));
 const mockFetch=async(url,opts={})=>{calls.push({url,opts});if(opts.method==='PATCH')remote=JSON.parse(opts.body);return {ok:true,json:async()=>url.includes('userinfo')?{email:'person@example.com'}:url.includes('alt=media')?remote:url.includes('spaces=')?{files:[{id:'remote'}]}:{id:'created'}}};
 assert.equal(gisLoads,1);assert.ok(d.document.querySelector('script[src*="gsi"]'),'GIS is preloaded without requesting a token');
 d.fetch=mockFetch;ds('heroDrive').click();await tick();await tick();assert.equal(gisLoads,1);assert.equal(da.backup().snapshots.length,3);assert.equal(da.backup().tags.sample_brand.tag,'브랜드');
 assert.equal(d.localStorage.getItem('igfc_drive_connected'),'1');assert.match(ds('driveHint').textContent,/연결됨.*방금 동기화/);assert.equal(ds('hero').classList.contains('hidden'),true);
 assert.ok(calls.some(c=>c.opts.method==='PATCH'&&JSON.parse(c.opts.body).tags.sample_brand));
 // Local edits are debounced, merged with newly arrived remote data, then uploaded.
 calls=[];await da.importBackup({snapshots:[{id:'local',date:'2026-12-12',followers:[]}],tags:{sample_brand:{tag:'수정',memo:'local',updatedAt:Date.now()}}});
 remote.snapshots.push({id:'remote-new',date:'2026-12-13',followers:['remote']});
 await da.importBackup({snapshots:[],tags:{}});assert.equal(calls.length,0);await waitSync();
 assert.equal(calls.filter(c=>c.opts.method==='PATCH').length,1);assert.equal(remote.snapshots.length,5);assert.equal(remote.tags.sample_brand.memo,'local');
 // Deletion uploads a tombstone and an old remote copy cannot resurrect it.
 const stale=JSON.parse(JSON.stringify(remote));calls=[];ds('snapList').querySelector('[data-del="fake-1"]').click();await tick();await waitSync();assert.ok(remote.tombstones['fake-1']);assert.equal(remote.snapshots.some(s=>s.id==='fake-1'),false);
 remote=stale;await da.importBackup({snapshots:[],tags:{}});await waitSync();assert.equal(remote.snapshots.some(s=>s.id==='fake-1'),false);
 remote.tombstones['fake-2']=Date.now();await da.importBackup({snapshots:[],tags:{}});await waitSync();assert.equal(da.backup().snapshots.some(s=>s.id==='fake-2'),false,'원격 삭제도 로컬로 병합');
 // Memo/tag edits and snapshot saves also auto-upload.
 await da.handle([new d.File(['[{"string_list_data":[{"value":"sample_brand"}]}]'],'following.json'),new d.File(['[]'],'followers_1.json')]);da.selectTab('nfb');
 const driveMemo=ds('list').querySelector('.memo');driveMemo.value='자동 메모';driveMemo.dispatchEvent(new d.Event('change',{bubbles:true}));await tick();await waitSync();assert.equal(remote.tags.sample_brand.memo,'자동 메모');
 ds('exDate').value='2027-02-01';ds('saveSnap').click();await tick();await waitSync();assert.ok(remote.snapshots.some(s=>s.date==='2027-02-01'));
 // Empty Drive creates the hidden appDataFolder file automatically.
 calls=[];d.fetch=async(url,opts={})=>{calls.push({url,opts});return {ok:true,json:async()=>url.includes('spaces=')?{files:[]}:{id:'created'}}};await da.importBackup({snapshots:[],tags:{}});await waitSync();assert.ok(calls.some(c=>c.opts.method==='POST'&&JSON.parse(c.opts.body).parents[0]==='appDataFolder'));
 d.fetch=async()=>({ok:false,status:403});await da.importBackup({snapshots:[],tags:{}});await waitSync();assert.match(ds('driveHint').textContent,/403/);assert.equal(ds('driveRetry').classList.contains('hidden'),false);
 d.fetch=mockFetch;ds('driveRetry').click();await tick();await tick();assert.match(ds('driveHint').textContent,/연결됨/);
 ds('driveDisconnect').click();assert.equal(d.localStorage.getItem('igfc_drive_connected'),null);calls=[];await da.importBackup({snapshots:[],tags:{}});await waitSync();assert.equal(calls.length,0);drive.window.close();
 // Returning accounts show a calm resume action and only authorize in a gesture.
 let prompts=[];const reconnect=await page({storage:{igfc_drive_connected:1,igfc_drive_email:'person@example.com',igfc_snapshots:read('sample_snapshot_backup_full.json')},fetch:mockFetch,auth:(o,p)=>{prompts.push(p);o.callback({access_token:'resumed',expires_in:3600})}});await tick();
 const rd=reconnect.window.document;assert.deepEqual(prompts,[]);assert.match(rd.getElementById('driveResume').textContent,/person@example.com/);assert.equal(rd.getElementById('driveResume').classList.contains('hidden'),false);
 rd.getElementById('driveResume').click();assert.equal(prompts.length,1);assert.equal(prompts[0].prompt,'');assert.equal(prompts[0].login_hint,'person@example.com');await tick();assert.match(rd.getElementById('driveHint').textContent,/연결됨/);reconnect.window.close();
 // Every meaningful interaction invokes reconnect in the same handler stack; failure only auto-attempts once.
 for(const action of ['uploadAgain','drop','dropKeyboard']){
   prompts=[];const up=await page({storage:{igfc_drive_connected:1,igfc_drive_email:'person@example.com',igfc_snapshots:read('sample_snapshot_backup_full.json')},auth:(o,p)=>{prompts.push(p);o.callback({error:'interaction_required'})},fetch:mockFetch});
   const ud=up.window.document;ud.getElementById('file').click=()=>{};const t=ud.getElementById(action==='dropKeyboard'?'drop':action);
   if(action==='dropKeyboard')t.dispatchEvent(new up.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));else t.click();
   assert.equal(prompts.length,0,action+' must not trigger Drive reconnect');await tick();up.window.close();
 }
 for(const action of ['saveSnap','delete','tag','memo','heroImport','impBtn','nav','tab']){
   prompts=[];const needsLogin=await page({storage:{igfc_drive_connected:1,igfc_drive_email:'person@example.com',igfc_snapshots:read('sample_snapshot_backup_full.json')},auth:(o,p)=>{prompts.push(p);o.callback({error:'interaction_required'})},fetch:mockFetch});
   const nl=needsLogin.window.document;needsLogin.window.IGApp.selectTab('nfb');
   let target=action==='delete'?nl.querySelector('[data-del]'):action==='nav'?nl.querySelector('[data-section]'):action==='tab'?nl.querySelector('.tabs button'):action==='dropKeyboard'?nl.getElementById('drop'):nl.getElementById(action);
   if(action==='tag'||action==='memo'){
     target=nl.createElement('input');target.className=action;const row=nl.createElement('div');row.className='note';row.append(target);nl.body.append(row);
     target.dispatchEvent(new needsLogin.window.Event('change',{bubbles:true}));
   }else if(action==='dropKeyboard')target.dispatchEvent(new needsLogin.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
   else target.click();
   assert.equal(prompts.length,1,action+' reconnects synchronously');assert.equal(prompts[0].login_hint,'person@example.com');await tick();
   nl.querySelector('[data-section]').click();await tick();assert.equal(prompts.length,1,'only one automatic attempt');
   nl.getElementById('driveResume').click();assert.equal(prompts.length,2,'explicit reconnect can retry');await tick();needsLogin.window.close();
 }
 // 서비스 워커의 상대 경로 셸과 오프라인 응답을 검사합니다.
 const handlers={},cached=new Map();let shell=[];const cache={addAll:async list=>{shell=list;list.forEach(p=>cached.set(new URL(p,'https://example.test/instagram-manager/').href,{ok:true,cached:true}))},match:async req=>cached.get(req.url),put:async()=>{}};
 const context={URL,Set,caches:{open:async()=>cache,keys:async()=>[],delete:async()=>true},fetch:async()=>{throw Error('offline')},self:{registration:{scope:'https://example.test/instagram-manager/'},addEventListener:(k,f)=>handlers[k]=f,skipWaiting:async()=>{},clients:{claim:async()=>{}}}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'sw.js'),'utf8'),context);
 let pending;handlers.install({waitUntil:p=>pending=p});await pending;assert.ok(shell.includes('./vendor/jszip.min.js'));for(const p of shell)assert.ok(fs.existsSync(path.join(root,p==='./'?'index.html':p)));
 handlers.fetch({request:{method:'GET',url:'https://example.test/instagram-manager/js/app.js'},respondWith:p=>pending=p});assert.equal((await pending).cached,true);
 console.log('통과: 기존 JSON·ZIP·HTML, 백업 호환/병합, 타임라인/재팔로우, 태그/메모, 활동 순위/통계, 기타 목록, 유령 추정, 저장소 대체, Drive 모의 요청, PWA 오프라인 셸');
}
const deadline=setTimeout(()=>{console.error('테스트 시간 초과: 완료되지 않은 비동기 작업');process.exit(1)},45000);
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>clearTimeout(deadline));

