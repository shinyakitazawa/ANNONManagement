import { allowedOrgs, visibleTasks, visibleDecisions } from './db.mjs';

export function dateJst(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
}
export function briefingFor(db,userId,orgId='all', today=dateJst()) {
  const allowed=allowedOrgs(db,userId);
  const selected=orgId==='all'?allowed:allowed.filter(o=>o.id===orgId);
  if (!selected.length) return null;
  const tasks=selected.flatMap(org=>(visibleTasks(db,userId,org.id)||[]).map(t=>({...t,org_name:org.name})));
  const decisions=selected.flatMap(org=>(visibleDecisions(db,userId,org.id)||[]).map(d=>({...d,org_id:org.id,org_name:org.name})));
  const open=tasks.filter(t=>t.status!=='done');
  const overdue=open.filter(t=>t.due_on && t.due_on<today);
  const blocked=open.filter(t=>t.status==='blocked');
  const dueSoon=open.filter(t=>t.due_on && t.due_on>=today && t.due_on<=addDays(today,3));
  const pending=decisions.filter(d=>d.state==='pending');
  const sorted=[...open].sort((a,b)=> {
    const rank={P0:0,P1:1,P2:2};
    return (rank[a.priority]-rank[b.priority])||((a.due_on||'9999').localeCompare(b.due_on||'9999'));
  });
  return {asOf:today,scope:orgId,organizations:selected.map(({id,name,area})=>({id,name,area})),
    counts:{active:open.length,overdue:overdue.length,blocked:blocked.length,dueSoon:dueSoon.length,pendingDecisions:pending.length},
    topPriorities:sorted.slice(0,8), overdue:overdue.slice(0,10),blocked:blocked.slice(0,10),dueSoon:dueSoon.slice(0,10),
    decisions:pending.slice(0,10),
    notice:'デモデータは実際の完了状況・協賛金額・契約を意味しません。情報が未確認なら確定事項として扱わないでください。'};
}
function addDays(iso,n){const d=new Date(iso+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
export function fallbackAnswer(brief,question) {
  const active=brief.topPriorities.slice(0,5).map(t=>`・[${t.priority}] ${t.org_name}：${t.title}（${t.status}／期限 ${t.due_on||'未設定'}／根拠 ${t.source_status}）`).join('\n');
  const asks=brief.decisions.slice(0,4).map(d=>`・${d.org_name}：${d.title}`).join('\n');
  return `質問：「${question}」\n\n【確認できる範囲での優先候補】\n${active||'現在、該当する未完了タスクはありません。'}\n\n【判断待ち】\n${asks||'登録された判断待ちはありません。'}\n\n【要注意】期限超過 ${brief.counts.overdue}件、障害あり ${brief.counts.blocked}件。\n\nAPIキー未設定のため、これはデータベースから生成した定型回答です。資料に含まれない事実や利益・着金は推測していません。`;
}
