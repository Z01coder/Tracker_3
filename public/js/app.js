/**
 * «Такт» — фронтенд (ванильный JS, без фреймворков).
 *
 * Одностраничное приложение: состояние в объекте state, каждый экран —
 * функция render*, которая полностью перерисовывает контейнер #app.
 * Экраны: вход → проекты → канбан-доска → карточка задачи (модалка),
 * для админа — ещё управление пользователями.
 */
'use strict';

// --- Константы ---------------------------------------------------------------

// Статусы канбана — в порядке колонок; метки и классы для стилей
const STATUSES = [
  { code: 'backlog',      label: 'Бэклог',      cls: 'st-backlog' },
  { code: 'in_progress',  label: 'В работе',    cls: 'st-in_progress' },
  { code: 'review',       label: 'На проверке', cls: 'st-review' },
  { code: 'done',         label: 'Готово',      cls: 'st-done' }
];
const statusLabel = code => STATUSES.find(s => s.code === code)?.label || code;

const PRIORITIES = [
  { code: 'low',      label: 'Низкий',       cls: 'pr-low' },
  { code: 'medium',   label: 'Средний',      cls: 'pr-medium' },
  { code: 'high',     label: 'Высокий',      cls: 'pr-high' },
  { code: 'critical', label: 'Критический',  cls: 'pr-critical' }
];
const priorityLabel = code => PRIORITIES.find(p => p.code === code)?.label || code;

// Роли — как показывать в шапке и таблице пользователей
const ROLE_LABELS = { admin: 'Админ', programmer: 'Программист' };

// --- Состояние приложения ------------------------------------------------------
const state = {
  user: null,          // вошедший пользователь {id, username, displayName, role}
  projects: [],        // список всех проектов
  assignees: [],       // активные пользователи (для выбора исполнителя)
  projectId: null,     // текущий открытый проект
  project: null,       // его объект
  tasks: [],           // задачи текущего проекта
  filters: { assignee: '', priority: '', q: '' }, // фильтры на доске
  view: 'projects'     // какой экран рисуем: projects | board | users
};

// --- Мелкая гибкость -----------------------------------------------------------
const $app = document.getElementById('app');

/** Экранирование HTML — весь пользовательский текст вставляем только через esc() */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 2026-11-04 → 04.11.2026 (для дедлайнов); null/пусто → '' */
function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

/** Просрочена ли задача: дедлайн в прошлом и статус не «Готово» */
function isOverdue(task) {
  if (!task.deadline || task.status === 'done') return false;
  const today = new Date().toISOString().slice(0, 10);
  return task.deadline < today;
}

