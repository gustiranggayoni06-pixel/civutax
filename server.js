async function autoCreateUserFromTxn(txn) {
  try {
    const [existing] = await pool.query('SELECT * FROM users WHERE username = ?', [txn.buyer_username]);

    if (txn.type === 'new_acc') {
      // ============================================================
      // ==== AKUN BARU ====
      // ============================================================
      if (existing.length > 0) {
        console.log(`[AUTO-CREATE] User ${txn.buyer_username} sudah ada, skip.`);
        return;
      }

      // Tentukan role + jumlah hari
      let role = 'User';
      let expDays = 0; // 0 = permanen/Unlimited

      if (txn.package_id === 'harian') {
        // Ambil jumlah hari dari selected_days (fallback ke 1)
        const days = parseInt(txn.selected_days) || 1;
        const clampedDays = Math.min(Math.max(days, 1), 5); // batasi 1-5
        role = `Harian (${clampedDays} Hari)`;
        expDays = clampedDays;
      }
      else if (txn.package_id === 'mingguan') {
        role = 'Mingguan';
        expDays = 7;
      }
      else if (txn.package_id === 'bulanan') {
        role = 'Bulanan';
        expDays = 30;
      }
      else if (txn.package_id === 'fullup') {
        role = 'Full Up';
      }
      else if (txn.package_id === 'reseller') {
        role = 'Reseller';
      }
      else if (txn.package_id === 'partner') {
        role = 'Partner';
      }
      else if (txn.package_id === 'owner') {
        role = 'Owner (Own)';
      }

      const generatedEmail = txn.buyer_email || `${txn.buyer_username.toLowerCase()}@civutax.com`;

      await pool.query(
        `INSERT INTO users (username, email, password, role, created_by, status) 
         VALUES (?, ?, ?, ?, 'pakasir-auto', 'active')`,
        [txn.buyer_username, generatedEmail, txn.buyer_password, role]
      );

      console.log(`[AUTO-CREATE] ✅ User ${txn.buyer_username} dibuat dengan role "${role}"`);

      // Format info jumlah hari kalau harian
      let infoHari = '';
      if (txn.package_id === 'harian') {
        const days = parseInt(txn.selected_days) || 1;
        infoHari = `\n• Durasi: *${Math.min(Math.max(days, 1), 5)} Hari*`;
      } else if (expDays > 0) {
        infoHari = `\n• Durasi: *${expDays} Hari*`;
      } else {
        infoHari = `\n• Durasi: *Unlimited / Permanen*`;
      }

      // Notif Telegram
      sendTelegramMessage(
        DEV_CHAT_ID,
        `🎉 *PEMBELIAN AKUN BARU VIA PAKASIR!*\n\n` +
        `• Username: \`${txn.buyer_username}\`\n` +
        `• Password: \`${txn.buyer_password}\`\n` +
        `• Role: *${role}*${infoHari}\n` +
        `• Total: Rp${Number(txn.total_payment || txn.amount).toLocaleString('id-ID')}\n` +
        `• Metode: ${txn.payment_method}\n` +
        `• Order ID: \`${txn.order_id}\``
      ).catch(() => {});

    } else if (txn.type === 'up_role') {
      // ============================================================
      // ==== UPGRADE ROLE ====
      // ============================================================
      if (existing.length === 0) {
        console.log(`[AUTO-UPGRADE] User ${txn.buyer_username} tidak ditemukan, skip.`);
        return;
      }

      // Tentukan role baru
      let newRole = 'User';
      if (txn.package_id === 'harian') {
        const days = parseInt(txn.selected_days) || 1;
        newRole = `Harian (${Math.min(Math.max(days, 1), 5)} Hari)`;
      }
      else if (txn.package_id === 'mingguan') newRole = 'Mingguan';
      else if (txn.package_id === 'bulanan') newRole = 'Bulanan';
      else if (txn.package_id === 'fullup') newRole = 'Full Up';
      else if (txn.package_id === 'reseller') newRole = 'Reseller';
      else if (txn.package_id === 'partner') newRole = 'Partner';
      else if (txn.package_id === 'owner') newRole = 'Owner (Own)';

      const oldRole = existing[0].role;

      await pool.query('UPDATE users SET role = ? WHERE username = ?', [newRole, txn.buyer_username]);

      console.log(`[AUTO-UPGRADE] ✅ ${txn.buyer_username}: ${oldRole} → ${newRole}`);

      // Hitung info harga upgrade
      const oldPrice = Number(txn.old_price) || 0;
      const fullPrice = Number(txn.full_price) || 0;
      const payAmount = Number(txn.total_payment || txn.amount) || 0;

      let hargaInfo = '';
      if (oldPrice > 0 && fullPrice > 0) {
        hargaInfo = `\n• Harga Role Lama: Rp${oldPrice.toLocaleString('id-ID')}\n` +
                    `• Harga Role Baru: Rp${fullPrice.toLocaleString('id-ID')}\n` +
                    `• Selisih Bayar: Rp${(fullPrice - oldPrice).toLocaleString('id-ID')}`;
      }

      // Notif Telegram
      sendTelegramMessage(
        DEV_CHAT_ID,
        `⬆️ *UPGRADE ROLE VIA PAKASIR!*\n\n` +
        `• Username: \`${txn.buyer_username}\`\n` +
        `• Role Lama: *${oldRole}*\n` +
        `• Role Baru: *${newRole}*${hargaInfo}\n` +
        `• Total Bayar: Rp${payAmount.toLocaleString('id-ID')}\n` +
        `• Metode: ${txn.payment_method}\n` +
        `• Order ID: \`${txn.order_id}\``
      ).catch(() => {});
    }

  } catch (err) {
    console.error('Auto create user error:', err);
  }
}
