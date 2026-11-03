'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
async function run(){
  function setup({saved=false,email='person@example.com',pending=false,authError=false,remote=null,local={snapshots:[],tags:{}}}={}){
    const elements=new Map(),events={},storage=new Map(saved?[['igfc_drive_connected','1'],['igfc_drive_email',email],...(pending?[['igfc_drive_dirty','1']]:[])]:[]),timers=new Map();
    let clock=100000,nextTimer=0,record=remote,fail=0,authFails=authError;
    const calls=[],prompts=[],authRequests=[];
    const element=id=>{if(!elements.has(id)){const classes=new Set();elements.set(id,{textContent:'',classList:{toggle(name,on){on?classes.add(name):classes.delete(name)},contains:name=>classes.has(name)}})}return elements.get(id)};
    const ctx={URLSearchParams,Date:class extends Date{static now(){return clock}},Number,Promise,Object,Error,Math,JSON,GOOGLE_CLIENT_ID:'mock-client',
      setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,at:clock+ms});return id},clearTimeout:id=>timers.delete(id),setInterval(){},
      localStorage:{getItem:key=>storage.get(key),setItem:(key,v)=>storage.set(key,v),removeItem:key=>storage.delete(key)},
      document:{getElementById:element},
      addEventListener:(name,fn)=>events[name]=fn,
      google:{accounts:{oauth2:{initTokenClient:o=>({requestAccessToken(params){prompts.push(params.prompt);authRequests.push(params);assert.match(o.scope,/openid email/);o.callback(authFails?{error:'interaction_required'}:{access_token:'token',expires_in:3600})}})}}},
      fetch:async(url,options={})=>{
        calls.push({url,options});if(fail)return {ok:false,status:fail};
        if(options.method==='PATCH')record=JSON.parse(options.body);
        return {ok:true,json:async()=>url.includes('userinfo')?{email}:url.includes('alt=media')?record:url.includes('spaces=')?{files:record?[{id:'remote'}]:[]}:{id:'created'}};
      }
    };
    ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(root,'js/data.js'),'utf8'),ctx);
    let data=ctx.normalizeBackup(local);
    ctx.IGApp={ready:Promise.resolve(),backup:()=>JSON.parse(JSON.stringify(data)),importBackup:async(input,notify=true)=>{data=ctx.mergeBackups(data,input);if(notify)events['igfc:change']();return true}};
    vm.runInContext(fs.readFileSync(path.join(root,'js/drive.js'),'utf8'),ctx);
    const settle=async()=>{for(let i=0;i<40;i++)await Promise.resolve()};
    return {ctx,calls,prompts,authRequests,storage,element,settle,get remote(){return record},set remote(value){record=value},set fail(value){fail=value},set authError(value){authFails=value},
      change:()=>events['igfc:change'](),async advance(ms){clock+=ms;for(const [id,t] of [...timers])if(t.at<=clock){timers.delete(id);t.fn()}await settle()}};
  }
  const snap=(id,date)=>({id,date,followers:['test']});
  const app=setup({remote:{snapshots:[snap('remote','2026-01-01')],tags:{test:{memo:'old'}}},local:{snapshots:[snap('local','2026-02-01')],tags:{test:{memo:'new',updatedAt:10}}}});
  app.element('driveConnect').onclick();await app.settle();assert.equal(app.remote.snapshots.length,2);assert.equal(app.remote.tags.test.memo,'new');assert.equal(app.storage.get('igfc_drive_connected'),'1');assert.equal(app.storage.get('igfc_drive_email'),'person@example.com');assert.ok(app.calls.some(c=>c.url==='https://www.googleapis.com/oauth2/v3/userinfo'));assert.match(app.element('driveHint').textContent,/연결됨/);
  let writes=app.calls.filter(c=>c.options.method==='PATCH').length;
  await app.ctx.IGApp.importBackup({snapshots:[snap('next','2026-03-01')],tags:{}});app.change();await app.advance(1999);assert.equal(app.calls.filter(c=>c.options.method==='PATCH').length,writes);await app.advance(1);assert.equal(app.remote.snapshots.length,3);assert.equal(app.calls.filter(c=>c.options.method==='PATCH').length,++writes);
  const stale=JSON.parse(JSON.stringify(app.remote));
  await app.ctx.IGApp.importBackup({snapshots:[],tags:{},tombstones:{remote:100}});await app.advance(2000);assert.equal(app.remote.snapshots.some(s=>s.id==='remote'),false);assert.equal(app.remote.tombstones.remote,100);
  app.remote=stale;app.change();await app.advance(2000);assert.equal(app.remote.snapshots.some(s=>s.id==='remote'),false,'stale remote must not resurrect deleted data');
  app.remote.tombstones.local=200;app.change();await app.advance(2000);assert.equal(app.ctx.IGApp.backup().snapshots.some(s=>s.id==='local'),false,'remote deletion propagates');
  app.fail=403;app.change();await app.advance(2000);assert.match(app.element('driveHint').textContent,/403/);assert.equal(app.element('driveRetry').classList.contains('hidden'),false);
  app.fail=0;app.element('driveRetry').onclick();await app.settle();assert.match(app.element('driveHint').textContent,/연결됨/);
  app.fail=401;app.change();await app.advance(2000);assert.equal(app.element('driveResume').classList.contains('hidden'),false);assert.equal(app.element('driveRetry').classList.contains('hidden'),true);
  app.fail=0;app.element('driveConnect').onclick();await app.settle();app.element('driveDisconnect').onclick();assert.equal(app.storage.has('igfc_drive_connected'),false);const count=app.calls.length;app.change();await app.advance(2000);assert.equal(app.calls.length,count);
  const fresh=setup();fresh.element('heroDrive').onclick();await fresh.settle();assert.ok(fresh.calls.some(c=>c.options.method==='POST'&&JSON.parse(c.options.body).parents[0]==='appDataFolder'));
  assert.equal(app.storage.has('igfc_drive_email'),false,'disconnect forgets email');
  const resumed=setup({saved:true,pending:true,remote:{snapshots:[snap('remote','2026-01-01')],tags:{}},local:{snapshots:[snap('offline','2026-02-01')],tags:{}}});
  await resumed.settle();assert.deepEqual(resumed.prompts,[],'arrival must never request tokens');
  assert.equal(resumed.element('driveResume').classList.contains('hidden'),false);assert.match(resumed.element('driveResume').textContent,/person@example.com/);
  resumed.element('driveResume').onclick();assert.deepEqual(resumed.prompts,[''],'token request is synchronous');
  assert.equal(resumed.authRequests[0].login_hint,'person@example.com');await resumed.settle();
  assert.equal(resumed.remote.snapshots.length,2,'pending local edits merge before upload');assert.equal(resumed.storage.has('igfc_drive_dirty'),false);
  assert.equal(resumed.calls.filter(c=>c.options.method==='PATCH').length,1);
  await resumed.advance(55*60*1000);resumed.ctx.IGDrive.onGesture();assert.equal(resumed.prompts.length,2,'refresh within five minutes of expiry');await resumed.settle();
  assert.equal(resumed.authRequests[1].login_hint,'person@example.com');
  const fallback=setup({saved:true,authError:true});await fallback.settle();
  fallback.ctx.IGDrive.onGesture();assert.deepEqual(fallback.prompts,[''],'gesture starts GIS without a microtask');await fallback.settle();
  fallback.ctx.IGDrive.onGesture();fallback.ctx.IGDrive.onGesture();await fallback.settle();assert.deepEqual(fallback.prompts,[''],'auto reconnect only once after failure');
  fallback.change();assert.equal(fallback.storage.get('igfc_drive_dirty'),'1');
  fallback.authError=false;fallback.element('driveResume').onclick();await fallback.settle();assert.deepEqual(fallback.prompts,['',''],'explicit resume may retry');
  const expired=setup({saved:true});expired.element('driveResume').onclick();await expired.settle();await expired.advance(61*60*1000);
  expired.change();await expired.advance(2000);assert.equal(expired.storage.get('igfc_drive_dirty'),'1');
  expired.ctx.IGDrive.onGesture();assert.equal(expired.prompts.length,2);await expired.settle();assert.equal(expired.storage.has('igfc_drive_dirty'),false);
  // A delayed GIS load must never turn the original click into an async popup.
  const loading=setup({saved:true});const google=loading.ctx.google;delete loading.ctx.google;
  let script;loading.ctx.document.createElement=()=>({});loading.ctx.document.head={append:s=>script=s};
  loading.element('driveResume').onclick();assert.equal(loading.prompts.length,0);await loading.settle();
  loading.ctx.google=google;script.onload();await loading.settle();assert.equal(loading.prompts.length,0,'script completion is not a gesture');
  loading.element('driveResume').onclick();assert.equal(loading.prompts.length,1);await loading.settle();
  // Legacy backups, id/date dedupe, timestamp conflict resolution and invalid input.
  const merged=fresh.ctx.mergeBackups({snapshots:[snap('one','2026-01-01')],tags:{}},{snapshots:[snap('other','2026-01-01')],tags:{}});assert.equal(merged.snapshots.length,1);
  const tomb=fresh.ctx.mergeBackups({snapshots:[],tags:{},tombstones:{one:200}},{snapshots:[snap('one','2026-01-01')],tags:{},tombstones:{one:100}});assert.equal(tomb.snapshots.length,0);assert.equal(tomb.tombstones.one,200);assert.throws(()=>fresh.ctx.normalizeBackup({snapshots:[{date:'bad'}]}));
  console.log('통과: Drive 클릭 재연결·계정 힌트·만료 갱신·대기 변경·병합·디바운스·삭제 전파·오류 재시도·연결 해제·백업 호환');
}
module.exports=run;
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1});
