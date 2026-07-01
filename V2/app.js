// ============================================================
// 刘昱君暑假任务管家（Cloudflare D1 + R2 多图稳定版）
// ✅ 一个任务 = 多张照片 / 多个视频
// ============================================================

(function () {
  console.log('🚀 多图版启动');

  const API = '/api';
  let currentView = 'daily';
  let currentCenterDate = new Date();
  let currentAddDate = null;
  let repeatType = 'once';
  let pendingTaskId = null;
  let selectedFiles = [];

  // ---- DOM ----
  const $ = id => document.getElementById(id);

  // ---- API ----
  async function api(path, opt={}) {
    const r = await fetch(API+path, opt);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  async function getTasks(date) {
    return (await api(`/tasks?date=${encodeURIComponent(date)}`)).map(t=>({
      id:t.id, text:t.task_text, completed:!!t.completed,
      repeat_type:t.repeat_type||'once', parent_id:t.parent_id,
      media_url:t.media_url, media_type:t.media_type
    }));
  }

  async function upsertTask(t) {
    const ex = await api(`/tasks?id=${encodeURIComponent(t.id)}`);
    if (ex.length) {
      await api(`/tasks?id=${encodeURIComponent(t.id)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(t)});
    } else {
      await api('/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...t,created_at:new Date().toISOString()})});
    }
  }

  async function completeTask(id) {
    await api(`/tasks?id=${encodeURIComponent(id)}`,{
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({completed:true})
    });
  }

  async function uploadMultipleMedia(taskId, files) {
    const fd = new FormData();
    files.forEach(f=>fd.append('file',f));
    fd.append('taskId',taskId);
    const data = await api('/upload',{method:'POST',body:fd});
    for (const f of data.files) {
      await api('/media',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        task_id:taskId, media_url:f.url, media_type:f.type
      })});
    }
  }

  async function loadMedia(taskId, container) {
    const list = await api(`/media?task_id=${encodeURIComponent(taskId)}`);
    container.innerHTML = '';
    list.forEach(m=>{
      const el = document.createElement(m.media_type==='video'?'video':'img');
      el.src = m.media_url;
      el.style='max-width:200px;max-height:200px;margin:6px;border-radius:12px;';
      if (m.media_type==='video') el.controls=true;
      container.appendChild(el);
    });
  }

  // ---- UI ----
  function format(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
  function week(d){return['周日','周一','周二','周三','周四','周五','周六'][d.getDay()];}

  async function renderDaily() {
    const g=$('tasksGrid'); g.innerHTML='<div class="loading">加载...</div>';
    const l=new Date(currentCenterDate); l.setDate(l.getDate()-1);
    const r=new Date(currentCenterDate); r.setDate(r.getDate()+1);
    const [a,b,c]=await Promise.all([getTasks(format(l)),getTasks(format(currentCenterDate)),getTasks(format(r))]);
    g.innerHTML='';
    g.appendChild(col(l,a,'昨天','yesterday'));
    g.appendChild(col(currentCenterDate,b,'今天','today'));
    g.appendChild(col(r,c,'明天','tomorrow'));
    $('displayDate').textContent=format(currentCenterDate);
    $('displayWeekday').textContent=week(currentCenterDate);
    bindCards();
  }

  function col(date,tasks,label,type) {
    const ymd=format(date);
    let html=tasks.length?tasks.map(t=>`
      <div class="task-card ${t.completed?'completed':''}" data-id="${t.id}" data-ymd="${ymd}">
        <div class="task-left">
          <span class="task-text">${t.text}</span>
          <span class="repeat-badge">${t.repeat_type==='daily'?'每天':t.repeat_type==='weekly'?'每周':'当天'}</span>
        </div>
        <div class="check-icon">${t.completed?'✓✓':'○'}</div>
      </div>
    `).join(''):`<div class="empty-msg">暂无任务</div>`;
    const d=document.createElement('div');
    d.className=`day-column ${type}-column`;
    d.innerHTML=`<div class="column-title"><span>${label}</span>${type==='today'?`<button class="add-task-btn" data-date="${ymd}">+</button>`:''}</div><div class="tasks-list">${html}</div>`;
    return d;
  }

  function bindCards() {
    document.querySelectorAll('.task-card').forEach(card=>{
      card.onclick=async()=>{
        const id=card.dataset.id;
        const completed=card.classList.contains('completed');
        if (completed) {
          const box=document.createElement('div');
          box.id='media-'+id;
          card.appendChild(box);
          await loadMedia(id,box);
        } else {
          pendingTaskId=id;
          selectedFiles=[];
          $('mediaPreview').innerHTML='';
          $('completeTaskModal').classList.add('active');
        }
      };
    });
    document.querySelectorAll('.add-task-btn').forEach(b=>{
      b.onclick=()=>openAdd(b.dataset.date);
    });
  }

  function openAdd(date){
    currentAddDate=date;
    $('taskTitleInput').value='';
    $('taskModal').classList.add('active');
  }

  // ---- 弹窗 ----
  $('chooseMediaBtn').onclick=()=>$('mediaFileInput').click();
  $('mediaFileInput').onchange=e=>{
    selectedFiles=Array.from(e.target.files);
    $('mediaPreview').innerHTML='';
    selectedFiles.forEach(f=>{
      const r=new FileReader();
      r.onload=ev=>{
        const el=document.createElement(f.type.startsWith('video')?'video':'img');
        el.src=ev.target.result;
        el.style='max-width:100px;max-height:100px;margin:4px;border-radius:12px;';
        if(f.type.startsWith('video')) el.controls=true;
        $('mediaPreview').appendChild(el);
      };
      r.readAsDataURL(f);
    });
  };
  $('cancelCompleteBtn').onclick=()=>$('completeTaskModal').classList.remove('active');
  $('confirmCompleteBtn').onclick=async()=>{
    if (!pendingTaskId) return;
    if (selectedFiles.length) await uploadMultipleMedia(pendingTaskId, selectedFiles);
    await completeTask(pendingTaskId);
    $('completeTaskModal').classList.remove('active');
    renderDaily();
  };

  // ---- 添加任务 ----
  $('confirmAddBtn').onclick=async()=>{
    const text=$('taskTitleInput').value.trim();
    if(!text) return;
    await upsertTask({
      id:crypto.randomUUID(),
      date:currentAddDate,
      task_text:text,
      completed:false,
      repeat_type:repeatType
    });
    $('taskModal').classList.remove('active');
    renderDaily();
  };

  // ---- 视图切换 ----
  $('dailyViewBtn').onclick=()=>{currentView='daily';renderDaily();};
  $('prevDayBtn').onclick=()=>{currentCenterDate.setDate(currentCenterDate.getDate()-1);renderDaily();};
  $('nextDayBtn').onclick=()=>{currentCenterDate.setDate(currentCenterDate.getDate()+1);renderDaily();};
  $('backTodayBtn').onclick=()=>{currentCenterDate=new Date();renderDaily();};

  // ---- 启动 ----
  currentCenterDate.setHours(0,0,0,0);
  renderDaily();
})();
