const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Konfigurasi Pool Database (TiDB Cloud / Aiven)
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'test',
  port: Number(process.env.DB_PORT) || 4000,
  ssl: { rejectUnauthorized: false },
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  connectTimeout: 10000 // Timeout 10 detik agar tidak menggantung
});

// Helper untuk memastikan tabel 'users' dan 'global_chats' dibuat otomatis
async function ensureTablesExist() {
  const createUsersTable = `
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(50) NOT NULL UNIQUE,
      email VARCHAR(100) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(50) DEFAULT 'User',
      avatar_url TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  const createChatsTable = `
    CREATE TABLE IF NOT EXISTS global_chats (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(50) NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await pool.query(createUsersTable);
  await pool.query(createChatsTable);
}

// Root Route Test
app.get('/', (req, res) => {
  res.send('Server Backend CIVUTAX Berjalan Lancar!');
});

// Endpoint Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username dan password wajib diisi!' });
  }

  try {
    await ensureTablesExist();
    const [rows] = await pool.query(
      'SELECT * FROM users WHERE username = ? OR email = ?',
      [username, username]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Username / Email tidak ditemukan!' });
    }

    const user = rows[0];
    if (user.password !== password) {
      return res.status(401).json({ success: false, message: 'Password salah!' });
    }

    res.json({
      success: true,
      message: 'Login berhasil!',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role || 'Ranzz : DEVELOPER',
        avatar_url: user.avatar_url || 'https://cdn.phototourl.com/member/2026-09-27-bfb1146c-714f-4bca-97ff-7eb50e41818b.jpg'
      }
    });
  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

// Endpoint Register
app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ success: false, message: 'Semua kolom pendaftaran wajib diisi!' });
  }

  try {
    await ensureTablesExist();

    const [existing] = await pool.query(
      'SELECT * FROM users WHERE username = ? OR email = ?',
      [username, email]
    );

    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: 'Username atau Email sudah terdaftar!' });
    }

    await pool.query(
      'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
      [username, email, password, 'User']
    );

    res.json({ success: true, message: 'Pendaftaran akun berhasil! Silakan login.' });
  } catch (err) {
    console.error('Register Error:', err);
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

// ==========================================
// ENDPOINT CHAT GLOBAL
// ==========================================

// 1. Endpoint Ambil 50 Pesan Terakhir
app.get('/api/chat/messages', async (req, res) => {
  try {
    await ensureTablesExist();
    const [rows] = await pool.query('SELECT * FROM global_chats ORDER BY id DESC LIMIT 50');
    // Dibalik agar urutannya dari pesan terlama ke terbaru di layar chat
    res.json({ success: true, messages: rows.reverse() });
  } catch (err) {
    console.error('Fetch Chat Error:', err);
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

// 2. Endpoint Kirim Pesan Baru
app.post('/api/chat/send', async (req, res) => {
  const { username, message } = req.body;

  if (!username || !message) {
    return res.status(400).json({ success: false, message: 'Username dan pesan wajib diisi!' });
  }

  try {
    await ensureTablesExist();
    await pool.query(
      'INSERT INTO global_chats (username, message) VALUES (?, ?)',
      [username, message]
    );

    res.json({ success: true, message: 'Pesan berhasil terkirim!' });
  } catch (err) {
    console.error('Send Chat Error:', err);
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
