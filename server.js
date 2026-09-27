const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();

// Konfigurasi CORS agar APK Android izinkan akses
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Koneksi ke Database Aiven MySQL
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  ssl: { rejectUnauthorized: false } // Diperlukan untuk Aiven Cloud
});

db.connect((err) => {
  if (err) {
    console.error('Koneksi Database Gagal:', err);
  } else {
    console.log('Terhubung ke Database Aiven MySQL!');
  }
});

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

  const query = 'SELECT * FROM users WHERE username = ? OR email = ?';
  db.query(query, [username, username], (err, results) => {
    if (err) {
      console.error('Database Error:', err);
      return res.status(500).json({ success: false, message: 'Terjadi kesalahan pada database server!' });
    }

    if (results.length === 0) {
      return res.status(401).json({ success: false, message: 'Username / Email tidak ditemukan!' });
    }

    const user = results[0];

    // Cek password
    if (user.password !== password) {
      return res.status(401).json({ success: false, message: 'Password salah!' });
    }

    // Login Berhasil
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

// Endpoint Register
app.post('/api/register', (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ success: false, message: 'Semua kolom pendaftaran wajib diisi!' });
  }

  const checkUserQuery = 'SELECT * FROM users WHERE username = ? OR email = ?';
  db.query(checkUserQuery, [username, email], (err, results) => {
    if (err) {
      console.error('Database Error:', err);
      return res.status(500).json({ success: false, message: 'Terjadi kesalahan server saat pengecekan!' });
    }

    if (results.length > 0) {
      return res.status(400).json({ success: false, message: 'Username atau Email sudah terdaftar!' });
    }

    const insertQuery = 'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)';
    db.query(insertQuery, [username, email, password, 'User'], (err, result) => {
      if (err) {
        console.error('Insert Error:', err);
        return res.status(500).json({ success: false, message: 'Gagal mendaftarkan akun!' });
      }

      res.json({ success: true, message: 'Pendaftaran akun berhasil!' });
    });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
