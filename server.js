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

// Konfigurasi Pool Database MySQL (TiDB Cloud / Aiven)
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
  connectTimeout: 10000
});

// Helper untuk memastikan tabel-tabel penting dibuat otomatis di MySQL
async function ensureTablesExist() {
  const createUsersTable = `
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(50) NOT NULL UNIQUE,
      email VARCHAR(100) UNIQUE,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(50) DEFAULT 'User',
      avatar_url TEXT,
      created_by VARCHAR(50),
      status VARCHAR(20) DEFAULT 'active',
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

  const createPendingSalesTable = `
    CREATE TABLE IF NOT EXISTS pending_sales (
      id INT AUTO_INCREMENT PRIMARY KEY,
      created_by VARCHAR(50) NOT NULL,
      creator_role VARCHAR(50),
      buyer_username VARCHAR(50) NOT NULL,
      buyer_password VARCHAR(255) NOT NULL,
      package_name VARCHAR(50) NOT NULL,
      package_price INT NOT NULL,
      tax_amount INT NOT NULL,
      status VARCHAR(30) DEFAULT 'pending_approval',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await pool.query(createUsersTable);
  await pool.query(createChatsTable);
  await pool.query(createPendingSalesTable);
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
        email: user.email || '',
        role: user.username.toLowerCase() === 'ranzz' ? 'Ranzz : DEVELOPER' : (user.role || 'User'),
        avatar_url: user.avatar_url || 'https://cdn.phototourl.com/member/2026-09-27-bfb1146c-714f-4bca-97ff-7eb50e41818b.jpg'
      }
    });
  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

// Endpoint Register User Biasa
app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username dan password wajib diisi!' });
  }

  try {
    await ensureTablesExist();

    const [existing] = await pool.query(
      'SELECT * FROM users WHERE username = ? OR email = ?',
      [username, email || '']
    );

    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: 'Username atau Email sudah terdaftar!' });
    }

    await pool.query(
      'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
      [username, email || null, password, 'User']
    );

    res.json({ success: true, message: 'Pendaftaran akun berhasil! Silakan login.' });
  } catch (err) {
    console.error('Register Error:', err);
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

// Cek Username Duplikat (Real-Time Check)
app.get('/api/users/check-username', async (req, res) => {
  const { username } = req.query;
  if (!username) return res.json({ exists: false });

  try {
    await ensureTablesExist();
    const [rowsUsers] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
    const [rowsPending] = await pool.query('SELECT id FROM pending_sales WHERE buyer_username = ? AND status = "pending_approval"', [username]);

    if (rowsUsers.length > 0 || rowsPending.length > 0) {
      return res.json({ exists: true });
    }
    res.json({ exists: false });
  } catch (err) {
    res.json({ exists: false });
  }
});

// ==========================================
// ENDPOINT PENJUALAN & ACC DEVELOPER (MYSQL)
// ==========================================

// 1. Pengajuan Akun Baru (Pending ACC)
app.post('/api/sales/request-approval', async (req, res) => {
  const { created_by, creator_role, buyer_username, buyer_password, package_name, package_price, tax_amount } = req.body;

  try {
    await ensureTablesExist();
    await pool.query(
      `INSERT INTO pending_sales (created_by, creator_role, buyer_username, buyer_password, package_name, package_price, tax_amount, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_approval')`,
      [created_by, creator_role, buyer_username, buyer_password, package_name, package_price, tax_amount]
    );

    res.json({ success: true, message: 'Berhasil dikirim ke antrean ACC Developer' });
  } catch (err) {
    console.error('Request Sales Error:', err);
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

// 2. Ambil Daftar Antrean Pending untuk Developer Ranzz
app.get('/api/sales/pending-list', async (req, res) => {
  try {
    await ensureTablesExist();
    const [rows] = await pool.query('SELECT * FROM pending_sales WHERE status = "pending_approval" ORDER BY id DESC');
    res.json({ success: true, requests: rows });
  } catch (err) {
    console.error('Pending List Error:', err);
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

// 3. Eksekusi ACC / Reject oleh Developer
app.post('/api/sales/approve', async (req, res) => {
  const { requestId, action } = req.body;

  try {
    await ensureTablesExist();
    const [rows] = await pool.query('SELECT * FROM pending_sales WHERE id = ?', [requestId]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Data pengajuan tidak ditemukan' });
    }

    const reqData = rows[0];

    if (action === 'approve') {
      // Simpan akun ke tabel users utama
      await pool.query(
        'INSERT INTO users (username, password, role, created_by, status) VALUES (?, ?, ?, ?, "active")',
        [reqData.buyer_username, reqData.buyer_password, reqData.package_name, reqData.created_by]
      );

      // Update status antrean menjadi approved
      await pool.query('UPDATE pending_sales SET status = "approved" WHERE id = ?', [requestId]);
    } else {
      // Update status antrean menjadi rejected
      await pool.query('UPDATE pending_sales SET status = "rejected" WHERE id = ?', [requestId]);
    }

    res.json({ success: true, message: 'Status berhasil diperbarui' });
  } catch (err) {
    console.error('Approve Error:', err);
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

// ==========================================
// ENDPOINT CHAT GLOBAL
// ==========================================

app.get('/api/chat/messages', async (req, res) => {
  try {
    await ensureTablesExist();
    const [rows] = await pool.query('SELECT * FROM global_chats ORDER BY id DESC LIMIT 50');
    res.json({ success: true, messages: rows.reverse() });
  } catch (err) {
    console.error('Fetch Chat Error:', err);
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

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
