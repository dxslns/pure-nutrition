const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
console.log('=== STARTING SERVER ===');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT:', process.env.PORT);
console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

// Middleware
app.use(cors());
app.use(express.json());

// Подключение к PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Проверка подключения
// Стало:
async function checkDatabaseConnection() {
    try {
        const client = await pool.connect();
        console.log('✅ Успешное подключение к PostgreSQL');
        client.release();
        return true;
    } catch (error) {
        console.error('❌ Ошибка подключения к PostgreSQL:', error.message);
        console.log('⚠️  Продолжаем работу без базы данных...');
        return false;
    }
}

// Создание таблиц
async function createTables() {
    try {
        const client = await pool.connect();

        try {
            // Таблица пользователей
            await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          email VARCHAR(100) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
            console.log('✅ Таблица users готова');

        // Таблица для отслеживания streak
        await client.query(`
      CREATE TABLE IF NOT EXISTS streaks (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        current_streak INT DEFAULT 0,
        last_entry_date DATE,
        longest_streak INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id)
      )
    `);
        console.log('✅ Таблица streaks готова');

        // Таблица для дневных записей
        await client.query(`
      CREATE TABLE IF NOT EXISTS day_entries (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        entry_date DATE NOT NULL,
        sleep_hours FLOAT,
        sleep_quality VARCHAR(50),
        water_intake VARCHAR(50),
        mood INT,
        activity_level INT,
        notes TEXT,
        sleep_issues TEXT,
        dehydration_symptoms TEXT,
        mood_related TEXT,
        activity_issues TEXT,
        negative_factors TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, entry_date)
      )
    `);
        console.log('✅ Таблица day_entries готова');

        } catch (error) {
            console.error('❌ Ошибка создания таблиц:', error.message);
        } finally {
            client.release();
        }

    } catch (error) {
        console.log('⚠️  Не удалось подключиться для создания таблиц');
    }
}

// Middleware для проверки JWT токена
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Токен не предоставлен' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Недействительный токен' });
        }
        req.user = user;
        next();
    });
}

// ============ API ============

