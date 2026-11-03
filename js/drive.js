(function(){
'use strict';
const $=id=>document.getElementById(id),connect=$('driveConnect'),hero=$('heroDrive'),hint=$('driveHint'),retry=$('driveRetry'),disconnect=$('driveDisconnect'),KEY='igfc_drive_connected';
let token='',expires=0,gisPromise,timer,busy=false,dirty=false,generation=0,lastSync=0,phase='off';
function remember(value){try{if(value)localStorage.setItem(KEY,'1');else localStorage.removeItem(KEY)}catch(e){}}
function remembered(){try{return localStorage.getItem(KEY)==='1'}catch(e){return false}}
function render(){
  const connected=phase==='ready'||phase==='syncing'||phase==='error';
  connect.classList.toggle('hidden',connected);disconnect.classList.toggle('hidden',!connected&&phase!=='reconnect');
  connect.textContent=phase==='reconnect'?'다시 연결':'구글 드라이브 연결';
  hero.textContent=phase==='syncing'?'동기화 중…':phase==='ready'?'드라이브 연결됨':phase==='error'?'동기화 오류 · 다시 시도':connect.textContent;
  hero.disabled=connect.disabled=phase==='syncing'||!GOOGLE_CLIENT_ID;
  retry.classList.toggle('hidden',phase!=='error');
  if(phase==='ready')hint.textContent='드라이브 연결됨 · '+(Date.now()-lastSync<60000?'방금 동기화':Math.floor((Date.now()-lastSync)/60000)+'분 전 동기화');
  else if(phase==='syncing')hint.textContent='동기화 중…';
  else if(phase==='reconnect')hint.textContent='자동 연결을 완료하지 못했어요. 다시 연결해 주세요.';
  else if(phase==='off')hint.textContent=GOOGLE_CLIENT_ID?'연결하면 자동으로 백업해요.':'config.js에 Google 클라이언트 ID를 설정해 주세요.';
}
function loadGIS(){
  if(window.google?.accounts?.oauth2)return Promise.resolve();
  if(!gisPromise)gisPromise=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.async=true;s.onload=resolve;s.onerror=()=>{s.remove();gisPromise=null;reject(new Error('Google 로그인을 불러오지 못했습니다'))};document.head.append(s)});
  return gisPromise;
}
async function authorize(silent){
  await loadGIS();
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Google 인증 시간이 초과되었습니다')),15000);
    const finish=(error,result)=>{clearTimeout(timeout);error?reject(error):resolve(result)};
    const client=google.accounts.oauth2.initTokenClient({client_id:GOOGLE_CLIENT_ID,scope:'https://www.googleapis.com/auth/drive.appdata',callback:r=>r.error?finish(new Error('Google 인증: '+r.error)):finish(null,r),error_callback:()=>finish(new Error('Google 로그인을 완료해 주세요'))});
    client.requestAccessToken({prompt:silent?'':'consent'});
  });
}
async function request(url,options={}){
  const response=await fetch(url,{...options,headers:{Authorization:'Bearer '+token,...options.headers}});
  if(!response.ok){if(response.status===401){token='';phase='reconnect'}throw new Error('Drive 요청 실패 ('+response.status+')')}
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
  if(busy){dirty=true;return}
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
    lastSync=Date.now();phase='ready';
  }catch(e){if(run===generation){if(phase!=='reconnect')phase='error';hint.textContent=e.message}}
  finally{busy=false;if(run===generation)render();if(dirty&&token)timer=setTimeout(sync,2000)}
}
async function connectDrive(silent=false){
  const run=generation;phase='syncing';render();
  try{const result=await authorize(silent);if(run!==generation)return;token=result.access_token;expires=Date.now()+(Number(result.expires_in)||3600)*1000;remember(true);await sync()}
  catch(e){if(run===generation){phase='reconnect';render()}}
}
connect.onclick=()=>connectDrive(false);hero.onclick=()=>token?sync():connectDrive(false);retry.onclick=sync;
disconnect.onclick=()=>{generation++;clearTimeout(timer);token='';dirty=false;remember(false);phase='off';render()};
window.addEventListener('igfc:change',()=>{if(!token&&!remembered())return;dirty=true;clearTimeout(timer);timer=setTimeout(sync,2000)});
render();setInterval(()=>{if(phase==='ready')render()},30000);
if(GOOGLE_CLIENT_ID&&remembered())IGApp.ready.then(()=>connectDrive(true));
})();