/** Неплохое всплывающее уведомление (toast) в правом верхнем углу */
function notify(text, isError = false) {
  const toast = document.createElement('div');
  toast.className = 'toast' + (isError ? ' toast-error' : '');
  toast.textContent = text;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

/** Обработка ошибки API: при 401 — доначинаем через экран входа */
function handleApiError(err) {
  if (err.status === 401) {
    state.user = null;
    renderLogin();
    notify('Сессия истекла — войдите заново', true);
  } else {
    notify(err.message, true);
  }
}

// --- Каркас: кое-какая разметка логотипа ---------------------------------------
const LOGO_HTML = '<svg class="logo-mark" viewBox="0 0 64 64" width="26" height="26" aria-hidden="true">' +
  '<rect width="64" height="64" rx="14" fill="#1C3D5A"/>' +
  '<rect x="13" y="15" width="10" height="20" rx="3" fill="#21262D"/>' +
  '<rect x="27" y="15" width="10" height="32" rx="3" fill="#F6F8FA"/>' +
  '<rect x="41" y="15" width="10" height="26" rx="3" fill="#C6973F"/>' +
  '<circle cx="32" cy="51" r="2.5" fill="#C6973F"/></svg>';

/** Шапка для экранов после входа */
function headerHtml() {
  const u = state.user;
  const usersLink = u.role === 'admin' ? '<a href="#" data-nav="users">Пользователи</a>' : '';
  return `
    <header class="topbar">
      <div class="topbar-left">
        <a href="#" data-nav="projects" class="brand">${LOGO_HTML}<span>Такт</span></a>
        <a href="#" data-nav="projects">Проекты</a>
        ${usersLink}
      </div>
      <div class="topbar-right">
        <span class="user-chip role-${u.role}" title="Роль">${esc(u.displayName)} · ${ROLE_LABELS[u.role]}</span>
        <button class="btn btn-ghost" id="btn-logout">Выйти</button>
      </div>
    </header>`;
}

// --- Экран входа -----------------------------------------------------------------
function renderLogin(message = '') {
  $app.innerHTML = `
    <div class="login-wrap">
      <form id="login-form" class="login-card" novalidate>
        <div class="login-brand">${LOGO_HTML}<h1>Такт</h1></div>
        <p class="login-sub">Командный трекер задач</p>
        ${message ? `<div class="form-error">${esc(message)}</div>` : ''}
        <label>Логин
          <input name="username" id="login-user" autocomplete="username" required>
        </label>
        <label>Пароль
          <input name="password" id="login-pass" type="password" autocomplete="current-password" required>
        </label>
        <button type="submit" class="btn btn-primary btn-wide">Войти</button>
      </form>
    </div>`;

  document.getElementById('login-form').addEventListener('submit', onLogin);
}

async function onLogin(event) {
  event.preventDefault();
  const form = event.target;
  const username = form.username.value.trim();
  const password = form.password.value;
  if (!username || !password) {
    renderLogin('Введите логин и пароль');
    return;
  }
  try {
    const { user } = await api('/auth/login', { method: 'POST', body: { username, password } });
    state.user = user;
    await goProjects();
  } catch (err) {
    renderLogin(err.message);
  }
}

// --- Экран «Проекты» ------------------------------------------------------------
function projectsHtml() {
  const cards = state.projects.map(p => `
    <article class="project-card" data-project="${p.id}">
      <h3>${esc(p.name)}</h3>
      <p class="project-desc">${esc(p.description || '')}</p>
      <div class="project-counts">
        ${STATUSES.map(s => `<span class="count-chip ${s.cls}" title="${s.label}">${s.label}: ${p[s.code + '_count']}</span>`).join('')}
      </div>
      <div class="project-actions">
        <button class="btn btn-sm" data-open-project="${p.id}">Открыть доску</button>
        ${state.user.role === 'admin' ? `
          <button class="btn btn-sm btn-ghost" data-edit-project="${p.id}">Редактировать</button>
          <button class="btn btn-sm btn-danger" data-delete-project="${p.id}">Удалить</button>` : ''}
      </div>
    </article>`).join('');

  return `
    <section class="page">
      <div class="page-head">
        <h2>Проекты</h2>
        ${state.user.role === 'admin' ? '<button class="btn btn-primary" id="btn-new-project">Создать проект</button>' : ''}
      </div>
      <div class="project-grid">${cards}</div>
      ${state.projects.length ? '' : '<p class="empty-note">Пока нет ни одного проекта.</p>'}
    </section>`;
}

function renderProjects() {
  $app.innerHTML = headerHtml() + `<main>${projectsHtml()}</main>`;
  bindHeader();
  bindProjectPage();
}

async function goProjects() {
  try {
    const [{ projects }, { assignees }] = await Promise.all([
      api('/projects'),
      api('/users/assignees')
    ]);
    state.projects = projects;
    state.assignees = assignees;
    state.view = 'projects';
    renderProjects();
  } catch (err) { handleApiError(err); }
}

/** Действия на странице проектов + модалка создания/редактирования проекта */
function bindProjectPage() {
  const $new = document.getElementById('btn-new-project');
  $new?.addEventListener('click', () => showProjectForm(null));

  $app.querySelectorAll('[data-open-project]').forEach($el =>
    $el.addEventListener('click', () => goProject(Number($el.dataset.openProject))));

  $app.querySelectorAll('[data-edit-project]').forEach($el =>
    $el.addEventListener('click', () => {
      const p = state.projects.find(x => x.id === Number($el.dataset.editProject));
      showProjectForm(p);
    }));

  $app.querySelectorAll('[data-delete-project]').forEach($el =>
    $el.addEventListener('click', async () => {
      const p = state.projects.find(x => x.id === Number($el.dataset.deleteProject));
      if (!confirm(`Удалить проект «${p.name}» вместе с задачами? Действие необратимо.`)) return;
      try {
        await api(`/projects/${p.id}`, { method: 'DELETE' });
        notify('Проект удалён');
        goProjects();
      } catch (err) { handleApiError(err); }
    }));
}

/** Модалка проекта: создание или правка существующего */
function showProjectForm(project) {
  const isEdit = Boolean(project);
  modal(`
    <h3>${isEdit ? 'Редактирование проекта' : 'Новый проект'}</h3>
    <form id="project-form" novalidate>
      <label>Название
        <input name="name" maxlength="100" value="${esc(project?.name || '')}" required>
      </label>
      <label>Описание
        <textarea name="description" rows="3" maxlength="1000">${esc(project?.description || '')}</textarea>
      </label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Отмена</button>
        <button type="submit" class="btn btn-primary">Сохранить</button>
      </div>
    </form>`);

  document.getElementById('project-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      name: e.target.name.value.trim(),
      description: e.target.description.value.trim()
    };
    if (!body.name) { notify('Укажите название проекта', true); return; }
    try {
      if (isEdit) await api(`/projects/${project.id}`, { method: 'PATCH', body });
      else        await api('/projects', { method: 'POST', body });
      closeModal();
      notify(isEdit ? 'Проект обновлён' : 'Проект создан');
      goProjects();
    } catch (err) { handleApiError(err); }
  });
}

