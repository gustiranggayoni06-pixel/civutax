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

// Konfigurasi Bot Telegram
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8563757113:AAG1gW-Px-E-JzDDgQWlBbdYIyUdxXd6Ykk';
const DEV_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '5474893948';

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

// Helper untuk memastikan tabel-tabel penting dibuat & migrasi kolom otomatis
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

  await pool.query(createUsersTable);
  await pool.query(createChatsTable);
  await pool.query(createPendingSalesTable);

  try { await pool.query('ALTER TABLE users MODIFY COLUMN email VARCHAR(100) NULL DEFAULT NULL'); } catch (e) {}
  try { await pool.query('ALTER TABLE users ADD COLUMN status VARCHAR(20) DEFAULT "active"'); } catch (e) {}
  try { await pool.query('ALTER TABLE users ADD COLUMN created_by VARCHAR(50) DEFAULT "system"'); } catch (e) {}
  try { await pool.query('ALTER TABLE global_chats ADD COLUMN reply_to JSON NULL'); } catch (e) {}
}

// Helper Kirim Pesan Telegram
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

// Fungsi Kirim Notifikasi Pengajuan Akun Baru
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

// Root Route Test
app.get('/', (req, res) => {
  res.send('Server Backend CIVUTAX Berjalan Lancar!');
});

// Endpoint Set Webhook Otomatis
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

// Endpoint Login
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
        avatar_url: user.avatar_url || 'https://cdn.phototourl.com/member/2026-09-27-bfb1146c-714f-4bca-97ff-7eb50e41818b.jpg'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

// Endpoint Register
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

// Endpoint Ambil Seluruh User Database
app.get('/api/users/all', async (req, res) => {
  try {
    await ensureTablesExist();
    const [rows] = await pool.query('SELECT id, username, password, role, created_by, status, created_at FROM users ORDER BY id DESC');
    res.json({ success: true, users: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

// Endpoint Ubah Password
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

// Endpoint Hapus Akun
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

// Cek Username Duplikat
app.get('/api/users/check-username', async (req, res) => {
  const { username } = req.query;
  if (!username) return res.json({ exists: false });

  try {
    await ensureTablesExist();
    const [rowsUsers] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
    const [rowsPending] = await pool.query('SELECT id FROM pending_sales WHERE buyer_username = ? AND status = "pending_approval"', [username]);

    res.json({ exists: rowsUsers.length > 0 || rowsPending.length > 0 });
  } catch (err) {
    res.json({ exists: false });
  }
});

// Pengajuan Akun Baru
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

// Ambil Seluruh Penjualan (Pending, Approved, Rejected)
app.get('/api/sales/pending-list', async (req, res) => {
  try {
    await ensureTablesExist();
    const [rows] = await pool.query('SELECT * FROM pending_sales ORDER BY id DESC');
    res.json({ success: true, requests: rows, data: rows, sales: rows, list: rows, result: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

// =========================================================================
// 📌 ENDPOINT HAPUS LOG SALES / ACC (BARU - UNTUK admin-acc.html)
// =========================================================================

// ✅ Hapus 1 log pengajuan berdasarkan ID
app.post('/api/sales/delete', async (req, res) => {
  const { requestId, requested_by } = req.body;

  if (!requestId) {
    return res.status(400).json({ success: false, message: 'requestId wajib diisi!' });
  }

  try {
    await ensureTablesExist();

    const [rows] = await pool.query('SELECT id FROM pending_sales WHERE id = ?', [requestId]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: `Log dengan ID #${requestId} tidak ditemukan!` });
    }

    await pool.query('DELETE FROM pending_sales WHERE id = ?', [requestId]);
    res.json({ success: true, message: `Log #${requestId} berhasil dihapus!` });
  } catch (err) {
    console.error('Delete sales log error:', err);
    res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
  }
});

// ✅ Hapus SEMUA log pengajuan (khusus Ranzz)
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

// Eksekusi ACC / Reject Web
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
        console.warn('Gagal insert lengkap, fallback query:', insertErr.message);
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

// WEBHOOK TELEGRAM LENGKAP
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
          `• /help - Bantuan & panduan bot`;

        const keyboard = {
          inline_keyboard: [
            [{ text: '📋 Cek Antrean ACC', callback_data: 'cmd_pending' }],
            [{ text: '📊 Statistik Sistem', callback_data: 'cmd_stats' }],
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

        const statsMsg = 
          `📊 *STATISTIK SISTEM CIVUTAX*\n\n` +
          `• Total Akun Terdaftar: *${usersCount[0].total}*\n` +
          `• Total Akun Di-ACC: *${approvedCount[0].total}*\n` +
          `• Antrean Menunggu ACC: *${pendingCount[0].total}*\n` +
          `• Total Log Tersimpan: *${totalLogs[0].total}*`;

        await sendTelegramMessage(chatId, statsMsg);
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
                console.warn('Fallback Telegram ACC:', insertErr.message);
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

        const statsMsg = 
          `📊 *STATISTIK SISTEM CIVUTAX*\n\n` +
          `• Total Akun Terdaftar: *${usersCount[0].total}*\n` +
          `• Total Akun Di-ACC: *${approvedCount[0].total}*\n` +
          `• Antrean Menunggu ACC: *${pendingCount[0].total}*\n` +
          `• Total Log Tersimpan: *${totalLogs[0].total}*`;

        await sendTelegramMessage(chatId, statsMsg);
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
// 📌 CHAT GLOBAL ENDPOINTS
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
