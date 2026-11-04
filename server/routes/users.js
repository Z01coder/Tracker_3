/**
 * «Такт» — управление пользователями. ВСЕ маршруты только для админа (ТЗ, раздел 6.5).
 *
 *   GET    /api/users      — список пользователей
 *   POST   /api/users      — создать учётку {username, displayName, password, role}
 *   PATCH  /api/users/:id  — {displayName?, role?, password?, isActive?}
 *
 * Регистрации по открытии нет: учётки создаёт только админ.
 */
'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware');
const { ROLES, trimmed } = require('../constants');

const router = express.Router();
router.use(requireAuth, requireAdmin); // весь файл — только админ

/** Публичное представление пользователя — без хэша пароля. */
function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    role: u.role,
    isActive: Boolean(u.is_active),
    createdAt: u.created_at
  };
}

// --- Список ---------------------------------------------------------------------
router.get('/', (_req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY id').all();
  res.json({ users: users.map(publicUser) });
});

// --- Создание учётки --------------------------------------------------------------
router.post('/', (req, res) => {
  const username = trimmed(req.body?.username, 40);
  const displayName = trimmed(req.body?.displayName, 60);
  const role = req.body?.role;
  const password = req.body?.password;

  if (!username || !displayName || !password) {
    return res.status(400).json({ error: 'Заполните логин, имя и пароль' });
  }
  if (!ROLES.includes(role)) {
    return res.status(400).json({ error: 'Роль должна быть admin или programmer' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Пароль — минимум 6 символов' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error: 'Такой логин уже существует' });

  const info = db.prepare(`
    INSERT INTO users (username, display_name, password_hash, role, is_active, created_at)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run(username, displayName, bcrypt.hashSync(String(password), 10), role, new Date().toISOString());

  res.status(201).json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)) });
});

// --- Редактирование ----------------------------------------------------------------
router.patch('/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  const displayName = req.body?.displayName !== undefined
    ? trimmed(req.body.displayName, 60) : user.display_name;
  const role = req.body?.role !== undefined ? req.body.role : user.role;
  const isActive = req.body?.isActive !== undefined
    ? (req.body.isActive ? 1 : 0) : user.is_active;

  if (!displayName) return res.status(400).json({ error: 'Имя не может быть пустым' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Роль должна быть admin или programmer' });

  // Защита от самоблокировки: нельзя деактивировать себя и менять собственную роль —
  // иначе админ может случайно оставить систему без администратора
  if (user.id === req.user.id && (!isActive || role !== 'admin')) {
    return res.status(400).json({ error: 'Нельзя деактивировать себя или менять собственную роль' });
  }

  // В системе должен остаться хотя бы один активный админ
  const activeAdmins = db.prepare(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1"
  ).get().n;
  const losingActiveAdmin = user.role === 'admin' && user.is_active === 1
    && (role !== 'admin' || !isActive);
  if (losingActiveAdmin && activeAdmins <= 1) {
    return res.status(400).json({ error: 'В системе должен остаться хотя бы один активный админ' });
  }

  // Пароль меняем только если передан новый
  let passwordHash = user.password_hash;
  if (req.body?.password !== undefined && req.body.password !== '') {
    if (String(req.body.password).length < 6) {
      return res.status(400).json({ error: 'Пароль — минимум 6 символов' });
    }
    passwordHash = bcrypt.hashSync(String(req.body.password), 10);
  }

  db.prepare(`
    UPDATE users SET display_name = ?, role = ?, is_active = ?, password_hash = ? WHERE id = ?
  `).run(displayName, role, isActive, passwordHash, user.id);

  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) });
});

module.exports = router;