// --- Экран «Канбан-доска» ---------------------------------------------------------
async function goProject(id) {
  try {
    const [{ project }, { tasks }] = await Promise.all([
      api(`/projects/${id}`),
      api(`/tasks/project/${id}`)
    ]);
    state.projectId = id;
    state.project = project;
    state.tasks = tasks;
    state.view = 'board';
    renderBoard();
  } catch (err) { handleApiError(err); }
}

/** Применяем фильтры к списку задач (поиск, исполнитель, приоритет) */
function filteredTasks() {
  const { assignee, priority, q } = state.filters;
  const needle = q.toLowerCase().trim();
  return state.tasks.filter(t =>
    (!assignee || String(t.assigneeId ?? '') === assignee) &&
    (!priority || t.priority === priority) &&
    (!needle || (t.title || '').toLowerCase().includes(needle))
  );
}

/** Карточка задачи в колонке */
function taskCard(t) {
  const idx = STATUSES.findIndex(s => s.code === t.status);
  const initials = (t.assigneeName || '').split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  return `
    <article class="task-card ${isOverdue(t) ? 'is-overdue' : ''}" data-task="${t.id}">
      <div class="task-card-top">
        <span class="prio-chip ${PRIORITIES.find(p => p.code === t.priority).cls}">
          ${priorityLabel(t.priority)}</span>
        ${t.deadline ? `<span class="task-deadline">до ${fmtDate(t.deadline)}</span>` : ''}
      </div>
      <h4>${esc(t.title)}</h4>
      <div class="task-card-bottom">
        <span class="assignee-chip ${t.assigneeId ? '' : 'is-empty'}"
              title="${esc(t.assigneeName || 'Без исполнителя')}">${initials || '—'}</span>
        <span class="move-buttons">
          <button class="btn btn-xs" data-move="prev" data-task-id="${t.id}"
                  title="Статус назад" ${idx === 0 ? 'disabled' : ''}>←</button>
          <button class="btn btn-xs" data-move="next" data-task-id="${t.id}"
                  title="Статус вперёд" ${idx === STATUSES.length - 1 ? 'disabled' : ''}>→</button>
        </span>
      </div>
    </article>`;
}

