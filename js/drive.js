(function(){
'use strict';
const save=document.getElementById('driveSave'),load=document.getElementById('driveLoad'),hint=document.getElementById('driveHint');
if(!GOOGLE_CLIENT_ID)return;
save.disabled=load.disabled=false;save.textContent='Google Drive에 저장';load.textContent='Google Drive에서 병합';
hint.textContent='선택 시 Google 로그인을 엽니다. 스냅샷·메모를 내 Drive의 앱 전용 공간에 저장합니다. 불러오기는 ID 또는 날짜가 같은 스냅샷을 중복 추가하지 않으며, 같은 계정의 메모는 Drive 내용을 우선합니다.';
let gisPromise;
function loadGIS(){
  if(window.google?.accounts?.oauth2)return Promise.resolve();
  if(!gisPromise)gisPromise=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.async=true;s.onload=resolve;s.onerror=()=>{s.remove();gisPromise=null;reject(new Error('Google 로그인 도구를 불러오지 못했습니다'))};document.head.append(s)});
  return gisPromise;
}
async function authorize(){
  await loadGIS();
  return new Promise((resolve,reject)=>{
    const client=google.accounts.oauth2.initTokenClient({client_id:GOOGLE_CLIENT_ID,scope:'https://www.googleapis.com/auth/drive.appdata',callback:r=>r.error?reject(new Error('Google 인증 실패: '+r.error)):resolve(r.access_token),error_callback:()=>reject(new Error('로그인이 취소되었거나 팝업을 열 수 없습니다'))});
    client.requestAccessToken();
  });
}
async function request(token,url,options={}){
  const response=await fetch(url,{...options,headers:{Authorization:'Bearer '+token,...options.headers}});
  if(!response.ok)throw new Error('Drive 요청 실패 ('+response.status+')');return response;
}
const base='https://www.googleapis.com/drive/v3/files',name='igfc_snapshots.json';
async function findFile(token){
  let page='',files=[];
  do{const params=new URLSearchParams({spaces:'appDataFolder',q:"name = '"+name+"' and trashed = false",fields:'nextPageToken,files(id,modifiedTime)',pageSize:'100',orderBy:'modifiedTime desc'});if(page)params.set('pageToken',page);const result=await(await request(token,base+'?'+params)).json();files.push(...(result.files||[]));page=result.nextPageToken||''}while(page);
  return files[0]?.id;
}
async function sync(action){
  save.disabled=load.disabled=true;
  try{
    await IGApp.ready;const token=await authorize();const id=await findFile(token);
    if(action==='load'){
      if(!id)throw new Error('Drive에 저장된 스냅샷 파일이 없습니다');
      const json=await(await request(token,base+'/'+encodeURIComponent(id)+'?alt=media')).json();
      const saved=await IGApp.importBackup(json);if(saved)IGApp.toast('Drive의 스냅샷과 메모를 병합했습니다');
    }else{
      let target=id;
      if(!target){const result=await(await request(token,base+'?fields=id',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,parents:['appDataFolder'],mimeType:'application/json'})})).json();target=result.id}
      await request(token,'https://www.googleapis.com/upload/drive/v3/files/'+encodeURIComponent(target)+'?uploadType=media',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(IGApp.backup())});
      IGApp.toast('Drive에 스냅샷과 메모를 저장했습니다');
    }
  }catch(e){IGApp.toast(e.message,false)}finally{save.disabled=load.disabled=false}
}
save.onclick=()=>sync('save');load.onclick=()=>sync('load');
})();
