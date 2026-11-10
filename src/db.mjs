import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export const uid = () => crypto.randomUUID();
export function secureHash(password,salt) { return crypto.scryptSync(password,salt,64).toString('hex'); }

export function createDatabase(filePath, { seed = true } = {}) {
  if (filePath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(filePath)),{recursive:true});
  const db = new DatabaseSync(filePath);
  db.exec(fs.readFileSync(new URL('../db/schema.sql',import.meta.url),'utf8'));
  if (seed && db.prepare('SELECT COUNT(*) AS n FROM organizations').get().n === 0) seedDemo(db);
  return db;
}

function seedDemo(db) {
  const orgs = [
    ['anon-coordination','ANON（協力ネットワーク）','ANON','単一法人の親会社とは扱わない'],
    ['gad','GAD Project','No.1 Entertainment','Lead Label周辺のプロジェクト'],
    ['lead-label','Lead Label','No.1 Entertainment','音楽レーベル'],
    ['beyond-max','Beyond-MAX','No.1 Entertainment','芸能プロダクション'],
    ['masterpiece','Masterpiece 1','No.5 Life Style','イベントチーム'],
    ['b-ill','B-ill','No.5 Life Style','ヒップホップカルチャースクール'],
    ['star-dig','STAR DIG','No.8 Development','創業支援']
  ];
  const insOrg=db.prepare('INSERT INTO organizations(id,slug,name,area,relationship_note) VALUES(?,?,?,?,?)');
  for(const [id,name,area,note] of orgs) insOrg.run(id,id,name,area,note);
  const users=[
    ['annon','annon@example.test','ANNON管理者（デモ）',process.env.ANNON_DEMO_PASSWORD || 'AnnonLocal-ChangeMe-2026!'],
    ['lead','lead@example.test','事業責任者（デモ）',process.env.LEAD_DEMO_PASSWORD || 'LeadLocal-ChangeMe-2026!'],
    ['viewer','viewer@example.test','閲覧担当（デモ）',process.env.VIEWER_DEMO_PASSWORD || 'ViewerLocal-ChangeMe-2026!'],
  ];
  const insUser=db.prepare('INSERT INTO users(id,email,display_name,salt,password_hash) VALUES(?,?,?,?,?)');
  for(const [id,email,name,password] of users){const salt=crypto.randomBytes(16).toString('hex');insUser.run(id,email,name,salt,secureHash(password,salt));}
  const insMember=db.prepare('INSERT INTO memberships(user_id,org_id,role,can_approve) VALUES(?,?,?,?)');
  for (const [id] of orgs) insMember.run('annon',id,'owner',1); // デモ用。実運用では業務責任者が個別に付与する
  for (const id of ['gad','lead-label']) insMember.run('lead',id,'manager',1);
  insMember.run('viewer','gad','viewer',0);
  db.prepare('INSERT INTO projects(id,org_id,name) VALUES(?,?,?)').run('launch3','gad','Launch vol.3');
  db.prepare('INSERT INTO projects(id,org_id,name) VALUES(?,?,?)').run('uan','lead-label','Uunaプロデュース（サンプル）');
  db.prepare('INSERT INTO projects(id,org_id,name) VALUES(?,?,?)').run('reorg','anon-coordination','情報共有・事業管理の整備');
  const task=db.prepare('INSERT INTO tasks(id,org_id,project_id,title,description,priority,status,due_on,source_status,source_note,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  task.run('task-a','gad','launch3','協賛提供条件を確認','金額・掲載位置・納期を確認。確定した契約金額は未入力。','P0','doing','2026-11-12','sample','デモ用の架空タスク。実案件の進捗ではない','annon');
  task.run('task-b','gad','launch3','制作物の校了担当を確定','フライヤー・パンフレット・告知動画の確認ルートを設定。','P0','todo','2026-11-13','sample','デモ用','annon');
  task.run('task-c','lead-label','uan','投稿スケジュールを整理','投稿頻度と素材回収の期限を確認。','P1','todo','2026-11-16','sample','デモ用','annon');
  task.run('task-d','anon-coordination','reorg','役割と報告先を確定','事業ごとの正式権限を確認し、名簿へ反映。','P0','blocked','2026-11-15','sample','デモ用','annon');
  const dec=db.prepare('INSERT INTO decisions(id,org_id,project_id,title,state,due_on,source_note) VALUES(?,?,?,?,?,?,?)');
  dec.run('d1','gad','launch3','協賛の承認・請求を誰が担当するか','pending','2026-11-11','検討例（デモ）');
  dec.run('d2','anon-coordination','reorg','事業別の情報アクセス権限','pending','2026-11-13','検討例（デモ）');
}

export function membership(db,userId,orgId) {
  return db.prepare('SELECT role,can_approve FROM memberships WHERE user_id=? AND org_id=?').get(userId,orgId);
}
export function allowedOrgs(db,userId) {
  return db.prepare(`SELECT o.id,o.name,o.area,m.role,m.can_approve
    FROM organizations o JOIN memberships m ON o.id=m.org_id WHERE m.user_id=? ORDER BY o.area,o.name`).all(userId);
}
export function accessible(db,userId,orgId) { return Boolean(membership(db,userId,orgId)); }
export function canPropose(db,userId,orgId) { return ['owner','manager','member'].includes(membership(db,userId,orgId)?.role); }
export function canApprove(db,userId,orgId) { const m=membership(db,userId,orgId); return Boolean(m && m.can_approve && ['owner','manager'].includes(m.role)); }
export function visibleTasks(db,userId,orgId) {
  if(!accessible(db,userId,orgId)) return null;
  return db.prepare(`SELECT t.id,t.title,t.description,t.priority,t.status,t.due_on,t.source_status,t.source_note,
    t.org_id,t.project_id,p.name AS project_name,t.updated_at FROM tasks t LEFT JOIN projects p ON t.project_id=p.id WHERE t.org_id=? ORDER BY CASE t.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 2 END, t.due_on`).all(orgId);
}
export function visibleDecisions(db,userId,orgId) {
  if(!accessible(db,userId,orgId)) return null;
  return db.prepare(`SELECT id,title,state,due_on,source_note FROM decisions WHERE org_id=? ORDER BY due_on`).all(orgId);
}
export function visibleApprovals(db,userId,orgId) {
  if(!accessible(db,userId,orgId)) return null;
  return db.prepare(`SELECT a.id,a.action_type,a.payload_json,a.status,a.created_at,a.requested_by,u.display_name AS requested_name,
    a.decided_at,a.decision_note FROM approvals a JOIN users u ON a.requested_by=u.id WHERE a.org_id=? ORDER BY a.created_at DESC`).all(orgId).map(({payload_json,...x})=>({...x,payload:JSON.parse(payload_json)}));
}
export function audit(db,actor,org,action,target,details={}) {
  db.prepare('INSERT INTO audit_logs(id,actor_id,org_id,action,target_id,metadata_json) VALUES(?,?,?,?,?,?)')
    .run(uid(),actor,org,action,target,JSON.stringify(details));
}
