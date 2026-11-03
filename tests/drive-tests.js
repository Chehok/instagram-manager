'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
async function run(){
  function setup({saved=false,authError=false,remote=null,local={snapshots:[],tags:{}}}={}){
    const elements=new Map(),events={},storage=new Map(saved?[['igfc_drive_connected','1']]:[]),timers=new Map();
    let clock=100000,nextTimer=0,record=remote,fail=0,authFails=authError;
    const calls=[],prompts=[];
    const element=id=>{if(!elements.has(id)){const classes=new Set();elements.set(id,{textContent:'',classList:{toggle(name,on){on?classes.add(name):classes.delete(name)},contains:name=>classes.has(name)}})}return elements.get(id)};
    const ctx={URLSearchParams,Date:class extends Date{static now(){return clock}},Number,Promise,Object,Error,Math,JSON,GOOGLE_CLIENT_ID:'mock-client',
      setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,at:clock+ms});return id},clearTimeout:id=>timers.delete(id),setInterval(){},
      localStorage:{getItem:key=>storage.get(key),setItem:(key,v)=>storage.set(key,v),removeItem:key=>storage.delete(key)},
      document:{getElementById:element},
      addEventListener:(name,fn)=>events[name]=fn,
      google:{accounts:{oauth2:{initTokenClient:o=>({requestAccessToken(params){prompts.push(params.prompt);o.callback(authFails?{error:'interaction_required'}:{access_token:'token',expires_in:3600})}})}}},
      fetch:async(url,options={})=>{
        calls.push({url,options});if(fail)return {ok:false,status:fail};
        if(options.method==='PATCH')record=JSON.parse(options.body);
        return {ok:true,json:async()=>url.includes('alt=media')?record:url.includes('spaces=')?{files:record?[{id:'remote'}]:[]}:{id:'created'}};
      }
    };
    ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(root,'js/data.js'),'utf8'),ctx);
    let data=ctx.normalizeBackup(local);
    ctx.IGApp={ready:Promise.resolve(),backup:()=>JSON.parse(JSON.stringify(data)),importBackup:async(input,notify=true)=>{data=ctx.mergeBackups(data,input);if(notify)events['igfc:change']();return true}};
    vm.runInContext(fs.readFileSync(path.join(root,'js/drive.js'),'utf8'),ctx);
    const settle=async()=>{for(let i=0;i<40;i++)await Promise.resolve()};
    return {ctx,calls,prompts,storage,element,settle,get remote(){return record},set remote(value){record=value},set fail(value){fail=value},set authError(value){authFails=value},
      change:()=>events['igfc:change'](),async advance(ms){clock+=ms;for(const [id,t] of [...timers])if(t.at<=clock){timers.delete(id);t.fn()}await settle()}};
  }
  const snap=(id,date)=>({id,date,followers:['test']});
  const app=setup({remote:{snapshots:[snap('remote','2026-01-01')],tags:{test:{memo:'old'}}},local:{snapshots:[snap('local','2026-02-01')],tags:{test:{memo:'new',updatedAt:10}}}});
  app.element('driveConnect').onclick();await app.settle();assert.equal(app.remote.snapshots.length,2);assert.equal(app.remote.tags.test.memo,'new');assert.equal(app.storage.get('igfc_drive_connected'),'1');assert.match(app.element('driveHint').textContent,/연결됨/);
  let writes=app.calls.filter(c=>c.options.method==='PATCH').length;
  await app.ctx.IGApp.importBackup({snapshots:[snap('next','2026-03-01')],tags:{}});app.change();await app.advance(1999);assert.equal(app.calls.filter(c=>c.options.method==='PATCH').length,writes);await app.advance(1);assert.equal(app.remote.snapshots.length,3);assert.equal(app.calls.filter(c=>c.options.method==='PATCH').length,++writes);
  const stale=JSON.parse(JSON.stringify(app.remote));
  await app.ctx.IGApp.importBackup({snapshots:[],tags:{},tombstones:{remote:100}});await app.advance(2000);assert.equal(app.remote.snapshots.some(s=>s.id==='remote'),false);assert.equal(app.remote.tombstones.remote,100);
  app.remote=stale;app.change();await app.advance(2000);assert.equal(app.remote.snapshots.some(s=>s.id==='remote'),false,'stale remote must not resurrect deleted data');
  app.remote.tombstones.local=200;app.change();await app.advance(2000);assert.equal(app.ctx.IGApp.backup().snapshots.some(s=>s.id==='local'),false,'remote deletion propagates');
  app.fail=403;app.change();await app.advance(2000);assert.match(app.element('driveHint').textContent,/403/);assert.equal(app.element('driveRetry').classList.contains('hidden'),false);
  app.fail=0;app.element('driveRetry').onclick();await app.settle();assert.match(app.element('driveHint').textContent,/연결됨/);
  app.fail=401;app.change();await app.advance(2000);assert.equal(app.element('driveConnect').textContent,'다시 연결');assert.equal(app.element('driveRetry').classList.contains('hidden'),true);
  app.fail=0;app.element('driveConnect').onclick();await app.settle();app.element('driveDisconnect').onclick();assert.equal(app.storage.has('igfc_drive_connected'),false);const count=app.calls.length;app.change();await app.advance(2000);assert.equal(app.calls.length,count);
  const fresh=setup();fresh.element('heroDrive').onclick();await fresh.settle();assert.ok(fresh.calls.some(c=>c.options.method==='POST'&&JSON.parse(c.options.body).parents[0]==='appDataFolder'));
  const silent=setup({saved:true});await silent.settle();assert.deepEqual(silent.prompts,['']);assert.match(silent.element('driveHint').textContent,/연결됨/);
  const fallback=setup({saved:true,authError:true});await fallback.settle();assert.deepEqual(fallback.prompts,['']);assert.equal(fallback.element('heroDrive').textContent,'다시 연결');fallback.authError=false;fallback.element('heroDrive').onclick();await fallback.settle();assert.deepEqual(fallback.prompts,['','consent']);
  // Legacy backups, id/date dedupe, timestamp conflict resolution and invalid input.
  const merged=fresh.ctx.mergeBackups({snapshots:[snap('one','2026-01-01')],tags:{}},{snapshots:[snap('other','2026-01-01')],tags:{}});assert.equal(merged.snapshots.length,1);
  const tomb=fresh.ctx.mergeBackups({snapshots:[],tags:{},tombstones:{one:200}},{snapshots:[snap('one','2026-01-01')],tags:{},tombstones:{one:100}});assert.equal(tomb.snapshots.length,0);assert.equal(tomb.tombstones.one,200);assert.throws(()=>fresh.ctx.normalizeBackup({snapshots:[{date:'bad'}]}));
  console.log('통과: Drive 자동 연결·병합·자동 업로드·디바운스·삭제 전파·오류 재시도·연결 해제·무인 재연결 대체·백업 호환');
}
module.exports=run;
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1});
