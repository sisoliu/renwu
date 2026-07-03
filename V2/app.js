function nowCST() {
    const now = new Date();
    return new Date(now.getTime() + 8 * 60 * 60 * 1000);
}

(function () {
    console.log('🚀 暑假任务管家');

    const API = '/api';
    let currentCenterDate = new Date();
    let currentAddDate = null;
    let pendingTaskId = null;
    let selectedFiles = [];
    let isEditingTaskId = null;
    let swipeStartX = 0;

    const $ = id => document.getElementById(id);

    /* ========== API ========== */
    async function api(path, opt = {}) {
        const res = await fetch(API + path, opt);
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    }

    async function getTasks(date) {
        return (await api(`/tasks?date=${encodeURIComponent(date)}`))
            .filter(t => !t.task_text?.startsWith('[已删除]'))
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
                body: JSON.stringify({ ...t, created_at: new Date().toISOString() })
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

    const base = new Date(currentCenterDate);
    const left = new Date(base);
    left.setDate(left.getDate() - 1);
    const right = new Date(base);
    right.setDate(right.getDate() + 1);

    const [l, c, r] = await Promise.all([
        getTasks(formatYMD(left)),
        getTasks(formatYMD(base)),
        getTasks(formatYMD(right))
    ]);

    grid.innerHTML = '';
    grid.appendChild(column(left, l, '昨天', 'yesterday'));
    grid.appendChild(column(base, c, '今天', 'today'));
    grid.appendChild(column(right, r, '明天', 'tomorrow'));

    $('displayDate').textContent = formatYMD(base);
    $('displayWeekday').textContent = ['周日','周一','周二','周三','周四','周五','周六'][base.getDay()];

    bindCardEvents();
   $('displayDate').textContent = formatYMD(base);
    $('displayWeekday').textContent = ['周日','周一','周二','周三','周四','周五','周六'][base.getDay()];

    bindCardEvents();

    // 填充已完成任务的媒体按钮
    const completedCards = document.querySelectorAll('.task-card.completed');
    for (const card of completedCards) {
        const id = card.dataset.id;
        const media = await api(`/media?task_id=${encodeURIComponent(id)}`);
        const placeholder = card.parentElement.querySelector('.task-right');
        if (media.length && placeholder) {
            placeholder.innerHTML = `<button class="media-btn" data-id="${id}" title="查看媒体">🖼️</button>`;
        }
    }
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
            html += `<div class="task-card-wrapper">`;

            // 任务主体
            html += `
            <div class="task-card ${t.completed ? 'completed' : ''}" data-id="${t.id}">
                <div class="task-left">
                    <span class="task-text">${escapeHtml(t.text)}</span>
                    <span class="repeat-badge">
                        ${t.repeat_type === 'daily' ? '每天' : t.repeat_type === 'weekly' ? '每周' : ''}
                    </span>
                </div>`;

            // 右侧操作区
            if (t.completed) {
                html += `
                <div class="task-right" data-media-placeholder="${t.id}"></div>`;
            } else {
                 html += `
                <div class="task-right">
                    <button class="edit-btn" data-id="${t.id}" title="编辑">✏️</button>
                    <button class="done-btn" data-id="${t.id}" title="完成任务">○</button>
                </div>`;
            }

            html += `</div></div>`;
        });
    }

    html += `</div>`;
    col.innerHTML = html;
    return col;
}

    /* ========== 卡片事件 ========== */
