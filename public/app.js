const $=id=>document.getElementById(id);
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={me:null,orgId:'all',brief:null};
async function api(url,opts={}){
 const res=await fetch(url,{credentials:'same-origin',headers:{'Content-Type':'application/json'},...opts});
 let json;try{json=await res.json();}catch{throw Error('不正なサーバー応答です');}
 if(!res.ok)throw Error(json.error||`HTTP ${res.status}`);
 return json;
}
function showLogin(){ $('login-view').hidden=false;$('app-view').hidden=true; }
async function boot(){
 try{ const me=await api('/api/me');state.me=me;$('login-view').hidden=true;$('app-view').hidden=false;
 $('user-name').textContent=me.user.display_name;
 $('org-select').innerHTML='<option value="all">権限のある全事業</option>'+me.organizations.map(o=>`<option value="${escapeHtml(o.id)}">${escapeHtml(o.name)}</option>`).join('');
 $('create-org').innerHTML=me.organizations.filter(o=>o.role!=='viewer').map(o=>`<option value="${escapeHtml(o.id)}">${escapeHtml(o.name)}</option>`).join('');
 $('create-form').hidden=me.organizations.every(o=>o.role==='viewer');
 await render();
 }catch(e){showLogin();}
}
function statusText(s){return ({todo:'未着手',doing:'進行中',blocked:'障害あり',done:'完了',pending:'承認待ち',approved:'承認済み',rejected:'却下'}[s]||s);}
function statusChip(s){return `<span class="chip">${escapeHtml(statusText(s))}</span>`;}
function taskRow(t){return `<tr><td data-label="優先"><span class="chip ${escapeHtml(t.priority)}">${escapeHtml(t.priority)}</span></td><td data-label="タスク"><strong>${escapeHtml(t.title)}</strong><br><span class="muted">${escapeHtml(t.project_name||t.org_name||t.org_id)}</span></td><td data-label="状態">${statusChip(t.status)}</td><td data-label="期限">${escapeHtml(t.due_on||'未設定')}</td><td data-label="根拠"><span class="chip">${t.source_status==='sample'?'デモ':escapeHtml(t.source_status)}</span></td><td data-label="操作">${t.status!=='done' ? `<button class="ghost small" data-complete="${escapeHtml(t.id)}" data-org="${escapeHtml(t.org_id)}">完了申請</button>`:'—'}</td></tr>`;}
function metric(label,value,description,kind=''){return `<div class="metric ${kind}"><div class="label">${label}</div><span class="value">${value}</span><span class="sub">${description}</span></div>`;}
async function render(){
 const org=state.orgId;
 try{
 const brief=await api('/api/briefing?orgId='+encodeURIComponent(org));state.brief=brief;
 $('brief-date').textContent=`${brief.asOf} JST · ${org==='all'?'許可された複数事業':brief.organizations[0]?.name} · データ同期：ローカルDB`;
 $('metrics').innerHTML=metric('進行中・未着手',brief.counts.active,'登録済みの未完了タスク','gold')+metric('期限超過',brief.counts.overdue,'期限までに完了していない仕事',brief.counts.overdue?'alert':'')+metric('障害・停滞',brief.counts.blocked,'対応が止まっている仕事',brief.counts.blocked?'alert':'')+metric('判断待ち',brief.counts.pendingDecisions,'決定事項の確認待ち');
 $('priority-list').innerHTML=brief.topPriorities.length?brief.topPriorities.map((t,i)=>`<div class="item"><span class="rank">${String(i+1).padStart(2,'0')}</span><div><strong>${escapeHtml(t.title)}</strong><div class="meta">${escapeHtml(t.org_name)} · ${escapeHtml(t.priority)} · ${escapeHtml(statusText(t.status))} · 期限 ${escapeHtml(t.due_on||'未設定')}</div></div></div>`).join(''):'<div class="empty">未完了のタスクはありません。</div>';
 $('decision-list').innerHTML=brief.decisions.length?brief.decisions.map((d,i)=>`<div class="item"><span class="rank">${String(i+1).padStart(2,'0')}</span><div><strong>${escapeHtml(d.title)}</strong><div class="meta">${escapeHtml(d.org_name)} · 期限 ${escapeHtml(d.due_on||'未設定')} · 検討中</div></div></div>`).join(''):'<div class="empty">判断待ちはありません。</div>';
 const list=org==='all'?brief.topPriorities: (await api('/api/tasks?orgId='+encodeURIComponent(org))).items;
 $('task-table').innerHTML=list.length?`<table><thead><tr><th>優先</th><th>タスク</th><th>状態</th><th>期限</th><th>根拠</th><th>操作</th></tr></thead><tbody>${list.map(taskRow).join('')}</tbody></table>`:'<div class="empty">対象タスクなし</div>';
 let approvals=[];const targets=org==='all'?state.me.organizations.map(o=>o.id):[org];
 for(const o of targets){const r=await api('/api/approvals?orgId='+encodeURIComponent(o));approvals.push(...r.items.filter(a=>a.status==='pending').map(a=>({...a,orgId:o,canApprove:r.canApprove})));}
 $('approvals-list').innerHTML=approvals.length?approvals.map(a=>`<div class="approval-card"><small>${escapeHtml(a.orgId)} · ${escapeHtml(a.action_type)} · ${escapeHtml(a.requested_name)}</small><strong>${escapeHtml(a.payload.title||a.payload.taskId)}</strong><p>状態：${escapeHtml(statusText(a.status))}</p><div class="approval-actions">${a.canApprove&&a.requested_by!==state.me.user.id?`<button data-approval="${escapeHtml(a.id)}" data-decision="approve" class="primary">承認</button><button data-approval="${escapeHtml(a.id)}" data-decision="reject" class="ghost">却下</button>`:'<span class="muted smalltext">他の権限者の判断待ち</span>'}</div></div>`).join(''):'<article class="panel"><div class="empty">承認待ちの申請はありません。</div></article>';
 }catch(e){$('priority-list').textContent=e.message;}
}
$('login-form').addEventListener('submit',async e=>{e.preventDefault();$('login-error').textContent='';const d=Object.fromEntries(new FormData(e.target));try{await api('/api/auth/login',{method:'POST',body:JSON.stringify(d)});await boot();}catch(err){$('login-error').textContent=err.message;}});
$('logout').addEventListener('click',async()=>{await api('/api/auth/logout',{method:'POST',body:'{}'});state.me=null;showLogin();});
$('org-select').addEventListener('change',async e=>{state.orgId=e.target.value;await render();});
$('create-form').addEventListener('submit',async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target));const result=$('create-result');try{await api('/api/approvals',{method:'POST',body:JSON.stringify({...data,actionType:'task.create'})});result.textContent='承認申請を登録しました';e.target.reset();await render();}catch(err){result.textContent=err.message;}});
document.addEventListener('click',async e=>{
 const complete=e.target.closest('[data-complete]');
 if(complete){try{await api('/api/approvals',{method:'POST',body:JSON.stringify({orgId:complete.dataset.org,actionType:'task.complete',taskId:complete.dataset.complete})});await render();}catch(err){alert(err.message);}return;}
 const btn=e.target.closest('[data-approval]');if(!btn)return;
 const d=btn.dataset.decision;const note=prompt(d==='approve'?'承認コメント（任意）':'却下理由を入力してください','')||'';
 try{await api('/api/approvals/'+btn.dataset.approval+'/decision',{method:'POST',body:JSON.stringify({decision:d,note})});await render();}catch(err){alert(err.message);}
});
$('ask-form').addEventListener('submit',async e=>{e.preventDefault();const q=new FormData(e.target).get('question');$('ai-answer').textContent='検索・回答中...';try{const r=await api('/api/ask',{method:'POST',body:JSON.stringify({orgId:state.orgId,question:q})});$('ai-answer').textContent=r.answer+'\n\n［回答モード: '+r.mode+' ／ 参照項目: '+r.sourceCount+'］';}catch(err){$('ai-answer').textContent='エラー：'+err.message;}});
boot();
