const fs=require('node:fs');
const JSZip=require('../vendor/jszip.min.js');
const entry=(u,t=1790812800)=>({title:u,string_list_data:[{href:'https://www.instagram.com/'+u+'/',value:u,timestamp:t}]});
async function main(){
 const zip=new JSZip(),root='fake_export/';
 const put=(p,j)=>zip.file(root+p,JSON.stringify(j,null,2));
 put('connections/followers_and_following/followers_1.json',[entry('sample_ari'),entry('sample_bori'),entry('sample_ghost')]);
 put('connections/followers_and_following/followers_2.json',[entry('sample_return')]);
 put('connections/followers_and_following/following.json',{relationships_following:[entry('sample_ari'),entry('sample_brand')]});
 for(const [file,key,user] of [
 ['pending_follow_requests','relationships_follow_requests_sent','sample_pending'],
 ['recently_unfollowed_profiles','relationships_unfollowed_users','sample_unfollowed'],
 ['blocked_profiles','relationships_blocked_users','sample_blocked'],
 ['restricted_profiles','relationships_restricted_users','sample_restricted'],
 ['close_friends','relationships_close_friends','sample_close']])put('connections/extra/'+file+'.json',{[key]:[entry(user)]});
 const like=(u,t)=>({title:u,string_map_data:{'Time':{timestamp:t},'URL':{href:'https://www.instagram.com/p/fake/'}}});
 put('your_instagram_activity/likes/liked_posts.json',{likes_media_likes:[like('sample_ari',1790816400),like('sample_ari',1790820000),like('sample_brand',1793494800)]});
 put('comments/post_comments_1.json',[{string_map_data:{'Media Owner':{value:'sample_bori'},'Comment':{value:'가상 댓글'},'Time':{timestamp:1790820000}}}]);
 put('your_instagram_activity/comments/post_comments_2.json',{comments_media_comments:[{title:'sample_ari',string_list_data:[{timestamp:1793498400}]}]});
 for(const variant of ['story_likes','polls','questions','emoji_sliders','quizzes','countdowns'])put('your_instagram_activity/story_interactions/'+variant+'.json',{['story_activities_'+variant]:[{title:'sample_brand',string_list_data:[{timestamp:1793502000,value:'예시 응답'}]}]});
 const mojibake=s=>Buffer.from(s,'utf8').toString('latin1');
 put('your_instagram_activity/messages/inbox/thread_a/message_1.json',{participants:[{name:mojibake('가상 나')},{name:'sample_ari'}],messages:[{sender_name:mojibake('가상 나'),timestamp_ms:1790820000000,content:mojibake('안녕')},{sender_name:'sample_ari',timestamp_ms:1790823600000},{sender_name:'sample_ari',timestamp_ms:1790827200000}]});
 put('messages/inbox/thread_b/message_1.json',{messages:[{sender_name:mojibake('가상 나'),timestamp_ms:1793502000000},{sender_name:'sample_bori',timestamp_ms:1793505600000}]});
 put('messages/inbox/thread_b/message_2.json',{messages:[{sender_name:'sample_bori',timestamp_ms:1793509200000}]});
 fs.writeFileSync('samples/sample_export_full.zip',await zip.generateAsync({type:'nodebuffer'}));
 const backup={app:'igfc',version:2,snapshots:[
 {id:'fake-1',date:'2026-09-01',followers:['sample_ari','sample_return','sample_gone'],following:['sample_ari']},
 {id:'fake-2',date:'2026-10-01',followers:['sample_ari','sample_bori'],following:['sample_ari','sample_brand']},
 {id:'fake-3',date:'2026-11-01',followers:['sample_ari','sample_bori','sample_ghost','sample_return'],following:['sample_ari','sample_brand']}],tags:{sample_brand:{tag:'브랜드',memo:'가상의 브랜드 메모'},sample_bori:{tag:'지인',memo:'샘플 전용'}}};
 fs.writeFileSync('samples/sample_snapshot_backup_full.json',JSON.stringify(backup,null,2)+'\n');
 console.log('가상 샘플 생성 완료');
}
main().catch(e=>{console.error(e);process.exitCode=1});
