/**
 * «Такт» — middleware проверки прав (роли по ТЗ, раздел 5).
 *
 * requireAuth  — доступ только для вошедших; попутно кладёт пользователя
 *                в req.user (для дальнейших проверок и фронтенда).
 * requireAdmin — поверх requireAuth: действия только для роли 'admin'.
 */
'use strict';

const db = require('./db');

/** Возвращает пользователя по id или null, если его нет/деактивировали. */
function findActiveUser(id) {
  if (!id) return null;
  return db.prepare(
    'SELECT id, username, display_name, role, is_active FROM users WHERE id = ?'
  ).get(id) || null;
}

/** Пускает дальше только авторизованных и активных пользователей. */
function requireAuth(req, res, next) {
  const user = findActiveUser(req.session.userId);
  if (!user || !user.is_active) {
    // Сессия есть, но пользователя больше нет / он деактивирован — считаем не вошедшим
    return res.status(401).json({ error: 'Требуется вход в систему' });
  }
  req.user = user; // дальше по цепочке доступен req.user
  next();
}

/** Пускает дальше только администраторов. Использовать после requireAuth. */
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Нужны права администратора' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, findActiveUser };
