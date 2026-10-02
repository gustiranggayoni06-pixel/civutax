const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Api-Key', 'X-Secret']
}));

app.use(express.json());

// =========================================================================
// 📌 KONFIGURASI TELEGRAM
// =========================================================================
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8563757113:AAG1gW-Px-E-JzDDgQWlBbdYIyUdxXd6Ykk';
const DEV_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '5474893948';

// =========================================================================
// 📌 KONFIGURASI PAKASIR PAYMENT GATEWAY
// =========================================================================
const PAKASIR_SLUG = process.env.PAKASIR_SLUG || 'ranzz-digital';
const PAKASIR_API_KEY = process.env.PAKASIR_API_KEY || '2i31X6c9lLZURpm35lE74rcCzrFPJ9l9';
const PAKASIR_WEBHOOK_SECRET = process.env.PAKASIR_WEBHOOK_SECRET || '0d5564bdf239618d9fda45fcf7ffb51c';
const PAKASIR_BASE_URL = 'https://app.pakasir.com/api/v2';

// =========================================================================
// 📌 KONFIGURASI DATABASE MYSQL
// =========================================================================
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

// =========================================================================
// 📌 HELPER: ENSURE TABLES + MIGRASI OTOMATIS
// =========================================================================
async function ensureTablesExist() {
  const createUsersTable = `
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(50) NOT NULL UNIQUE,
      email VARCHAR(100) NULL DEFAULT NULL,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(50) DEFAULT 'User',
      avatar_url TEXT,
      created_by VARCHAR(50) DEFAULT 'system',
      status VARCHAR(20) DEFAULT 'active',
      connected_senders INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  const createChatsTable = `
    CREATE TABLE IF NOT EXISTS global_chats (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(50) NOT NULL,
      message TEXT NOT NULL,
      reply_to JSON NULL,
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

  const createWaPairingsTable = `
    CREATE TABLE IF NOT EXISTS wa_pairings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(50) NOT NULL,
      phone_number VARCHAR(20) NOT NULL,
      pairing_token VARCHAR(64) NOT NULL UNIQUE,
      status VARCHAR(20) DEFAULT 'active',
      paired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_user (username)
    )
  `;

  const createPakasirTable = `
    CREATE TABLE IF NOT EXISTS pakasir_transactions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      txn_id VARCHAR(50) UNIQUE,
      order_id VARCHAR(100) NOT NULL,
      type VARCHAR(20) NOT NULL,
      package_id VARCHAR(50),
      package_name VARCHAR(50),
      amount INT NOT NULL,
      fee INT DEFAULT 0,
      total_payment INT DEFAULT 0,
      payment_method VARCHAR(30),
      buyer_username VARCHAR(50) NOT NULL,
      buyer_password VARCHAR(255) NOT NULL,
      buyer_email VARCHAR(100),
      buyer_contact VARCHAR(30),
      status VARCHAR(20) DEFAULT 'pending',
      payment_data JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP NULL
    )
  `;

  await pool.query(createUsersTable);
  await pool.query(createChatsTable);
  await pool.query(createPendingSalesTable);
  await pool.query(createWaPairingsTable);
  await pool.query(createPakasirTable);

  // Migrasi kolom (abaikan error kalau sudah ada)
  try { await pool.query('ALTER TABLE users MODIFY COLUMN email VARCHAR(100) NULL DEFAULT NULL'); } catch (e) {}
  try { await pool.query('ALTER TABLE users ADD COLUMN status VARCHAR(20) DEFAULT "active"'); } catch (e) {}
  try { await pool.query('ALTER TABLE users ADD COLUMN created_by VARCHAR(50) DEFAULT "system"'); } catch (e) {}
  try { await pool.query('ALTER TABLE users ADD COLUMN connected_senders INT DEFAULT 0'); } catch (e) {}
  try { await pool.query('ALTER TABLE global_chats ADD COLUMN reply_to JSON NULL'); } catch (e) {}
}

// =========================================================================
// 📌 HELPER TELEGRAM
// =========================================================================
async function sendTelegramMessage(chatId, text, replyMarkup = null) {
  try {
    const payload = { chat_id: chatId, text: text, parse_mode: 'Markdown' };
    if (replyMarkup) payload.reply_markup = replyMarkup;

    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error('Telegram Send Error:', err.message);
  }
}

async function sendTelegramNotification(pendingData) {
  const messageText = 
    `⚡ *PENGAJUAN AKUN BARU (NEED ACC)* ⚡\n\n` +
    `• *Pemohon*: ${pendingData.created_by} (${pendingData.creator_role || 'User'})\n` +
    `• *Username Akun*: \`${pendingData.buyer_username}\`\n` +
    `• *Password*: \`${pendingData.buyer_password}\`\n` +
    `• *Paket*: ${pendingData.package_name}\n` +
    `• *Harga*: Rp${Number(pendingData.package_price).toLocaleString('id-ID')}\n` +
    `• *Pajak (10%)*: Rp${Number(pendingData.tax_amount).toLocaleString('id-ID')}\n\n` +
    `Pilih tindakan di bawah ini untuk memproses:`;

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '✅ ACC / Aktifkan', callback_data: `acc_${pendingData.id}` },
        { text: '❌ Tolak / Reject', callback_data: `reject_${pendingData.id}` }
      ]
    ]
  };

  await sendTelegramMessage(DEV_CHAT_ID, messageText, replyMarkup);
}

