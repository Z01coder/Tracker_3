/**
 * «Такт» — подключение к базе данных SQLite.
 *
 * Отвечает за:
 *   1. открытие файла db/task.db (создаётся автоматически);
 *   2. создание схемы (CREATE TABLE IF NOT EXISTS — при каждом старте);
 *   3. сид-данные: ровно 5 демо-аккаунтов (2 админа + 3 программиста)
 *      и демо-проект с задачами и комментариями;
 *   4. идемпотентность: повторный запуск НЕ дублирует сид-данные.
 *
 * Схема из ТЗ (info/agents.md, раздел 7):
 *   users, projects, tasks, comments.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

// --- Файл базы ---------------------------------------------------------------
// Каталог db/ в корне проекта; .gitignore не хранит файлы БД —
// они создаются заново из сидов при первом запуске на любой машине.
const dbDir = path.join(__dirname, '..', 'db');
fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(path.join(dbDir, 'task.db'));

// WAL — журнал с упреждающей записью: быстрее и безопаснее при сбоях
db.pragma('journal_mode = WAL');
// Включаем исполнение внешних ключей (по умолчанию в SQLite они выключены)
db.pragma('foreign_keys = ON');

// --- Схема -------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    username      TEXT UNIQUE NOT NULL,
    display_name  TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin','programmer')),
    is_active     INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    created_by  INTEGER REFERENCES users(id),
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT,
    status      TEXT NOT NULL DEFAULT 'backlog'
                CHECK (status IN ('backlog','in_progress','review','done')),
    priority    TEXT NOT NULL DEFAULT 'medium'
                CHECK (priority IN ('low','medium','high','critical')),
    assignee_id INTEGER REFERENCES users(id),
    deadline    TEXT,
    created_by  INTEGER REFERENCES users(id),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS comments (
    id         INTEGER PRIMARY KEY,
    task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    author_id  INTEGER NOT NULL REFERENCES users(id),
    text       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT
  );
`);

// --- Сид-данные ---------------------------------------------------------------
/**
 * Дата в отдалении от «сегодня» — чтобы дедлайны демо-проекта выглядели живо:
 * часть задач уже просрочена, часть — на подходе.
 */
function dateFromToday(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

const nowIso = () => new Date().toISOString();

function seed() {
  const usersCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (usersCount > 0) return; // сиды уже есть — ничего не делаем

  const hash = (password) => bcrypt.hashSync(password, 10); // bcrypt cost 10 — учебная норма
  const ts = nowIso();

  // 5 аккаунтов из ТЗ (раздел 5): пароли хранятся только в виде хэшей
  const insertUser = db.prepare(`
    INSERT INTO users (username, display_name, password_hash, role, is_active, created_at)
    VALUES (?, ?, ?, ?, 1, ?)
  `);
  const uBoss1 = insertUser.run('boss1', 'Антон Иванов', hash('Boss#2026'), 'admin',      ts).lastInsertRowid;
  const uBoss2 = insertUser.run('boss2', 'Елена Борисова', hash('Boss#2027'), 'admin',      ts).lastInsertRowid;
  const uDev1  = insertUser.run('dev1',  'Пётр Крылов',    hash('Dev#2026'),  'programmer', ts).lastInsertRowid;
  const uDev2  = insertUser.run('dev2',  'Мария Соколова', hash('Dev#2027'),  'programmer', ts).lastInsertRowid;
  const uDev3  = insertUser.run('dev3',  'Тимур Гареев',   hash('Dev#2028'),  'programmer', ts).lastInsertRowid;

  // Демо-проект: поддержка сайта заказчика на CakePHP (так в исходном заказе)
  const pDemo = db.prepare(`
    INSERT INTO projects (name, description, created_by, created_at)
    VALUES ('Сайт CakePHP — поддержка',
            'Сопровождение сайта заказчика на CakePHP: багфиксы, мелкие доработки, релизы.',
            ?, ?)
  `).run(uBoss1, ts).lastInsertRowid;

  // ~10 задач: все 4 статуса и все 4 приоритета, разные исполнители и дедлайны
  const insertTask = db.prepare(`
    INSERT INTO tasks (project_id, title, description, status, priority, assignee_id, deadline, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const task = (title, description, status, priority, assignee, deadline) =>
    insertTask.run(pDemo, title, description, status, priority, assignee, deadline, uBoss1, ts, ts).lastInsertRowid;

  const t1 = task('Изучить: кодовая база CakePHP 3.x', 'Разобраться в структуре: контроллеры, шаблоны, миграции.', 'in_progress', 'high', uDev1, dateFromToday(5));
  const t2 = task('Настроить резервное копирование БД', 'Ежедневный дамп через cron с ретеншеном 7 дней.', 'done',                'high',   uDev1, dateFromToday(-4));
  const t3 = task('Баг: рассылка падает с ошибкой 500', 'Клиент сообщает: массовые письма не отправляются. Логи смотреть в /tmp/logs.', 'review', 'critical', uDev2, dateFromToday(-2));
  const t4 = task('Обновить зависимости до новой версии CakePHP', 'Сначала проверить на тест-сервере, затем релиз на прод.', 'backlog',  'high',   uDev3, dateFromToday(10));
  const t5 = task('Форма обратной связи: проверка полей', 'Ограничение на длину сообщения + капчу.',                       'in_progress', 'medium', uDev3, dateFromToday(3));
  const t6 = task('Ускорить загрузку каталога', 'Индексы на таблице товаров + кеширование главного блока.',                   'backlog',   'medium', uDev2, dateFromToday(14));
  const t7 = task('Редизайн верхней панели', 'Сделать по макету заказчика, плюс мобильная версия.',                            'backlog',   'low',    uDev3, dateFromToday(21));
  const t8 = task('Ошибка 404 на профиле пользователя', 'Ломается роутинг после прошлого релиза — падают страницы профилей.',                    'in_progress', 'low',    uDev3, dateFromToday(2));
  const t9 = task('SSL-сертификат: обновление', 'Перевыпуск на домен, обновить на проде сразу после продления.',                            'review',   'critical', uDev1, dateFromToday(-1));
  const t10 = task('Инвентаризация аккаунтов админов', 'Проверить всех авторизованных, лишних деактивировать.',                   'done',     'medium', uBoss2, dateFromToday(-7));

  // Комментарии: обсуждение идёт в задачах 1 и 3
  const insertComment = db.prepare(`
    INSERT INTO comments (task_id, author_id, text, created_at)
    VALUES (?, ?, ?, ?)
  `);
  insertComment.run(t1, uBoss1, 'Доступы к тест-серверу выслал на почту. Начинай с чтения миграций.', ts);
  insertComment.run(t1, uDev1,  'Принял. Сегодня посмотрю, как у них организованы миграции и деплой.', ts);
  insertComment.run(t3, uBoss1, 'Клиент эскалирует: письмо от него пришло утром. Нужно разобраться до конца дня.', ts);
  insertComment.run(t3, uDev2,  'Найдено: SMTP-лимиты на сервере. Обернула рассылку в очередь с ограничением на батч. На тесте работает.', ts);
}

seed();

// --- Экспорт ------------------------------------------------------------------
module.exports = db;
