/**
 * «Такт» — маршруты комментариев к задачам (ТЗ, раздел 6.4).
 *
 *   GET    /api/comments/task/:taskId — комментарии задачи (обе роли)
 *   POST   /api/comments/task/:taskId — добавить (обе роли)
 *   PATCH  /api/comments/:id          — редактировать (автор или админ)
 *   DELETE /api/comments/:id          — удалить (автор или админ)
 */
'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware');
const { trimmed } = require('../constants');

const router = express.Router();
router.use(requireAuth);

/** Комментарий в формате фронтенда (имя автора подгружено). */
function withAuthor(c) {
  return {
    id: c.id,
    taskId: c.task_id,
    authorId: c.author_id,
    authorName: c.author_name,
    text: c.text,
    createdAt: c.created_at,
    updatedAt: c.updated_at
  };
}

// --- Комментарии задачи --------------------------------------------------------
router.get('/task/:taskId', (req, res) => {
  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Задача не найдена' });

  const comments = db.prepare(`
    SELECT c.*, u.display_name AS author_name
    FROM comments c
    JOIN users u ON u.id = c.author_id
    WHERE c.task_id = ?
    ORDER BY c.created_at ASC
  `).all(req.params.taskId);

  res.json({ comments: comments.map(withAuthor) });
});

// --- Добавление комментария ------------------------------------------------------
router.post('/task/:taskId', (req, res) => {
  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Задача не найдена' });

  const text = trimmed(req.body?.text, 2000);
  if (!text) return res.status(400).json({ error: 'Комментарий не может быть пустым' });

  const info = db.prepare(`
    INSERT INTO comments (task_id, author_id, text, created_at)
    VALUES (?, ?, ?, ?)
  `).run(task.id, req.user.id, text, new Date().toISOString());

  const c = db.prepare(`
    SELECT c.*, u.display_name AS author_name FROM comments c
    JOIN users u ON u.id = c.author_id
    WHERE c.id = ?
  `).get(info.lastInsertRowid);

  res.status(201).json({ comment: withAuthor(c) });
});

// --- Редактирование: автор или админ --------------------------------------------
router.patch('/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Комментарий не найден' });

  const canEdit = c.author_id === req.user.id || req.user.role === 'admin';
  if (!canEdit) return res.status(403).json({ error: 'Редактировать можно только свои комментарии' });

  const text = trimmed(req.body?.text, 2000);
  if (!text) return res.status(400).json({ error: 'Комментарий не может быть пустым' });

  db.prepare('UPDATE comments SET text = ?, updated_at = ? WHERE id = ?')
    .run(text, new Date().toISOString(), c.id);

  const updated = db.prepare(`
    SELECT c.*, u.display_name AS author_name FROM comments c
    JOIN users u ON u.id = c.author_id
    WHERE c.id = ?
  `).get(c.id);

  res.json({ comment: withAuthor(updated) });
});

// --- Удаление: автор или админ ---------------------------------------------------
router.delete('/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Комментарий не найден' });

  const canDelete = c.author_id === req.user.id || req.user.role === 'admin';
  if (!canDelete) return res.status(403).json({ error: 'Удалять можно только свои комментарии' });

  db.prepare('DELETE FROM comments WHERE id = ?').run(c.id);
  res.json({ ok: true });
});

module.exports = router;