// 1. Регистрация
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Все поля обязательны' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Пароль минимум 6 символов' });
        }

        const existingUsers = await pool.query(
            'SELECT id FROM users WHERE email = $1',
            [email]
        );

        if (existingUsers.rows.length > 0) {
            return res.status(400).json({ error: 'Email уже используется' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await pool.query(
            'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id',
            [name, email, hashedPassword]
        );

        await pool.query(
            'INSERT INTO streaks (user_id, current_streak, last_entry_date, longest_streak) VALUES ($1, 0, NULL, 0)',
            [result.rows[0].id]
        );

        const token = jwt.sign(
            { id: result.rows[0].id, email, name },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({
            success: true,
            message: 'Регистрация успешна',
            token,
            user: { id: result.rows[0].id, name, email }
        });

    } catch (error) {
        console.error('Ошибка регистрации:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// 2. Вход
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email и пароль обязательны' });
        }

        const users = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );

        if (users.rows.length === 0) {
            return res.status(401).json({ error: 'Пользователь не найден' });
        }

        const user = users.rows[0];
        const validPassword = await bcrypt.compare(password, user.password);

        if (!validPassword) {
            return res.status(401).json({ error: 'Неверный пароль' });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, name: user.name },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({
            success: true,
            message: 'Вход выполнен',
            token,
            user: { id: user.id, name: user.name, email: user.email }
        });

    } catch (error) {
        console.error('Ошибка входа:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// 3. Проверка токена
app.get('/api/me', authenticateToken, async (req, res) => {
    try {
        const users = await pool.query(
            'SELECT id, name, email, created_at FROM users WHERE id = $1',
            [req.user.id]
        );

        if (users.rows.length === 0) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        res.json({
            success: true,
            user: users.rows[0]
        });

    } catch (error) {
        console.error('Ошибка получения информации:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// 4. Получение streak
app.get('/api/streak', authenticateToken, async (req, res) => {
    try {
        const streaks = await pool.query(
            'SELECT current_streak, last_entry_date, longest_streak FROM streaks WHERE user_id = $1',
            [req.user.id]
        );

        if (streaks.rows.length === 0) {
            await pool.query(
                'INSERT INTO streaks (user_id, current_streak, last_entry_date, longest_streak) VALUES ($1, 0, NULL, 0)',
                [req.user.id]
            );

            return res.json({
                currentStreak: 0,
                lastEntryDate: null,
                longestStreak: 0
            });
        }

        const streak = streaks.rows[0];

        res.json({
            currentStreak: streak.current_streak,
            lastEntryDate: streak.last_entry_date,
            longestStreak: streak.longest_streak
        });

    } catch (error) {
        console.error('Ошибка получения streak:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// 5. Обновление streak
app.post('/api/streak/update', authenticateToken, async (req, res) => {
    try {
        const { date } = req.body;

        if (!date) {
            return res.status(400).json({ error: 'Дата обязательна' });
        }

        const streaks = await pool.query(
            'SELECT current_streak, last_entry_date, longest_streak FROM streaks WHERE user_id = $1',
            [req.user.id]
        );

        let currentStreak = 0;
        let lastEntryDate = null;
        let longestStreak = 0;

        if (streaks.rows.length > 0) {
            const streak = streaks.rows[0];
            currentStreak = streak.current_streak;
            lastEntryDate = streak.last_entry_date;
            longestStreak = streak.longest_streak;
        }

        if (lastEntryDate) {
            const lastDate = new Date(lastEntryDate);
            const today = new Date(date);
            const diffDays = Math.floor((today - lastDate) / (1000 * 60 * 60 * 24));

            if (diffDays === 0) {
                return res.json({
                    message: 'Today already recorded',
                    currentStreak: currentStreak,
                    longestStreak: longestStreak
                });
            } else if (diffDays === 1) {
                currentStreak += 1;
            } else {
                currentStreak = 1;
            }
        } else {
            currentStreak = 1;
        }

        if (currentStreak > longestStreak) {
            longestStreak = currentStreak;
        }

        if (streaks.rows.length > 0) {
            await pool.query(
                'UPDATE streaks SET current_streak = $1, last_entry_date = $2, longest_streak = $3, updated_at = CURRENT_TIMESTAMP WHERE user_id = $4',
                [currentStreak, date, longestStreak, req.user.id]
            );
        } else {
            await pool.query(
                'INSERT INTO streaks (user_id, current_streak, last_entry_date, longest_streak) VALUES ($1, $2, $3, $4)',
                [req.user.id, currentStreak, date, longestStreak]
            );
        }

        res.json({
            message: 'Streak updated successfully',
            currentStreak: currentStreak,
            lastEntryDate: date,
            longestStreak: longestStreak
        });

    } catch (error) {
        console.error('Ошибка обновления streak:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// 6. Сохранение дня
app.post('/api/day', authenticateToken, async (req, res) => {
    try {
        const { date, data } = req.body;

        if (!date || !data) {
            return res.status(400).json({ error: 'Дата и данные обязательны' });
        }

        const existingEntries = await pool.query(
            'SELECT id FROM day_entries WHERE user_id = $1 AND entry_date = $2',
            [req.user.id, date]
        );

        const entryData = {
            user_id: req.user.id,
            entry_date: date,
            sleep_hours: data.sleepHours || null,
            sleep_quality: data.sleepQuality || null,
            water_intake: data.waterIntake || null,
            mood: data.mood || null,
            activity_level: data.activityLevel || null,
            notes: data.notes || null,
            sleep_issues: data.sleepIssues ? JSON.stringify(data.sleepIssues) : null,
            dehydration_symptoms: data.dehydrationSymptoms ? JSON.stringify(data.dehydrationSymptoms) : null,
            mood_related: data.moodRelated ? JSON.stringify(data.moodRelated) : null,
            activity_issues: data.activityIssues ? JSON.stringify(data.activityIssues) : null,
            negative_factors: data.negativeFactors ? JSON.stringify(data.negativeFactors) : null
        };

        if (existingEntries.rows.length > 0) {
            await pool.query(
                `UPDATE day_entries SET 
          sleep_hours = $1, sleep_quality = $2, water_intake = $3, mood = $4, 
          activity_level = $5, notes = $6, sleep_issues = $7, dehydration_symptoms = $8,
          mood_related = $9, activity_issues = $10, negative_factors = $11, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $12 AND entry_date = $13`,
                [
                    entryData.sleep_hours, entryData.sleep_quality, entryData.water_intake,
                    entryData.mood, entryData.activity_level, entryData.notes,
                    entryData.sleep_issues, entryData.dehydration_symptoms,
                    entryData.mood_related, entryData.activity_issues, entryData.negative_factors,
                    req.user.id, date
                ]
            );
        } else {
            await pool.query(
                `INSERT INTO day_entries (
          user_id, entry_date, sleep_hours, sleep_quality, water_intake, mood,
          activity_level, notes, sleep_issues, dehydration_symptoms,
          mood_related, activity_issues, negative_factors
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                [
                    entryData.user_id, entryData.entry_date, entryData.sleep_hours,
                    entryData.sleep_quality, entryData.water_intake, entryData.mood,
                    entryData.activity_level, entryData.notes, entryData.sleep_issues,
                    entryData.dehydration_symptoms, entryData.mood_related,
                    entryData.activity_issues, entryData.negative_factors
                ]
            );
        }

        res.json({
            success: true,
            message: 'Day data saved successfully'
        });

    } catch (error) {
        console.error('Ошибка сохранения дня:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// 7. Получение записи дня
app.get('/api/day/:date', authenticateToken, async (req, res) => {
    try {
        const { date } = req.params;

        const entries = await pool.query(
            'SELECT * FROM day_entries WHERE user_id = $1 AND entry_date = $2',
            [req.user.id, date]
        );

        if (entries.rows.length === 0) {
            return res.status(404).json({ error: 'Запись не найдена' });
        }

        const entry = entries.rows[0];

        const response = {
            sleepHours: entry.sleep_hours,
            sleepQuality: entry.sleep_quality,
            waterIntake: entry.water_intake,
            mood: entry.mood,
            activityLevel: entry.activity_level,
            notes: entry.notes,
            sleepIssues: entry.sleep_issues ? JSON.parse(entry.sleep_issues) : [],
            dehydrationSymptoms: entry.dehydration_symptoms ? JSON.parse(entry.dehydration_symptoms) : [],
            moodRelated: entry.mood_related ? JSON.parse(entry.mood_related) : [],
            activityIssues: entry.activity_issues ? JSON.parse(entry.activity_issues) : [],
            negativeFactors: entry.negative_factors ? JSON.parse(entry.negative_factors) : []
        };

        res.json({
            success: true,
            data: response
        });

    } catch (error) {
        console.error('Ошибка получения записи:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// 8. Health Score (упрощённая версия для PostgreSQL)
app.get('/api/health-score', authenticateToken, async (req, res) => {
    try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const dateString = sevenDaysAgo.toISOString().split('T')[0];

        const entries = await pool.query(
            `SELECT * FROM day_entries 
       WHERE user_id = $1 AND entry_date >= $2 
       ORDER BY entry_date DESC`,
            [req.user.id, dateString]
        );

        if (entries.rows.length === 0) {
            return res.json({
                overallScore: 0,
                categories: [],
                trends: []
            });
        }

        // Упрощённый расчёт для примера
        const overallScore = 75; // Заглушка
        const categories = [
            { name: 'Sleep', score: 80, weight: 40, description: 'Good sleep habits' },
            { name: 'Water', score: 70, weight: 20, description: 'Adequate hydration' },
            { name: 'Activity', score: 65, weight: 20, description: 'Moderate activity' },
            { name: 'Mood', score: 85, weight: 20, description: 'Good mood stability' }
        ];

        res.json({
            overallScore: overallScore,
            categories: categories,
            trends: [],
            entriesCount: entries.rows.length,
            daysTracked: Math.min(entries.rows.length, 7)
        });

    } catch (error) {
        console.error('Ошибка расчета Health Score:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// 9. Проверка здоровья сервера
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Сервер работает',
        timestamp: new Date().toISOString()
    });
});

// Запуск сервера
async function startServer() {
    console.log('=== startServer() called ===');

    const dbConnected = await checkDatabaseConnection();

    if (dbConnected) {
        await createTables();
        console.log('📊 База данных: PostgreSQL (подключена)');
    } else {
        console.log('📊 База данных: Не подключена (режим без БД)');
    }

    app.listen(PORT, () => {
        console.log('='.repeat(50));
        console.log(`🚀 Сервер запущен: http://localhost:${PORT}`);
        console.log('');
        console.log('📡 Доступные API (некоторые могут не работать без БД):');
        console.log(`   GET  /api/health          - Проверка сервера ✓`);
        console.log(`   POST /api/register        - Регистрация ${dbConnected ? '✓' : '✗'}`);
        console.log(`   POST /api/login           - Вход ${dbConnected ? '✓' : '✗'}`);
        console.log('='.repeat(50));
    });
}