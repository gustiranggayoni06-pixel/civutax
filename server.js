const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Fungsi Helper untuk membuat koneksi DB dengan SSL Aiven
function getDbConnection() {
  return mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    ssl: { rejectUnauthorized: false }
  });
}

// Fungsi Otomatis Pastikan Tabel users Ada
function ensureTableExists(db, callback) {
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
  db.query(createTableQuery, (err) => {
    if (err) console.error('Error auto-create table:', err);
    callback(err);
  });
}

// Root Route Test
app.get('/', (req, res) => {
  res.send('Server Backend CIVUTAX Berjalan Lancar!');
});

// Endpoint Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username dan password wajib diisi!' });
  }

  const db = getDbConnection();

  ensureTableExists(db, (tableErr) => {
    if (tableErr) {
      db.end();
      return res.status(500).json({ success: false, message: 'Gagal inisialisasi tabel database: ' + tableErr.message });
    }

    const query = 'SELECT * FROM users WHERE username = ? OR email = ?';
    db.query(query, [username, username], (err, results) => {
      db.end(); // Tutup koneksi serverless

      if (err) {
        console.error('Database Error:', err);
        return res.status(500).json({ success: false, message: 'Database Error: ' + err.message });
      }

      if (results.length === 0) {
        return res.status(401).json({ success: false, message: 'Username / Email tidak ditemukan!' });
      }

      const user = results[0];

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
    });
  });
});

// Endpoint Register
app.post('/api/register', (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ success: false, message: 'Semua kolom pendaftaran wajib diisi!' });
  }

  const db = getDbConnection();

  ensureTableExists(db, (tableErr) => {
    if (tableErr) {
      db.end();
      return res.status(500).json({ success: false, message: 'Gagal inisialisasi tabel database: ' + tableErr.message });
    }

    const checkUserQuery = 'SELECT * FROM users WHERE username = ? OR email = ?';
    db.query(checkUserQuery, [username, email], (err, results) => {
      if (err) {
        db.end();
        console.error('Database Error:', err);
        return res.status(500).json({ success: false, message: 'Database Error: ' + err.message });
      }

      if (results.length > 0) {
        db.end();
        return res.status(400).json({ success: false, message: 'Username atau Email sudah terdaftar!' });
      }

      const insertQuery = 'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)';
      db.query(insertQuery, [username, email, password, 'User'], (err, result) => {
        db.end();
        if (err) {
          console.error('Insert Error:', err);
          return res.status(500).json({ success: false, message: 'Gagal mendaftarkan akun: ' + err.message });
        }

        res.json({ success: true, message: 'Pendaftaran akun berhasil! Silakan login.' });
      });
    });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
