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
// 📌 KONFIGURASI PAKASIR
// =========================================================================
const PAKASIR_SLUG = process.env.PAKASIR_SLUG || 'ranzz-digital';
const PAKASIR_API_KEY = process.env.PAKASIR_API_KEY || '2i31X6c9lLZURpm35lE74rcCzrFPJ9l9';
const PAKASIR_WEBHOOK_SECRET = process.env.PAKASIR_WEBHOOK_SECRET || '0d5564bdf239618d9fda45fcf7ffb51c';
const PAKASIR_BASE_URL = 'https://app.pakasir.com/api/v2';

// =========================================================================
// 📌 KONFIGURASI DATABASE
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
      display_name VARCHAR(50) NULL,
      created_by VARCHAR(50) DEFAULT 'system',
      status VARCHAR(20) DEFAULT 'active',
      connected_senders INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `;

  const createChatsTable = `
    CREATE TABLE IF NOT EXISTS global_chats (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(50) NOT NULL,
      role VARCHAR(50) DEFAULT 'User',
      message TEXT NOT NULL,
      reply_to JSON NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  const createPinnedChatTable = `
    CREATE TABLE IF NOT EXISTS pinned_chats (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(50) NOT NULL,
      role VARCHAR(50) DEFAULT 'User',
      message TEXT NOT NULL,
      pinned_by VARCHAR(50) NOT NULL,
      pinned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
      selected_days INT DEFAULT 1,
      old_price INT DEFAULT 0,
      full_price INT DEFAULT 0,
      buyer_username VARCHAR(50) NOT NULL,
      buyer_password VARCHAR(255) NOT NULL,
      buyer_contact VARCHAR(30),
      status VARCHAR(20) DEFAULT 'pending',
      payment_data JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP NULL
    )
  `;

  await pool.query(createUsersTable);
  await pool.query(createChatsTable);
  await pool.query(createPinnedChatTable);
  await pool.query(createPendingSalesTable);
  await pool.query(createWaPairingsTable);
  await pool.query(createPakasirTable);

  // Migrasi kolom otomatis
  try { await pool.query('ALTER TABLE users MODIFY COLUMN email VARCHAR(100) NULL DEFAULT NULL'); } catch (e) {}
  try { await pool.query('ALTER TABLE users ADD COLUMN status VARCHAR(20) DEFAULT "active"'); } catch (e) {}
  try { await pool.query('ALTER TABLE users ADD COLUMN created_by VARCHAR(50) DEFAULT "system"'); } catch (e) {}
  try { await pool.query('ALTER TABLE users ADD COLUMN connected_senders INT DEFAULT 0'); } catch (e) {}
  try { await pool.query('ALTER TABLE users ADD COLUMN display_name VARCHAR(50) NULL'); } catch (e) {}
  try { await pool.query('ALTER TABLE users ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'); } catch (e) {}
  try { await pool.query('ALTER TABLE global_chats ADD COLUMN reply_to JSON NULL'); } catch (e) {}
  try { await pool.query('ALTER TABLE global_chats ADD COLUMN role VARCHAR(50) DEFAULT "User"'); } catch (e) {}
  try { await pool.query('ALTER TABLE pakasir_transactions ADD COLUMN selected_days INT DEFAULT 1'); } catch (e) {}
  try { await pool.query('ALTER TABLE pakasir_transactions ADD COLUMN old_price INT DEFAULT 0'); } catch (e) {}
  try { await pool.query('ALTER TABLE pakasir_transactions ADD COLUMN full_price INT DEFAULT 0'); } catch (e) {}
  try { await pool.query('ALTER TABLE pakasir_transactions DROP COLUMN buyer_email'); } catch (e) {}
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
res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
    const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);

    if (rows.length === 0) return res.status(401).json({ success: false, message: 'Username tidak ditemukan!' });

    const user = rows[0];
    if (user.password !== password) return res.status(401).json({ success: false, message: 'Password salah!' });

    res.json({
      success: true,
      message: 'Login berhasil!',
      user: {
        id: user.id,
        username: user.username,
        role: user.username.toLowerCase() === 'ranzz' ? 'Ranzzz : DEVELOPER' : (user.role || 'User'),
        avatar_url: user.avatar_url || 'https://cdn.phototourl.com/member/2026-09-27-bfb1146c-714f-4bca-97ff-7eb50e41818b.jpg',
        display_name: user.display_name || null,
        connected_senders: user.connected_senders || 0,
        created_at: user.created_at
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, message: 'Username dan password wajib diisi!' });

  try {
    await ensureTablesExist();
    const [existing] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);

    if (existing.length > 0) return res.status(400).json({ success: false, message: 'Username sudah terdaftar!' });

    const generatedEmail = `${username.toLowerCase()}@civutax.com`;
    await pool.query('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)', [username, generatedEmail, password, 'User']);
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

// Profile endpoint
app.get('/api/users/profile/:username', async (req, res) => {
  const { username } = req.params;
  if (!username) return res.status(400).json({ success: false, message: 'username wajib!' });

  try {
    await ensureTablesExist();
    const [rows] = await pool.query('SELECT id, username, role, avatar_url, display_name, created_by, status, connected_senders, created_at FROM users WHERE username = ?', [username]);

    if (rows.length === 0) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });

    res.json({ success: true, user: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

// Update profile
app.post('/api/users/update-profile', async (req, res) => {
  const { username, display_name, avatar_url } = req.body;
  if (!username || !display_name) {
    return res.status(400).json({ success: false, message: 'Username & display_name wajib!' });
  }

  try {
    await ensureTablesExist();
    await pool.query('ALTER TABLE users ADD COLUMN display_name VARCHAR(50) NULL').catch(() => {});

    await pool.query(
      'UPDATE users SET display_name = ?, avatar_url = COALESCE(?, avatar_url) WHERE username = ?',
      [display_name, avatar_url || null, username]
    );

    res.json({ success: true, message: 'Profil berhasil disimpan!' });
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
app.post('/api/pakasir/create', async (req, res) => {
  const { 
    order_id, type, package_id, package_name, amount, method, buyer,
    full_price, old_price, selected_days
  } = req.body;

  if (!order_id || !type || !amount || !buyer || !buyer.username || !buyer.password) {
    return res.status(400).json({ success: false, message: 'Data tidak lengkap!' });
  }

  try {
    await ensureTablesExist();

    if (type === 'new_acc') {
      const [existing] = await pool.query('SELECT id FROM users WHERE username = ?', [buyer.username]);
      if (existing.length > 0) {
        return res.status(400).json({ success: false, message: 'Username sudah terdaftar!' });
      }
    }

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

    const finalSelectedDays = parseInt(selected_days) || 1;
    const finalOldPrice = Number(old_price) || 0;
    const finalFullPrice = Number(full_price) || Number(amount) || 0;

    await pool.query(
      `INSERT INTO pakasir_transactions 
        (txn_id, order_id, type, package_id, package_name, amount, fee, total_payment, payment_method,
         selected_days, old_price, full_price,
         buyer_username, buyer_password, buyer_contact, status, payment_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        pakasirData.txn_id, order_id, type, package_id, package_name, amount,
        pakasirData.fee || 0, pakasirData.total_payment || amount,
        method,
        finalSelectedDays, finalOldPrice, finalFullPrice,
        buyer.username, buyer.password, buyer.contact || null,
        JSON.stringify(pakasirData)
      ]
    );

    console.log(`[PAKASIR] ✅ Transaksi baru: ${pakasirData.txn_id} - ${buyer.username} - Rp${amount} (${type})`);

    let infoDurasi = '';
    if (package_id === 'harian' && type === 'new_acc') {
      infoDurasi = `\n• Durasi: *${finalSelectedDays} Hari*`;
    }

    sendTelegramMessage(
      DEV_CHAT_ID,
      `💳 *TRANSAKSI BARU PAKASIR*\n\n` +
      `• Order ID: \`${order_id}\`\n` +
      `• Txn ID: \`${pakasirData.txn_id}\`\n` +
      `• Tipe: *${type === 'new_acc' ? 'Akun Baru' : 'Upgrade Role'}*\n` +
      `• User: \`${buyer.username}\`\n` +
      `• Paket: ${package_name}${infoDurasi}\n` +
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

app.get('/api/pakasir/status/:txn_id', async (req, res) => {
  const { txn_id } = req.params;

  try {
    await ensureTablesExist();

    const [rows] = await pool.query('SELECT * FROM pakasir_transactions WHERE txn_id = ?', [txn_id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan' });
    }

    const localTxn = rows[0];

    if (localTxn.status === 'completed') {
      return res.json({ success: true, status: 'completed', completed_at: localTxn.completed_at });
    }

    const pakasirRes = await fetch(`${PAKASIR_BASE_URL}/transaction-status/${PAKASIR_SLUG}/${txn_id}`, {
      headers: { 'X-Api-Key': PAKASIR_API_KEY }
    });
    const pakasirData = await pakasirRes.json();

    if (pakasirData.status && pakasirData.status !== localTxn.status) {
      await pool.query(
        'UPDATE pakasir_transactions SET status = ?, completed_at = ? WHERE txn_id = ?',
        [pakasirData.status, pakasirData.completed_at || null, txn_id]
      );

      if (pakasirData.status === 'completed') {
        const [freshRows] = await pool.query('SELECT * FROM pakasir_transactions WHERE txn_id = ?', [txn_id]);
        await autoCreateUserFromTxn(freshRows[0]);
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

app.post('/api/pakasir/webhook', async (req, res) => {
  const secret = req.headers['x-secret'];
  const { txn_id, order_id, amount, status, completed_at, is_sandbox } = req.body;

  console.log(`[PAKASIR WEBHOOK] txn_id=${txn_id} status=${status}`);

  if (secret !== PAKASIR_WEBHOOK_SECRET) {
    console.warn('[PAKASIR WEBHOOK] ❌ Invalid secret!');
    return res.status(403).json({ success: false, message: 'Invalid webhook secret' });
  }

  try {
    await ensureTablesExist();

    const [rows] = await pool.query('SELECT * FROM pakasir_transactions WHERE txn_id = ?', [txn_id]);
    if (rows.length === 0) {
      console.warn(`[PAKASIR WEBHOOK] ⚠️ Transaksi ${txn_id} tidak ditemukan`);
      return res.sendStatus(200);
    }

    const localTxn = rows[0];

    if (status === 'completed' && localTxn.status !== 'completed') {
      await pool.query(
        'UPDATE pakasir_transactions SET status = "completed", completed_at = ? WHERE txn_id = ?',
        [completed_at || new Date(), txn_id]
      );

      const [freshRows] = await pool.query('SELECT * FROM pakasir_transactions WHERE txn_id = ?', [txn_id]);
      await autoCreateUserFromTxn(freshRows[0]);

      console.log(`[PAKASIR WEBHOOK] ✅ Transaksi ${txn_id} COMPLETED`);
    } else if (status === 'canceled') {
      await pool.query('UPDATE pakasir_transactions SET status = "canceled" WHERE txn_id = ?', [txn_id]);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Pakasir webhook error:', err);
    res.sendStatus(500);
  }
});

async function autoCreateUserFromTxn(txn) {
  try {
    if (!txn) return;

    const [existing] = await pool.query('SELECT * FROM users WHERE username = ?', [txn.buyer_username]);

    if (txn.type === 'new_acc') {
      if (existing.length > 0) return;

      let role = 'User';
      let expDays = 0;

      if (txn.package_id === 'harian') {
        const days = Math.min(Math.max(parseInt(txn.selected_days) || 1, 1), 5);
        role = `Harian (${days} Hari)`;
        expDays = days;
      }
      else if (txn.package_id === 'mingguan') { role = 'Mingguan'; expDays = 7; }
      else if (txn.package_id === 'bulanan') { role = 'Bulanan'; expDays = 30; }
      else if (txn.package_id === 'fullup') { role = 'Full Up'; }
      else if (txn.package_id === 'reseller') { role = 'Reseller'; }
      else if (txn.package_id === 'partner') { role = 'Partner'; }
      else if (txn.package_id === 'owner') { role = 'Owner (Own)'; }

      const generatedEmail = `${txn.buyer_username.toLowerCase()}@civutax.com`;

      await pool.query(
        `INSERT INTO users (username, email, password, role, created_by, status) 
         VALUES (?, ?, ?, ?, 'pakasir-auto', 'active')`,
        [txn.buyer_username, generatedEmail, txn.buyer_password, role]
      );

      sendTelegramMessage(
        DEV_CHAT_ID,
        `🎉 *PEMBELIAN AKUN BARU VIA PAKASIR!*\n\n` +
        `• Username: \`${txn.buyer_username}\`\n` +
        `• Password: \`${txn.buyer_password}\`\n` +
        `• Role: *${role}*\n` +
        `• Total: Rp${Number(txn.total_payment || txn.amount).toLocaleString('id-ID')}\n` +
        `• Order ID: \`${txn.order_id}\``
      ).catch(() => {});

    } else if (txn.type === 'up_role') {
      if (existing.length === 0) return;

      let newRole = 'User';
      if (txn.package_id === 'fullup') newRole = 'Full Up';
      else if (txn.package_id === 'reseller') newRole = 'Reseller';
      else if (txn.package_id === 'partner') newRole = 'Partner';
      else if (txn.package_id === 'owner') newRole = 'Owner (Own)';

      const oldRole = existing[0].role;
      await pool.query('UPDATE users SET role = ? WHERE username = ?', [newRole, txn.buyer_username]);

      sendTelegramMessage(
        DEV_CHAT_ID,
        `⬆️ *UPGRADE ROLE VIA PAKASIR!*\n\n` +
        `• Username: \`${txn.buyer_username}\`\n` +
        `• Role: *${oldRole}* → *${newRole}*\n` +
        `• Total: Rp${Number(txn.total_payment || txn.amount).toLocaleString('id-ID')}`
      ).catch(() => {});
    }
  } catch (err) {
    console.error('Auto create user error:', err);
  }
}

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

app.get('/api/pakasir/transactions', async (req, res) => {
  try {
    await ensureTablesExist();
    const [rows] = await pool.query('SELECT * FROM pakasir_transactions ORDER BY id DESC LIMIT 100');
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

    sendTelegramMessage(
      DEV_CHAT_ID,
      `📲 *PAIRING BARU VIA TERMUX*\n\n` +
      `• User: *${username}*\n` +
      `• Nomor: \`${cleanPhone}\`\n` +
      `• Token: \`${pairing_token.substring(0, 12)}...\``
    ).catch(() => {});

    res.json({ success: true, message: 'Pairing tercatat!', phone: cleanPhone });
  } catch (err) {
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

app.post('/api/whatsapp/verify-pairing', async (req, res) => {
  const { username, pairing_token } = req.body;
  if (!username || !pairing_token) {
    return res.status(400).json({ success: false, message: 'Data kurang!' });
  }

  try {
    await ensureTablesExist();
    const [rows] = await pool.query(
      'SELECT * FROM wa_pairings WHERE pairing_token = ? AND status = "active"',
      [pairing_token]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Token tidak valid / expired!' });
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

    res.json({ success: true, message: 'Perangkat diputuskan.' });
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
// 📌 CHAT GLOBAL + PINNED
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
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message, messages: [] });
  }
}

app.get('/api/chat/list', handleGetChatList);
app.get('/api/chat/messages', handleGetChatList);

app.post('/api/chat/send', async (req, res) => {
  const { username, role, message, reply_to } = req.body;
  if (!username || !message) return res.status(400).json({ success: false, message: 'Username dan pesan wajib diisi!' });

  try {
    await ensureTablesExist();
    const replyData = reply_to ? JSON.stringify(reply_to) : null;

    // Simpan dengan role
    try {
      await pool.query(
        'INSERT INTO global_chats (username, role, message, reply_to) VALUES (?, ?, ?, ?)',
        [username, role || 'User', message, replyData]
      );
    } catch (insertErr) {
      // Fallback kalau kolom role belum ada
      await pool.query('INSERT INTO global_chats (username, message, reply_to) VALUES (?, ?, ?)', [username, message, replyData]);
    }

    res.json({ success: true, message: 'Pesan terkirim!' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

// PIN CHAT — hanya DEV
app.post('/api/chat/pin', async (req, res) => {
  const { username, message, pinned_by } = req.body;
  if (!username || !message || !pinned_by) {
    return res.status(400).json({ success: false, message: 'Data kurang!' });
  }

  if (pinned_by.toLowerCase() !== 'ranzz') {
    return res.status(403).json({ success: false, message: 'Hanya Developer yang bisa sematkan pesan!' });
  }

  try {
    await ensureTablesExist();

    // Ambil role target user
    const [users] = await pool.query('SELECT role FROM users WHERE username = ?', [username]);
    const role = users.length > 0 ? users[0].role : 'User';

    // Hapus pinned lama, ganti dengan yang baru
    await pool.query('DELETE FROM pinned_chats');
    await pool.query(
      'INSERT INTO pinned_chats (username, role, message, pinned_by) VALUES (?, ?, ?, ?)',
      [username, role, message, pinned_by]
    );

    res.json({ success: true, message: 'Pesan disematkan!' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

// GET pinned chat
app.get('/api/chat/pinned', async (req, res) => {
  try {
    await ensureTablesExist();
    const [rows] = await pool.query('SELECT * FROM pinned_chats ORDER BY id DESC LIMIT 1');
    res.json({ success: true, pinned: rows[0] || null });
  } catch (err) {
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

// UNPIN chat — hanya DEV
app.post('/api/chat/unpin', async (req, res) => {
  const { username } = req.body;
  if (!username || username.toLowerCase() !== 'ranzz') {
    return res.status(403).json({ success: false, message: 'Hanya DEV!' });
  }

  try {
    await ensureTablesExist();
    await pool.query('DELETE FROM pinned_chats');
    res.json({ success: true, message: 'Pinned dihapus!' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

async function handleClearChat(req, res) {
  const username = (req.body && req.body.username) || req.query.username;

  if (!username || username.toLowerCase() !== 'ranzz') {
    return res.status(403).json({ success: false, message: 'Akses ditolak! Hanya Ranzz.' });
  }

  try {
    await ensureTablesExist();
    await pool.query('DELETE FROM global_chats');
    res.json({ success: true, message: 'Chat dibersihkan!' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
}

app.post('/api/chat/clear', handleClearChat);
app.delete('/api/chat/clear', handleClearChat);

// =========================================================================
// 📌 TELEGRAM WEBHOOK - BOT COMMANDS
// =========================================================================
app.post('/api/telegram/webhook', async (req, res) => {
  const { message, callback_query } = req.body;

  try {
    await ensureTablesExist();

    // ============ HANDLE TEXT COMMANDS ============
    if (message && message.text) {
      const chatId = String(message.chat.id);
      const text = message.text.trim();

      if (chatId !== DEV_CHAT_ID) {
        await sendTelegramMessage(chatId, "Akses ditolak. Bot ini hanya untuk Developer Ranzz.");
        return res.sendStatus(200);
      }

      // ============ /start & /menu ============
      if (text === '/start' || text === '/menu') {
        const startMenu = 
          `*BOT KONTROL CIVUTAX*\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `Selamat datang, *Developer Ranzz*\n\n` +
          `*KONTROL SISTEM:*\n` +
          `/pending - Antrean akun butuh ACC\n` +
          `/stats - Statistik lengkap sistem\n` +
          `/users - List semua user terdaftar\n` +
          `/adduser - Tambah user manual\n` +
          `/deluser - Hapus user dari database\n` +
          `/setrole - Ubah role user\n\n` +
          `*CHAT GLOBAL:*\n` +
          `/chats - Lihat 20 chat terbaru\n` +
          `/pin - Sematkan pesan di chat\n` +
          `/unpin - Hapus pesan sematan\n` +
          `/clearchat - Bersihkan semua chat\n\n` +
          `*WA PAIRING:*\n` +
          `/wapairing - List WA tersambung\n` +
          `/unpair - Putuskan WA user\n\n` +
          `*PAKASIR:*\n` +
          `/pakasir - 10 transaksi terbaru\n` +
          `/revenue - Total pendapatan\n\n` +
          `*LOG & BERSIH:*\n` +
          `/clearlogs - Hapus semua log ACC\n` +
          `/backup - Backup database info\n\n` +
          `*INFO:*\n` +
          `/help - Bantuan lengkap\n` +
          `/ping - Test respon bot\n` +
          `/version - Info versi bot`;

        const keyboard = {
          inline_keyboard: [
            [{ text: 'Antrean ACC', callback_data: 'cmd_pending' }, { text: 'Statistik', callback_data: 'cmd_stats' }],
            [{ text: 'List User', callback_data: 'cmd_users' }, { text: 'Chat Terbaru', callback_data: 'cmd_chats' }],
            [{ text: 'WA Pairing', callback_data: 'cmd_wa_list' }, { text: 'Transaksi Pakasir', callback_data: 'cmd_pakasir' }],
            [{ text: 'Revenue', callback_data: 'cmd_revenue' }],
            [{ text: 'Bersihkan Chat', callback_data: 'cmd_clear_chat' }, { text: 'Bersihkan Log', callback_data: 'cmd_clear_logs' }],
            [{ text: 'Ping', callback_data: 'cmd_ping' }, { text: 'Bantuan', callback_data: 'cmd_help' }]
          ]
        };

        await sendTelegramMessage(chatId, startMenu, keyboard);
      }

      // ============ /ping ============
      else if (text === '/ping') {
        const start = Date.now();
        await pool.query('SELECT 1');
        const latency = Date.now() - start;
        await sendTelegramMessage(chatId, `Pong!\n\nLatency: *${latency}ms*\nBot aktif 24/7`);
      }

      // ============ /version ============
      else if (text === '/version') {
        await sendTelegramMessage(chatId, 
          `*CIVUTAX BOT VERSION*\n\n` +
          `• Bot Version: *1.0.0*\n` +
          `• Node Environment: *${process.env.NODE_ENV || 'production'}*\n` +
          `• Pakasir Slug: *${PAKASIR_SLUG}*\n` +
          `• Uptime: *${Math.floor(process.uptime())} detik*\n` +
          `• Memory: *${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB*`
        );
      }

      // ============ /help ============
      else if (text === '/help') {
        await sendTelegramMessage(chatId,
          `*PANDUAN BOT CIVUTAX*\n\n` +
          `Bot ini untuk mengelola sistem CIVUTAX:\n` +
          `• index.html → Halaman login & pembelian\n` +
          `• dashboard.html → Panel user\n` +
          `• admin-acc.html → Panel ACC Developer\n\n` +
          `*Cara Pakai:*\n` +
          `1. Ketik /start untuk buka menu\n` +
          `2. Klik tombol interaktif\n` +
          `3. Atau ketik command langsung\n\n` +
          `*Link Aplikasi:*\n` +
          `• Dashboard: https://civutax-s9zn.vercel.app\n` +
          `• Webhook Pakasir: https://civutax-s9zn.vercel.app/api/pakasir/webhook`
        );
      }

      // ============ /pending ============
      else if (text === '/pending') {
        const [rows] = await pool.query('SELECT * FROM pending_sales WHERE status = "pending_approval" ORDER BY id DESC');
        if (rows.length === 0) {
          await sendTelegramMessage(chatId, "Tidak ada antrean pengajuan akun baru.");
        } else {
          for (const pendingData of rows) await sendTelegramNotification(pendingData);
        }
      }

      // ============ /stats ============
      else if (text === '/stats') {
        const [usersCount] = await pool.query('SELECT COUNT(*) as total FROM users');
        const [pendingCount] = await pool.query('SELECT COUNT(*) as total FROM pending_sales WHERE status = "pending_approval"');
        const [approvedCount] = await pool.query('SELECT COUNT(*) as total FROM pending_sales WHERE status = "approved"');
        const [rejectedCount] = await pool.query('SELECT COUNT(*) as total FROM pending_sales WHERE status = "rejected"');
        const [waCount] = await pool.query('SELECT COUNT(*) as total FROM wa_pairings WHERE status = "active"');
        const [pakasirSuccess] = await pool.query('SELECT COUNT(*) as total FROM pakasir_transactions WHERE status = "completed"');
        const [chatCount] = await pool.query('SELECT COUNT(*) as total FROM global_chats');
        const [revenue] = await pool.query('SELECT SUM(total_payment) as total FROM pakasir_transactions WHERE status = "completed"');

        const statsMsg = 
          `*STATISTIK SISTEM CIVUTAX*\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `*USER & AKUN:*\n` +
          `• Total User Terdaftar: *${usersCount[0].total}*\n` +
          `• Total Akun Di-ACC: *${approvedCount[0].total}*\n` +
          `• Antrean Menunggu: *${pendingCount[0].total}*\n` +
          `• Akun Ditolak: *${rejectedCount[0].total}*\n\n` +
          `*AKTIVITAS:*\n` +
          `• WA Pairing Aktif: *${waCount[0].total}*\n` +
          `• Total Pesan Chat: *${chatCount[0].total}*\n` +
          `• Transaksi Pakasir Sukses: *${pakasirSuccess[0].total}*\n\n` +
          `*KEUANGAN:*\n` +
          `• Total Revenue: *Rp${Number(revenue[0].total || 0).toLocaleString('id-ID')}*\n\n` +
          `Update: ${new Date().toLocaleString('id-ID')}`;

        await sendTelegramMessage(chatId, statsMsg);
      }

      // ============ /users ============
      else if (text === '/users') {
        const [rows] = await pool.query('SELECT username, role, created_at FROM users ORDER BY id DESC LIMIT 30');
        if (rows.length === 0) {
          await sendTelegramMessage(chatId, "Belum ada user terdaftar.");
        } else {
          let listText = `*LIST USER TERDAFTAR (30 terbaru)*\n\n`;
          rows.forEach((u, i) => {
            listText += `${i + 1}. *${u.username}* — ${u.role}\n`;
          });
          listText += `\nTotal: ${rows.length} ditampilkan`;
          await sendTelegramMessage(chatId, listText);
        }
      }

      // ============ /adduser ============
      else if (text.startsWith('/adduser')) {
        const parts = text.split(' ');
        if (parts.length < 3) {
          await sendTelegramMessage(chatId, 
            `*Cara Pakai:*\n` +
            `/adduser username password [role]\n\n` +
            `Contoh:\n` +
            `/adduser budi123 rahasia456 User\n` +
            `/adduser sultan1 pass123 Owner (Own)`
          );
        } else {
          const username = parts[1].trim();
          const password = parts[2].trim();
          const role = parts.slice(3).join(' ').trim() || 'User';

          const [existing] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
          if (existing.length > 0) {
            await sendTelegramMessage(chatId, `Username *${username}* sudah terdaftar.`);
          } else {
            const generatedEmail = `${username.toLowerCase()}@civutax.com`;
            await pool.query(
              'INSERT INTO users (username, email, password, role, created_by, status) VALUES (?, ?, ?, ?, "telegram-bot", "active")',
              [username, generatedEmail, password, role]
            );
            await sendTelegramMessage(chatId, 
              `User berhasil ditambahkan:\n\n` +
              `• Username: \`${username}\`\n` +
              `• Password: \`${password}\`\n` +
              `• Role: *${role}*`
            );
          }
        }
      }

      // ============ /deluser ============
      else if (text.startsWith('/deluser')) {
        const parts = text.split(' ');
        if (parts.length < 2) {
          await sendTelegramMessage(chatId, 'Cara pakai: `/deluser username`');
        } else {
          const username = parts[1].trim();
          if (username.toLowerCase() === 'ranzz') {
            await sendTelegramMessage(chatId, 'Tidak bisa hapus akun Developer!');
          } else {
            const [existing] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
            if (existing.length === 0) {
              await sendTelegramMessage(chatId, `User *${username}* tidak ditemukan.`);
            } else {
              await pool.query('DELETE FROM users WHERE username = ?', [username]);
              await sendTelegramMessage(chatId, `User *${username}* berhasil dihapus.`);
            }
          }
        }
      }

      // ============ /setrole ============
      else if (text.startsWith('/setrole')) {
        const parts = text.split(' ');
        if (parts.length < 3) {
          await sendTelegramMessage(chatId, 
            '*Cara Pakai:*\n' +
            `/setrole username role_baru\n\n` +
            `Contoh:\n` +
            `/setrole budi123 Owner (Own)\n` +
            `/setrole sultan1 Full Up`
          );
        } else {
          const username = parts[1].trim();
          const newRole = parts.slice(2).join(' ').trim();

          const [existing] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
          if (existing.length === 0) {
            await sendTelegramMessage(chatId, `User *${username}* tidak ditemukan.`);
          } else {
            const oldRole = existing[0].role;
            await pool.query('UPDATE users SET role = ? WHERE username = ?', [newRole, username]);
            await sendTelegramMessage(chatId, 
              `Role diubah:\n\n` +
              `• User: \`${username}\`\n` +
              `• Lama: *${oldRole}*\n` +
              `• Baru: *${newRole}*`
            );
          }
        }
      }

      // ============ /chats ============
      else if (text === '/chats') {
        const [rows] = await pool.query('SELECT username, role, message, created_at FROM global_chats ORDER BY id DESC LIMIT 20');
        if (rows.length === 0) {
          await sendTelegramMessage(chatId, "Belum ada pesan chat.");
        } else {
          let listText = `*20 CHAT TERBARU*\n\n`;
          rows.reverse().forEach((c) => {
            listText += `[${c.role || 'User'}] *${c.username}*: ${c.message}\n`;
          });
          await sendTelegramMessage(chatId, listText);
        }
      }

      // ============ /pin ============
      else if (text.startsWith('/pin')) {
        const parts = text.split(' ');
        if (parts.length < 3) {
          await sendTelegramMessage(chatId, 
            '*Cara Pakai:*\n' +
            `/pin username pesan\n\n` +
            `Contoh:\n` +
            `/pin ranzz Halo semua! Ini pesan sematan\n` +
            `/pin budi123 Jangan lupa bayar ya`
          );
        } else {
          const targetUser = parts[1].trim();
          const pinMessage = parts.slice(2).join(' ').trim();

          const [users] = await pool.query('SELECT role FROM users WHERE username = ?', [targetUser]);
          if (users.length === 0) {
            await sendTelegramMessage(chatId, `User *${targetUser}* tidak ditemukan.`);
          } else {
            const role = users[0].role;
            await pool.query('DELETE FROM pinned_chats');
            await pool.query(
              'INSERT INTO pinned_chats (username, role, message, pinned_by) VALUES (?, ?, ?, ?)',
              [targetUser, role, pinMessage, 'ranzz']
            );
            await sendTelegramMessage(chatId, 
              `Pesan disematkan:\n\n` +
              `• User: *${targetUser}* (${role})\n` +
              `• Pesan: ${pinMessage}`
            );
          }
        }
      }

      // ============ /unpin ============
      else if (text === '/unpin') {
        await pool.query('DELETE FROM pinned_chats');
        await sendTelegramMessage(chatId, "Pesan sematan dihapus.");
      }

      // ============ /clearchat ============
      else if (text === '/clearchat') {
        const [result] = await pool.query('DELETE FROM global_chats');
        await sendTelegramMessage(chatId, `Chat global dibersihkan. (${result.affectedRows} pesan dihapus)`);
      }

      // ============ /wapairing ============
      else if (text === '/wapairing') {
        const [rows] = await pool.query('SELECT * FROM wa_pairings WHERE status = "active" ORDER BY paired_at DESC LIMIT 20');
        if (rows.length === 0) {
          await sendTelegramMessage(chatId, "Belum ada user pairing WA.");
        } else {
          let listText = `*WA PAIRING AKTIF (${rows.length})*\n\n`;
          rows.forEach((w, i) => {
            listText += `${i + 1}. *${w.username}*\n   Nomor: \`${w.phone_number}\`\n   Tanggal: ${new Date(w.paired_at).toLocaleString('id-ID')}\n\n`;
          });
          await sendTelegramMessage(chatId, listText);
        }
      }

      // ============ /unpair ============
      else if (text.startsWith('/unpair')) {
        const parts = text.split(' ');
        if (parts.length < 2) {
          await sendTelegramMessage(chatId, 'Cara pakai: `/unpair username`');
        } else {
          const username = parts[1].trim();
          await pool.query('UPDATE wa_pairings SET status = "disconnected" WHERE username = ?', [username]);
          await pool.query(
            'UPDATE users SET connected_senders = GREATEST(COALESCE(connected_senders,0) - 1, 0) WHERE username = ?',
            [username]
          ).catch(() => {});
          await sendTelegramMessage(chatId, `WA user *${username}* diputuskan.`);
        }
      }

      // ============ /pakasir ============
      else if (text === '/pakasir') {
        const [rows] = await pool.query('SELECT * FROM pakasir_transactions ORDER BY id DESC LIMIT 10');
        if (rows.length === 0) {
          await sendTelegramMessage(chatId, "Belum ada transaksi Pakasir.");
        } else {
          let listText = `*10 TRANSAKSI PAKASIR TERBARU*\n\n`;
          rows.forEach((t, i) => {
            const statusIcon = t.status === 'completed' ? '[OK]' : (t.status === 'pending' ? '[PENDING]' : '[X]');
            listText += `${i + 1}. ${statusIcon} *${t.buyer_username}*\n   ${t.package_name} - Rp${Number(t.amount).toLocaleString('id-ID')}\n   Txn: \`${t.txn_id}\`\n\n`;
          });
          await sendTelegramMessage(chatId, listText);
        }
      }

      // ============ /revenue ============
      else if (text === '/revenue') {
        const [total] = await pool.query('SELECT SUM(total_payment) as total, COUNT(*) as count FROM pakasir_transactions WHERE status = "completed"');
        const [today] = await pool.query('SELECT SUM(total_payment) as total, COUNT(*) as count FROM pakasir_transactions WHERE status = "completed" AND DATE(completed_at) = CURDATE()');
        const [month] = await pool.query('SELECT SUM(total_payment) as total, COUNT(*) as count FROM pakasir_transactions WHERE status = "completed" AND MONTH(completed_at) = MONTH(CURDATE()) AND YEAR(completed_at) = YEAR(CURDATE())');

        await sendTelegramMessage(chatId,
          `*LAPORAN REVENUE*\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `*Total Keseluruhan:*\n` +
          `• Rp${Number(total[0].total || 0).toLocaleString('id-ID')}\n` +
          `• Dari ${total[0].count} transaksi\n\n` +
          `*Hari Ini:*\n` +
          `• Rp${Number(today[0].total || 0).toLocaleString('id-ID')}\n` +
          `• Dari ${today[0].count} transaksi\n\n` +
          `*Bulan Ini:*\n` +
          `• Rp${Number(month[0].total || 0).toLocaleString('id-ID')}\n` +
          `• Dari ${month[0].count} transaksi`
        );
      }

      // ============ /clearlogs ============
      else if (text === '/clearlogs') {
        const [result] = await pool.query('DELETE FROM pending_sales');
        await sendTelegramMessage(chatId, `Semua log pengajuan dihapus. (${result.affectedRows} entri)`);
      }

      // ============ /backup ============
      else if (text === '/backup') {
        const [users] = await pool.query('SELECT COUNT(*) as c FROM users');
        const [chats] = await pool.query('SELECT COUNT(*) as c FROM global_chats');
        const [pins] = await pool.query('SELECT COUNT(*) as c FROM pinned_chats');
        const [sales] = await pool.query('SELECT COUNT(*) as c FROM pending_sales');
        const [wa] = await pool.query('SELECT COUNT(*) as c FROM wa_pairings');
        const [pakasir] = await pool.query('SELECT COUNT(*) as c FROM pakasir_transactions');

        await sendTelegramMessage(chatId,
          `*DATABASE INFO*\n\n` +
          `• Users: ${users[0].c}\n` +
          `• Chats: ${chats[0].c}\n` +
          `• Pinned: ${pins[0].c}\n` +
          `• Sales Log: ${sales[0].c}\n` +
          `• WA Pairings: ${wa[0].c}\n` +
          `• Pakasir Txn: ${pakasir[0].c}\n\n` +
          `Server uptime: ${Math.floor(process.uptime())}s`
        );
      }

      else {
        // Command tidak dikenal
        await sendTelegramMessage(chatId, 
          `Command *${text}* tidak dikenal.\n\n` +
          `Ketik /start untuk lihat menu lengkap.`
        );
      }
    }

    // ============ HANDLE CALLBACK QUERY (TOMBOL) ============
    if (callback_query) {
      const data = callback_query.data;
      const chatId = callback_query.message.chat.id;
      const messageId = callback_query.message.message_id;

      // ACC/REJECT
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
                text: `Pengajuan ini sudah pernah diproses!`,
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
                text: `*AKUN BERHASIL DI-ACC & AKTIF!*\n\nUsername: \`${reqData.buyer_username}\`\nPassword: \`${reqData.buyer_password}\`\nPaket: ${reqData.package_name}`,
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
                text: `*PENGAJUAN DITOLAK!*\n\nUsername: \`${reqData.buyer_username}\``,
                parse_mode: 'Markdown'
              })
            });
          }
        }
      }

      // BUTTON COMMANDS
      else if (data === 'cmd_pending') {
        const [rows] = await pool.query('SELECT * FROM pending_sales WHERE status = "pending_approval" ORDER BY id DESC');
        if (rows.length === 0) {
          await sendTelegramMessage(chatId, "Tidak ada antrean pengajuan.");
        } else {
          for (const pendingData of rows) await sendTelegramNotification(pendingData);
        }
      }

      else if (data === 'cmd_stats') {
        const [usersCount] = await pool.query('SELECT COUNT(*) as total FROM users');
        const [pendingCount] = await pool.query('SELECT COUNT(*) as total FROM pending_sales WHERE status = "pending_approval"');
        const [approvedCount] = await pool.query('SELECT COUNT(*) as total FROM pending_sales WHERE status = "approved"');
        const [waCount] = await pool.query('SELECT COUNT(*) as total FROM wa_pairings WHERE status = "active"');
        const [chatCount] = await pool.query('SELECT COUNT(*) as total FROM global_chats');
        const [revenue] = await pool.query('SELECT SUM(total_payment) as total FROM pakasir_transactions WHERE status = "completed"');

        await sendTelegramMessage(chatId, 
          `*STATISTIK*\n\n` +
          `• Users: *${usersCount[0].total}*\n` +
          `• Pending ACC: *${pendingCount[0].total}*\n` +
          `• Approved: *${approvedCount[0].total}*\n` +
          `• WA Aktif: *${waCount[0].total}*\n` +
          `• Pesan Chat: *${chatCount[0].total}*\n` +
          `• Revenue: *Rp${Number(revenue[0].total || 0).toLocaleString('id-ID')}*`
        );
      }

      else if (data === 'cmd_users') {
        const [rows] = await pool.query('SELECT username, role FROM users ORDER BY id DESC LIMIT 30');
        let listText = `*LIST USER (30)*\n\n`;
        rows.forEach((u, i) => {
          listText += `${i + 1}. *${u.username}* — ${u.role}\n`;
        });
        await sendTelegramMessage(chatId, listText || 'Belum ada user.');
      }

      else if (data === 'cmd_chats') {
        const [rows] = await pool.query('SELECT username, role, message FROM global_chats ORDER BY id DESC LIMIT 20');
        if (rows.length === 0) {
          await sendTelegramMessage(chatId, "Belum ada chat.");
        } else {
          let listText = `*20 CHAT TERBARU*\n\n`;
          rows.reverse().forEach((c) => {
            listText += `[${c.role || 'User'}] *${c.username}*: ${c.message}\n`;
          });
          await sendTelegramMessage(chatId, listText);
        }
      }

      else if (data === 'cmd_wa_list') {
        const [rows] = await pool.query('SELECT * FROM wa_pairings WHERE status = "active" ORDER BY paired_at DESC LIMIT 20');
        if (rows.length === 0) {
          await sendTelegramMessage(chatId, "Belum ada WA pairing aktif.");
        } else {
          let listText = `*WA PAIRING AKTIF*\n\n`;
          rows.forEach((w, i) => {
            listText += `${i + 1}. *${w.username}* — \`${w.phone_number}\`\n`;
          });
          await sendTelegramMessage(chatId, listText);
        }
      }

      else if (data === 'cmd_pakasir') {
        const [rows] = await pool.query('SELECT * FROM pakasir_transactions ORDER BY id DESC LIMIT 10');
        if (rows.length === 0) {
          await sendTelegramMessage(chatId, "Belum ada transaksi Pakasir.");
        } else {
          let listText = `*10 TRANSAKSI PAKASIR*\n\n`;
          rows.forEach((t, i) => {
            const statusIcon = t.status === 'completed' ? 'OK' : (t.status === 'pending' ? 'WAIT' : 'X');
            listText += `${i + 1}. [${statusIcon}] *${t.buyer_username}* — ${t.package_name} — Rp${Number(t.amount).toLocaleString('id-ID')}\n`;
          });
          await sendTelegramMessage(chatId, listText);
        }
      }

      else if (data === 'cmd_revenue') {
        const [total] = await pool.query('SELECT SUM(total_payment) as total, COUNT(*) as count FROM pakasir_transactions WHERE status = "completed"');
        const [today] = await pool.query('SELECT SUM(total_payment) as total FROM pakasir_transactions WHERE status = "completed" AND DATE(completed_at) = CURDATE()');

        await sendTelegramMessage(chatId,
          `*REVENUE*\n\n` +
          `Total: *Rp${Number(total[0].total || 0).toLocaleString('id-ID')}*\n` +
          `Dari ${total[0].count} transaksi\n\n` +
          `Hari ini: *Rp${Number(today[0].total || 0).toLocaleString('id-ID')}*`
        );
      }

      else if (data === 'cmd_clear_chat') {
        const [result] = await pool.query('DELETE FROM global_chats');
        await sendTelegramMessage(chatId, `Chat dibersihkan. (${result.affectedRows} pesan)`);
      }

      else if (data === 'cmd_clear_logs') {
        const [result] = await pool.query('DELETE FROM pending_sales');
        await sendTelegramMessage(chatId, `Log pengajuan dihapus. (${result.affectedRows} entri)`);
      }

      else if (data === 'cmd_ping') {
        const start = Date.now();
        await pool.query('SELECT 1');
        const latency = Date.now() - start;
        await sendTelegramMessage(chatId, `Pong! Latency: *${latency}ms*`);
      }

      else if (data === 'cmd_help') {
        await sendTelegramMessage(chatId,
          `*BANTUAN BOT CIVUTAX*\n\n` +
          `Semua command diawali slash (/).\n` +
          `Ketik /start untuk menu utama.\n` +
          `Klik tombol atau ketik command langsung.\n\n` +
          `*Fitur Utama:*\n` +
          `• ACC akun otomatis via tombol\n` +
          `• Pin chat dari Telegram\n` +
          `• Add/del user dari bot\n` +
          `• Cek revenue realtime\n` +
          `• Kelola WA pairing\n\n` +
          `Webhook Pakasir sudah aktif dan berfungsi.`
        );
      }

      // Acknowledge callback
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callback_query.id })
      }).catch(() => {});
    }
  } catch (err) {
    console.error('Webhook Process Error:', err);
  }

  res.sendStatus(200);
});

// =========================================================================
// 📌 TIKTOK DOWNLOADER (MULTI-FALLBACK)
// =========================================================================
app.get('/api/tools/tiktok', async (req, res) => {
  const { url } = req.query;

  if (!url) return res.status(400).json({ success: false, message: 'Parameter URL wajib diisi!' });
  if (!url.includes('tiktok.com')) return res.status(400).json({ success: false, message: 'Link harus dari TikTok!' });

  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  // ============ SUMBER 1: TIKWM ============
  try {
    const r1 = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`, {
      headers: { 'User-Agent': userAgent, 'Accept': 'application/json' }
    });
    const d1 = await r1.json();

    if (d1.code === 0 && d1.data) {
      const v = d1.data;
      const base = 'https://www.tikwm.com';
      const fix = (u) => u ? (u.startsWith('http') ? u : base + u) : null;

      return res.json({
        success: true,
        source: 'tikwm',
        data: {
          title: v.title || 'TikTok Video',
          author: v.author ? v.author.unique_id : 'unknown',
          cover: fix(v.cover),
          video: fix(v.hdplay) || fix(v.play),
          audio: fix(v.music),
          duration: v.duration || 0,
          play_count: v.play_count || 0,
          likes: v.digg_count || 0,
          comments: v.comment_count || 0,
          shares: v.share_count || 0
        }
      });
    }
  } catch (e) {
    console.warn('[TIKTOK] TikWM gagal:', e.message);
  }

  // ============ SUMBER 2: DOUYIN.WTF ============
  try {
    const r2 = await fetch(`https://api.douyin.wtf/api/hybrid/video_data?url=${encodeURIComponent(url)}&minimal=false`, {
      headers: { 'User-Agent': userAgent, 'Accept': 'application/json' }
    });
    const d2 = await r2.json();

    if (d2.code === 200 && d2.data) {
      const v = d2.data;
      const videoUrl = v.video_data?.nwm_video_url_HQ 
                    || v.video_data?.nwm_video_url 
                    || v.video_data?.wm_video_url_HQ
                    || v.video_data?.wm_video_url;

      if (videoUrl) {
        return res.json({
          success: true,
          source: 'douyin.wtf',
          data: {
            title: v.desc || 'TikTok Video',
            author: v.author?.unique_id || 'unknown',
            cover: v.video_data?.cover_data?.cover?.url_list?.[0] || null,
            video: videoUrl,
            audio: v.music_data?.play_url?.url_list?.[0] || null,
            duration: v.video_data?.duration || 0,
            play_count: v.statistics?.play_count || 0,
            likes: v.statistics?.digg_count || 0,
            comments: v.statistics?.comment_count || 0,
            shares: v.statistics?.share_count || 0
          }
        });
      }
    }
  } catch (e) {
    console.warn('[TIKTOK] Douyin.wtf gagal:', e.message);
  }

  return res.status(404).json({
    success: false,
    message: 'Semua sumber gagal. Coba link lain atau beberapa saat lagi.'
  });
});

// =========================================================================
// 📌 UPLOAD IMAGE TO URL (MULTI-FALLBACK: Catbox → ImgBB → Uguu)
// =========================================================================

// Middleware buat terima file upload (tanpa perlu install multer)
// Pakai raw body + boundary parsing sederhana
app.use('/api/tools/upload', express.raw({ 
  type: ['image/*', 'application/octet-stream'], 
  limit: '10mb' 
}));

app.post('/api/tools/upload', async (req, res) => {
  try {
    // Terima file dari FormData di frontend
    // req.body bakal jadi Buffer kalau content-type image/*
    // Tapi karena frontend kirim FormData, kita handle multipart manual
    // Fallback: pakai endpoint yang terima base64 JSON
    
    return res.status(400).json({ 
      success: false, 
      message: 'Gunakan endpoint /api/tools/upload-base64' 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Endpoint utama: terima base64 image dari frontend
app.post('/api/tools/upload-base64', async (req, res) => {
  const { image, filename } = req.body;

  if (!image) {
    return res.status(400).json({ success: false, message: 'Data image wajib dikirim!' });
  }

  // Bersihin prefix data:image/xxx;base64,
  const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');

  if (buffer.length > 10 * 1024 * 1024) {
    return res.status(400).json({ success: false, message: 'Ukuran gambar max 10MB!' });
  }

  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  // ============ SUMBER 1: CATBOX.MOE ============
  try {
    const formData = new FormData();
    formData.append('reqtype', 'fileupload');
    formData.append('fileToUpload', new Blob([buffer], { type: 'image/jpeg' }), filename || 'upload.jpg');

    const r1 = await fetch('https://catbox.moe/user/api.php', {
      method: 'POST',
      body: formData,
      headers: { 'User-Agent': userAgent }
    });

    const url1 = (await r1.text()).trim();

    if (url1 && url1.startsWith('http')) {
      return res.json({ success: true, source: 'catbox', url: url1 });
    }
  } catch (e) {
    console.warn('[UPLOAD] Catbox gagal:', e.message);
  }

  // ============ SUMBER 2: UGUU.SE (GRATIS, NO KEY) ============
  try {
    const formData2 = new FormData();
    formData2.append('files[]', new Blob([buffer], { type: 'image/jpeg' }), filename || 'upload.jpg');

    const r2 = await fetch('https://uguu.se/upload.php', {
      method: 'POST',
      body: formData2,
      headers: { 'User-Agent': userAgent }
    });

    const d2 = await r2.json();

    if (d2 && d2.success && d2.files && d2.files[0] && d2.files[0].url) {
      return res.json({ success: true, source: 'uguu', url: d2.files[0].url });
    }
  } catch (e) {
    console.warn('[UPLOAD] Uguu gagal:', e.message);
  }

  // ============ SUMBER 3: TMPFILES.ORG (GRATIS, NO KEY) ============
  try {
    const formData3 = new FormData();
    formData3.append('file', new Blob([buffer], { type: 'image/jpeg' }), filename || 'upload.jpg');

    const r3 = await fetch('https://tmpfiles.org/api/v1/upload', {
      method: 'POST',
      body: formData3,
      headers: { 'User-Agent': userAgent }
    });

    const d3 = await r3.json();

    if (d3 && d3.status === 'success' && d3.data && d3.data.url) {
      // Tmpfiles kasih URL halaman, convert ke direct link
      const directUrl = d3.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
      return res.json({ success: true, source: 'tmpfiles', url: directUrl });
    }
  } catch (e) {
    console.warn('[UPLOAD] Tmpfiles gagal:', e.message);
  }

  // ============ SUMBER 4: 0X0.ST (GRATIS, NO KEY) ============
  try {
    const formData4 = new FormData();
    formData4.append('file', new Blob([buffer], { type: 'image/jpeg' }), filename || 'upload.jpg');

    const r4 = await fetch('https://0x0.st', {
      method: 'POST',
      body: formData4,
      headers: { 'User-Agent': userAgent }
    });

    const url4 = (await r4.text()).trim();

    if (url4 && url4.startsWith('http')) {
      return res.json({ success: true, source: '0x0.st', url: url4 });
    }
  } catch (e) {
    console.warn('[UPLOAD] 0x0.st gagal:', e.message);
  }

  return res.status(500).json({
    success: false,
    message: 'Semua server upload gagal. Coba lagi beberapa saat.'
  });
});

// =========================================================================
// 📌 FALLBACK 404
// =========================================================================
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Endpoint ${req.method} ${req.originalUrl} tidak ditemukan.` });
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
