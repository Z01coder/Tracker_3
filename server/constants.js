/**
 * «Такт» — общие константы и мелкие helpers для API.
 * Держим здесь, чтобы все маршруты валидировали одинаково.
 */
'use strict';

// Статусы канбана (ТЗ, раздел 6.3) — в порядке колонок слева направо
const STATUSES = ['backlog', 'in_progress', 'review', 'done'];

// Приоритеты (ТЗ, раздел 6.4)
const PRIORITIES = ['low', 'medium', 'high', 'critical'];

// Роли (ТЗ, раздел 5)
const ROLES = ['admin', 'programmer'];

/** Проверка формата даты дедлайна YYYY-MM-DD */
const isDateStr = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Обрезка строки или undefined (для необязательных полей) */
function trimmed(value, maxLen) {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  if (maxLen && s.length > maxLen) return s.slice(0, maxLen);
  return s;
}

module.exports = { STATUSES, PRIORITIES, ROLES, isDateStr, trimmed };
