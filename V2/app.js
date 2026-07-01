// ============================================================
// 刘昱君暑假任务管家（Cloudflare D1 + R2 完整版）
// ============================================================

(function () {
  if (window.__appStarted) return;
  window.__appStarted = true;

  console.log('🚀 应用启动中（Cloudflare D1 + R2）');

  // ============================================================
  // 基础配置
  // ============================================================
  const API_BASE = '/api';
  const TABLE_NAME = 'tasks';

  // ============================================================
  // DOM 检查
  // ============================================================
  function checkElements() {
    const ids = [
      'completeTaskModal','completeTaskText','mediaFileInput','mediaPreview',
      'chooseMediaBtn','clearMediaBtn','confirmCompleteBtn','cancelCompleteBtn','tasksGrid'
    ];
    ids.forEach(id => {
      if (!document.getElementById(id)) console.warn('⚠️ 缺少 DOM:', id);
    });
  }
  checkElements();

  // ============================================================
  // Cloudflare API 封装
  // ============================================================
  async function apiFetch(path, options = {}) {
    const res = await fetch(`${API_BASE}/${path}`, options);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  // ============================================================
  // 文件（R2）
  // ============================================================
  async function uploadMediaToStorage(file, taskId) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('taskId', taskId);
    const res = await fetch(`${API_BASE}/upload`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error('上传失败');
    const data = await res.json();
    return data.url;
  }

  async function deleteMediaFromStorage(url) {
    if (!url) return;
    await fetch(`${API_BASE}/delete-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileUrl: url })
    });
  }

  // ============================================================
  // 数据库（D1）
  // ============================================================
  async function getTasksByDate(date) {
    const data = await apiFetch(`${TABLE_NAME}?date=${encodeURIComponent(date)}`);
    return data.map(t => ({
      id: t.id,
      text: t.task_text,
      completed: !!t.completed,
      repeat_type: t.repeat_type || 'once',
      parent_id: t.parent_id,
      media_url: t.media_url,
      media_type: t.media_type
    }));
  }

  async function upsertTask(task) {
    const exists = await apiFetch(`${TABLE_NAME}?id=${encodeURIComponent(task.id)}`);
    if (exists.length) {
      await apiFetch(`${TABLE_NAME}?id=${encodeURIComponent(task.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(task)
      });
    } else {
      await apiFetch(TABLE_NAME, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...task, created_at: new Date().toISOString() })
      });
    }
  }

  async function deleteTaskById(id) {
    const tasks = await apiFetch(`${TABLE_NAME}?id=${encodeURIComponent(id)}`);
    if (tasks.length && tasks[0].media_url) {
      await deleteMediaFromStorage(tasks[0].media_url);
    }
    await apiFetch(`${TABLE_NAME}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async function getAllTasks() {
    return await apiFetch(TABLE_NAME);
  }

  async function completeTaskWithMedia(id, file) {
    let mediaUrl = null, mediaType = null;
    if (file) {
      mediaUrl = await uploadMediaToStorage(file, id);
      mediaType = file.type.startsWith('video') ? 'video' : 'image';
    }
    await apiFetch(`${TABLE_NAME}?id=${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed: true, media_url: mediaUrl, media_type: mediaType })
    });
    return { success: true };
  }

  // ============================================================
  // 重复任务
  // ============================================================
  async function ensureRecurringTasksForDate(dateStr) {
    const all = await getAllTasks();
    const existing = await getTasksByDate(dateStr);
    const texts = new Set(existing.map(t => t.text));
    const bases = all.filter(t => t.repeat_type !== 'once' && !t.parent_id);

    for (let b of bases) {
      const bd = new Date(b.date);
      const td = new Date(dateStr);

      if (b.repeat_type === 'daily' && td >= bd && !texts.has(b.task_text)) {
        await upsertTask({
          id: crypto.randomUUID(),
          date: dateStr,
          task_text: b.task_text,
          repeat_type: 'daily',
          parent_id: b.id,
          completed: false
        });
      }

      if (b.repeat_type === 'weekly' &&
          td.getDay() === bd.getDay() &&
          td >= bd &&
          !texts.has(b.task_text)) {
        await upsertTask({
          id: crypto.randomUUID(),
          date: dateStr,
          task_text: b.task_text,
          repeat_type: 'weekly',
          parent_id: b.id,
          completed: false
        });
      }
    }
  }

  async function prepareRecurringForRange(dates) {
    for (let d of dates) await ensureRecurringTasksForDate(d);
  }

  // ============================================================
  // UI 渲染
  // ============================================================
  let currentView = 'daily';
  let currentCenterDate = new Date();

  function formatYMD(d) {
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }

  function getWeekday(d) {
    return ['周日','周一','周二','周三','周四','周五','周六'][d.getDay()];
  }

  function escapeHtml(s) {
    if (!s) return '';
    return s.replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
  }

  // ---- 每日视图 ----
  async function renderDailyView() {
    const grid = document.getElementById('tasksGrid');
    grid.innerHTML = '<div class="loading">加载中...</div>';

    const left = new Date(currentCenterDate); left.setDate(left.getDate()-1);
    const right = new Date(currentCenterDate); right.setDate(right.getDate()+1);

    const leftStr = formatYMD(left), centerStr = formatYMD(currentCenterDate), rightStr = formatYMD(right);
    await prepareRecurringForRange([leftStr, centerStr, rightStr]);

    const [l, c, r] = await Promise.all([
      getTasksByDate(leftStr),
      getTasksByDate(centerStr),
      getTasksByDate(rightStr)
    ]);

    grid.innerHTML = '';
    grid.appendChild(buildColumn(left, l, leftStr.slice(5)+' 昨天', 'yesterday'));
    grid.appendChild(buildColumn(currentCenterDate, c, centerStr.slice(5)+' 今天', 'today'));
    grid.appendChild(buildColumn(right, r, rightStr.slice(5)+' 明天', 'tomorrow'));

    document.getElementById('displayDate').textContent = centerStr;
    document.getElementById('displayWeekday').textContent = getWeekday(currentCenterDate);

    attachCardEvents();
    attachAddButtons();
  }

  function buildColumn(dateObj, tasks, label, type) {
    const ymd = formatYMD(dateObj);
    let html = '';

    if (!tasks.length) {
      html = '<div class="empty-msg">✨ 暂无任务，点 + 添加</div>';
    } else {
      tasks.forEach(t => {
        const badge = t.repeat_type === 'daily' ? '每天' : (t.repeat_type === 'weekly' ? '每周' : '当天');
        const mediaIcon = t.media_url ? (t.media_type === 'video' ? '🎬' : '📸') : '';
        html += `
          <div class="task-card ${t.completed?'completed':''}"
               data-task-id="${t.id}"
               data-date-ymd="${ymd}"
               data-completed="${t.completed}"
               data-repeat="${t.repeat_type}"
               data-task-text="${escapeHtml(t.text)}"
               data-media-url="${t.media_url||''}"
               data-media-type="${t.media_type||''}">
            <div class="task-left">
              <span class="task-text">${escapeHtml(t.text)}</span>
              <span class="repeat-badge">${badge}</span>
              ${mediaIcon ? `<span class="media-badge">${mediaIcon}</span>` : ''}
            </div>
            <div class="check-icon">${t.completed?'✓✓':'○'}</div>
          </div>
        `;
      });
    }

    const col = document.createElement('div');
    col.className = `day-column ${type}-column`;
    col.innerHTML = `
      <div class="column-title">
        <span>${label}</span>
        ${type==='today'?`<button class="add-task-btn" data-date="${ymd}">+</button>`:''}
      </div>
      <div class="tasks-list">${html}</div>
    `;
    return col;
  }

  // ---- 暑假总览 ----
  async function renderOverview() {
    const container = document.getElementById('overviewContainer');
    container.innerHTML = '<div class="loading">加载总览...</div>';

    let totalComp = 0, totalAll = 0;
    const start = new Date(2026,6,1), end = new Date(2026,7,30);
    let cur = new Date(start);
    const months = [[],[]];

    while (cur <= end) {
      const ds = formatYMD(cur);
      await ensureRecurringTasksForDate(ds);
      const tasks = await getTasksByDate(ds);
      const comp = tasks.filter(t=>t.completed).length;
      totalComp += comp;
      totalAll += tasks.length;

      const obj = {
        ymd: ds,
        day: cur.getDate(),
        comp,
        total: tasks.length,
        rate: tasks.length ? comp/tasks.length : 0
      };
      months[cur.getMonth()===6?0:1].push(obj);
      cur.setDate(cur.getDate()+1);
    }

    let html = `<div class="overview-header">
      <div class="overview-title">📆 暑假总览</div>
      <div class="stats-badge">完成率 ${totalAll?((totalComp/totalAll*100).toFixed(1)):0}% (${totalComp}/${totalAll})</div>
    </div>`;

    ['七月','八月'].forEach((name,i)=>{
      if (!months[i].length) return;
      html += `<div class="month-section"><div class="month-badge">${name}</div><div class="week-grid">`;
      for (let j=0;j<months[i].length;j+=7){
        const week = months[i].slice(j,j+7);
        html += `<div class="week-row"><div class="week-label">${week[0].day}~${week[week.length-1].day}</div><div class="day-cards">`;
        week.forEach(d=>{
          html += `<div class="day-summary" data-ymd="${d.ymd}">
            <div class="day-num">${d.day}</div>
            <div class="completion-rate">✅ ${Math.round(d.rate*100)}%</div>
            <div>${d.comp}/${d.total}</div>
          </div>`;
        });
        html += '</div></div>';
      }
      html += '</div></div>';
    });

    container.innerHTML = html;

    document.querySelectorAll('.day-summary').forEach(el=>{
      el.onclick = ()=>{
        const ymd = el.dataset.ymd;
        if (!ymd) return;
        const [y,m,d] = ymd.split('-');
        currentCenterDate = new Date(+y,+m-1,+d);
        document.getElementById('dailyViewBtn').click();
        setTimeout(renderDailyView,50);
      };
    });
  }

  // ============================================================
  // 卡片事件
  // ============================================================
  let pendingTaskId = null;
  let selectedFile = null;

  function attachCardEvents() {
    const grid = document.getElementById('tasksGrid');
    grid.onclick = e => {
      const card = e.target.closest('.task-card');
      if (!card) return;

      const id = card.dataset.taskId;
      const completed = card.dataset.completed === 'true';
      const text = card.dataset.taskText;
      const url = card.dataset.mediaUrl;
      const type = card.dataset.mediaType;

      if (completed && url) {
        openMediaView(url, type);
      } else if (!completed) {
        openCompleteModal(id, text);
      }
    };

    grid.ondblclick = async e => {
      const card = e.target.closest('.task-card');
      if (!card) return;
      const id = card.dataset.taskId;
      const ymd = card.dataset.dateYmd;
      const repeat = card.dataset.repeat;
      const text = card.dataset.taskText;

      await deleteTaskWithRelation({id,repeat_type:repeat}, ymd, text);
      if (currentView==='daily') await renderDailyView();
      else await renderOverview();
    };
  }

  function attachAddButtons() {
    document.querySelectorAll('.add-task-btn').forEach(btn=>{
      btn.onclick = ()=> openAddModal(btn.dataset.date);
    });
  }

  // ---- 完成任务弹窗 ----
  function openCompleteModal(id, text) {
    pendingTaskId = id;
    document.getElementById('completeTaskText').textContent = `「${text}」`;
    selectedFile = null;
    document.getElementById('mediaFileInput').value = '';
    document.getElementById('mediaPreview').innerHTML = `
      <div style="font-size:3rem;color:#d99464;">📤</div>
      <p style="color:#b87a53;">点击下方按钮上传照片或视频</p>
    `;
    document.getElementById('completeTaskModal').classList.add('active');
  }

  document.getElementById('chooseMediaBtn').onclick = () => document.getElementById('mediaFileInput').click();
  document.getElementById('mediaFileInput').onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size>10 * 1024 * 1024){alert('文件不能超过10MB');return;}
    selectedFile = file;
    const reader = new FileReader();
    reader.onload = ev=>{
      document.getElementById('mediaPreview').innerHTML =
        file.type.startsWith('video')
        ? `<video controls src="${ev.target.result}" style="max-width:100%;max-height:200px;border-radius:16px;"></video>`
        : `<img src="${ev.target.result}" style="max-width:100%;max-height:200px;border-radius:16px;"/>`;
    };
    reader.readAsDataURL(file);
  };
  document.getElementById('clearMediaBtn').onclick = () => {
    selectedFile=null;
    document.getElementById('mediaFileInput').value='';
    document.getElementById('mediaPreview').innerHTML = `
      <div style="font-size:3rem;color:#d99464;">📤</div>
      <p style="color:#b87a53;">点击下方按钮上传照片或视频</p>
    `;
  };
  document.getElementById('cancelCompleteBtn').onclick = () => {
    document.getElementById('completeTaskModal').classList.remove('active');
  };
  document.getElementById('confirmCompleteBtn').onclick = async () => {
    if (!pendingTaskId) return;
    await completeTaskWithMedia(pendingTaskId, selectedFile);
    document.getElementById('completeTaskModal').classList.remove('active');
    if (currentView==='daily') await renderDailyView();
    else await renderOverview();
  };

  // ---- 查看媒体 ----
  function openMediaView(url, type) {
    const modal = document.getElementById('viewMediaModal');
    const content = document.getElementById('viewMediaContent');
    content.innerHTML = type==='video'
      ? `<video controls src="${url}" style="max-width:100%;max-height:70vh;border-radius:16px;"></video>`
      : `<img src="${url}" style="max-width:100%;max-height:70vh;border-radius:16px;"/>`;
    modal.classList.add('active');
  }
  document.getElementById('closeMediaViewBtn').onclick = () =>
    document.getElementById('viewMediaModal').classList.remove('active');

  // ---- 添加任务弹窗 ----
  let currentAddDate = null;
  let repeatType = 'once';

  document.querySelectorAll('.repeat-option').forEach(opt=>{
    opt.onclick = ()=>{
      document.querySelectorAll('.repeat-option').forEach(o=>o.classList.remove('selected'));
      opt.classList.add('selected');
      repeatType = opt.dataset.repeat;
    };
  });

  document.getElementById('confirmAddBtn').onclick = async () => {
    const text = document.getElementById('taskTitleInput').value.trim();
    if (!text) return alert('请输入任务内容');
    if (await addNewTaskWithRepeat(currentAddDate, text, repeatType)) {
      document.getElementById('taskModal').classList.remove('active');
      if (currentView==='daily') await renderDailyView();
      else await renderOverview();
    }
  };

  document.getElementById('cancelModalBtn').onclick = () =>
    document.getElementById('taskModal').classList.remove('active');

  function openAddModal(date) {
    currentAddDate = date;
    document.getElementById('taskTitleInput').value = '';
    repeatType = 'once';
    document.querySelectorAll('.repeat-option').forEach(o=>o.classList.remove('selected'));
    document.querySelector('.repeat-option[data-repeat="once"]').classList.add('selected');
    document.getElementById('taskModal').classList.add('active');
    document.getElementById('taskTitleInput').focus();
  }

  // ============================================================
  // 删除确认
  // ============================================================
  async function deleteTaskWithRelation(task, date, text) {
    return new Promise(resolve=>{
      let buttons=[];
      if (task.repeat_type==='daily'){
        buttons=[
          {label:'仅删除今天',value:'today'},
          {label:'删除所有未来',value:'future',danger:true},
          {label:'取消',value:'cancel'}
        ];
      } else if (task.repeat_type==='weekly'){
        buttons=[
          {label:'仅删除本周',value:'today'},
          {label:'删除所有未来',value:'future',danger:true},
          {label:'取消',value:'cancel'}
        ];
      } else {
        buttons=[
          {label:'确认删除',value:'ok',danger:true},
          {label:'取消',value:'cancel'}
        ];
      }

      showDynamicDeleteConfirm(
        `🗑️ 删除任务\n\n「${text}」`,
        buttons,
        async v=>{
          if (v==='today'){await deleteTaskById(task.id);resolve(true);}
          if (v==='future'){
            const all=await getAllTasks();
            const toDel=all.filter(t=>t.task_text===text&&t.date>=date);
            for (let t of toDel) await deleteTaskById(t.id);
            resolve(true);
          }
          resolve(false);
        }
      );
    });
  }

  function showDynamicDeleteConfirm(msg,buttons,cb){
    document.getElementById('deleteWarningMsg').innerHTML=msg.replace(/\n/g,'<br>');
    const box=document.getElementById('deleteDynamicButtons');
    box.innerHTML='';
    buttons.forEach(b=>{
      const btn=document.createElement('button');
      btn.className=`modal-btn ${b.danger?'danger':''}`;
      btn.textContent=b.label;
      btn.onclick=()=>{
        document.getElementById('deleteConfirmModal').classList.remove('active');
        cb(b.value);
      };
      box.appendChild(btn);
    });
    document.getElementById('deleteConfirmModal').classList.add('active');
  }

  // ============================================================
  // 视图切换
  // ============================================================
  document.getElementById('dailyViewBtn').onclick = () => {
    currentView='daily';
    document.getElementById('dailyViewPanel').style.display='block';
    document.getElementById('overviewViewPanel').style.display='none';
    document.getElementById('dailyViewBtn').classList.add('active');
    document.getElementById('overviewViewBtn').classList.remove('active');
    renderDailyView();
  };

  document.getElementById('overviewViewBtn').onclick = () => {
    currentView='overview';
    document.getElementById('dailyViewPanel').style.display='none';
    document.getElementById('overviewViewPanel').style.display='block';
    document.getElementById('dailyViewBtn').classList.remove('active');
    document.getElementById('overviewViewBtn').classList.add('active');
    renderOverview();
  };

  document.getElementById('prevDayBtn').onclick = () => {
    currentCenterDate.setDate(currentCenterDate.getDate()-1);
    renderDailyView();
  };

  document.getElementById('nextDayBtn').onclick = () => {
    currentCenterDate.setDate(currentCenterDate.getDate()+1);
    renderDailyView();
  };

  document.getElementById('backTodayBtn').onclick = () => {
    currentCenterDate=new Date();
    currentCenterDate.setHours(0,0,0,0);
    document.getElementById('dailyViewBtn').click();
  };

  // ============================================================
  // 启动
  // ============================================================
  currentCenterDate.setHours(0,0,0,0);
  renderDailyView();
  console.log('✅ 应用启动完成');
})();