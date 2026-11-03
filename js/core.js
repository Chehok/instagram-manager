
// ---- pure logic (testable in node) ----
function userFromHref(h){
  try{var u=new URL(String(h));if(!/^(www\.)?instagram\.com$/i.test(u.hostname))return '';var parts=u.pathname.split('/').filter(Boolean);var name=parts[0]==='_u'?parts[1]:parts[0];if(!name||['p','reel','reels','stories','explore'].includes(name.toLowerCase()))return '';return decodeURIComponent(name)}catch(e){return ''}
}
function extractEntries(data){
  var arr=Array.isArray(data)?data:null;
  if(!arr&&data&&typeof data==='object'){for(var k in data){if(Array.isArray(data[k])&&/follow|relationship/i.test(k)){arr=data[k];break}}}
  if(!arr)return[];var out=[];
  arr.forEach(function(o){if(!o||typeof o!=='object')return;var sl=Array.isArray(o.string_list_data)?o.string_list_data:[];if(!sl.length)sl=[{}];
    sl.forEach(function(s){if(!s||typeof s!=='object')return;var u=s.value||o.title||userFromHref(s.href)||'';u=String(u).trim().replace(/^@/,'');if(!u)return;
      out.push({username:u,href:s.href||('https://www.instagram.com/'+encodeURIComponent(u)),timestamp:s.timestamp||o.timestamp||0})})});
  return out}
function parseHtmlList(html){var out=[],re=/<a[^>]+href="([^"]*instagram\.com\/[^"]+)"[^>]*>([^<]*)<\/a>/gi,m;
  while((m=re.exec(html))){var u=(m[2]||'').trim()||userFromHref(m[1]);if(u&&!/^https?:/.test(u))out.push({username:u.replace(/^@/,''),href:m[1],timestamp:0})}
  var dates=html.match(/<div>([A-Z][a-z]{2} \d{1,2}, \d{4}[^<]*)<\/div>/g)||[];
  if(dates.length===out.length)dates.forEach(function(d,i){var t=Date.parse(d.replace(/<\/?div>/g,''));if(!isNaN(t))out[i].timestamp=Math.floor(t/1000)});return out}
function classify(name){var b=name.split('/').pop().toLowerCase();
  if(/^followers(_\d+)?\.(json|html)$/.test(b))return'followers';if(/^following\.(json|html)$/.test(b))return'following';return null}
function dedupe(list){var m=new Map();list.forEach(function(e){var k=e.username.toLowerCase();if(!m.has(k))m.set(k,e)});return Array.from(m.values())}
function parseFile(name,text){var kind=classify(name);if(!kind)return null;var ent;
  if(/\.html$/i.test(name))ent=parseHtmlList(text);else ent=extractEntries(JSON.parse(text.replace(/^\uFEFF/,'')));return{kind:kind,entries:ent}}
function compare(followers,following){var fs=new Set(followers.map(function(e){return e.username.toLowerCase()})),gs=new Set(following.map(function(e){return e.username.toLowerCase()}));
  return{notFollowingBack:following.filter(function(e){return!fs.has(e.username.toLowerCase())}),fans:followers.filter(function(e){return!gs.has(e.username.toLowerCase())})}}
function diffSnapshots(oldU,newU){var o=new Set(oldU.map(function(s){return s.toLowerCase()})),n=new Set(newU.map(function(s){return s.toLowerCase()}));
  return{lost:oldU.filter(function(u){return!n.has(u.toLowerCase())}),gained:newU.filter(function(u){return!o.has(u.toLowerCase())})}}
function fmtDate(ts){if(!ts)return'-';var d=new Date(ts*1000);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function toCsv(list){return'username,profile_url,date\n'+list.map(function(e){return[e.username,e.href,fmtDate(e.timestamp)].map(function(v){return'"'+String(v).replace(/"/g,'""')+'"'}).join(',')}).join('\n')}
function sortList(list,mode){var a=list.slice();if(mode==='name')a.sort(function(x,y){return x.username.localeCompare(y.username)});
  else a.sort(function(x,y){return mode==='date-asc'?x.timestamp-y.timestamp:y.timestamp-x.timestamp});return a}
if(typeof module!=='undefined')module.exports={extractEntries:extractEntries,parseHtmlList:parseHtmlList,classify:classify,dedupe:dedupe,parseFile:parseFile,compare:compare,diffSnapshots:diffSnapshots,toCsv:toCsv,sortList:sortList,fmtDate:fmtDate};
