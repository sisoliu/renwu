// ============================================================
// 暑假任务管家 · 最全完整版（Cloudflare D1 + R2）
// ✅ 支持：多图上传 / iOS 风格相册 / 动态 DOM 绑定
// ============================================================

(function () {
  console.log('🚀 最全完整版启动');

  const API = '/api';
  let currentCenterDate = new Date();
  let currentAddDate = null;
  let currentRepeatType = 'once';
  let pendingTaskId = null;
  let selectedFiles = [];

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

  function weekday(d) {
    return ['周日','周一','周二','周三','周四','周五','周六'][d.getDay()];
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
    $('displayWeekday').textContent = weekday(currentCenterDate);

    bindCardEvents();
    bindAddButtons();
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
          <div class="task-card ${t.completed ? 'completed' : ''}" data-id="${t.id}">
            <div class="task-left">
              <span class="task-text">${escapeHtml(t.text)}</span>
              <span class="repeat-badge">
                ${t.repeat_type === 'daily' ? '每天' : t.repeat_type === 'weekly' ? '每周' : '当天'}
              </span>
            </div>
            <div class="check-icon">${t.completed ? '✓✓' : '○'}</div>
          </div>
        `;
      });
    }

    html += `</div>`;
    col.innerHTML = html;
    return col;
  }

  function escapeHtml(s) {
    if (!s) return '';
    return s.replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
  }

  /* ========== 事件绑定（动态 DOM 安全） ========== */

  function bindCardEvents() {
    document.querySelectorAll('.task-card').forEach(card => {
      card.onclick = async () => {
        const id = card.dataset.id;
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
    });
  }

  function bindAddButtons() {
    document.querySelectorAll('.add-task-btn').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        openAddModal(btn.dataset.date);
      };
    });
  }

  /* ========== 添加任务 ========== */

  function openAddModal(date) {
    currentAddDate = date;
    currentRepeatType = 'once';
    $('taskTitleInput').value = '';
    document.querySelectorAll('.repeat-option').forEach(o =>
      o.classList.toggle('selected', o.dataset.repeat === 'once')
    );
    $('taskModal').classList.add('active');
    $('taskTitleInput').focus();
  }

  document.querySelectorAll('.repeat-option').forEach(opt => {
    opt.onclick = () => {
      document.querySelectorAll('.repeat-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      currentRepeatType = opt.dataset.repeat;
    };
  });

  $('confirmAddBtn').onclick = async () => {
    const text = $('taskTitleInput').value.trim();
    if (!text) return alert('请输入任务内容');
    await upsertTask({
      id: crypto.randomUUID(),
      date: currentAddDate,
      task_text: text,
      completed: false,
      repeat_type: currentRepeatType
    });
    $('taskModal').classList.remove('active');
    renderDailyView();
  };

  $('cancelModalBtn').onclick = () => {
    $('taskModal').classList.remove('active');
  };

  /* ========== 完成任务 ========== */

  $('chooseMediaBtn').onclick = () => $('mediaFileInput').click();

  $('mediaFileInput').onchange = e => {
    selectedFiles = Array.from(e.target.files);
    $('mediaPreview').innerHTML = '';
    selectedFiles.forEach(f => {
      const reader = new FileReader();
      reader.onload = ev => {
        const el = document.createElement(f.type.startsWith('video') ? 'video' : 'img');
        el.src = ev.target.result;
        el.style = 'max-width:100px;max-height:100px;margin:4px;border-radius:12px;';
        if (f.type.startsWith('video')) el.controls = true;
        $('mediaPreview').appendChild(el);
      };
      reader.readAsDataURL(f);
    });
  };

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

  /* ========== iOS 风格相册 ========== */

  let galleryItems = [];
  let galleryIndex = 0;
  let touchStartX = 0;
  let mouseDownX = 0;

  function openGallery(items, index = 0) {
    galleryItems = items;
    galleryIndex = index;

    const modal = $('galleryModal');
    const track = $('galleryTrack');
    track.innerHTML = '';

    items.forEach(m => {
      const div = document.createElement('div');
      div.className = 'gallery-item';
      if (m.media_type === 'video') {
        div.innerHTML = `<video src="${m.media_url}" controls autoplay style="max-width:100%;max-height:100%;"></video>`;
      } else {
        div.innerHTML = `<img src="${m.media_url}" style="max-width:100%;max-height:100%;" />`;
      }
      track.appendChild(div);
    });

    track.style.transform = `translateX(-${index * 100}vw)`;
    modal.classList.add('active');

    modal.ontouchstart = e => { touchStartX = e.touches[0].clientX; };
    modal.ontouchend = e => {
      const diff = touchStartX - e.changedTouches[0].clientX;
      if (Math.abs(diff) > 50) diff > 0 ? nextGallery() : prevGallery();
    };

    modal.onmousedown = e => { mouseDownX = e.clientX; };
    modal.onmouseup = e => {
      const diff = mouseDownX - e.clientX;
      if (Math.abs(diff) > 50) diff > 0 ? nextGallery() : prevGallery();
    };

    document.onkeydown = e => {
      if (e.key === 'ArrowRight') nextGallery();
      if (e.key === 'ArrowLeft') prevGallery();
      if (e.key === 'Escape') closeGallery();
    };
  }

  function nextGallery() {
    if (galleryIndex < galleryItems.length - 1) {
      galleryIndex++;
      updateGallery();
    }
  }

  function prevGallery() {
    if (galleryIndex > 0) {
      galleryIndex--;
      updateGallery();
    }
  }

  function updateGallery() {
    const t = $('galleryTrack');
    if (t) t.style.transform = `translateX(-${galleryIndex * 100}vw)`;
  }

  function closeGallery() {
    $('galleryModal').classList.remove('active');
    document.onkeydown = null;
  }

  // 关闭按钮
  const closeBtn = document.querySelector('#galleryModal .close-btn');
  if (closeBtn) closeBtn.onclick = closeGallery;

  $('galleryModal').onclick = e => {
    if (e.target === $('galleryModal')) closeGallery();
  };

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
