async function autoCreateUserFromTxn(txn) {
  try {
    const [existing] = await pool.query('SELECT * FROM users WHERE username = ?', [txn.buyer_username]);

    if (txn.type === 'new_acc') {
      // ==== AKUN BARU ====
      if (existing.length > 0) {
        console.log(`[AUTO-CREATE] User ${txn.buyer_username} sudah ada, skip.`);
        return;
      }

      let role = 'User';
      if (txn.package_id === 'harian') role = 'Harian (1 Hari)';
      else if (txn.package_id === 'mingguan') role = 'Mingguan';
      else if (txn.package_id === 'bulanan') role = 'Bulanan';
      else if (txn.package_id === 'fullup') role = 'Full Up';
      else if (txn.package_id === 'reseller') role = 'Reseller';
      else if (txn.package_id === 'partner') role = 'Partner';
      else if (txn.package_id === 'owner') role = 'Owner (Own)';

      const generatedEmail = txn.buyer_email || `${txn.buyer_username.toLowerCase()}@civutax.com`;

      await pool.query(
        `INSERT INTO users (username, email, password, role, created_by, status) 
         VALUES (?, ?, ?, ?, 'pakasir-auto', 'active')`,
        [txn.buyer_username, generatedEmail, txn.buyer_password, role]
      );

      console.log(`[AUTO-CREATE] ✅ User ${txn.buyer_username} dibuat dengan role ${role}`);

      sendTelegramMessage(
        DEV_CHAT_ID,
        `🎉 *PEMBELIAN AKUN BARU VIA PAKASIR!*\n\n` +
        `• Username: \`${txn.buyer_username}\`\n` +
        `• Password: \`${txn.buyer_password}\`\n` +
        `• Role: *${role}*\n` +
        `• Total: Rp${Number(txn.total_payment).toLocaleString('id-ID')}\n` +
        `• Metode: ${txn.payment_method}\n` +
        `• Order ID: \`${txn.order_id}\``
      ).catch(() => {});

    } else if (txn.type === 'up_role') {
      // ==== UPGRADE ROLE ====
      if (existing.length === 0) {
        console.log(`[AUTO-UPGRADE] User ${txn.buyer_username} tidak ditemukan, skip.`);
        return;
      }

      let newRole = 'User';
      if (txn.package_id === 'fullup') newRole = 'Full Up';
      else if (txn.package_id === 'reseller') newRole = 'Reseller';
      else if (txn.package_id === 'partner') newRole = 'Partner';
      else if (txn.package_id === 'owner') newRole = 'Owner (Own)';

      const oldRole = existing[0].role;

      await pool.query('UPDATE users SET role = ? WHERE username = ?', [newRole, txn.buyer_username]);

      console.log(`[AUTO-UPGRADE] ✅ ${txn.buyer_username}: ${oldRole} → ${newRole}`);

      sendTelegramMessage(
        DEV_CHAT_ID,
        `⬆️ *UPGRADE ROLE VIA PAKASIR!*\n\n` +
        `• Username: \`${txn.buyer_username}\`\n` +
        `• Role Lama: *${oldRole}*\n` +
        `• Role Baru: *${newRole}*\n` +
        `• Total Bayar: Rp${Number(txn.total_payment).toLocaleString('id-ID')}\n` +
        `• Metode: ${txn.payment_method}\n` +
        `• Order ID: \`${txn.order_id}\``
      ).catch(() => {});
    }
  } catch (err) {
    console.error('Auto create user error:', err);
  }
}
