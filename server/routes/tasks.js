/**
 * «Такт» — маршруты задач (ТЗ, раздел 6.3–6.4).
 *
 *   GET    /api/tasks/project/:projectId — задачи проекта (обе роли)
 *   POST   /api/tasks/project/:projectId — создать задачу (обе роли)
 *   PATCH  /api/tasks/:id                — изменить поля/статус (обе роли)
 *   DELETE /api/tasks/:id                — удалить (админ — любую; программист — свою)
 *
 * Перемещение по канбан-колонкам с фронтенда — это PATCH со статусом.
 */
'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware');
const { STATUSES, PRIORITIES, isDateStr, trimmed } = require('../constants');

const router = express.Router();
router.use(requireAuth);

// --- Валидация полей задачи ----------------------------------------------------
/**
 * Проверяет поля задачи из тела запроса.
 * Возвращает { error } | { fields } — fields уже нормализованы.
 */
function validateTaskFields(body, partial, existing) {
  // базовые значения: для полного создания — дефолты, для частичного — текущие
  const next = {
    title:       body.title       !== undefined ? trimmed(body.title, 150)      : (existing ? existing.title : undefined),
    description: body.description !== undefined ? trimmed(body.description, 4000): (existing ? existing.description : undefined),
    status:      body.status      !== undefined ? body.status                   : (existing ? existing.status : 'backlog'),
    priority:    body.priority    !== undefined ? body.priority                 : (existing ? existing.priority : 'medium'),
    assignee_id: body.assignee_id !== undefined ? (body.assignee_id === null ? null : Number(body.assignee_id))
                                                            : (existing ? existing.assignee_id : null),
    deadline:    body.deadline    !== undefined ? (body.deadline === null ? null : String(body.deadline))
                                                            : (existing ? existing.deadline : null)
  };

  if (!partial && (next.title === undefined || next.title === null || next.title === '')) {
    return { error: 'Укажите название задачи' };
  }
  if (next.title === '') return { error: 'Название задачи не может быть пустым' };

  if (!STATUSES.includes(next.status)) return { error: 'Неизвестный статус задачи' };
  if (!PRIORITIES.includes(next.priority)) return { error: 'Неизвестный приоритет задачи' };

  // Исполнителем может быть только существующий активный пользователь
  if (next.assignee_id !== null) {
    const assignee = db.prepare(
      'SELECT id FROM users WHERE id = ? AND is_active = 1'
    ).get(next.assignee_id);
    if (!assignee) return { error: 'Исполнитель не найден или не активен' };
  }

  // Дедлайн — либо дата YYYY-MM-DD, либо пусто
  if (next.deadline !== null && !isDateStr(next.deadline)) {
    return { error: 'Дедлайн указывается датой в формате ГГГГ-ММ-ДД' };
  }

  return { fields: next };
}

// --- Формат задачи для фронтенда -------------------------------------------------
function withAssignee(t) {
  return {
    id: t.id,
    projectId: t.project_id,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    assigneeId: t.assignee_id,
    assigneeName: t.assignee_name || null,
    deadline: t.deadline,
    createdBy: t.created_by,
    createdAt: t.created_at,
    updatedAt: t.updated_at
  };
}

// --- Задачи проекта -------------------------------------------------------------
router.get('/project/:projectId', (req, res) => {
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Проект не найден' });

  const tasks = db.prepare(`
    SELECT t.*, u.display_name AS assignee_name
    FROM tasks t
    LEFT JOIN users u ON u.id = t.assignee_id
    WHERE t.project_id = ?
    ORDER BY t.created_at ASC
  `).all(req.params.projectId);

  res.json({ tasks: tasks.map(withAssignee) });
});

// --- Создание задачи --------------------------------------------------------------
router.post('/project/:projectId', (req, res) => {
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Проект не найден' });

  const check = validateTaskFields(req.body || {}, false, null);
  if (check.error) return res.status(400).json({ error: check.error });
  const f = check.fields;

  const ts = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO tasks (project_id, title, description, status, priority, assignee_id, deadline, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(project.id, f.title, f.description || null, f.status, f.priority, f.assignee_id, f.deadline, req.user.id, ts, ts);

  const t = db.prepare(`
    SELECT t.*, u.display_name AS assignee_name FROM tasks t
    LEFT JOIN users u ON u.id = t.assignee_id
    WHERE t.id = ?
  `).get(info.lastInsertRowid);

  res.status(201).json({ task: withAssignee(t) });
});

// --- Изменение задачи ---------------------------------------------------------------
router.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Задача не найдена' });

  const check = validateTaskFields(req.body || {}, true, existing);
  if (check.error) return res.status(400).json({ error: check.error });
  const f = check.fields;

  db.prepare(`
    UPDATE tasks
    SET title = ?, description = ?, status = ?, priority = ?, assignee_id = ?, deadline = ?, updated_at = ?
    WHERE id = ?
  `).run(f.title, f.description || null, f.status, f.priority, f.assignee_id, f.deadline,
         new Date().toISOString(), existing.id);

  const t = db.prepare(`
    SELECT t.*, u.display_name AS assignee_name FROM tasks t
    LEFT JOIN users u ON u.id = t.assignee_id
    WHERE t.id = ?
  `).get(existing.id);

  res.json({ task: withAssignee(t) });
});

// --- Удаление задачи -----------------------------------------------------------------
// Админ удаляет любую; программист — только задачу, которую создал сам (ТЗ, раздел 5)
router.delete('/:id', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Задача не найдена' });

  const isOwner = task.created_by === req.user.id;
  if (req.user.role !== 'admin' && !isOwner) {
    return res.status(403).json({ error: 'Можно удалять только свои задачи' });
  }

  db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  res.json({ ok: true });
});

module.exports = router;
