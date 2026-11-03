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
 const dom=await page(),w=dom.window,app=w.IGApp,$=id=>w.document.getElementById(id);
 assert.equal(app.storageMode,'local');assert.deepEqual(Array.from(w.swRegistrations),['./sw.js']);assert.equal($('driveSave').disabled,true);assert.match($('driveSave').textContent,/설정 필요/);
 assert.equal(w.document.querySelector('script[src*="gsi"]'),null,'GIS는 지연 로드');
 const read=name=>JSON.parse(fs.readFileSync(path.join(root,'samples',name),'utf8'));
 await app.importBackup(read('sample_snapshot_backup.json'));assert.equal(app.backup().snapshots.length,1);$('snapList').querySelector('[data-del]').click();await tick();assert.equal(app.backup().snapshots.length,0);
 await app.importBackup(read('sample_snapshot_backup_full.json'));await app.importBackup(read('sample_snapshot_backup_full.json'));
 assert.equal(app.backup().snapshots.length,3);assert.equal(app.backup().tags.sample_brand.tag,'브랜드');
 assert.match($('timeline').textContent,/sample_return.*재팔로우/s);assert.ok($('countChart').querySelector('svg'));assert.match($('countChart').textContent,/정보|팔로잉/);
 // 날짜가 같고 ID가 다른 백업도 중복을 만들지 않습니다.
 await app.importBackup({snapshots:[{id:'other-id',date:'2026-11-01',followers:['fake']}],tags:{}});assert.equal(app.backup().snapshots.length,3);
 const file=new w.File([fs.readFileSync(path.join(root,'samples/sample_export_full.zip'))],'sample_export_full.zip');
 await app.handle([file]);assert.equal(app.state.followers.length,4);assert.equal(app.state.following.length,2);
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
 Object.defineProperty($('file'),'files',{value:[followers],configurable:true});$('file').dispatchEvent(new w.Event('change'));await tick();
 assert.equal($('ghostTab').disabled,true);assert.match($('activityHint').textContent,/자료가 없습니다/);
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
 configured=true;const drive=await page(),d=drive.window,da=d.IGApp;let calls=[],remote=read('sample_snapshot_backup_full.json');
 assert.equal(gisLoads,0);assert.equal(d.document.querySelector('script[src*="gsi"]'),null);
 d.fetch=async(url,opts={})=>{calls.push({url,opts});return {ok:true,json:async()=>url.includes('alt=media')?remote:url.includes('spaces=')?{files:[{id:'remote'}]}:{id:'created'}}};
 d.document.getElementById('driveLoad').click();await tick();assert.equal(gisLoads,1);assert.equal(da.backup().snapshots.length,3);assert.equal(da.backup().tags.sample_brand.tag,'브랜드');
 d.document.getElementById('driveSave').click();await tick();assert.ok(calls.some(c=>c.opts.method==='PATCH'&&JSON.parse(c.opts.body).tags.sample_brand));
 calls=[];d.fetch=async(url,opts={})=>{calls.push({url,opts});return {ok:true,json:async()=>url.includes('spaces=')?{files:[]}:{id:'created'}}};d.document.getElementById('driveSave').click();await tick();assert.ok(calls.some(c=>c.opts.method==='POST'&&JSON.parse(c.opts.body).parents[0]==='appDataFolder'));
 d.fetch=async()=>({ok:false,status:403});d.document.getElementById('driveLoad').click();await tick();assert.match(d.document.getElementById('toast').textContent,/403/);assert.equal(d.document.getElementById('driveLoad').disabled,false);drive.window.close();
 // 서비스 워커의 상대 경로 셸과 오프라인 응답을 검사합니다.
 const handlers={},cached=new Map();let shell=[];const cache={addAll:async list=>{shell=list;list.forEach(p=>cached.set(new URL(p,'https://example.test/instagram-manager/').href,{ok:true,cached:true}))},match:async req=>cached.get(req.url),put:async()=>{}};
 const context={URL,Set,caches:{open:async()=>cache,keys:async()=>[],delete:async()=>true},fetch:async()=>{throw Error('offline')},self:{registration:{scope:'https://example.test/instagram-manager/'},addEventListener:(k,f)=>handlers[k]=f,skipWaiting:async()=>{},clients:{claim:async()=>{}}}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'sw.js'),'utf8'),context);
 let pending;handlers.install({waitUntil:p=>pending=p});await pending;assert.ok(shell.includes('./vendor/jszip.min.js'));for(const p of shell)assert.ok(fs.existsSync(path.join(root,p==='./'?'index.html':p)));
 handlers.fetch({request:{method:'GET',url:'https://example.test/instagram-manager/js/app.js'},respondWith:p=>pending=p});assert.equal((await pending).cached,true);
 console.log('통과: 기존 JSON·ZIP·HTML, 백업 호환/병합, 타임라인/재팔로우, 태그/메모, 활동 순위/통계, 기타 목록, 유령 추정, 저장소 대체, Drive 모의 요청, PWA 오프라인 셸');
}
const deadline=setTimeout(()=>{console.error('테스트 시간 초과: 완료되지 않은 비동기 작업');process.exit(1)},20000);
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>clearTimeout(deadline));
