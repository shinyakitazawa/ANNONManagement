import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadEnv, config } from './config.mjs';
import { createDatabase,secureHash,uid,membership,allowedOrgs,canPropose,canApprove,visibleTasks,visibleDecisions,visibleApprovals,audit } from './db.mjs';
import { briefingFor } from './briefing.mjs';
import { answerQuestion } from './ai.mjs';

// fileURLToPath correctly decodes file:// URLs on Windows (including drive letters).
const root=path.resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const throttle=new Map();
function send(res,status,data,extra={}) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra});res.end(JSON.stringify(data));
}
function error(res,status,message){send(res,status,{error:message});}
function cookieValue(req,key) {return (req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(key+'='))?.slice(key.length+1)||'';}
function cookie(token,req,clear=false){const parts=[`annon_sid=${clear?'':token}`,'HttpOnly','SameSite=Strict','Path=/','Max-Age='+(clear?'0':604800)];if(req.socket.encrypted)parts.push('Secure');return parts.join('; ');}
async function body(req) {
  let size=0;const chunks=[];
  for await(const part of req){size+=part.length;if(size>65536)throw Object.assign(new Error('Request body too large'),{status:413});chunks.push(part);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw Object.assign(new Error('Invalid JSON'),{status:400});}
}
function me(db,req){const token=cookieValue(req,'annon_sid');if(!/^[a-f0-9]{64}$/.test(token))return null;
  const hash=crypto.createHash('sha256').update(token).digest('hex');
  return db.prepare(`SELECT u.id,u.email,u.display_name FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>datetime('now')`).get(hash)||null;
}
function checkOrigin(req){if(!['POST','PUT','PATCH','DELETE'].includes(req.method))return true;
  const origin=req.headers.origin;
  if(!origin)return true;try{return new URL(origin).host===req.headers.host;}catch{return false;}
}
const knownFields={priority:new Set(['P0','P1','P2']),action:new Set(['task.create','task.complete']),decision:new Set(['approve','reject'])};
function publicStatic(req,res,u){
  const key=u.pathname==='/'?'/index.html':u.pathname;
  const full=path.resolve(root,'.'+key);
  if(!(full===root || full.startsWith(root+path.sep)))return error(res,403,'Forbidden');
  try{const info=fs.statSync(full);if(!info.isFile())return error(res,404,'Not found');
    res.writeHead(200,{'Content-Type':mime[path.extname(full)]||'application/octet-stream','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store'});
    fs.createReadStream(full).pipe(res);
  }catch{return error(res,404,'Not found');}
}

