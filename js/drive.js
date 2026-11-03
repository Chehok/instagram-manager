(function(){
'use strict';
const $=id=>document.getElementById(id),connect=$('driveConnect'),hero=$('heroDrive'),hint=$('driveHint'),retry=$('driveRetry'),disconnect=$('driveDisconnect'),resume=$('driveResume'),KEY='igfc_drive_connected',EMAIL='igfc_drive_email',DIRTY='igfc_drive_dirty';
let token='',expires=0,gisPromise,timer,busy=false,dirty=stored(DIRTY)==='1',generation=0,lastSync=0,phase=remembered()?'reconnect':'off',authPending=false,autoAttempted=false;
function stored(key){try{return localStorage.getItem(key)||''}catch(e){return ''}}
function pending(value){dirty=value;try{if(value)localStorage.setItem(DIRTY,'1');else localStorage.removeItem(DIRTY)}catch(e){}}
function remember(value){try{if(value)localStorage.setItem(KEY,'1');else localStorage.removeItem(KEY)}catch(e){}}
function remembered(){try{return localStorage.getItem(KEY)==='1'}catch(e){return false}}
function render(){
  const connected=phase==='ready'||phase==='syncing'||phase==='error';
  disconnect.classList.toggle('hidden',!connected&&phase!=='reconnect');
  const label='🔄 드라이브 동기화 이어하기'+(stored(EMAIL)?' ('+stored(EMAIL)+')':'');
  resume.textContent=label;resume.classList.toggle('hidden',phase!=='reconnect');resume.disabled=authPending||!GOOGLE_CLIENT_ID;
  connect.classList.toggle('hidden',connected||phase==='reconnect');
  connect.textContent='구글 드라이브 연결';
  hero.textContent=phase==='reconnect'?label:phase==='syncing'?'동기화 중…':phase==='ready'?'드라이브 연결됨':phase==='error'?'동기화 오류 · 다시 시도':connect.textContent;
  hero.disabled=connect.disabled=phase==='syncing'||authPending||!GOOGLE_CLIENT_ID;
  retry.classList.toggle('hidden',phase!=='error');
  if(phase==='ready')hint.textContent='드라이브 연결됨 · '+(Date.now()-lastSync<60000?'방금 동기화':Math.floor((Date.now()-lastSync)/60000)+'분 전 동기화');
  else if(phase==='syncing')hint.textContent='동기화 중…';
  else if(phase==='reconnect')hint.textContent=dirty?'변경 내용을 기기에 보관 중이에요.':'보안을 위해 클릭 한 번으로 동기화를 이어가세요.';
  else if(phase==='off')hint.textContent=GOOGLE_CLIENT_ID?'연결하면 자동으로 백업해요.':'config.js에 Google 클라이언트 ID를 설정해 주세요.';
}
function loadGIS(){
  if(window.google?.accounts?.oauth2)return Promise.resolve();
  if(!gisPromise)gisPromise=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.async=true;s.onload=resolve;s.onerror=()=>{s.remove();gisPromise=null;reject(new Error('Google 로그인을 불러오지 못했습니다'))};document.head.append(s)});
  return gisPromise;
}
function authorize(reconnect){
  // Never wait for a script here: requestAccessToken must run in this gesture's stack.
  if(!window.google?.accounts?.oauth2){
    loadGIS().catch(()=>{});
    return Promise.reject(new Error('Google 로그인을 준비 중입니다. 잠시 후 다시 눌러 주세요.'));
  }
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Google 인증 시간이 초과되었습니다')),60000);
    const finish=(error,result)=>{clearTimeout(timeout);error?reject(error):resolve(result)};
    const client=google.accounts.oauth2.initTokenClient({client_id:GOOGLE_CLIENT_ID,scope:'https://www.googleapis.com/auth/drive.appdata openid email',callback:r=>r.error?finish(new Error('Google 인증: '+r.error)):finish(null,r),error_callback:()=>finish(new Error('Google 로그인을 완료해 주세요'))});
    client.requestAccessToken(reconnect?{prompt:'',login_hint:stored(EMAIL)}:{prompt:'consent'});
  });
}
async function request(url,options={}){
  const response=await fetch(url,{...options,headers:{Authorization:'Bearer '+token,...options.headers}});
  if(!response.ok){if(response.status===401){token='';expires=0;phase='reconnect'}throw new Error('Drive 요청 실패 ('+response.status+')')}
  return response;
}
const base='https://www.googleapis.com/drive/v3/files',name='igfc_snapshots.json';
async function findFile(){
  let page='',files=[];
  do{const params=new URLSearchParams({spaces:'appDataFolder',q:"name = '"+name+"' and trashed = false",fields:'nextPageToken,files(id,modifiedTime)',pageSize:'100',orderBy:'modifiedTime desc'});if(page)params.set('pageToken',page);const result=await(await request(base+'?'+params)).json();files.push(...(result.files||[]));page=result.nextPageToken||''}while(page);
  return files[0]?.id;
}
async function sync(){
  clearTimeout(timer);
  if(!token||Date.now()>=expires){if(remembered()){phase='reconnect';render()}return}
  if(busy){pending(true);return}
  const run=generation;busy=true;dirty=false;phase='syncing';render();
  try{
    await IGApp.ready;let id=await findFile();
    if(run!==generation)return;
    if(id){const remote=await(await request(base+'/'+encodeURIComponent(id)+'?alt=media')).json();if(run!==generation)return;await IGApp.importBackup(remote,false)}
    if(run!==generation)return;
    if(!id){const created=await(await request(base+'?fields=id',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,parents:['appDataFolder'],mimeType:'application/json'})})).json();id=created.id}
    if(run!==generation)return;
    await request('https://www.googleapis.com/upload/drive/v3/files/'+encodeURIComponent(id)+'?uploadType=media',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(IGApp.backup())});
    if(run!==generation)return;
    if(!dirty)pending(false);lastSync=Date.now();phase='ready';
  }catch(e){if(run===generation){pending(true);if(phase!=='reconnect')phase='error';hint.textContent=e.message}}
  finally{busy=false;if(run===generation)render();if(dirty&&token&&phase==='ready')timer=setTimeout(sync,2000)}
}
async function connectDrive(reconnect=remembered()){
  if(authPending||!GOOGLE_CLIENT_ID)return;
  const run=generation;authPending=true;phase='syncing';render();
  try{
    const authorization=authorize(reconnect); // Starts the popup synchronously, before any await.
    const result=await authorization;if(run!==generation)return;
    token=result.access_token;expires=Date.now()+(Number(result.expires_in)||3600)*1000;remember(true);
    try{
      const user=await(await request('https://www.googleapis.com/oauth2/v3/userinfo')).json();
      if(run!==generation)return;
      if(user.email)try{localStorage.setItem(EMAIL,user.email)}catch(e){}
    }catch(e){if(!token)throw e} // Older grants can still sync if email is unavailable.
    if(run!==generation)return;
    await sync();
  }catch(e){if(run===generation){phase='reconnect';render()}}
  finally{if(run===generation){authPending=false;render()}}
}
function onGesture(){
  if(!remembered()||autoAttempted||authPending||busy||!GOOGLE_CLIENT_ID)return;
  if(token&&expires-Date.now()>5*60*1000)return;
  if(!window.google?.accounts?.oauth2){loadGIS().catch(()=>{});return}
  autoAttempted=true;connectDrive(true);
}
connect.onclick=()=>connectDrive();resume.onclick=()=>connectDrive(true);
hero.onclick=()=>token&&expires-Date.now()>5*60*1000?sync():connectDrive();retry.onclick=()=>token&&Date.now()<expires?sync():connectDrive(true);
disconnect.onclick=()=>{generation++;clearTimeout(timer);token='';expires=0;authPending=false;pending(false);remember(false);try{localStorage.removeItem(EMAIL)}catch(e){}phase='off';render()};
window.addEventListener('igfc:change',()=>{pending(true);clearTimeout(timer);if(token&&!authPending)timer=setTimeout(sync,2000);if(phase==='reconnect')render()});
window.IGDrive={onGesture};
render();setInterval(()=>{if(token&&Date.now()>=expires){token='';expires=0;phase='reconnect'}if(phase==='ready'||phase==='reconnect')render()},30000);
// Loading GIS is safe on arrival; requesting a token always requires a gesture.
if(GOOGLE_CLIENT_ID)loadGIS().catch(()=>{});
})();
