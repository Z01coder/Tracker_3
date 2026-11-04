/**
 * «Такт» — маршруты проектов (ТЗ, раздел 6.2).
 *
 *   GET    /api/projects          — список с счётчиками по статусам (обе роли)
 *   GET    /api/projects/:id      — один проект
 *   POST   /api/projects          — создать           (только админ)
 *   PATCH  /api/projects/:id      — отредактировать   (только админ)
 *   DELETE /api/projects/:id      — удалить           (только админ)
 */
'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware');
const { trimmed } = require('../constants');

const router = express.Router();
router.use(requireAuth); // все маршруты проектов только для вошедших

// --- Список проектов ----------------------------------------------------------
// Фронтенду нужны карточки: название, описание и сколько задач в каждом статусе
router.get('/', (req, res) => {
  const projects = db.prepare(`
    SELECT p.*, (
      SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'backlog'
    ) AS backlog_count,
    (
      SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'in_progress'
    ) AS in_progress_count,
    (
      SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'review'
    ) AS review_count,
    (
      SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done'
    ) AS done_count
    FROM projects p
    ORDER BY p.created_at DESC
  `).all();
  res.json({ projects });
});

// --- Один проект ---------------------------------------------------------------
router.get('/:id', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Проект не найден' });
  res.json({ project });
});

// --- Создание (только админ) -----------------------------------------------------
router.post('/', requireAdmin, (req, res) => {
  const name = trimmed(req.body?.name, 100);
  const description = trimmed(req.body?.description, 1000);

  if (!name) return res.status(400).json({ error: 'Укажите название проекта' });

  const info = db.prepare(
    'INSERT INTO projects (name, description, created_by, created_at) VALUES (?, ?, ?, ?)'
  ).run(name, description || null, req.user.id, new Date().toISOString());

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ project });
});

// --- Редактирование (только админ) -----------------------------------------------
router.patch('/:id', requireAdmin, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Проект не найден' });

  // Частичное обновление: меняем только переданные поля
  const name = req.body?.name !== undefined ? trimmed(req.body.name, 100) : project.name;
  const description = req.body?.description !== undefined
    ? trimmed(req.body.description, 1000)
    : project.description;

  if (!name) return res.status(400).json({ error: 'Укажите название проекта' });

  db.prepare('UPDATE projects SET name = ?, description = ? WHERE id = ?')
    .run(name, description || null, project.id);

  res.json({ project: db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id) });
});

// --- Удаление (только админ) -----------------------------------------------------
// Задачи и комментарии удалятся каскадом (ON DELETE CASCADE в схеме)
router.delete('/:id', requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Проект не найден' });
  res.json({ ok: true });
});

module.exports = router;