/** Рабочая область канбан-доски */
function boardHtml() {
  const flt = state.filters;
  return `
    <section class="page page-wide">
      <div class="page-head">
        <div class="page-head-left">
          <a href="#" class="btn btn-ghost" data-nav="projects">← Проекты</a>
          <h2>${esc(state.project.name)}</h2>
        </div>
        <button class="btn btn-primary" id="btn-new-task">+ Задача</button>
      </div>

      <div class="filters">
        <input type="search" id="flt-q" placeholder="Поиск по названию…" value="${esc(flt.q)}">
        <select id="flt-assignee">
          <option value="">Все исполнители</option>
          ${state.assignees.map(a =>
            `<option value="${a.id}" ${String(a.id) === flt.assignee ? 'selected' : ''}>${esc(a.displayName)}</option>`).join('')}
        </select>
        <select id="flt-priority">
          <option value="">Любой приоритет</option>
          ${PRIORITIES.map(p =>
            `<option value="${p.code}" ${p.code === flt.priority ? 'selected' : ''}>${p.label}</option>`).join('')}
        </select>
        <button class="btn btn-ghost btn-sm" id="flt-reset">Сбросить</button>
      </div>

      <div class="kanban">
        ${STATUSES.map(s => `
          <div class="kanban-col ${s.cls}">
            <div class="kanban-col-head">
              <span class="col-title">${s.label}</span>
              <span class="col-count">${filteredTasks().filter(t => t.status === s.code).length}</span>
            </div>
            ${filteredTasks().filter(t => t.status === s.code).map(t => taskCard(t)).join('') || '<p class="col-empty">Задач нет</p>'}
          </div>`).join('')}
      </div>
    </section>`;
}

/** Показать доску (id — по желанию: если сменился, перезагружаем данные) */
async function renderBoard() {
  $app.innerHTML = headerHtml() + `<main>${boardHtml()}</main>`;
  bindHeader();
  bindBoard();
}

async function goBoardFresh() {
  // перезагрузка данных текущего проекта с сервера (после правок)
  if (!state.projectId) return goProjects();
  try {
    const { tasks } = await api(`/tasks/project/${state.projectId}`);
    state.tasks = tasks;
    renderBoard();
  } catch (err) { handleApiError(err); }
}

function bindBoard() {
  // фильтры: мгновенный перерендер при вводе
  document.getElementById('flt-q').addEventListener('input', e => {
    state.filters.q = e.target.value;
    renderBoard();
    document.getElementById('flt-q').focus();
  });
  document.getElementById('flt-assignee').addEventListener('change', e => {
    state.filters.assignee = e.target.value;
    renderBoard();
  });
  document.getElementById('flt-priority').addEventListener('change', e => {
    state.filters.priority = e.target.value;
    renderBoard();
  });
  document.getElementById('flt-reset').addEventListener('click', () => {
    state.filters = { assignee: '', priority: '', q: '' }; // обязательно очищаем состояние, иначе «сброс» ничего не сбрасывает
    renderBoard();
  });
  document.getElementById('btn-new-task').addEventListener('click', () => showTaskForm(null));

  // клики по карточкам и кнопкам перемещения
  $app.querySelectorAll('[data-move]').forEach($btn =>
    $btn.addEventListener('click', async (e) => {
      e.stopPropagation(); // не открывать карточку
      const id = Number($btn.dataset.taskId);
      const task = state.tasks.find(t => t.id === id);
      const idx = STATUSES.findIndex(s => s.code === task.status);
      const delta = $btn.dataset.move === 'next' ? 1 : -1;
      const next = STATUSES[idx + delta];
      try {
        await api(`/tasks/${id}`, { method: 'PATCH', body: { status: next.code } });
        task.status = next.code; // локально и перерисовка без запроса списка
        renderBoard();
      } catch (err) { handleApiError(err); }
    }));

  $app.querySelectorAll('.task-card').forEach($card =>
    $card.addEventListener('click', () => {
      const t = state.tasks.find(x => x.id === Number($card.dataset.task));
      showTaskModal(t);
    }));
}

// --- Модалка карточки задачи -------------------------------------------------------
/** Универсальное окно-модалка: фикс-обёртка + закрытие по клику на фон/крестик */
function modal(html, width = '560px') {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal" style="max-width:${width}">
    <button class="modal-close" data-close aria-label="Закрыть">×</button>${html}</div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelectorAll('[data-close]').forEach($b => $b.addEventListener('click', () => overlay.remove()));
  document.body.appendChild(overlay);
  return overlay;
}
function closeModal() {
  document.querySelector('.modal-overlay')?.remove();
}