// =========================================================================
// 📌 ROOT ROUTE
// =========================================================================
app.get('/', (req, res) => {
  res.send('Server Backend CIVUTAX Berjalan Lancar!');
});

// =========================================================================
// 📌 TELEGRAM WEBHOOK SETUP
// =========================================================================
app.get('/api/telegram/set-webhook', async (req, res) => {
  const webhookUrl = `https://${req.headers.host}/api/telegram/webhook`;
  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${webhookUrl}`);
    const data = await response.json();
    res.json({ success: true, webhook_url: webhookUrl, telegram_response: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// =========================================================================
// 📌 AUTH: LOGIN & REGISTER
// =========================================================================
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, message: 'Username dan password wajib diisi!' });

  try {
    await ensureTablesExist();
    const [rows] = await pool.query('SELECT * FROM users WHERE username = ? OR email = ?', [username, username]);

    if (rows.length === 0) return res.status(401).json({ success: false, message: 'Username / Email tidak ditemukan!' });

    const user = rows[0];
    if (user.password !== password) return res.status(401).json({ success: false, message: 'Password salah!' });

    res.json({
      success: true,
      message: 'Login berhasil!',
      user: {
        id: user.id,
        username: user.username,
        email: user.email || '',
        role: user.username.toLowerCase() === 'ranzz' ? 'Ranzz : DEVELOPER' : (user.role || 'User'),
        avatar_url: user.avatar_url || 'https://cdn.phototourl.com/member/2026-09-27-bfb1146c-714f-4bca-97ff-7eb50e41818b.jpg',
        connected_senders: user.connected_senders || 0,
        created_at: user.created_at
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, message: 'Username dan password wajib diisi!' });

  try {
    await ensureTablesExist();
    const [existing] = await pool.query('SELECT * FROM users WHERE username = ? OR email = ?', [username, email || '']);

    if (existing.length > 0) return res.status(400).json({ success: false, message: 'Username atau Email sudah terdaftar!' });

    await pool.query('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)', [username, email || null, password, 'User']);
    res.json({ success: true, message: 'Pendaftaran akun berhasil! Silakan login.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

// =========================================================================
// 📌 USER MANAGEMENT
// =========================================================================
app.get('/api/users/all', async (req, res) => {
  try {
    await ensureTablesExist();
    const [rows] = await pool.query('SELECT id, username, password, role, created_by, status, connected_senders, created_at FROM users ORDER BY id DESC');
    res.json({ success: true, users: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

app.post('/api/users/change-password', async (req, res) => {
  const { username, oldPassword, newPassword, requested_by, requested_role } = req.body;

  if (!username || !newPassword) {
    return res.status(400).json({ success: false, message: 'Username target dan password baru wajib diisi!' });
  }

  try {
    await ensureTablesExist();
    const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Pengguna target tidak ditemukan!' });
    }

    const targetUser = rows[0];
    const reqUser = (requested_by || username).toLowerCase();
    const reqRole = (requested_role || '').toLowerCase();

    const isSelfChange = reqUser === username.toLowerCase();
    const hasPrivilege = ['ranzz', 'developer', 'reseller', 'partner', 'owner', 'own', 'full up'].some(r => reqRole.includes(r) || reqUser === 'ranzz');

    if (isSelfChange && !hasPrivilege) {
      if (!oldPassword) return res.status(400).json({ success: false, message: 'Password lama wajib diisi!' });
      if (targetUser.password !== oldPassword) return res.status(400).json({ success: false, message: 'Password saat ini (password lama) salah!' });
    }

    await pool.query('UPDATE users SET password = ? WHERE username = ?', [newPassword, username]);
    res.json({ success: true, message: `Password untuk akun '${username}' berhasil diperbarui!` });
  } catch (err) {
    console.error('Change Password Error:', err);
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

app.post('/api/users/delete', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ success: false, message: 'Username target wajib diisi!' });

  try {
    await ensureTablesExist();
    const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);

    if (rows.length === 0) return res.status(404).json({ success: false, message: `Username '${username}' tidak ditemukan di database!` });

    await pool.query('DELETE FROM users WHERE username = ?', [username]);
    res.json({ success: true, message: `Akun '${username}' berhasil dihapus secara permanen dari database!` });
  } catch (err) {
    console.error('Delete User Error:', err);
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

app.get('/api/users/check-username', async (req, res) => {
  const { username } = req.query;
  if (!username) return res.json({ exists: false });

  try {
    await ensureTablesExist();
    const [rowsUsers] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
    const [rowsPending] = await pool.query('SELECT id FROM pending_sales WHERE buyer_username = ? AND status = "pending_approval"', [username]);
    const [rowsPakasir] = await pool.query('SELECT id FROM pakasir_transactions WHERE buyer_username = ? AND status = "pending"', [username]);

    res.json({ exists: rowsUsers.length > 0 || rowsPending.length > 0 || rowsPakasir.length > 0 });
  } catch (err) {
    res.json({ exists: false });
  }
});

// =========================================================================
// 📌 SALES / PENJUALAN MANUAL
// =========================================================================
app.post('/api/sales/request-approval', async (req, res) => {
  const { created_by, creator_role, buyer_username, buyer_password, package_name, package_price, tax_amount } = req.body;

  try {
    await ensureTablesExist();
    const [result] = await pool.query(
      `INSERT INTO pending_sales (created_by, creator_role, buyer_username, buyer_password, package_name, package_price, tax_amount, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_approval')`,
      [created_by, creator_role, buyer_username, buyer_password, package_name, package_price, tax_amount]
    );

    sendTelegramNotification({
      id: result.insertId,
      created_by, creator_role, buyer_username, buyer_password,
      package_name, package_price, tax_amount
    });

    res.json({ success: true, message: 'Berhasil dikirim ke antrean ACC Developer & Telegram!' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

app.get('/api/sales/pending-list', async (req, res) => {
  try {
    await ensureTablesExist();
    const [rows] = await pool.query('SELECT * FROM pending_sales ORDER BY id DESC');
    res.json({ success: true, requests: rows, data: rows, sales: rows, list: rows, result: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

app.post('/api/sales/delete', async (req, res) => {
  const { requestId, requested_by } = req.body;
  if (!requestId) return res.status(400).json({ success: false, message: 'requestId wajib diisi!' });

  try {
    await ensureTablesExist();
    const [rows] = await pool.query('SELECT id FROM pending_sales WHERE id = ?', [requestId]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: `Log dengan ID #${requestId} tidak ditemukan!` });

    await pool.query('DELETE FROM pending_sales WHERE id = ?', [requestId]);
    res.json({ success: true, message: `Log #${requestId} berhasil dihapus!` });
  } catch (err) {
    console.error('Delete sales log error:', err);
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

app.post('/api/sales/delete-all', async (req, res) => {
  const { requested_by } = req.body;
  if (!requested_by || String(requested_by).toLowerCase() !== 'ranzz') {
    return res.status(403).json({ success: false, message: 'Akses ditolak! Hanya Ranzz yang bisa menghapus semua log.' });
  }

  try {
    await ensureTablesExist();
    const [result] = await pool.query('DELETE FROM pending_sales');
    res.json({ success: true, message: `Semua log berhasil dihapus (${result.affectedRows} entri)!`, affected: result.affectedRows });
  } catch (err) {
    console.error('Delete all sales log error:', err);
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

app.post('/api/sales/approve', async (req, res) => {
  const { requestId, action } = req.body;

  try {
    await ensureTablesExist();
    const [rows] = await pool.query('SELECT * FROM pending_sales WHERE id = ?', [requestId]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Data pengajuan tidak ditemukan' });

    const reqData = rows[0];
    if (reqData.status !== 'pending_approval') {
      return res.status(400).json({ success: false, message: 'Pengajuan ini sudah pernah diproses!' });
    }

    if (action === 'approve') {
      const [existingUser] = await pool.query('SELECT id FROM users WHERE username = ?', [reqData.buyer_username]);
      
      if (existingUser.length > 0) {
        await pool.query('UPDATE pending_sales SET status = "approved" WHERE id = ?', [requestId]);
        return res.json({ success: true, message: 'Username sudah aktif terdaftar sebelumnya, status diperbarui ke Approved!' });
      }

      try {
        const generatedEmail = `${reqData.buyer_username.toLowerCase()}@civutax.com`;
        await pool.query(
          'INSERT INTO users (username, email, password, role, created_by, status) VALUES (?, ?, ?, ?, ?, "active")', 
          [reqData.buyer_username, generatedEmail, reqData.buyer_password, reqData.package_name, reqData.created_by]
        );
      } catch (insertErr) {
        console.warn('Fallback query:', insertErr.message);
        await pool.query(
          'INSERT INTO users (username, password, role) VALUES (?, ?, ?)', 
          [reqData.buyer_username, reqData.buyer_password, reqData.package_name]
        );
      }

      await pool.query('UPDATE pending_sales SET status = "approved" WHERE id = ?', [requestId]);
    } else {
      await pool.query('UPDATE pending_sales SET status = "rejected" WHERE id = ?', [requestId]);
    }

    res.json({ success: true, message: 'Status berhasil diperbarui' });
  } catch (err) {
    console.error('Approve Error:', err);
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

// =========================================================================
// 📌 PAKASIR PAYMENT GATEWAY ENDPOINTS
// =========================================================================

// ✅ 1. Buat transaksi baru (dipanggil dari index.html)
app.post('/api/pakasir/create', async (req, res) => {
  const { order_id, type, package_id, package_name, amount, method, buyer } = req.body;

  if (!order_id || !type || !amount || !buyer || !buyer.username || !buyer.password) {
    return res.status(400).json({ success: false, message: 'Data tidak lengkap!' });
  }

  try {
    await ensureTablesExist();

    // Cek username sudah ada atau tidak
    const [existing] = await pool.query('SELECT id FROM users WHERE username = ?', [buyer.username]);
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: 'Username sudah terdaftar!' });
    }

    // Panggil API Pakasir v2
    const pakasirRes = await fetch(`${PAKASIR_BASE_URL}/create-transaction/${PAKASIR_SLUG}/${order_id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': PAKASIR_API_KEY
      },
      body: JSON.stringify({ method, amount })
    });

    const pakasirData = await pakasirRes.json();

    if (!pakasirData.txn_id) {
      console.error('[PAKASIR] Response error:', pakasirData);
      return res.status(500).json({
        success: false,
        message: 'Pakasir error: ' + (pakasirData.message || JSON.stringify(pakasirData))
      });
    }

    // Simpan transaksi ke DB
    await pool.query(
      `INSERT INTO pakasir_transactions 
        (txn_id, order_id, type, package_id, package_name, amount, fee, total_payment, payment_method, 
         buyer_username, buyer_password, buyer_email, buyer_contact, status, payment_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        pakasirData.txn_id, order_id, type, package_id, package_name, amount,
        pakasirData.fee || 0, pakasirData.total_payment || amount,
        method, buyer.username, buyer.password, buyer.email || null, buyer.contact || null,
        JSON.stringify(pakasirData)
      ]
    );

    console.log(`[PAKASIR] ✅ Transaksi baru: ${pakasirData.txn_id} - ${buyer.username} - Rp${amount}`);

    // Notif Telegram transaksi baru
    sendTelegramMessage(
      DEV_CHAT_ID,
      `💳 *TRANSAKSI BARU PAKASIR*\n\n` +
      `• Order ID: \`${order_id}\`\n` +
      `• Txn ID: \`${pakasirData.txn_id}\`\n` +
      `• User: \`${buyer.username}\`\n` +
      `• Paket: ${package_name}\n` +
      `• Total: Rp${(pakasirData.total_payment || amount).toLocaleString('id-ID')}\n` +
      `• Metode: ${method}\n` +
      `• Status: ⏳ *Pending*`
    ).catch(() => {});

    res.json({
      success: true,
      txn_id: pakasirData.txn_id,
      order_id: pakasirData.order_id || order_id,
      amount: pakasirData.amount || amount,
      fee: pakasirData.fee || 0,
      total_payment: pakasirData.total_payment || amount,
      payment_method: pakasirData.payment_method || method,
      qr_string: pakasirData.qr_string || null,
      va_number: pakasirData.va_number || null,
      payment_link: pakasirData.payment_link || null,
      expired_at: pakasirData.expired_at || null
    });

  } catch (err) {
    console.error('Pakasir create error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ✅ 2. Cek status transaksi (dipanggil dari polling index.html)
app.get('/api/pakasir/status/:txn_id', async (req, res) => {
  const { txn_id } = req.params;

  try {
    await ensureTablesExist();

    // Ambil dari DB
    const [rows] = await pool.query('SELECT * FROM pakasir_transactions WHERE txn_id = ?', [txn_id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan' });
    }

    const localTxn = rows[0];

    // Kalau sudah completed di lokal, langsung return
    if (localTxn.status === 'completed') {
      return res.json({ success: true, status: 'completed', completed_at: localTxn.completed_at });
    }

    // Cek ke Pakasir
    const pakasirRes = await fetch(`${PAKASIR_BASE_URL}/transaction-status/${PAKASIR_SLUG}/${txn_id}`, {
      headers: { 'X-Api-Key': PAKASIR_API_KEY }
    });
    const pakasirData = await pakasirRes.json();

    // Update status di DB kalau berubah
    if (pakasirData.status && pakasirData.status !== localTxn.status) {
      await pool.query(
        'UPDATE pakasir_transactions SET status = ?, completed_at = ? WHERE txn_id = ?',
        [pakasirData.status, pakasirData.completed_at || null, txn_id]
      );

      // Kalau completed → auto-create user
      if (pakasirData.status === 'completed') {
        await autoCreateUserFromTxn(localTxn);
      }
    }

    res.json({
      success: true,
      status: pakasirData.status || localTxn.status,
      completed_at: pakasirData.completed_at || null
    });

  } catch (err) {
    console.error('Pakasir status error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ✅ 3. Webhook dari Pakasir (real-time notif)
app.post('/api/pakasir/webhook', async (req, res) => {
  const secret = req.headers['x-secret'];
  const { txn_id, order_id, amount, status, completed_at, is_sandbox } = req.body;

  console.log(`[PAKASIR WEBHOOK] txn_id=${txn_id} status=${status} secret=${secret ? 'RECEIVED' : 'MISSING'}`);

  if (secret !== PAKASIR_WEBHOOK_SECRET) {
    console.warn('[PAKASIR WEBHOOK] ❌ Invalid secret!');
    return res.status(403).json({ success: false, message: 'Invalid webhook secret' });
  }

  try {
    await ensureTablesExist();

    const [rows] = await pool.query('SELECT * FROM pakasir_transactions WHERE txn_id = ?', [txn_id]);
    if (rows.length === 0) {
      console.warn(`[PAKASIR WEBHOOK] ⚠️ Transaksi ${txn_id} tidak ditemukan di DB`);
      return res.sendStatus(200);
    }

    const localTxn = rows[0];

    if (status === 'completed' && localTxn.status !== 'completed') {
      await pool.query(
        'UPDATE pakasir_transactions SET status = "completed", completed_at = ? WHERE txn_id = ?',
        [completed_at || new Date(), txn_id]
      );

      await autoCreateUserFromTxn(localTxn);

      console.log(`[PAKASIR WEBHOOK] ✅ Transaksi ${txn_id} COMPLETED & user auto-created`);
    } else if (status === 'canceled') {
      await pool.query('UPDATE pakasir_transactions SET status = "canceled" WHERE txn_id = ?', [txn_id]);
      console.log(`[PAKASIR WEBHOOK] ⛔ Transaksi ${txn_id} CANCELED`);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Pakasir webhook error:', err);
    res.sendStatus(500);
  }
});

// ✅ 4. Auto-create user setelah pembayaran sukses
async function autoCreateUserFromTxn(txn) {
  try {
    // Cek user sudah ada
    const [existing] = await pool.query('SELECT id FROM users WHERE username = ?', [txn.buyer_username]);
    if (existing.length > 0) {
      console.log(`[AUTO-CREATE] User ${txn.buyer_username} sudah ada, skip.`);
      return;
    }

    // Tentukan role berdasarkan type & package
    let role = 'User';
    let durationText = txn.package_name;

    if (txn.type === 'new_acc') {
      if (txn.package_id === 'harian') { role = 'Harian (1 Hari)'; }
      else if (txn.package_id === 'mingguan') { role = 'Mingguan'; }
      else if (txn.package_id === 'bulanan') { role = 'Bulanan'; }
      else { role = 'Harian (1 Hari)'; }
    } else if (txn.type === 'up_role') {
      role = txn.package_name; // Full Up, Reseller, Partner, Owner
    }

    const generatedEmail = txn.buyer_email || `${txn.buyer_username.toLowerCase()}@civutax.com`;

    await pool.query(
      `INSERT INTO users (username, email, password, role, created_by, status) 
       VALUES (?, ?, ?, ?, 'pakasir-auto', 'active')`,
      [txn.buyer_username, generatedEmail, txn.buyer_password, role]
    );

    console.log(`[AUTO-CREATE] ✅ User ${txn.buyer_username} berhasil dibuat dengan role ${role}`);

    // Notif Telegram sukses
    sendTelegramMessage(
      DEV_CHAT_ID,
      `🎉 *PEMBELIAN BERHASIL VIA PAKASIR!*\n\n` +
      `• Tipe: *${txn.type === 'new_acc' ? 'Akun Baru' : 'Upgrade Role'}*\n` +
      `• Username: \`${txn.buyer_username}\`\n` +
      `• Password: \`${txn.buyer_password}\`\n` +
      `• Paket: ${txn.package_name}\n` +
      `• Role Aktif: *${role}*\n` +
      `• Total Bayar: Rp${Number(txn.total_payment).toLocaleString('id-ID')}\n` +
      `• Metode: ${txn.payment_method}\n` +
      `• Kontak: ${txn.buyer_contact || '-'}\n` +
      `• Order ID: \`${txn.order_id}\`\n\n` +
      `✅ Akun otomatis aktif & siap login!`
    ).catch(() => {});

  } catch (err) {
    console.error('Auto create user error:', err);
  }
}

// ✅ 5. Cek biaya admin (opsional - proxy ke Pakasir)
app.get('/api/pakasir/fee/:amount', async (req, res) => {
  const { amount } = req.params;
  try {
    const pakasirRes = await fetch(`${PAKASIR_BASE_URL}/payment-fee/${amount}`);
    const data = await pakasirRes.json();
    res.json({ success: true, fees: data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ✅ 6. Ambil riwayat transaksi Pakasir (khusus developer)
app.get('/api/pakasir/transactions', async (req, res) => {
  const { username } = req.query;
  try {
    await ensureTablesExist();
    const [rows] = await pool.query(
      'SELECT * FROM pakasir_transactions ORDER BY id DESC LIMIT 100'
    );
    res.json({ success: true, transactions: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// =========================================================================
// 📌 WHATSAPP PAIRING VIA TERMUX
// =========================================================================

app.post('/api/whatsapp/register-paired', async (req, res) => {
  const { username, phone_number, pairing_token, paired_at } = req.body;

  if (!username || !phone_number || !pairing_token) {
    return res.status(400).json({ success: false, message: 'Data tidak lengkap!' });
  }

  if (String(pairing_token).length < 20) {
    return res.status(400).json({ success: false, message: 'Format token tidak valid!' });
  }

  let cleanPhone = String(phone_number).replace(/\D/g, '');
  if (cleanPhone.startsWith('0')) cleanPhone = '62' + cleanPhone.slice(1);
  if (cleanPhone.startsWith('8')) cleanPhone = '62' + cleanPhone;

  try {
    await ensureTablesExist();

    await pool.query(
      `INSERT INTO wa_pairings (username, phone_number, pairing_token, status)
       VALUES (?, ?, ?, 'active')
       ON DUPLICATE KEY UPDATE 
         phone_number = VALUES(phone_number),
         pairing_token = VALUES(pairing_token),
         status = 'active',
         paired_at = CURRENT_TIMESTAMP`,
      [username, cleanPhone, pairing_token]
    );

    await pool.query(
      'UPDATE users SET connected_senders = COALESCE(connected_senders, 0) + 1 WHERE username = ?',
      [username]
    ).catch(() => {});

    console.log(`[TERMUX PAIRING] ✅ ${username} - ${cleanPhone} tersambung`);

    sendTelegramMessage(
      DEV_CHAT_ID,
      `📲 *PAIRING BARU VIA TERMUX*\n\n` +
      `• User: *${username}*\n` +
      `• Nomor: \`${cleanPhone}\`\n` +
      `• Token: \`${pairing_token.substring(0, 12)}...\`\n` +
      `• Waktu: ${new Date().toLocaleString('id-ID')}`
    ).catch(() => {});

    res.json({ success: true, message: 'Pairing tercatat di server!', phone: cleanPhone });
  } catch (err) {
    console.error('Register paired error:', err);
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

app.post('/api/whatsapp/verify-pairing', async (req, res) => {
  const { username, pairing_token } = req.body;

  if (!username || !pairing_token) {
    return res.status(400).json({ success: false, message: 'username & pairing_token wajib!' });
  }

  try {
    await ensureTablesExist();
    const [rows] = await pool.query(
      'SELECT * FROM wa_pairings WHERE pairing_token = ? AND status = "active"',
      [pairing_token]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Token tidak valid / sudah expired!' });
    }

    const pairing = rows[0];

    if (pairing.username !== username) {
      await pool.query('UPDATE wa_pairings SET username = ? WHERE id = ?', [username, pairing.id]);
    }

    res.json({
      success: true,
      message: 'Token valid!',
      phone_number: pairing.phone_number,
      paired_at: pairing.paired_at,
      username: pairing.username
    });
  } catch (err) {
    console.error('Verify pairing error:', err);
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

app.post('/api/whatsapp/unpair', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ success: false, message: 'username wajib!' });

  try {
    await ensureTablesExist();
    await pool.query('UPDATE wa_pairings SET status = "disconnected" WHERE username = ?', [username]);
    await pool.query(
      'UPDATE users SET connected_senders = GREATEST(COALESCE(connected_senders,0) - 1, 0) WHERE username = ?',
      [username]
    ).catch(() => {});

    console.log(`[TERMUX PAIRING] ⛔ ${username} diputuskan`);
    res.json({ success: true, message: 'Perangkat berhasil diputuskan.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

app.get('/api/whatsapp/pair-status', async (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ success: false, message: 'username wajib!' });

  try {
    await ensureTablesExist();
    const [rows] = await pool.query('SELECT * FROM wa_pairings WHERE username = ? LIMIT 1', [username]);

    if (rows.length === 0) {
      return res.json({ success: true, status: 'not_found', connected: false });
    }

    const data = rows[0];
    res.json({
      success: true,
      status: data.status,
      connected: data.status === 'active',
      phone: data.phone_number,
      paired_at: data.paired_at
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

// =========================================================================
// 📌 TELEGRAM WEBHOOK
// =========================================================================
app.post('/api/telegram/webhook', async (req, res) => {
  const { message, callback_query } = req.body;

  try {
    await ensureTablesExist();

    if (message && message.text) {
      const chatId = String(message.chat.id);
      const text = message.text.trim();

      if (chatId !== DEV_CHAT_ID) {
        await sendTelegramMessage(chatId, "❌ Akses Ditolak! Anda bukan Developer Ranzz.");
        return res.sendStatus(200);
      }

      if (text === '/start' || text === '/menu') {
        const startMenu = 
          `👑 *BOT KONTROL PANEL CIVUTAX DEVELOPER*\n\n` +
          `Halo Developer *Ranzz*!\n\n` +
          `*Daftar Perintah:*\n` +
          `• /pending - Cek antrean akun butuh ACC\n` +
          `• /stats - Cek statistik total user & penjualan\n` +
          `• /clearchat - Bersihkan seluruh Chat Global\n` +
          `• /clearlogs - Hapus SEMUA log pengajuan ACC\n` +
          `• /wapairing - Cek semua user WA yang tersambung\n` +
          `• /pakasir - Cek riwayat transaksi Pakasir\n` +
          `• /help - Bantuan & panduan bot`;

        const keyboard = {
          inline_keyboard: [
            [{ text: '📋 Cek Antrean ACC', callback_data: 'cmd_pending' }],
            [{ text: '📊 Statistik Sistem', callback_data: 'cmd_stats' }],
            [{ text: '📲 WA Tersambung', callback_data: 'cmd_wa_list' }],
            [{ text: '💳 Transaksi Pakasir', callback_data: 'cmd_pakasir' }],
            [{ text: '🗑️ Bersihkan Chat Global', callback_data: 'cmd_clear_chat' }],
            [{ text: '💥 Hapus Semua Log ACC', callback_data: 'cmd_clear_logs' }]
          ]
        };

        await sendTelegramMessage(chatId, startMenu, keyboard);
      } else if (text === '/pending') {
        const [rows] = await pool.query('SELECT * FROM pending_sales WHERE status = "pending_approval" ORDER BY id DESC');
        if (rows.length === 0) {
          await sendTelegramMessage(chatId, "✅ Tidak ada antrean pengajuan akun baru saat ini.");
        } else {
          for (const pendingData of rows) await sendTelegramNotification(pendingData);
        }
      } else if (text === '/stats') {
        const [usersCount] = await pool.query('SELECT COUNT(*) as total FROM users');
        const [pendingCount] = await pool.query('SELECT COUNT(*) as total FROM pending_sales WHERE status = "pending_approval"');
        const [approvedCount] = await pool.query('SELECT COUNT(*) as total FROM pending_sales WHERE status = "approved"');
        const [totalLogs] = await pool.query('SELECT COUNT(*) as total FROM pending_sales');
        const [waCount] = await pool.query('SELECT COUNT(*) as total FROM wa_pairings WHERE status = "active"');
        const [pakasirCount] = await pool.query('SELECT COUNT(*) as total FROM pakasir_transactions WHERE status = "completed"');

        const statsMsg = 
          `📊 *STATISTIK SISTEM CIVUTAX*\n\n` +
          `• Total Akun Terdaftar: *${usersCount[0].total}*\n` +
          `• Total Akun Di-ACC: *${approvedCount[0].total}*\n` +
          `• Antrean Menunggu ACC: *${pendingCount[0].total}*\n` +
          `• Total Log Tersimpan: *${totalLogs[0].total}*\n` +
          `• WA Pairing Aktif: *${waCount[0].total}*\n` +
          `• Transaksi Pakasir Sukses: *${pakasirCount[0].total}*`;

        await sendTelegramMessage(chatId, statsMsg);
      } else if (text === '/wapairing') {
        const [rows] = await pool.query('SELECT * FROM wa_pairings WHERE status = "active" ORDER BY paired_at DESC LIMIT 20');
        if (rows.length === 0) {
          await sendTelegramMessage(chatId, "📭 Belum ada user yang pairing WA via Termux.");
        } else {
          let listText = `📲 *DAFTAR WA PAIRING AKTIF* (${rows.length})\n\n`;
          rows.forEach((w, i) => {
            listText += `${i + 1}. *${w.username}*\n   • Nomor: \`${w.phone_number}\`\n   • Pairing: ${new Date(w.paired_at).toLocaleString('id-ID')}\n\n`;
          });
          await sendTelegramMessage(chatId, listText);
        }
      } else if (text === '/pakasir') {
        const [rows] = await pool.query('SELECT * FROM pakasir_transactions ORDER BY id DESC LIMIT 10');
        if (rows.length === 0) {
          await sendTelegramMessage(chatId, "💳 Belum ada transaksi Pakasir.");
        } else {
          let listText = `💳 *10 TRANSAKSI PAKASIR TERBARU*\n\n`;
          rows.forEach((t, i) => {
            const emoji = t.status === 'completed' ? '✅' : (t.status === 'pending' ? '⏳' : '❌');
            listText += `${i + 1}. ${emoji} *${t.buyer_username}*\n   • ${t.package_name} • Rp${Number(t.amount).toLocaleString('id-ID')}\n   • ${t.payment_method} • \`${t.txn_id}\`\n\n`;
          });
          await sendTelegramMessage(chatId, listText);
        }
      } else if (text === '/clearchat') {
        await pool.query('DELETE FROM global_chats');
        await sendTelegramMessage(chatId, "🗑️ *Seluruh riwayat Chat Global berhasil dibersihkan!*");
      } else if (text === '/clearlogs') {
        const [result] = await pool.query('DELETE FROM pending_sales');
        await sendTelegramMessage(chatId, `💥 *SEMUA LOG PENGAJUAN ACC BERHASIL DIHAPUS!*\n\nTotal log yang dihapus: *${result.affectedRows}* entri.`);
      } else if (text === '/help') {
        await sendTelegramMessage(chatId, "ℹ️ *Panduan:* Gunakan tombol interaktif atau ketik /start untuk membuka kontrol panel utama.");
      }
    }

    if (callback_query) {
      const data = callback_query.data;
      const chatId = callback_query.message.chat.id;
      const messageId = callback_query.message.message_id;

      if (data.startsWith('acc_') || data.startsWith('reject_')) {
        const [action, requestId] = data.split('_');
        const [rows] = await pool.query('SELECT * FROM pending_sales WHERE id = ?', [requestId]);

        if (rows.length > 0) {
          const reqData = rows[0];

          if (reqData.status !== 'pending_approval') {
            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId, message_id: messageId,
                text: `⚠️ *PENGAJUAN INI SUDAH PERNAH DIPROSES SEBELUMNYA!*`,
                parse_mode: 'Markdown'
              })
            });
            return res.sendStatus(200);
          }

          if (action === 'acc') {
            const [existingUser] = await pool.query('SELECT id FROM users WHERE username = ?', [reqData.buyer_username]);
            if (existingUser.length === 0) {
              try {
                const generatedEmail = `${reqData.buyer_username.toLowerCase()}@civutax.com`;
                await pool.query(
                  'INSERT INTO users (username, email, password, role, created_by, status) VALUES (?, ?, ?, ?, ?, "active")',
                  [reqData.buyer_username, generatedEmail, reqData.buyer_password, reqData.package_name, reqData.created_by]
                );
              } catch (insertErr) {
                await pool.query(
                  'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
                  [reqData.buyer_username, reqData.buyer_password, reqData.package_name]
                );
              }
            }
            
            await pool.query('UPDATE pending_sales SET status = "approved" WHERE id = ?', [requestId]);

            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId, message_id: messageId,
                text: `✅ *AKUN BERHASIL DI-ACC & AKTIF!*\n\n• Username: \`${reqData.buyer_username}\`\n• Password: \`${reqData.buyer_password}\`\n• Paket: ${reqData.package_name}\n• Diproses oleh: Developer Ranzz (via Telegram)`,
                parse_mode: 'Markdown'
              })
            });
          } else if (action === 'reject') {
            await pool.query('UPDATE pending_sales SET status = "rejected" WHERE id = ?', [requestId]);

            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId, message_id: messageId,
                text: `❌ *PENGAJUAN DITOLAK!*\n\n• Username: \`${reqData.buyer_username}\``,
                parse_mode: 'Markdown'
              })
            });
          }
        }
      } else if (data === 'cmd_pending') {
        const [rows] = await pool.query('SELECT * FROM pending_sales WHERE status = "pending_approval" ORDER BY id DESC');
        if (rows.length === 0) {
          await sendTelegramMessage(chatId, "✅ Tidak ada antrean pengajuan akun baru saat ini.");
        } else {
          for (const pendingData of rows) await sendTelegramNotification(pendingData);
        }
      } else if (data === 'cmd_stats') {
        const [usersCount] = await pool.query('SELECT COUNT(*) as total FROM users');
        const [pendingCount] = await pool.query('SELECT COUNT(*) as total FROM pending_sales WHERE status = "pending_approval"');
        const [approvedCount] = await pool.query('SELECT COUNT(*) as total FROM pending_sales WHERE status = "approved"');
        const [totalLogs] = await pool.query('SELECT COUNT(*) as total FROM pending_sales');
        const [waCount] = await pool.query('SELECT COUNT(*) as total FROM wa_pairings WHERE status = "active"');
        const [pakasirCount] = await pool.query('SELECT COUNT(*) as total FROM pakasir_transactions WHERE status = "completed"');

        const statsMsg = 
          `📊 *STATISTIK SISTEM CIVUTAX*\n\n` +
          `• Total Akun Terdaftar: *${usersCount[0].total}*\n` +
          `• Total Akun Di-ACC: *${approvedCount[0].total}*\n` +
          `• Antrean Menunggu ACC: *${pendingCount[0].total}*\n` +
          `• Total Log Tersimpan: *${totalLogs[0].total}*\n` +
          `• WA Pairing Aktif: *${waCount[0].total}*\n` +
          `• Transaksi Pakasir Sukses: *${pakasirCount[0].total}*`;

        await sendTelegramMessage(chatId, statsMsg);
      } else if (data === 'cmd_wa_list') {
        const [rows] = await pool.query('SELECT * FROM wa_pairings WHERE status = "active" ORDER BY paired_at DESC LIMIT 20');
        if (rows.length === 0) {
          await sendTelegramMessage(chatId, "📭 Belum ada user yang pairing WA via Termux.");
        } else {
          let listText = `📲 *DAFTAR WA PAIRING AKTIF* (${rows.length})\n\n`;
          rows.forEach((w, i) => {
            listText += `${i + 1}. *${w.username}*\n   • Nomor: \`${w.phone_number}\`\n   • Pairing: ${new Date(w.paired_at).toLocaleString('id-ID')}\n\n`;
          });
          await sendTelegramMessage(chatId, listText);
        }
      } else if (data === 'cmd_pakasir') {
        const [rows] = await pool.query('SELECT * FROM pakasir_transactions ORDER BY id DESC LIMIT 10');
        if (rows.length === 0) {
          await sendTelegramMessage(chatId, "💳 Belum ada transaksi Pakasir.");
        } else {
          let listText = `💳 *10 TRANSAKSI PAKASIR TERBARU*\n\n`;
          rows.forEach((t, i) => {
            const emoji = t.status === 'completed' ? '✅' : (t.status === 'pending' ? '⏳' : '❌');
            listText += `${i + 1}. ${emoji} *${t.buyer_username}*\n   • ${t.package_name} • Rp${Number(t.amount).toLocaleString('id-ID')}\n   • ${t.payment_method} • \`${t.txn_id}\`\n\n`;
          });
          await sendTelegramMessage(chatId, listText);
        }
      } else if (data === 'cmd_clear_chat') {
        await pool.query('DELETE FROM global_chats');
        await sendTelegramMessage(chatId, "🗑️ *Seluruh riwayat Chat Global berhasil dibersihkan!*");
      } else if (data === 'cmd_clear_logs') {
        const [result] = await pool.query('DELETE FROM pending_sales');
        await sendTelegramMessage(chatId, `💥 *SEMUA LOG PENGAJUAN ACC BERHASIL DIHAPUS!*\n\nTotal log yang dihapus: *${result.affectedRows}* entri.`);
      }
    }
  } catch (err) {
    console.error('Webhook Process Error:', err);
  }

  res.sendStatus(200);
});

// =========================================================================
// 📌 CHAT GLOBAL
// =========================================================================
async function handleGetChatList(req, res) {
  try {
    await ensureTablesExist();
    const [rows] = await pool.query('SELECT * FROM global_chats ORDER BY id DESC LIMIT 50');
    const messages = rows.reverse();
    res.json({
      success: true,
      messages: messages,
      chats: messages,
      data: messages,
      list: messages,
      result: messages
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message, messages: [], chats: [], data: [] });
  }
}

app.get('/api/chat/list', handleGetChatList);
app.get('/api/chat/messages', handleGetChatList);

app.post('/api/chat/send', async (req, res) => {
  const { username, message, reply_to } = req.body;
  if (!username || !message) return res.status(400).json({ success: false, message: 'Username dan pesan wajib diisi!' });

  try {
    await ensureTablesExist();
    const replyData = reply_to ? JSON.stringify(reply_to) : null;

    try {
      await pool.query('INSERT INTO global_chats (username, message, reply_to) VALUES (?, ?, ?)', [username, message, replyData]);
    } catch (insertErr) {
      await pool.query('INSERT INTO global_chats (username, message) VALUES (?, ?)', [username, message]);
    }

    res.json({ success: true, message: 'Pesan berhasil terkirim!' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

async function handleClearChat(req, res) {
  const username = (req.body && req.body.username) || req.query.username;

  if (!username || username.toLowerCase() !== 'ranzz') {
    return res.status(403).json({ success: false, message: 'Akses ditolak! Hanya Ranzz yang dapat membersihkan chat.' });
  }

  try {
    await ensureTablesExist();
    await pool.query('DELETE FROM global_chats');
    res.json({ success: true, message: 'Seluruh riwayat chat berhasil dibersihkan!' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
}

app.post('/api/chat/clear', handleClearChat);
app.delete('/api/chat/clear', handleClearChat);

// =========================================================================
// 📌 FALLBACK 404
// =========================================================================
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Endpoint ${req.method} ${req.originalUrl} tidak ditemukan di server.` });
});

// =========================================================================
// 📌 START SERVER
// =========================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Pakasir configured: slug=${PAKASIR_SLUG}`);
});

module.exports = app;
