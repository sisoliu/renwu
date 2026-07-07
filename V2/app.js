function nowCST() {
    const now = new Date();
    return new Date(now.getTime() + 8 * 60 * 60 * 1000);
}

(function () {
    console.log('🚀 暑假任务管家（最终版）');

    const API = '/api';
    let currentCenterDate = new Date();
    let pendingTaskId = null;
    let selectedFiles = [];
    let isEditingTaskId = null;

    let galleryItems = [];
    let galleryIndex = 0;

    // 日历总览当前年月
    let overviewYear = new Date().getFullYear();
    let overviewMonth = new Date().getMonth();

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
    if (!files || !files.length) return;

    const fd = new FormData();
    for (const f of files) fd.append('file', f);
    fd.append('taskId', taskId);

    const data = await api('/upload', { method: 'POST', body: fd });
    if (!Array.isArray(data.files)) return;

    for (const f of data.files) {
        // ✅ 按后端返回的 type 前缀判断，兜底用文件名后缀
        let mt = 'file';
        if (f.type?.startsWith('image/')) mt = 'image';
        else if (f.type?.startsWith('video/')) mt = 'video';
        else if (f.name?.match(/\.(mp4|mov|avi|mkv|webm)$/i)) mt = 'video';
        else if (f.name?.match(/\.(jpg|jpeg|png|gif|webp)$/i)) mt = 'image';

        await api('/media', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                task_id: taskId,
                media_url: f.url,
                media_type: mt   // ✅ 保证存 'video' 或 'image'
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

    function normalizeMediaType(type) {
        if (!type) return 'file';
        if (type.startsWith('image/')) return 'image';
        if (type.startsWith('video/')) return 'video';
        return 'file';
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
        $('displayWeekday').textContent = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][base.getDay()];

        bindCardEvents();

        // ✅ 编辑弹窗：删除任务
    $('deleteTaskBtn').onclick = async () => {
        if (!isEditingTaskId) return;
        if (!confirm('确定删除该任务？')) return;

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
    };

        // 已完成任务：根据媒体类型显示图标
        const completedCards = document.querySelectorAll('.task-card.completed');
        for (const card of completedCards) {
            const id = card.dataset.id;
            const media = await api(`/media?task_id=${encodeURIComponent(id)}`);
            const placeholder = card.parentElement.querySelector('.task-right');
            if (!media.length || !placeholder) continue;

            const type = media[0].media_type || '';
            const icon = type === 'video' ? '🎬' : '🖼️';

            placeholder.innerHTML = `<button class="media-btn" data-id="${id}" title="查看媒体">${icon}</button>`;
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
                html += `
                <div class="task-card ${t.completed ? 'completed' : ''}" data-id="${t.id}">
                    <div class="task-left">
                        <span class="task-text">${escapeHtml(t.text)}</span>
                        <span class="repeat-badge">
                            ${t.repeat_type === 'daily' ? '每天' : t.repeat_type === 'weekly' ? '每周' : ''}
                        </span>
                    </div>`;

                if (t.completed) {
                    html += `<div class="task-right" data-media-placeholder="${t.id}"></div>`;
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

            if (e.target.classList.contains('media-btn')) {
                const id = e.target.dataset.id;
                const list = await api(`/media?task_id=${encodeURIComponent(id)}`);
                if (list.length) openGallery(list, 0);
                return;
            }

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

    /* ========== 添加 / 编辑任务 ========== */
    function openAddModal(date, editTask) {
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
                task_text: fullText,
                date,
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
        selectedFiles = Array.from(e.target.files);
        $('mediaPreview').innerHTML = `已选择 ${selectedFiles.length} 个文件`;
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

    /* ========== 相册 & 滑动 ========== */
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
                if (diff > 0 && galleryIndex < galleryItems.length - 1) galleryIndex++;
                if (diff < 0 && galleryIndex > 0) galleryIndex--;
                track.style.transform = `translateX(-${galleryIndex * 100}vw)`;
            }
        }, { passive: true });
    })();

    /* ========== 日历总览 ========== */
    async function renderOverviewCalendar() {
        const container = $('overviewContainer');
        container.innerHTML = '';

        const now = new Date();
        const year = overviewYear;
        const month = overviewMonth;
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        $('overviewTitle').textContent = `${year}年 ${month + 1}月`;

        let html = `<div class="calendar-grid">`;

        ['日','一','二','三','四','五','六'].forEach(d =>
            html += `<div style="font-weight:bold;color:#b4825a;">${d}</div>`
        );

        const firstDay = new Date(year, month, 1).getDay();
        for (let i = 0; i < firstDay; i++) html += `<div></div>`;

        const promises = [];
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            promises.push(getTasks(dateStr));
        }

        const results = await Promise.all(promises);

        for (let d = 1; d <= daysInMonth; d++) {
            const hasTask = results[d - 1].length > 0;
            const isToday =
                d === now.getDate() &&
                month === now.getMonth() &&
                year === now.getFullYear();

            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

            html += `<div 
                class="calendar-day ${hasTask ? 'has-task' : ''} ${isToday ? 'today' : ''}"
                data-date="${dateStr}">
                ${d}${hasTask ? '●' : ''}
            </div>`;
        }

        html += `</div>`;
        container.innerHTML = html;

        container.querySelectorAll('.calendar-day[data-date]').forEach(day => {
            day.style.cursor = 'pointer';
            day.onclick = () => {
                const dateStr = day.dataset.date;
                const [y, m, d] = dateStr.split('-').map(Number);
                currentCenterDate = new Date(y, m - 1, d);
                currentCenterDate.setHours(0, 0, 0, 0);

                $('overviewViewPanel').style.display = 'none';
                $('dailyViewPanel').style.display = 'block';
                renderDailyView();
            };
        });
    }

    /* ========== 底部按钮 ========== */
    $('closeOverviewBtn').onclick = () => {
        $('overviewViewPanel').style.display = 'none';
        $('dailyViewPanel').style.display = 'block';
    };

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

        overviewYear = new Date().getFullYear();
        overviewMonth = new Date().getMonth();

        await renderOverviewCalendar();
    };

    $('prevMonthBtn').onclick = async () => {
        overviewMonth--;
        if (overviewMonth < 0) {
            overviewMonth = 11;
            overviewYear--;
        }
        await renderOverviewCalendar();
    };

    $('nextMonthBtn').onclick = async () => {
        overviewMonth++;
        if (overviewMonth > 11) {
            overviewMonth = 0;
            overviewYear++;
        }
        await renderOverviewCalendar();
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

    /* ========== PWA ========== */
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    /* ========== 启动 ========== */
    currentCenterDate.setHours(0, 0, 0, 0);
    renderDailyView();

})();