/** Опции <select> исполнителей: обычный список + «пусто» */
function assigneeOptions(selectedId) {
  return `<option value="">Без исполнителя</option>` + state.assignees.map(a =>
    `<option value="${a.id}" ${a.id === Number(selectedId) ? 'selected' : ''}>${esc(a.displayName)}</option>`
  ).join('');
}

/**
 * Форма задачи: создание из кнопки «+ Задача» или редактирование из карточки.
 * task === null → создание (можно задать стартовый статус — колонка, где нажали "+").
 */
function showTaskForm(task, startStatus = 'backlog') {
  const isEdit = Boolean(task);
  modal(`
    <h3>${isEdit ? 'Задача' : 'Новая задача'}</h3>
    <div class="form-error" id="task-error" hidden></div>
    <form id="task-form" novalidate>
      <label>Название
        <input name="title" maxlength="150" value="${esc(task?.title || '')}" required>
      </label>
      <label>Описание
        <textarea name="description" rows="3" maxlength="4000">${esc(task?.description || '')}</textarea>
      </label>
      <div class="form-grid">
        <label>Статус
          <select name="status">
            ${STATUSES.map(s => `<option value="${s.code}" ${(task ? task.status : startStatus) === s.code ? 'selected' : ''}>${s.label}</option>`).join('')}
          </select>
        </label>
        <label>Приоритет
          <select name="priority">
            ${PRIORITIES.map(p => `<option value="${p.code}" ${(task?.priority || 'medium') === p.code ? 'selected' : ''}>${p.label}</option>`).join('')}
          </select>
        </label>
        <label>Исполнитель
          <select name="assignee_id">${assigneeOptions(task?.assigneeId)}</select>
        </label>
        <label>Дедлайн
          <input type="date" name="deadline" value="${esc(task?.deadline || '')}">
        </label>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Отмена</button>
        <button type="submit" class="btn btn-primary">Сохранить</button>
      </div>
    </form>`);

  document.getElementById('task-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = {
      title: f.title.value.trim(),
      description: f.description.value.trim(),
      status: f.status.value,
      priority: f.priority.value,
      assignee_id: f.assignee_id.value ? Number(f.assignee_id.value) : null,
      deadline: f.deadline.value || null
    };
    if (!body.title) {
      const $err = document.getElementById('task-error');
      $err.hidden = false; $err.textContent = 'Укажите название задачи';
      return;
    }
    try {
      if (isEdit) {
        await api(`/tasks/${task.id}`, { method: 'PATCH', body });
        notify('Задача обновлена');
      } else {
        await api(`/tasks/project/${state.projectId}`, { method: 'POST', body });
        notify('Задача создана');
      }
      closeModal();
      goBoardFresh(); // обновляем доску
    } catch (err) {
      const $err = document.getElementById('task-error');
      $err.hidden = false; $err.textContent = err.message;
    }
  });
}

