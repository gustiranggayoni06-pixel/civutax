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

// Konfigurasi Pool Database Aiven
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT) || 25547,
  ssl: { rejectUnauthorized: false },
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  connectTimeout: 10000 // Timeout 10 detik agar tidak menggantung
});

// Helper untuk pastikan tabel users ada
async function ensureTableExists() {
  const createTableQuery = `
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
  await pool.query(createTableQuery);
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
    await ensureTableExists();
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
    await ensureTableExists();

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