function bindCardEvents() {
    $('tasksGrid').onclick = async e => {

        // ✅ 查看媒体
        if (e.target.classList.contains('media-btn')) {
            const id = e.target.dataset.id;
            const list = await api(`/media?task_id=${encodeURIComponent(id)}`);
            if (list.length) {
                openGallery(list, 0);
                }
          return;
      }

        // ✅ 编辑
        if (e.target.classList.contains('edit-btn')) {
            const wrapper = e.target.closest('.task-card-wrapper');
            const id = wrapper.querySelector('.task-card').dataset.id;
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

        // ✅ 完成任务
        if (e.target.classList.contains('done-btn')) {
            const wrapper = e.target.closest('.task-card-wrapper');
            const id = wrapper.querySelector('.task-card').dataset.id;
            pendingTaskId = id;
            selectedFiles = [];
            $('mediaPreview').innerHTML = '';
            $('completeTaskModal').classList.add('active');
            return;
        }
    };
}

    /* ========== 添加 / 编辑任务弹窗 ========== */
function openAddModal(date, editTask) {
    currentAddDate = date;
    isEditingTaskId = editTask ? editTask.id : null;

    $('taskModalTitle').textContent = editTask ? '编辑任务' : '添加任务';
    $('deleteTaskBtn').style.display = editTask ? 'inline-block' : 'none';

    const now = nowCST();
    now.setSeconds(0);
    $('taskDateTimeInput').value = now.toISOString().slice(0, 16);

    $('taskTitleInput').value = editTask
        ? editTask.text.replace(/^\[\d{2}:\d{2}\]\s*/, '')
        : '';

    $('repeatSelect').value = editTask ? editTask.repeat_type : 'once';
    $('taskModal').classList.add('active');
    $('taskTitleInput').focus();
}

    document.addEventListener('click', e => {
        const addBtn = e.target.closest('.add-task-btn');
        if (addBtn) {
            openAddModal(addBtn.dataset.date);
        }
    });

    $('cancelModalBtn').onclick = () => {
        $('taskModal').classList.remove('active');
        isEditingTaskId = null;
    };

    $('deleteTaskBtn').onclick = async () => {
        if (!confirm('确定删除该任务？')) return;
        await api(`/tasks?id=${encodeURIComponent(isEditingTaskId)}`, { method: 'DELETE' });
        $('taskModal').classList.remove('active');
        isEditingTaskId = null;
        renderDailyView();
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
        await api(`/tasks?id=${encodeURIComponent(isEditingTaskId)}`, {
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
    $('chooseMediaBtn').onclick = () => $('mediaFileInput').click();

    $('mediaFileInput').onchange = e => {
        const files = Array.from(e.target.files);
        selectedFiles = files;
        $('mediaPreview').innerHTML = `已选择 ${files.length} 个文件`;
    };

    $('clearMediaBtn').onclick = () => {
        selectedFiles = [];
        $('mediaPreview').innerHTML = '';
        $('mediaFileInput').value = '';
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

    /* ========== 相册 ========== */
    let galleryItems = [], galleryIndex = 0;

function openGallery(items, index) {
    galleryItems = items;
    galleryIndex = index;

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

    // ✅ 关闭按钮
    const modal = $('galleryModal');
    if (!modal.querySelector('.gallery-close')) {
        const btn = document.createElement('button');
        btn.className = 'gallery-close';
        btn.innerHTML = '✕';
        modal.appendChild(btn);
        btn.onclick = () => modal.classList.remove('active');
    }

    modal.classList.add('active');
}

    $('galleryModal').onclick = e => {
        if (e.target === $('galleryModal')) {
            $('galleryModal').classList.remove('active');
        }
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

    /* ========== 启动 ========== */
    currentCenterDate.setHours(0, 0, 0, 0);
    renderDailyView();
    // ✅ 删除任务（事件委托，稳定可靠）
document.addEventListener('click', async e => {
    if (e.target.id === 'deleteTaskBtn') {
        if (!isEditingTaskId) return;
        if (!confirm('确定删除该任务？')) return;

        // ✅ 用 PATCH 模拟删除（后端支持）
        await api(`/tasks?id=${encodeURIComponent(isEditingTaskId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                completed: 1,
                task_text: '[已删除]'
            })
        });

        $('taskModal').classList.remove('active');
        isEditingTaskId = null;
        renderDailyView();
    }
});
(() => {
    const modal = $('galleryModal');
    const track = $('galleryTrack');
    let startX = 0;

    modal.addEventListener('touchstart', e => {
        startX = e.touches[0].clientX;
    }, { passive: true });

    modal.addEventListener('touchend', e => {
        const endX = e.changedTouches[0].clientX;
        const diff = startX - endX;

        if (Math.abs(diff) > 50) {
            if (diff > 0 && galleryIndex < galleryItems.length - 1) {
                galleryIndex++;
            }
            if (diff < 0 && galleryIndex > 0) {
                galleryIndex--;
            }
            track.style.transform = `translateX(-${galleryIndex * 100}vw)`;
        }
    }, { passive: true });
    
    $('backTodayBtn').onclick = () => {
    currentCenterDate = new Date();
    currentCenterDate.setHours(0, 0, 0, 0);
    renderDailyView();
    };

    $('overviewBtn').onclick = async () => {
    const panel = $('overviewViewPanel');
    const daily = $('dailyViewPanel');

    if (panel.style.display === 'block') {
        panel.style.display = 'none';
        daily.style.display = 'block';
        return;
    }

    daily.style.display = 'none';
    panel.style.display = 'block';

    const container = $('overviewContainer');
    container.innerHTML = '';

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    let html = `<h2 style="text-align:center;margin-bottom:12px;">${year}年 ${month + 1}月</h2>`;
    html += `<div class="calendar-grid">`;

    ['日','一','二','三','四','五','六'].forEach(d =>
        html += `<div style="font-weight:bold;color:#b4825a;">${d}</div>`
    );

    const firstDay = new Date(year, month, 1).getDay();
    for (let i = 0; i < firstDay; i++) html += `<div></div>`;

    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const tasks = await getTasks(dateStr);
        const hasTask = tasks.length > 0;
        const isToday = d === now.getDate();

        html += `<div class="calendar-day ${hasTask ? 'has-task' : ''} ${isToday ? 'today' : ''}">
            ${d}${hasTask ? '●' : ''}
        </div>`;
    }

    html += `</div>`;
    container.innerHTML = html;
};
})();
