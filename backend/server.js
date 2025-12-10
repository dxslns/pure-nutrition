const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');
const path = require('path');

// Загрузка переменных окружения
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

// Настройки CORS
const corsOptions = {
    origin: function (origin, callback) {
        // Разрешить запросы без origin
        if (!origin) return callback(null, true);

        // Разрешенные домены
        const allowedOrigins = process.env.ALLOWED_ORIGINS
            ? process.env.ALLOWED_ORIGINS.split(',')
            : ['http://localhost:3000', 'http://localhost:8080'];

        if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Статические файлы для разработки
if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
    app.use(express.static(path.join(__dirname, '../frontend')));
    app.use('/PNGs', express.static(path.join(__dirname, '../PNGs')));
    app.use(express.static(path.join(__dirname, '../')));
}

// Подключение к MySQL
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Проверка подключения
async function checkDatabaseConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ Успешное подключение к MySQL');
        connection.release();
    } catch (error) {
        console.error('❌ Ошибка подключения к MySQL');
        process.exit(1);
    }
}

// Создание таблиц
async function createTables() {
    try {
        // Таблица пользователей
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Таблица users готова');

        // Таблица для отслеживания streak
        await pool.query(`
            CREATE TABLE IF NOT EXISTS streaks (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                current_streak INT DEFAULT 0,
                last_entry_date DATE,
                longest_streak INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE KEY user_streak (user_id)
            )
        `);
        console.log('✅ Таблица streaks готова');

        // Таблица для дневных записей
        await pool.query(`
            CREATE TABLE IF NOT EXISTS day_entries (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
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
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE KEY user_date (user_id, entry_date)
            )
        `);
        console.log('✅ Таблица day_entries готова');

    } catch (error) {
        console.error('❌ Ошибка создания таблиц:', error.message);
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

        const [existingUsers] = await pool.query(
            'SELECT id FROM users WHERE email = ?',
            [email]
        );

        if (existingUsers.length > 0) {
            return res.status(400).json({ error: 'Email уже используется' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const [result] = await pool.query(
            'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
            [name, email, hashedPassword]
        );

        // Создаем запись streak для нового пользователя
        await pool.query(
            'INSERT INTO streaks (user_id, current_streak, last_entry_date, longest_streak) VALUES (?, 0, NULL, 0)',
            [result.insertId]
        );

        const token = jwt.sign(
            { id: result.insertId, email, name },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({
            success: true,
            message: 'Регистрация успешна',
            token,
            user: { id: result.insertId, name, email }
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

        const [users] = await pool.query(
            'SELECT * FROM users WHERE email = ?',
            [email]
        );

        if (users.length === 0) {
            return res.status(401).json({ error: 'Пользователь не найден' });
        }

        const user = users[0];
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

// 3. Проверка токена / информация о пользователе
app.get('/api/me', authenticateToken, async (req, res) => {
    try {
        const [users] = await pool.query(
            'SELECT id, name, email, created_at FROM users WHERE id = ?',
            [req.user.id]
        );

        if (users.length === 0) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        res.json({
            success: true,
            user: users[0]
        });

    } catch (error) {
        console.error('Ошибка получения информации:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// 4. Получение streak пользователя
app.get('/api/streak', authenticateToken, async (req, res) => {
    try {
        const [streaks] = await pool.query(
            'SELECT current_streak, last_entry_date, longest_streak FROM streaks WHERE user_id = ?',
            [req.user.id]
        );

        if (streaks.length === 0) {
            // Создаем запись streak если её нет
            await pool.query(
                'INSERT INTO streaks (user_id, current_streak, last_entry_date, longest_streak) VALUES (?, 0, NULL, 0)',
                [req.user.id]
            );

            return res.json({
                currentStreak: 0,
                lastEntryDate: null,
                longestStreak: 0
            });
        }

        const streak = streaks[0];

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

        // Получаем текущий streak
        const [streaks] = await pool.query(
            'SELECT current_streak, last_entry_date, longest_streak FROM streaks WHERE user_id = ?',
            [req.user.id]
        );

        let currentStreak = 0;
        let lastEntryDate = null;
        let longestStreak = 0;

        if (streaks.length > 0) {
            const streak = streaks[0];
            currentStreak = streak.current_streak;
            lastEntryDate = streak.last_entry_date;
            longestStreak = streak.longest_streak;
        }

        // Проверяем, была ли сегодня уже запись
        if (lastEntryDate) {
            const lastDate = new Date(lastEntryDate);
            const today = new Date(date);
            const diffDays = Math.floor((today - lastDate) / (1000 * 60 * 60 * 24));

            if (diffDays === 0) {
                // Сегодня уже была запись - не увеличиваем streak
                return res.json({
                    message: 'Today already recorded',
                    currentStreak: currentStreak,
                    longestStreak: longestStreak
                });
            } else if (diffDays === 1) {
                // Вчера была запись - увеличиваем streak
                currentStreak += 1;
            } else {
                // Пропущен день или больше - сбрасываем streak
                currentStreak = 1;
            }
        } else {
            // Первая запись
            currentStreak = 1;
        }

        // Обновляем самую длинную серию
        if (currentStreak > longestStreak) {
            longestStreak = currentStreak;
        }

        // Обновляем запись в базе данных
        if (streaks.length > 0) {
            await pool.query(
                'UPDATE streaks SET current_streak = ?, last_entry_date = ?, longest_streak = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
                [currentStreak, date, longestStreak, req.user.id]
            );
        } else {
            await pool.query(
                'INSERT INTO streaks (user_id, current_streak, last_entry_date, longest_streak) VALUES (?, ?, ?, ?)',
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

// 6. Сохранение дневной записи
app.post('/api/day', authenticateToken, async (req, res) => {
    try {
        const { date, data } = req.body;

        if (!date || !data) {
            return res.status(400).json({ error: 'Дата и данные обязательны' });
        }

        // Проверяем, есть ли уже запись на эту дату
        const [existingEntries] = await pool.query(
            'SELECT id FROM day_entries WHERE user_id = ? AND entry_date = ?',
            [req.user.id, date]
        );

        // Подготовка данных для сохранения
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

        if (existingEntries.length > 0) {
            // Обновляем существующую запись
            await pool.query(
                `UPDATE day_entries SET 
                    sleep_hours = ?, sleep_quality = ?, water_intake = ?, mood = ?, 
                    activity_level = ?, notes = ?, sleep_issues = ?, dehydration_symptoms = ?,
                    mood_related = ?, activity_issues = ?, negative_factors = ?, updated_at = CURRENT_TIMESTAMP
                WHERE user_id = ? AND entry_date = ?`,
                [
                    entryData.sleep_hours, entryData.sleep_quality, entryData.water_intake,
                    entryData.mood, entryData.activity_level, entryData.notes,
                    entryData.sleep_issues, entryData.dehydration_symptoms,
                    entryData.mood_related, entryData.activity_issues, entryData.negative_factors,
                    req.user.id, date
                ]
            );
        } else {
            // Создаем новую запись
            await pool.query(
                `INSERT INTO day_entries (
                    user_id, entry_date, sleep_hours, sleep_quality, water_intake, mood,
                    activity_level, notes, sleep_issues, dehydration_symptoms,
                    mood_related, activity_issues, negative_factors
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

// 7. Получение дневных записей
app.get('/api/day/:date', authenticateToken, async (req, res) => {
    try {
        const { date } = req.params;

        const [entries] = await pool.query(
            'SELECT * FROM day_entries WHERE user_id = ? AND entry_date = ?',
            [req.user.id, date]
        );

        if (entries.length === 0) {
            return res.status(404).json({ error: 'Запись не найдена' });
        }

        const entry = entries[0];

        // Парсим JSON поля
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

// 8. Проверка здоровья сервера
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Сервер работает',
        timestamp: new Date().toISOString()
    });
});

// 9. Получение Health Score
app.get('/api/health-score', authenticateToken, async (req, res) => {
    try {
        // Получаем записи за последние 7 дней
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const dateString = sevenDaysAgo.toISOString().split('T')[0];

        const [entries] = await pool.query(
            `SELECT * FROM day_entries 
             WHERE user_id = ? AND entry_date >= ? 
             ORDER BY entry_date DESC`,
            [req.user.id, dateString]
        );

        if (entries.length === 0) {
            return res.json({
                overallScore: 0,
                categories: [],
                trends: []
            });
        }

        // Рассчитываем баллы для каждой категории
        let sleepScore = 0;
        let waterScore = 0;
        let activityScore = 0;
        let moodScore = 0;

        let sleepEntries = 0;
        let waterEntries = 0;
        let activityEntries = 0;
        let moodEntries = 0;

        // Анализируем тренды
        const trends = [];
        let goodDays = 0;
        let badDays = 0;

        entries.forEach(entry => {
            // Sleep score calculation
            if (entry.sleep_hours !== null) {
                let entrySleepScore = 0;

                // Hours slept (60% of sleep score)
                if (entry.sleep_hours >= 7 && entry.sleep_hours <= 9) {
                    entrySleepScore += 60; // Ideal range
                } else if (entry.sleep_hours >= 6 && entry.sleep_hours < 7) {
                    entrySleepScore += 40; // Below ideal
                } else if (entry.sleep_hours > 9 && entry.sleep_hours <= 10) {
                    entrySleepScore += 40; // Above ideal
                } else if (entry.sleep_hours >= 5 && entry.sleep_hours < 6) {
                    entrySleepScore += 20; // Low
                } else if (entry.sleep_hours > 10 && entry.sleep_hours <= 11) {
                    entrySleepScore += 20; // High
                }

                // Sleep quality (40% of sleep score)
                if (entry.sleep_quality === 'slept-well') {
                    entrySleepScore += 40;
                } else if (entry.sleep_quality === 'poor-sleep') {
                    entrySleepScore += 10;
                }

                // Sleep issues penalty
                if (entry.sleep_issues) {
                    try {
                        const issues = JSON.parse(entry.sleep_issues);
                        const penalty = Math.min(issues.length * 10, 30);
                        entrySleepScore -= penalty;
                    } catch (e) {
                        console.error('Error parsing sleep issues:', e);
                    }
                }

                sleepScore += Math.max(0, Math.min(100, entrySleepScore));
                sleepEntries++;
            }

            // Water score calculation
            if (entry.water_intake) {
                let entryWaterScore = 0;

                // Water intake
                if (entry.water_intake === 'enough') {
                    entryWaterScore += 100;
                } else if (entry.water_intake === 'too-little') {
                    entryWaterScore += 30;
                }

                // Dehydration symptoms penalty
                if (entry.dehydration_symptoms) {
                    try {
                        const symptoms = JSON.parse(entry.dehydration_symptoms);
                        const penalty = Math.min(symptoms.length * 15, 40);
                        entryWaterScore -= penalty;
                    } catch (e) {
                        console.error('Error parsing dehydration symptoms:', e);
                    }
                }

                waterScore += Math.max(0, Math.min(100, entryWaterScore));
                waterEntries++;
            }

            // Activity score calculation
            if (entry.activity_level !== null) {
                let entryActivityScore = 0;

                // Activity level
                if (entry.activity_level >= 5 && entry.activity_level <= 7) {
                    entryActivityScore += 100; // Good range
                } else if (entry.activity_level >= 3 && entry.activity_level < 5) {
                    entryActivityScore += 70; // Moderate
                } else if (entry.activity_level > 7 && entry.activity_level <= 9) {
                    entryActivityScore += 80; // High but good
                } else if (entry.activity_level >= 1 && entry.activity_level < 3) {
                    entryActivityScore += 30; // Low
                } else if (entry.activity_level === 10) {
                    entryActivityScore += 60; // Very high
                }

                // Activity issues penalty
                if (entry.activity_issues) {
                    try {
                        const issues = JSON.parse(entry.activity_issues);
                        const penalty = Math.min(issues.length * 8, 40);
                        entryActivityScore -= penalty;
                    } catch (e) {
                        console.error('Error parsing activity issues:', e);
                    }
                }

                activityScore += Math.max(0, Math.min(100, entryActivityScore));
                activityEntries++;
            }

            // Mood score calculation
            if (entry.mood !== null) {
                let entryMoodScore = 100; // Start with perfect score

                // Mood penalty
                if (entry.mood <= 3) {
                    entryMoodScore -= 40; // Very low mood
                } else if (entry.mood <= 5) {
                    entryMoodScore -= 20; // Low mood
                } else if (entry.mood <= 7) {
                    entryMoodScore -= 10; // Moderate mood
                }

                // Mood related issues penalty
                if (entry.mood_related) {
                    try {
                        const moodIssues = JSON.parse(entry.mood_related);
                        const penalty = Math.min(moodIssues.length * 12, 60);
                        entryMoodScore -= penalty;
                    } catch (e) {
                        console.error('Error parsing mood related:', e);
                    }
                }

                moodScore += Math.max(0, Math.min(100, entryMoodScore));
                moodEntries++;

                // Track good/bad days for trends
                if (entryMoodScore >= 60) {
                    goodDays++;
                } else if (entryMoodScore < 40) {
                    badDays++;
                }
            }
        });

        // Calculate average scores
        const avgSleepScore = sleepEntries > 0 ? Math.round(sleepScore / sleepEntries) : 0;
        const avgWaterScore = waterEntries > 0 ? Math.round(waterScore / waterEntries) : 0;
        const avgActivityScore = activityEntries > 0 ? Math.round(activityScore / activityEntries) : 0;
        const avgMoodScore = moodEntries > 0 ? Math.round(moodScore / moodEntries) : 0;

        // Calculate overall score with weights
        const overallScore = Math.round(
            (avgSleepScore * 0.4) +
            (avgWaterScore * 0.2) +
            (avgActivityScore * 0.2) +
            (avgMoodScore * 0.2)
        );

        // Prepare categories data
        const categories = [
            {
                name: 'Sleep',
                score: avgSleepScore,
                weight: 40,
                description: getHealthScoreDescription('sleep', avgSleepScore, sleepEntries)
            },
            {
                name: 'Water',
                score: avgWaterScore,
                weight: 20,
                description: getHealthScoreDescription('water', avgWaterScore, waterEntries)
            },
            {
                name: 'Activity',
                score: avgActivityScore,
                weight: 20,
                description: getHealthScoreDescription('activity', avgActivityScore, activityEntries)
            },
            {
                name: 'Mood',
                score: avgMoodScore,
                weight: 20,
                description: getHealthScoreDescription('mood', avgMoodScore, moodEntries)
            }
        ];

        // Generate trends based on analysis
        if (entries.length >= 3) {
            if (goodDays > badDays && goodDays >= 3) {
                trends.push({
                    emoji: '📈',
                    text: 'Mostly good days this week!',
                    type: 'positive'
                });
            } else if (badDays > goodDays && badDays >= 3) {
                trends.push({
                    emoji: '📉',
                    text: 'Consider taking more rest days',
                    type: 'negative'
                });
            }

            // Check for consistency
            if (entries.length >= 5) {
                const consistentDays = entries.slice(0, 5).every(entry =>
                    entry.sleep_hours !== null &&
                    entry.water_intake !== null &&
                    entry.mood !== null
                );

                if (consistentDays) {
                    trends.push({
                        emoji: '⭐',
                        text: 'Great consistency in tracking!',
                        type: 'positive'
                    });
                }
            }

            // Check for improvement
            if (entries.length >= 3) {
                const recentAvg = (avgSleepScore + avgMoodScore) / 2;
                const olderEntries = entries.slice(Math.floor(entries.length * 0.7));
                let olderAvg = 0;
                let olderCount = 0;

                olderEntries.forEach(entry => {
                    if (entry.mood !== null) {
                        olderAvg += entry.mood * 0.5;
                        olderCount++;
                    }
                    if (entry.sleep_hours !== null) {
                        const sleepPoints = entry.sleep_hours >= 7 ? 50 : 25;
                        olderAvg += sleepPoints * 0.5;
                        olderCount++;
                    }
                });

                if (olderCount > 0) {
                    olderAvg = olderAvg / olderCount;
                    if (recentAvg > olderAvg + 10) {
                        trends.push({
                            emoji: '🚀',
                            text: 'Great improvement this week!',
                            type: 'positive'
                        });
                    }
                }
            }
        }

        res.json({
            overallScore: overallScore,
            categories: categories,
            trends: trends,
            entriesCount: entries.length,
            daysTracked: Math.min(entries.length, 7)
        });

    } catch (error) {
        console.error('Ошибка расчета Health Score:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Helper function for Health Score descriptions
function getHealthScoreDescription(category, score, entries) {
    if (entries === 0) {
        return 'No data recorded';
    }

    if (score >= 80) {
        const descriptions = {
            'sleep': 'Excellent sleep patterns',
            'water': 'Perfect hydration',
            'activity': 'Great activity levels',
            'mood': 'Excellent mood balance'
        };
        return descriptions[category] || 'Excellent';
    } else if (score >= 60) {
        const descriptions = {
            'sleep': 'Good sleep habits',
            'water': 'Adequate hydration',
            'activity': 'Good activity levels',
            'mood': 'Good mood stability'
        };
        return descriptions[category] || 'Good';
    } else if (score >= 40) {
        const descriptions = {
            'sleep': 'Average sleep quality',
            'water': 'Moderate hydration',
            'activity': 'Moderate activity',
            'mood': 'Average mood levels'
        };
        return descriptions[category] || 'Fair';
    } else {
        const descriptions = {
            'sleep': 'Needs improvement',
            'water': 'Hydration needs attention',
            'activity': 'Activity needs increase',
            'mood': 'Mood needs attention'
        };
        return descriptions[category] || 'Needs improvement';
    }
}

// Запуск сервера
async function startServer() {
    await checkDatabaseConnection();
    await createTables();

    app.listen(PORT, () => {
        console.log('='.repeat(50));
        console.log(`🚀 Сервер запущен: http://localhost:${PORT}`);
        console.log(`📊 База данных: MySQL/pure_nutrition_db`);
        console.log('');
        console.log('📡 Доступные API:');
        console.log(`   POST /api/register        - Регистрация`);
        console.log(`   POST /api/login           - Вход`);
        console.log(`   GET  /api/me              - Информация о пользователе`);
        console.log(`   GET  /api/streak          - Получение streak`);
        console.log(`   POST /api/streak/update   - Обновление streak`);
        console.log(`   POST /api/day             - Сохранение дня`);
        console.log(`   GET  /api/day/:date       - Получение дня`);
        console.log(`   GET  /api/health          - Проверка сервера`);
        console.log(`   GET  /api/health-score    - Health Score`);
        console.log('='.repeat(50));
    });
}

startServer().catch(error => {
    console.error('Ошибка запуска:', error);
});