/** Полное окно задачи: форма + комментарии + удаление (если разрешено) */
async function showTaskModal(task) {
  // комментарии грузим с сервера — правки в других окнах могли их обновить
  let comments = [];
  try {
    ({ comments } = await api(`/comments/task/${task.id}`));
  } catch (err) { handleApiError(err); return; }

  const canDelete = state.user.role === 'admin' || task.createdBy === state.user.id;
  const overlay = modal(`
    <div id="task-modal-body"></div>
  `, '640px');
  const body = overlay.querySelector('#task-modal-body');

  /** Перерисовка содержимого модалки (форма + комментарии) */
  function draw() {
    body.innerHTML = `
      <h3>Задача</h3>
      <form id="task-form" class="task-modal-form" novalidate>
        <label>Название
          <input name="title" maxlength="150" value="${esc(task.title)}" required>
        </label>
        <label>Описание
          <textarea name="description" rows="3" maxlength="4000">${esc(task.description || '')}</textarea>
        </label>
        <div class="form-grid">
          <label>Статус
            <select name="status">
              ${STATUSES.map(s => `<option value="${s.code}" ${task.status === s.code ? 'selected' : ''}>${s.label}</option>`).join('')}
            </select>
          </label>
          <label>Приоритет
            <select name="priority">
              ${PRIORITIES.map(p => `<option value="${p.code}" ${task.priority === p.code ? 'selected' : ''}>${p.label}</option>`).join('')}
            </select>
          </label>
          <label>Исполнитель
            <select name="assignee_id">${assigneeOptions(task.assigneeId)}</select>
          </label>
          <label>Дедлайн
            <input type="date" name="deadline" value="${esc(task.deadline || '')}">
          </label>
        </div>
        <div class="form-error" id="task-error" hidden></div>
        <div class="modal-actions">
        ${canDelete ? '<button type="button" class="btn btn-danger" id="task-delete">Удалить задачу</button>' : ''}
        <button type="button" class="btn btn-ghost" data-close-modal>Закрыть</button>
        <button type="submit" class="btn btn-primary">Сохранить</button>
      </div>
    </form>

      <section class="comments">
        <h4>Комментарии (${comments.length})</h4>
        <ul id="comment-list">
          ${comments.map(c => commentHtml(c)).join('') || '<li class="empty-note">Пока нет комментариев</li>'}
        </ul>
        <form id="comment-form">
          <textarea name="text" rows="2" maxlength="2000" placeholder="Добавить комментарий…" required></textarea>
          <button type="submit" class="btn btn-primary btn-sm">Отправить</button>
        </form>
      </section>`;

    bindTaskModalForm();
    bindComments();
  }

  /** Сохранение правок задачи */
  function bindTaskModalForm() {
    body.querySelector('[data-close-modal]').addEventListener('click', () => overlay.remove());

    body.querySelector('#task-delete')?.addEventListener('click', async () => {
      if (!confirm('Удалить задачу вместе с комментариями?')) return;
      try {
        await api(`/tasks/${task.id}`, { method: 'DELETE' });
        overlay.remove();
        notify('Задача удалена');
        goBoardFresh();
      } catch (err) { handleApiError(err); }
    });

    body.querySelector('#task-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const bodyPatch = {
        title: f.title.value.trim(),
        description: f.description.value.trim(),
        status: f.status.value,
        priority: f.priority.value,
        assignee_id: f.assignee_id.value ? Number(f.assignee_id.value) : null,
        deadline: f.deadline.value || null
      };
      if (!bodyPatch.title) {
        const $err = body.querySelector('#task-error');
        $err.hidden = false; $err.textContent = 'Укажите название задачи';
        return;
      }
      try {
        const { task: updated } = await api(`/tasks/${task.id}`, { method: 'PATCH', body: bodyPatch });
        Object.assign(task, updated);           // обновляем локальную копию
        notify('Задача обновлена');
        goBoardFreshWithoutModal();             // доска — в фоне, модалка остаётся
        draw();
      } catch (err) {
        const $err = body.querySelector('#task-error');
        $err.hidden = false; $err.textContent = err.message;
      }
    });
  }

  /** Обновить доску в фоне, не закрывая модалку */
  function goBoardFreshWithoutModal() {
    api(`/tasks/project/${state.projectId}`)
      .then(({ tasks }) => { state.tasks = tasks; renderBoardKeepModal(overlay); })
      .catch(err => handleApiError(err));
  }

  /** HTML одного комментария (кнопки видны по правам: автор или админ) */
  function commentHtml(c) {
    const canEdit = c.authorId === state.user.id || state.user.role === 'admin';
    return `
      <li class="comment" data-comment-id="${c.id}">
        <div class="comment-head">
          <span class="comment-author">${esc(c.authorName)}</span>
          <time class="comment-date">${fmtDate(c.createdAt.slice(0, 10))}</time>
          ${canEdit ? `
            <span class="comment-actions">
              <button class="btn btn-xs" data-edit-comment="${c.id}">Изменить</button>
              <button class="btn btn-xs btn-danger" data-delete-comment="${c.id}">Удалить</button>
            </span>` : ''}
        </div>
        <p class="comment-text" data-comment-text="${c.id}">${esc(c.text)}</p>
      </li>`;
  }

  /** Комментарии: добавление, правка (inline textarea), удаление */
  function bindComments() {
    body.querySelector('#comment-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = e.target.text.value.trim();
      if (!text) return;
      try {
        const { comment } = await api(`/comments/task/${task.id}`, { method: 'POST', body: { text } });
        e.target.text.value = '';
        comments.push(comment);
        draw();
      } catch (err) { handleApiError(err); }
    });

    body.querySelectorAll('[data-edit-comment]').forEach($b =>
      $b.addEventListener('click', () => {
        const id = Number($b.dataset.editComment);
        const comment = comments.find(c => c.id === id);
        const $text = body.querySelector(`[data-comment-text="${id}"]`);
        $text.outerHTML = `
          <form class="comment-edit" data-edit-form="${id}">
            <textarea name="text" rows="2" maxlength="2000">${esc(comment.text)}</textarea>
            <span class="modal-actions">
              <button type="button" class="btn btn-ghost btn-sm" data-cancel="${id}">Отмена</button>
              <button type="submit" class="btn btn-primary btn-sm">Сохранить</button>
            </span>
          </form>`;

        body.querySelector(`[data-cancel="${id}"]`).addEventListener('click', draw);
        body.querySelector(`[data-edit-form="${id}"]`).addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const text = ev.target.text.value.trim();
          if (!text) return;
          try {
            const { comment: updated } = await api(`/comments/${id}`, { method: 'PATCH', body: { text } });
            Object.assign(comment, updated);
            notify('Комментарий обновлён');
            draw();
          } catch (err) { handleApiError(err); }
        });
      }));

    body.querySelectorAll('[data-delete-comment]').forEach($b =>
      $b.addEventListener('click', async () => {
        const id = Number($b.dataset.deleteComment);
        if (!confirm('Удалить комментарий?')) return;
        try {
          await api(`/comments/${id}`, { method: 'DELETE' });
          comments = comments.filter(c => c.id !== id);
          notify('Комментарий удалён');
          draw();
        } catch (err) { handleApiError(err); }
      }));
  }

  draw();
}

