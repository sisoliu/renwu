// ============================================================
// 暑假任务管家 · 最终完整版
// ✅ 顶部添加按钮
// ✅ 日期时间选择 + 下拉重复
// ✅ 左滑编辑 / 删除（微信风格）
// ✅ 编辑任务回填
// ============================================================

(function () {
  console.log('🚀 最终完整版启动');

  const API = '/api';
  let currentCenterDate = new Date();
  let currentAddDate = null;
  let pendingTaskId = null;
  let selectedFiles = [];
  let isEditingTaskId = null;   // ✅ 编辑模式标识
  let swipeStartX = 0;          // ✅ 左滑用

  const $ = id => document.getElementById(id);

  /* ========== API ========== */

  async function api(path, opt = {}) {
    const res = await fetch(API + path, opt);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async function getTasks(date) {
    return (await api(`/tasks?date=${encodeURIComponent(date)}`))
      .map(t => ({
        id: t.id,
        text: t.task_text,
        completed: !!t.completed,
        repeat_type: t.repeat_type || 'once'
      }));
  }

  async function upsertTask(t) {
    const ex = await api(`/tasks?id=${encodeURIComponent(t.id)}`);
    if (ex.length) {
      await api(`/tasks?id=${encodeURIComponent(t.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(t)
      });
    } else {
      await api('/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...t,
          created_at: new Date().toISOString()
        })
      });
    }
  }

  async function completeTask(id) {
    await api(`/tasks?id=${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed: true })
    });
  }

  async function uploadMedia(taskId, files) {
    const fd = new FormData();
    files.forEach(f => fd.append('file', f));
    fd.append('taskId', taskId);

    const data = await api('/upload', { method: 'POST', body: fd });
    if (!Array.isArray(data.files)) return;

    for (const f of data.files) {
      await api('/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_id: taskId,
          media_url: f.url,
          media_type: f.type
        })
      });
    }
  }

  /* ========== 工具 ========== */

  function formatYMD(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function escapeHtml(s) {
    if (!s) return '';
    return s.replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
  }

  /* ========== 每日视图 ========== */

  async function renderDailyView() {
    const grid = $('tasksGrid');
    grid.innerHTML = '<div class="loading">加载中…</div>';

    const left = new Date(currentCenterDate);
    left.setDate(left.getDate() - 1);
    const right = new Date(currentCenterDate);
    right.setDate(right.getDate() + 1);

    const [l, c, r] = await Promise.all([
      getTasks(formatYMD(left)),
      getTasks(formatYMD(currentCenterDate)),
      getTasks(formatYMD(right))
    ]);

    grid.innerHTML = '';
    grid.appendChild(column(left, l, '昨天', 'yesterday'));
    grid.appendChild(column(currentCenterDate, c, '今天', 'today'));
    grid.appendChild(column(right, r, '明天', 'tomorrow'));

    $('displayDate').textContent = formatYMD(currentCenterDate);
    $('displayWeekday').textContent = ['周日','周一','周二','周三','周四','周五','周六'][currentCenterDate.getDay()];

    bindCardEvents();
  }

  function column(date, tasks, label, type) {
    const ymd = formatYMD(date);
    const col = document.createElement('div');
    col.className = `day-column ${type}-column`;

    let html = `<div class="column-title"><span>${label}</span>`;
    if (type === 'today') {
      html += `<button class="add-task-btn" data-date="${ymd}">+</button>`;
    }
    html += `</div><div class="tasks-list">`;

    if (!tasks.length) {
      html += `<div class="empty-msg">暂无任务</div>`;
    } else {
      tasks.forEach(t => {
        html += `
          <div class="task-card-wrapper">
            <div class="task-card ${t.completed ? 'completed' : ''}" data-id="${t.id}">
              <div class="task-left">
                <span class="task-text">${escapeHtml(t.text)}</span>
                <span class="repeat-badge">
                  ${t.repeat_type === 'daily' ? '每天' : t.repeat_type === 'weekly' ? '每周' : '当天'}
                </span>
              </div>
              <div class="check-icon">${t.completed ? '✓✓' : '○'}</div>
            </div>
            <div class="task-actions">
              <button class="edit-btn">编辑</button>
              <button class="delete-btn">删除</button>
            </div>
          </div>
        `;
      });
    }

    html += `</div>`;
    col.innerHTML = html;
    return col;
  }

  /* ========== 卡片事件 ========== */

  function bindCardEvents() {
    $('tasksGrid').onclick = async e => {
      const wrapper = e.target.closest('.task-card-wrapper');
      if (!wrapper) return;

      const card = wrapper.querySelector('.task-card');
      const id = card.dataset.id;

      // ✅ 删除
      if (e.target.classList.contains('delete-btn')) {
        if (!confirm('确定删除该任务？')) return;
        await api(`/tasks?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
        renderDailyView();
        return;
      }

      // ✅ 编辑
      if (e.target.classList.contains('edit-btn')) {
        const list = await api(`/tasks?id=${encodeURIComponent(id)}`);
        if (list.length) {
          openAddModal(list[0].date, {
            id: list[0].id,
            text: list[0].task_text,
            repeat_type: list[0].repeat_type
          });
        }
        return;
      }

      // ✅ 点击卡片：完成 / 查看相册
      const completed = card.classList.contains('completed');
      if (completed) {
        const list = await api(`/media?task_id=${encodeURIComponent(id)}`);
        if (list.length) openGallery(list, 0);
      } else {
        pendingTaskId = id;
        selectedFiles = [];
        $('mediaPreview').innerHTML = '';
        $('completeTaskModal').classList.add('active');
      }
    };

    // ✅ 左滑
    document.querySelectorAll('.task-card-wrapper').forEach(wrapper => {
      const card = wrapper.querySelector('.task-card');
      wrapper.ontouchstart = e => { swipeStartX = e.touches[0].clientX; };
      wrapper.ontouchend = e => {
        const diff = swipeStartX - e.changedTouches[0].clientX;
        card.style.transform = diff > 80 ? 'translateX(-130px)' : 'translateX(0)';
      };
      wrapper.onmousedown = e => { swipeStartX = e.clientX; };
      wrapper.onmouseup = e => {
        const diff = swipeStartX - e.clientX;
        card.style.transform = diff > 80 ? 'translateX(-130px)' : 'translateX(0)';
      };
    });
  }

  /* ========== 添加 / 编辑任务弹窗 ========== */

  function openAddModal(date, editTask) {
    currentAddDate = date;
    isEditingTaskId = editTask ? editTask.id : null;

    const now = new Date();
    now.setSeconds(0);
    $('taskDateTimeInput').value = now.toISOString().slice(0, 16);

    $('taskTitleInput').value = editTask
      ? editTask.text.replace(/^\[\d{2}:\d{2}\]\s*/, '')
      : '';

    $('repeatSelect').value = editTask ? editTask.repeat_type : 'once';

    $('taskModal').classList.add('active');
    $('taskTitleInput').focus();
  }

  $('addTaskTopBtn').onclick = () => {
    openAddModal(formatYMD(currentCenterDate));
  };

  $('cancelModalBtn').onclick = () => {
    $('taskModal').classList.remove('active');
    isEditingTaskId = null;
  };

  $('confirmAddBtn').onclick = async () => {
    const text = $('taskTitleInput').value.trim();
    if (!text) return alert('请输入任务内容');

    const dt = new Date($('taskDateTimeInput').value);
    const date = formatYMD(dt);
    const time =
      ('0' + dt.getHours()).slice(-2) + ':' +
      ('0' + dt.getMinutes()).slice(-2);
    const fullText = `[${time}] ${text}`;

    if (isEditingTaskId) {
      await api(`/tasks?id=${encodeURIEncode(isEditingTaskId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_text: fullText,
          date,
          repeat_type: $('repeatSelect').value
        })
      });
    } else {
      await upsertTask({
        id: crypto.randomUUID(),
        date,
        task_text: fullText,
        completed: false,
        repeat_type: $('repeatSelect').value
      });
    }

    $('taskModal').classList.remove('active');
    isEditingTaskId = null;
    renderDailyView();
  };

  /* ========== 完成任务 ========== */

  $('cancelCompleteBtn').onclick = () => {
    $('completeTaskModal').classList.remove('active');
  };

  $('confirmCompleteBtn').onclick = async () => {
    if (!pendingTaskId) return;
    if (selectedFiles.length) {
      await uploadMedia(pendingTaskId, selectedFiles);
    }
    await completeTask(pendingTaskId);
    $('completeTaskModal').classList.remove('active');
    renderDailyView();
  };

  /* ========== 相册 ========== */

  let galleryItems = [];
  let galleryIndex = 0;

  function openGallery(items, index) {
    galleryItems = items;
    galleryIndex = index;

    const modal = $('galleryModal');
    const track = $('galleryTrack');
    track.innerHTML = '';

    items.forEach(m => {
      const div = document.createElement('div');
      div.className = 'gallery-item';
      div.innerHTML = m.media_type === 'video'
        ? `<video src="${m.media_url}" controls autoplay style="max-width:100%;max-height:100%;"></video>`
        : `<img src="${m.media_url}" style="max-width:100%;max-height:100%;" />`;
      track.appendChild(div);
    });

    track.style.transform = `translateX(-${index * 100}vw)`;
    modal.classList.add('active');

    modal.onclick = e => {
      if (e.target === modal) {
        modal.classList.remove('active');
      }
    };
  }

  /* ========== 日期导航 ========== */

  $('prevDayBtn').onclick = () => {
    currentCenterDate.setDate(currentCenterDate.getDate() - 1);
    renderDailyView();
  };

  $('nextDayBtn').onclick = () => {
    currentCenterDate.setDate(currentCenterDate.getDate() + 1);
    renderDailyView();
  };

  $('backTodayBtn').onclick = () => {
    currentCenterDate = new Date();
    currentCenterDate.setHours(0, 0, 0, 0);
    renderDailyView();
  };

  /* ========== 启动 ========== */

  currentCenterDate.setHours(0, 0, 0, 0);
  renderDailyView();
})();
