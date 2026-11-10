import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, membership, visibleTasks, canApprove } from '../src/db.mjs';
import { briefingFor } from '../src/briefing.mjs';
import { createApp } from '../src/server.mjs';

const settings={demoMode:true,openaiKey:'',openaiModel:'gpt-5.5'};
function context(){
 const db=createDatabase(':memory:');const app=createApp({db,settings});
 return {db,app};
}
async function start(app){await new Promise(r=>app.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+app.address().port;}
async function http(base,route,method='GET',body=null,cookie=''){
 const r=await fetch(base+route,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
async function login(base,email,pass){
 const r=await http(base,'/api/auth/login','POST',{email,password:pass});assert.equal(r.status,200);return r.cookie;
}

test('ANON組織スコープ: Lead担当者は別事業を閲覧できない',()=>{
 const {db}=context();
 assert.ok(membership(db,'lead','gad'));assert.equal(membership(db,'lead','b-ill'),undefined);
 assert.equal(visibleTasks(db,'lead','b-ill'),null);
 assert.ok(visibleTasks(db,'lead','gad').length>0);
 assert.equal(canApprove(db,'viewer','gad'),false);
 db.close();
});

test('ブリーフィングは本人の許可組織だけを含む',()=>{
 const {db}=context();
 const lead=briefingFor(db,'lead','all','2026-11-10');
 assert.equal(lead.organizations.length,2);
 assert.ok(lead.topPriorities.every(t=>['gad','lead-label'].includes(t.org_id)));
 assert.equal(briefingFor(db,'lead','star-dig'),null);
 db.close();
});

test('API: 未ログインのデータ取得は拒否される',async()=>{
 const {db,app}=context();const base=await start(app);
 try{const r=await http(base,'/api/briefing?orgId=all');assert.equal(r.status,401);}
 finally{await new Promise(r=>app.close(r));db.close();}
});

test('API: 委譲承認、自己承認禁止、承認前にタスクが作られない',async()=>{
 const {db,app}=context();const base=await start(app);
 try{
 const lead=await login(base,'lead@example.test','LeadLocal-ChangeMe-2026!');
 const annon=await login(base,'annon@example.test','AnnonLocal-ChangeMe-2026!');
 const viewer=await login(base,'viewer@example.test','ViewerLocal-ChangeMe-2026!');
 const deny=await http(base,'/api/tasks?orgId=b-ill','GET',null,lead);assert.equal(deny.status,403);
 const noPropose=await http(base,'/api/approvals','POST',{orgId:'gad',actionType:'task.create',title:'viewer task',priority:'P0'},viewer);assert.equal(noPropose.status,403);
 const proposal=await http(base,'/api/approvals','POST',{orgId:'gad',actionType:'task.create',title:'テストの制作タスク',priority:'P1',dueOn:'2026-11-13'},lead);
 assert.equal(proposal.status,201);
 const pending=db.prepare('SELECT * FROM tasks WHERE title=?').get('テストの制作タスク');assert.equal(pending,undefined);
 const self=await http(base,'/api/approvals/'+proposal.data.id+'/decision','POST',{decision:'approve'},lead);assert.equal(self.status,403);
 const deniedCross=await http(base,'/api/approvals/'+proposal.data.id+'/decision','POST',{decision:'approve'},viewer);assert.equal(deniedCross.status,403);
 const approve=await http(base,'/api/approvals/'+proposal.data.id+'/decision','POST',{decision:'approve',note:'OK'},annon);assert.equal(approve.status,200);
 assert.ok(db.prepare('SELECT * FROM tasks WHERE title=?').get('テストの制作タスク'));
 const twice=await http(base,'/api/approvals/'+proposal.data.id+'/decision','POST',{decision:'approve'},annon);assert.equal(twice.status,409);
 const logs=db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='approval.approved'").get().n;assert.equal(logs,1);
 }finally{await new Promise(r=>app.close(r));db.close();}
});

test('API: 外部AIキーなしでも参謀回答を表示可能',async()=>{
 const {db,app}=context();const base=await start(app);
 try{
 const lead=await login(base,'lead@example.test','LeadLocal-ChangeMe-2026!');
 const ok=await http(base,'/api/ask','POST',{orgId:'gad',question:'今日の最優先は？'},lead);
 assert.equal(ok.status,200);assert.equal(ok.data.mode,'local');assert.match(ok.data.answer,/優先候補/);
 const forbidden=await http(base,'/api/ask','POST',{orgId:'star-dig',question:'業務を教えて'},lead);assert.equal(forbidden.status,403);
 }finally{await new Promise(r=>app.close(r));db.close();}
});


test('Web画面: / が HTML を返し、JS/CSSが取得できる',async()=>{
 const {db,app}=context(); const base=await start(app);
 try{
  for(const route of ['/', '/index.html']){
   const response=await fetch(base+route);
   assert.equal(response.status,200,route);
   assert.match(response.headers.get('content-type')||'',/text\/html/);
   assert.match(await response.text(),/ANNON/);
  }
  for(const route of ['/app.js','/styles.css']){
   const response=await fetch(base+route);
   assert.equal(response.status,200,route);
  }
 } finally{await new Promise(r=>app.close(r));db.close();}
});
