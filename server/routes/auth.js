/**
 * «Такт» — маршруты аутентификации (ТЗ, раздел 6.1).
 *
 *   POST /api/auth/login   — вход {username, password}
 *   POST /api/auth/logout  — выход
 *   GET  /api/me           — данные текущего пользователя (для фронтенда)
 *
 * Регистрации нет: учётки создаёт только админ (ТЗ, вопрос 1 клиентам).
 */
'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth } = require('../middleware');

const router = express.Router();

/** Безопасное представление пользователя: без хэша пароля. */
function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    role: u.role
  };
}

// --- Вход ----------------------------------------------------------------------
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Введите логин и пароль' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).trim());

  // Одно и то же сообщение для «нет такого» и «не тот пароль» —
  // чтобы не подсказывать переборщику, какой именно логин существует.
  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }

  if (!user.is_active) {
    return res.status(403).json({ error: 'Учётная запись отключена. Обратитесь к администратору' });
  }

  req.session.userId = user.id; // с этого момента пользователь «в системе»
  res.json({ user: publicUser(user) });
});

// --- Выход ----------------------------------------------------------------------
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('takt.sid');
    res.json({ ok: true });
  });
});

// --- Текущий пользователь -------------------------------------------------------
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = router;