/**
 * При обновлении доски в фоне (после правок задачи) модалка живёт внутри #app,
 * поэтому перерисоваем доску, а потом вернём оверлей модалки наверх.
 */
async function renderBoardKeepModal(overlay) {
  $app.innerHTML = headerHtml() + `<main>${boardHtml()}</main>`;
  bindHeader();
  bindBoard();
  document.body.appendChild(overlay);
}

// --- Экран «Пользователи» (только админ) -------------------------------------------
async function goUsers() {
  try {
    const { users } = await api('/users');
    state.view = 'users';
    $app.innerHTML = headerHtml() + `<main>${usersHtml(users)}</main>`;
    bindHeader();
    bindUsersPage(users);
  } catch (err) { handleApiError(err); }
}

function usersHtml(users) {
  return `
    <section class="page">
      <div class="page-head">
        <h2>Пользователи</h2>
        <button class="btn btn-primary" id="btn-new-user">Создать пользователя</button>
      </div>
      <table class="users-table">
        <thead><tr>
          <th>Логин</th><th>Имя</th><th>Роль</th><th>Статус</th><th>Создан</th><th></th>
        </tr></thead>
        <tbody>
          ${users.map(u => `
            <tr class="${u.isActive ? '' : 'row-inactive'}">
              <td>${esc(u.username)}</td>
              <td>${esc(u.displayName)}</td>
              <td>${ROLE_LABELS[u.role]}</td>
              <td>${u.isActive ? '<span class="st-done">Активен</span>' : '<span class="col-count">Отключён</span>'}</td>
              <td>${fmtDate(u.createdAt.slice(0, 10))}</td>
              <td class="row-actions">
                <button class="btn btn-sm" data-edit-user="${u.id}">Редактировать</button>
                ${u.id !== state.user.id ? (
    u.isActive ? `<button class="btn btn-sm btn-danger" data-deactivate-user="${u.id}">Деактивировать</button>`
               : `<button class="btn btn-sm" data-activate-user="${u.id}">Активировать</button>`)
      : '<span class="col-count" title="Это вы">вы</span>'}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </section>`;
}

function bindUsersPage(users) {
  document.getElementById('btn-new-user').addEventListener('click', () => showUserForm(null));

  $app.querySelectorAll('[data-edit-user]').forEach($b =>
    $b.addEventListener('click', () => {
      const u = users.find(x => x.id === Number($b.dataset.editUser));
      showUserForm(u);
    }));

  $app.querySelectorAll('[data-deactivate-user], [data-activate-user]').forEach($b =>
    $b.addEventListener('click', async () => {
      const id = Number($b.dataset.deactivateUser || $b.dataset.activateUser);
      const u = users.find(x => x.id === id);
      const deactivate = Boolean($b.dataset.deactivateUser);
      if (deactivate && !confirm(`Отключить учётку «${u.displayName}»? Вход будет запрещён.`)) return;
      try {
        await api(`/users/${id}`, { method: 'PATCH', body: { isActive: !deactivate } });
        notify(deactivate ? 'Пользователь деактивирован' : 'Пользователь активирован');
        goUsers();
      } catch (err) { handleApiError(err); }
    }));
}

/** Форма создания/редактирования учётки (админ) */
function showUserForm(user) {
  const isEdit = Boolean(user);
  modal(`
    <h3>${isEdit ? `Редактирование: ${esc(user.displayName)}` : 'Новый пользователь'}</h3>
    <div class="form-error" id="user-error" hidden></div>
    <form id="user-form" novalidate>
      <div class="form-grid">
        <label>Логин
          <input name="username" maxlength="40" value="${esc(user?.username || '')}"
                 ${isEdit ? 'disabled' : ''} required>
        </label>
        <label>Имя
          <input name="displayName" maxlength="60" value="${esc(user?.displayName || '')}" required>
        </label>
        <label>Роль
          <select name="role">
            <option value="programmer" ${(user?.role || 'programmer') === 'programmer' ? 'selected' : ''}>Программист</option>
            <option value="admin" ${user?.role === 'admin' ? 'selected' : ''}>Админ</option>
          </select>
        </label>
        <label>${isEdit ? 'Новый пароль (пусто — не менять)' : 'Пароль'}
          <input type="password" name="password" autocomplete="new-password" ${isEdit ? '' : 'required'}>
        </label>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Отмена</button>
        <button type="submit" class="btn btn-primary">Сохранить</button>
      </div>
    </form>`);

  document.getElementById('user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      if (isEdit) {
        const body = { displayName: f.displayName.value.trim(), role: f.role.value };
        if (f.password.value) body.password = f.password.value;
        await api(`/users/${user.id}`, { method: 'PATCH', body });
        notify('Пользователь обновлён');
      } else {
        await api('/users', {
          method: 'POST',
          body: {
            username: f.username.value.trim(),
            displayName: f.displayName.value.trim(),
            role: f.role.value,
            password: f.password.value
          }
        });
        notify('Пользователь создан');
      }
      closeModal();
      goUsers();
    } catch (err) {
      const $err = document.getElementById('user-error');
      $err.hidden = false; $err.textContent = err.message;
    }
  });
}

// --- Шапка: навигация и выход ----------------------------------------------------
function bindHeader() {
  $app.querySelectorAll('[data-nav]').forEach($el =>
    $el.addEventListener('click', (e) => {
      e.preventDefault();
      const nav = $el.dataset.nav;
      if (nav === 'projects') goProjects();
      if (nav === 'users')    goUsers();
    }));

  document.getElementById('btn-logout').addEventListener('click', async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
      state.user = null;
      renderLogin();
    } catch { /* выход из оффлайна не критичен */ renderLogin(); }
  });
}

// --- Старт приложения --------------------------------------------------------------
(async function init() {
  try {
    const { user } = await api('/auth/me'); // уже вошедшие попадают сразу в приложение
    state.user = user;
    await goProjects();
  } catch {
    renderLogin(); // 401 — обычный «не вошли»
  }
})();
