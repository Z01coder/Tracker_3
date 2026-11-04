/**
 * «Такт» — командный трекер задач с канбан-доской и ролями.
 *
 * Точка входа сервера. На этапе каркаса здесь:
 *   1. настройка Express (JSON-тела, сессии в cookie),
 *   2. раздача статики из public/,
 *   3. служебная ручка /health для проверки «сервер жив».
 * Подключение базы данных SQLite и API появятся на следующих этапах
 * (см. план в файле plan.md).
 */
'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');

const PORT = Number(process.env.PORT) || 3003; // порт по брифу: 3001/3002/3003 для Tracker_1/2/3

const app = express();

// небольшой запрет на подпись Express в ответах — лишний намёк на технологию
app.disable('x-powered-by');

// --- Тела запросов -----------------------------------------------------------
// JSON приходит из фронтенда при всех запросах к API
app.use(express.json());

// --- Сессии ------------------------------------------------------------------
// Сессия хранится в cookie takt.sid; данные сессии — в памяти процесса
// (MemoryStore достаточен для учебного MVP на 5 аккаунтов).
// Секрет берём из переменной окружения SESSION_SECRET, чтобы на Railway
// его можно было задать без правки кода.
app.use(session({
  name: 'takt.sid',
  secret: process.env.SESSION_SECRET || 'takt-dev-secret-change-me',
  resave: false,           // не перезаписывать сессию, если она не изменилась
  saveUninitialized: false, // до входа сессию не создаём
  cookie: {
    httpOnly: true,          // cookie недоступна из JS браузера
    sameSite: 'lax',         // защита от CSRF в пределах разумного для MVP
    maxAge: 12 * 60 * 60 * 1000 // 12 часов — типичный рабочий день
  }
}));

// --- Статика -----------------------------------------------------------------
// Фронтенд: index.html, css/, js/ — без сборщиков, ванильный HTML/CSS/JS
app.use(express.static(path.join(__dirname, '..', 'public')));

// --- База данных --------------------------------------------------------------
// Требуем ("const _db =") только чтобы БД создалась и сидались данные при старте
const _db = require('./db');

// --- API ----------------------------------------------------------------------
app.use('/api/auth', require('./routes/auth'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/comments', require('./routes/comments'));
app.use('/api/users', require('./routes/users'));

// Неизвестные API-пути отвечают JSON-ошибкой, а не HTML-страницей
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Неизвестный путь API' });
});

// --- Служебные ручки ---------------------------------------------------------
// Проверка живости сервера (используется при самопроверке и в деплое)
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'takt', port: PORT });
});

// На следующих этапах здесь появятся: подключение БД (db/index.js),
// сид-данные и смонтированные маршруты API (/api/...).

// --- Запуск ------------------------------------------------------------------
// 0.0.0.0 — слушаем на всех интерфейсах, как требуется для Railway и локальной сети
app.listen(PORT, '0.0.0.0', () => {
  console.log(`«Такт» запущен: http://localhost:${PORT}`);
});

// --- Обработка ошибок ---------------------------------------------------------
// Финальная прослойка: любые непойманные ошибки API отдаём как JSON на русском
// (например, битый JSON в теле запроса — 400, а не HTML-страницу body-parser)
app.use((err, req, res, _next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Некорректный JSON в запросе' });
  }
  console.error(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});