export function createApp({db,settings}) {
  const listener=async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');
    const url=new URL(req.url,'http://'+(req.headers.host||'127.0.0.1'));
    if(!url.pathname.startsWith('/api/'))return publicStatic(req,res,url);
    if(!checkOrigin(req))return error(res,403,'Origin mismatch');
    if(url.pathname==='/api/health')return send(res,200,{ok:true,mode:'mvp-local',demoMode:settings.demoMode});
    try{
      if(url.pathname==='/api/auth/login'&&req.method==='POST'){
        const address=req.socket.remoteAddress||'unknown';const now=Date.now();const prev=throttle.get(address)||[];
        const recent=prev.filter(t=>now-t<60000);if(recent.length>=10)return error(res,429,'ログイン試行数が多すぎます');
        recent.push(now);throttle.set(address,recent);
        const input=await body(req);const user=db.prepare('SELECT * FROM users WHERE email=?').get(String(input.email||'').toLowerCase());
        const given=String(input.password||'');const hash=user?secureHash(given,user.salt):secureHash(given,'0'.repeat(32));
        if(!user || !crypto.timingSafeEqual(Buffer.from(hash,'hex'),Buffer.from(user.password_hash,'hex')))return error(res,401,'メールまたはパスワードが違います');
        const token=crypto.randomBytes(32).toString('hex');const tokenHash=crypto.createHash('sha256').update(token).digest('hex');
        db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,datetime('now','+7 days'))").run(tokenHash,user.id);
        return send(res,200,{user:{id:user.id,display_name:user.display_name,email:user.email}}, {'Set-Cookie':cookie(token,req)});
      }
      const user=me(db,req);
      if(!user)return error(res,401,'ログインが必要です');
      if(url.pathname==='/api/auth/logout'&&req.method==='POST'){
        const token=cookieValue(req,'annon_sid');if(token)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(crypto.createHash('sha256').update(token).digest('hex'));
        return send(res,200,{ok:true},{'Set-Cookie':cookie('',req,true)});
      }
      if(url.pathname==='/api/me'&&req.method==='GET')return send(res,200,{user,organizations:allowedOrgs(db,user.id),demoMode:settings.demoMode,aiConfigured:Boolean(settings.openaiKey)});
      const orgId=url.searchParams.get('orgId')||'';
      if(url.pathname==='/api/organizations'&&req.method==='GET')return send(res,200,{organizations:allowedOrgs(db,user.id)});
      if(url.pathname==='/api/briefing'&&req.method==='GET'){
        const brief=briefingFor(db,user.id,orgId||'all');return brief?send(res,200,brief):error(res,403,'この組織を閲覧できません');
      }
      if(url.pathname==='/api/tasks'&&req.method==='GET'){
        const data=visibleTasks(db,user.id,orgId);return data?send(res,200,{items:data}):error(res,403,'この組織を閲覧できません');
      }
      if(url.pathname==='/api/decisions'&&req.method==='GET'){
        const data=visibleDecisions(db,user.id,orgId);return data?send(res,200,{items:data}):error(res,403,'この組織を閲覧できません');
      }
      if(url.pathname==='/api/approvals'&&req.method==='GET'){
        const data=visibleApprovals(db,user.id,orgId);return data?send(res,200,{items:data,canApprove:canApprove(db,user.id,orgId)}):error(res,403,'この組織を閲覧できません');
      }
      if(url.pathname==='/api/approvals'&&req.method==='POST'){
        const input=await body(req);const organization=String(input.orgId||'');
        if(!canPropose(db,user.id,organization))return error(res,403,'提案権限がありません');
        if(!knownFields.action.has(input.actionType))return error(res,400,'Invalid action type');
        let payload;
        if(input.actionType==='task.create'){
          if(typeof input.title!=='string'||input.title.trim().length<3||input.title.length>160||!knownFields.priority.has(input.priority))return error(res,400,'タスク名・優先度を確認してください');
          const due=String(input.dueOn||'');if(due&&!/^\d{4}-\d{2}-\d{2}$/.test(due))return error(res,400,'Invalid due date');
          payload={title:input.title.trim(),description:String(input.description||'').slice(0,2000),priority:input.priority,dueOn:due||null};
        }else{
          const item=db.prepare('SELECT id,title,status FROM tasks WHERE id=? AND org_id=?').get(String(input.taskId||''),organization);
          if(!item||item.status==='done')return error(res,400,'対象タスクが見つからないか、すでに完了しています');
          payload={taskId:item.id,title:item.title};
        }
        const id=uid();db.prepare('INSERT INTO approvals(id,org_id,action_type,payload_json,status,requested_by) VALUES(?,?,?,?,?,?)').run(id,organization,input.actionType,JSON.stringify(payload),'pending',user.id);
        audit(db,user.id,organization,'approval.request',id,{actionType:input.actionType});return send(res,201,{id,status:'pending'});
      }
      const match=url.pathname.match(/^\/api\/approvals\/([a-f0-9-]{36})\/decision$/);
      if(match&&req.method==='POST'){
        const input=await body(req);const existing=db.prepare('SELECT * FROM approvals WHERE id=?').get(match[1]);
        if(!existing)return error(res,404,'申請が見つかりません');
        if(!canApprove(db,user.id,existing.org_id))return error(res,403,'この組織の承認権限がありません');
        if(existing.requested_by===user.id)return error(res,403,'自分の申請を承認・却下できません');
        if(!knownFields.decision.has(input.decision))return error(res,400,'Invalid decision');
        if(existing.status!=='pending')return error(res,409,'この申請は処理済みです');
        const payload=JSON.parse(existing.payload_json);
        db.exec('BEGIN IMMEDIATE');
        try{
          const outcome=input.decision==='approve'?'approved':'rejected';
          const updated=db.prepare("UPDATE approvals SET status=?,decided_by=?,decided_at=CURRENT_TIMESTAMP,decision_note=? WHERE id=? AND status='pending'")
            .run(outcome,user.id,String(input.note||'').slice(0,600),existing.id);
          if(updated.changes!==1)throw new Error('Approval conflict');
          if(outcome==='approved'&&existing.action_type==='task.create'){
            db.prepare(`INSERT INTO tasks(id,org_id,title,description,priority,status,due_on,source_status,source_note,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)`)
              .run(uid(),existing.org_id,payload.title,payload.description,payload.priority,'todo',payload.dueOn,'approved','承認済みの社内タスク案',existing.requested_by);
          }
          if(outcome==='approved'&&existing.action_type==='task.complete'){
            const result=db.prepare("UPDATE tasks SET status='done',updated_at=CURRENT_TIMESTAMP WHERE id=? AND org_id=? AND status!='done'")
              .run(payload.taskId,existing.org_id);
            if(result.changes!==1)throw new Error('Task could not be completed');
          }
          audit(db,user.id,existing.org_id,'approval.'+outcome,existing.id,{actionType:existing.action_type});db.exec('COMMIT');
          return send(res,200,{ok:true,status:outcome});
        }catch(e){db.exec('ROLLBACK');throw e;}
      }
      if(url.pathname==='/api/ask'&&req.method==='POST'){
        const input=await body(req);const organization=String(input.orgId||'all');
        const question=String(input.question||'').trim();if(question.length<3||question.length>1000)return error(res,400,'質問は3〜1000文字で入力してください');
        const brief=briefingFor(db,user.id,organization);if(!brief)return error(res,403,'この組織を閲覧できません');
        const result=await answerQuestion({brief,question,key:settings.openaiKey,model:settings.openaiModel});
        return send(res,200,result);
      }
      return error(res,404,'API not found');
    }catch(e){console.error('API ERROR:',e.message);return error(res,e.status||500,e.status?e.message:'処理に失敗しました。サーバーログを確認してください');}
  };
  return http.createServer(listener);
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  loadEnv();const settings=config();
  if(!settings.demoMode){console.error('このリポジトリはローカルMVPです。公開運用にはOIDC、監査、承認権限の正式設定が必要です。');process.exit(1);}
  if(!['127.0.0.1','localhost','::1'].includes(settings.host)){
    console.error('デモモードでは外部インターフェースにバインドできません。HOST=127.0.0.1 にしてください。');process.exit(1);
  }
  const database=createDatabase(settings.dbPath);
  const app=createApp({db:database,settings});
  app.listen(settings.port,settings.host,()=>console.log(`ANNON AI OFFICE (LOCAL DEMO) http://${settings.host}:${settings.port}`));
}
