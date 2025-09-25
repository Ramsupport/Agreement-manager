// server.js
const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

// Database setup
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/agreement_db'
});

// Initialize database tables
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agents (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agreements (
      id SERIAL PRIMARY KEY,
      owner_name TEXT,
      location TEXT,
      token_number TEXT UNIQUE,
      agreement_date DATE,
      owner_contact TEXT,
      tenant_contact TEXT,
      email TEXT,
      expiry_date DATE,
      reminder_date DATE,
      cc_email TEXT,
      agent_name TEXT,
      total_payment NUMERIC,
      payment_owner NUMERIC,
      payment_tenant NUMERIC,
      payment_due NUMERIC,
      agreement_status TEXT,
      biometric_date DATE,
      actual_cost NUMERIC,
      agent_commission NUMERIC,
      other_expenses NUMERIC,
      gross_profit NUMERIC,
      net_profit NUMERIC,
      profit_margin NUMERIC,
      created_at TIMESTAMP DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id SERIAL PRIMARY KEY,
      username TEXT,
      action TEXT,
      details TEXT,
      ip_address TEXT,
      created_at TIMESTAMP DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      default_cc_email TEXT,
      company_name TEXT,
      reminder_days_before INTEGER,
      date_format TEXT,
      currency_symbol TEXT,
      session_timeout INTEGER,
      max_records_per_page INTEGER
    );
  `);

  // Seed default admin user if none exist
  const res = await pool.query(`SELECT COUNT(*) FROM users;`);
  if (res.rows[0].count == 0) {
    await pool.query(
      `INSERT INTO users (username, password, role) VALUES ($1, $2, $3);`,
      ['admin', 'admin123', 'admin']
    );
    console.log('Seeded default admin user (admin/admin123).');
  }

  // Seed agents list if empty
  const agentsRes = await pool.query(`SELECT COUNT(*) FROM agents;`);
  if (agentsRes.rows[0].count == 0) {
    const defaultAgents = ['Ramnath', 'Agent 1', 'Agent 2', 'Agent 3'];
    for (let name of defaultAgents) {
      await pool.query(`INSERT INTO agents (name) VALUES ($1) ON CONFLICT DO NOTHING;`, [name]);
    }
    console.log('Seeded default agents:', defaultAgents);
  }

  // Seed default settings row if none
  const settingsRes = await pool.query(`SELECT COUNT(*) FROM system_settings;`);
  if (settingsRes.rows[0].count == 0) {
    await pool.query(
      `INSERT INTO system_settings (id, default_cc_email, company_name, reminder_days_before, date_format, currency_symbol, session_timeout, max_records_per_page)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7);`,
      ['support@ramnathshetty.com', 'Shetty Legal Advisors', 30, 'DD-MM-YYYY', '₹', 60, 25]
    );
    console.log('Seeded default system settings.');
  }
}

initDb().catch(err => console.error('Error initializing database:', err.stack));

// Serve static files (index.html at root)
app.use(express.static(path.join(__dirname)));

// API: Test connection
app.get('/api/test', (req, res) => {
  res.json({ status: 'ok' });
});

// Authentication
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1 AND password = $2;',
      [username, password]
    );
    if (result.rows.length > 0) {
      // In a real app, you'd issue a token. Here we just return success.
      res.json({ message: 'Login successful' });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Agreements CRUD
app.get('/api/agreements', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM agreements ORDER BY created_at DESC;');
    res.json(result.rows);
  } catch (err) {
    console.error('Fetch agreements error:', err);
    res.status(500).json({ error: 'Failed to fetch agreements' });
  }
});

app.post('/api/agreements', async (req, res) => {
  const data = req.body;
  try {
    // Calculate financials if not provided
    const totalPayment = parseFloat(data.totalPayment) || 0;
    const actualCost = parseFloat(data.actualCost) || 0;
    const agentCommission = parseFloat(data.agentCommission) || 0;
    const otherExpenses = parseFloat(data.otherExpenses) || 0;
    const grossProfit = totalPayment - actualCost;
    const netProfit = grossProfit - agentCommission - otherExpenses;
    const profitMargin = totalPayment > 0 ? (netProfit / totalPayment) * 100 : 0;

    const insertQuery = `
      INSERT INTO agreements (
        owner_name, location, token_number, agreement_date, owner_contact, tenant_contact,
        email, expiry_date, reminder_date, cc_email, agent_name,
        total_payment, payment_owner, payment_tenant, payment_due, agreement_status,
        biometric_date, actual_cost, agent_commission, other_expenses,
        gross_profit, net_profit, profit_margin
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16,
        $17, $18, $19, $20,
        $21, $22, $23
      ) RETURNING *;
    `;
    const params = [
      data.ownerName, data.location, data.tokenNumber, data.agreementDate || null,
      data.ownerContact, data.tenantContact, data.email, data.expiryDate || null,
      data.reminderDate || null, data.ccEmail, data.agentName,
      totalPayment, parseFloat(data.paymentOwner) || 0, parseFloat(data.paymentTenant) || 0, parseFloat(data.paymentDue) || 0,
      data.agreementStatus, data.biometricDate || null,
      actualCost, agentCommission, otherExpenses,
      grossProfit, netProfit, profitMargin
    ];
    const result = await pool.query(insertQuery, params);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Save agreement error:', err);
    res.status(500).json({ error: 'Failed to save agreement' });
  }
});

app.get('/api/agreements/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const result = await pool.query('SELECT * FROM agreements WHERE id = $1;', [id]);
    if (result.rows.length) {
      res.json(result.rows[0]);
    } else {
      res.status(404).json({ error: 'Agreement not found' });
    }
  } catch (err) {
    console.error('Get agreement error:', err);
    res.status(500).json({ error: 'Error fetching agreement' });
  }
});

app.put('/api/agreements/:id', async (req, res) => {
  const id = req.params.id;
  const data = req.body;
  try {
    // Recalculate financials
    const totalPayment = parseFloat(data.totalPayment) || 0;
    const actualCost = parseFloat(data.actualCost) || 0;
    const agentCommission = parseFloat(data.agentCommission) || 0;
    const otherExpenses = parseFloat(data.otherExpenses) || 0;
    const grossProfit = totalPayment - actualCost;
    const netProfit = grossProfit - agentCommission - otherExpenses;
    const profitMargin = totalPayment > 0 ? (netProfit / totalPayment) * 100 : 0;

    const updateQuery = `
      UPDATE agreements SET
        owner_name = $1, location = $2, token_number = $3, agreement_date = $4,
        owner_contact = $5, tenant_contact = $6, email = $7, expiry_date = $8,
        reminder_date = $9, cc_email = $10, agent_name = $11,
        total_payment = $12, payment_owner = $13, payment_tenant = $14,
        payment_due = $15, agreement_status = $16, biometric_date = $17,
        actual_cost = $18, agent_commission = $19, other_expenses = $20,
        gross_profit = $21, net_profit = $22, profit_margin = $23
      WHERE id = $24 RETURNING *;
    `;
    const params = [
      data.ownerName, data.location, data.tokenNumber, data.agreementDate || null,
      data.ownerContact, data.tenantContact, data.email, data.expiryDate || null,
      data.reminderDate || null, data.ccEmail, data.agentName,
      totalPayment, parseFloat(data.paymentOwner) || 0, parseFloat(data.paymentTenant) || 0, parseFloat(data.paymentDue) || 0,
      data.agreementStatus, data.biometricDate || null,
      actualCost, agentCommission, otherExpenses,
      grossProfit, netProfit, profitMargin,
      id
    ];
    const result = await pool.query(updateQuery, params);
    if (result.rows.length) {
      res.json(result.rows[0]);
    } else {
      res.status(404).json({ error: 'Agreement not found' });
    }
  } catch (err) {
    console.error('Update agreement error:', err);
    res.status(500).json({ error: 'Failed to update agreement' });
  }
});

app.delete('/api/agreements/:id', async (req, res) => {
  const id = req.params.id;
  try {
    await pool.query('DELETE FROM agreements WHERE id = $1;', [id]);
    res.json({ message: 'Agreement deleted' });
  } catch (err) {
    console.error('Delete agreement error:', err);
    res.status(500).json({ error: 'Failed to delete agreement' });
  }
});

// Token uniqueness check (for new or edited agreements)
app.get('/api/agreements/check-token', async (req, res) => {
  const token = req.query.token;
  const id = req.query.id; // allow skipping current record on edit
  if (!token) {
    return res.status(400).json({ error: 'Token required' });
  }
  try {
    let query = 'SELECT COUNT(*) FROM agreements WHERE token_number = $1';
    let params = [token];
    if (id) {
      query += ' AND id != $2';
      params.push(id);
    }
    const result = await pool.query(query, params);
    const unique = (parseInt(result.rows[0].count) === 0);
    res.json({ unique });
  } catch (err) {
    console.error('Check token error:', err);
    res.json({ unique: true });
  }
});

// Reports endpoints
app.get('/api/reports/profit', async (req, res) => {
  const from = req.query.from;
  const to = req.query.to;
  const agent = req.query.agent;
  try {
    let query = 'SELECT * FROM agreements WHERE agreement_date BETWEEN $1 AND $2';
    let params = [from, to];
    if (agent) {
      query += ' AND agent_name = $3';
      params.push(agent);
    }
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Profit report error:', err);
    res.status(500).json({ error: 'Failed to generate profit report' });
  }
});

app.get('/api/reports/agent/:agent', async (req, res) => {
  const agent = req.params.agent;
  try {
    const result = await pool.query('SELECT * FROM agreements WHERE agent_name = $1;', [agent]);
    res.json(result.rows);
  } catch (err) {
    console.error('Agent report error:', err);
    res.status(500).json({ error: 'Failed to generate agent report' });
  }
});

app.get('/api/reports/expiring', async (req, res) => {
  const from = req.query.from;
  const to = req.query.to;
  try {
    const result = await pool.query('SELECT * FROM agreements WHERE expiry_date BETWEEN $1 AND $2;', [from, to]);
    res.json(result.rows);
  } catch (err) {
    console.error('Expiring report error:', err);
    res.status(500).json({ error: 'Failed to generate expiring report' });
  }
});

app.get('/api/reports/pending', async (req, res) => {
  const filter = req.query.filter; // 'greater' or 'less'
  try {
    let query;
    if (filter === 'greater') {
      query = 'SELECT * FROM agreements WHERE payment_due > 0;';
    } else if (filter === 'less') {
      query = 'SELECT * FROM agreements WHERE payment_due < 0;';
    } else {
      return res.json([]); // no filter selected
    }
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error('Pending report error:', err);
    res.status(500).json({ error: 'Failed to generate pending report' });
  }
});

// Users endpoints
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, role, created_at FROM users ORDER BY created_at DESC;');
    res.json(result.rows);
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

app.post('/api/users', async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING id, username, role, created_at;',
      [username, password, role || 'user']
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Add user error:', err);
    res.status(400).json({ error: 'Failed to add user' });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  const id = req.params.id;
  try {
    await pool.query('DELETE FROM users WHERE id = $1;', [id]);
    res.json({ message: 'User deleted' });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

app.put('/api/users/change-password', async (req, res) => {
  const { username, currentPassword, newPassword } = req.body;
  if (!username || !currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Missing parameters' });
  }
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1 AND password = $2;', [username, currentPassword]);
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    await pool.query('UPDATE users SET password = $1 WHERE username = $2;', [newPassword, username]);
    res.json({ message: 'Password changed' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Agents list
app.get('/api/agents', async (req, res) => {
  try {
    const result = await pool.query('SELECT name FROM agents ORDER BY name;');
    res.json(result.rows.map(r => ({ name: r.name })));
  } catch (err) {
    console.error('List agents error:', err);
    res.status(500).json({ error: 'Failed to list agents' });
  }
});

// Activity logs
app.get('/api/activity-logs', async (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  try {
    const result = await pool.query(
      'SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT $1;',
      [limit]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Fetch activity logs error:', err);
    res.status(500).json({ error: 'Failed to fetch activity logs' });
  }
});

app.post('/api/activity-logs', async (req, res) => {
  const { username, action, details, ipAddress } = req.body;
  try {
    await pool.query(
      'INSERT INTO activity_logs (username, action, details, ip_address) VALUES ($1, $2, $3, $4);',
      [username, action, details, ipAddress]
    );
    res.json({ message: 'Log recorded' });
  } catch (err) {
    console.error('Log activity error:', err);
    res.status(500).json({ error: 'Failed to log activity' });
  }
});

// System settings
app.get('/api/settings', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM system_settings WHERE id = 1;');
    if (result.rows.length) {
      res.json(result.rows[0]);
    } else {
      res.json({});
    }
  } catch (err) {
    console.error('Fetch settings error:', err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

app.put('/api/settings', async (req, res) => {
  const s = req.body;
  try {
    const query = `
      UPDATE system_settings SET
        default_cc_email = $1, company_name = $2, reminder_days_before = $3,
        date_format = $4, currency_symbol = $5, session_timeout = $6,
        max_records_per_page = $7
      WHERE id = 1 RETURNING *;
    `;
    const params = [
      s.default_cc_email, s.company_name, s.reminder_days_before,
      s.date_format, s.currency_symbol, s.session_timeout, s.max_records_per_page
    ];
    const result = await pool.query(query, params);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Save settings error:', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// Backup & Restore
app.post('/api/backup/restore', async (req, res) => {
  const backupData = req.body;
  try {
    // Caution: this will overwrite existing data
    await pool.query('BEGIN;');
    // Clear existing data
    await pool.query('DELETE FROM activity_logs;');
    await pool.query('DELETE FROM agreements;');
    await pool.query('DELETE FROM users;');
    // Restore agreements
    if (backupData.agreements) {
      for (let ag of backupData.agreements) {
        const insertQ = `
          INSERT INTO agreements (
            owner_name, location, token_number, agreement_date, owner_contact, tenant_contact,
            email, expiry_date, reminder_date, cc_email, agent_name,
            total_payment, payment_owner, payment_tenant, payment_due, agreement_status,
            biometric_date, actual_cost, agent_commission, other_expenses,
            gross_profit, net_profit, profit_margin
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23);
        `;
        await pool.query(insertQ, [
          ag.owner_name, ag.location, ag.token_number, ag.agreement_date, ag.owner_contact, ag.tenant_contact,
          ag.email, ag.expiry_date, ag.reminder_date, ag.cc_email, ag.agent_name,
          ag.total_payment, ag.payment_owner, ag.payment_tenant, ag.payment_due, ag.agreement_status,
          ag.biometric_date, ag.actual_cost, ag.agent_commission, ag.other_expenses,
          ag.gross_profit, ag.net_profit, ag.profit_margin
        ]);
      }
    }
    // Restore users (note: passwords are hidden; we skip or use a placeholder)
    if (backupData.users) {
      for (let u of backupData.users) {
        // Skip if password hidden
        const pwd = (u.password && u.password !== '***HIDDEN***') ? u.password : 'password';
        await pool.query(
          'INSERT INTO users (username, password, role, created_at) VALUES ($1,$2,$3,$4);',
          [u.username, pwd, u.role, u.created_at || new Date()]
        );
      }
    }
    // Restore settings
    if (backupData.settings) {
      const s = backupData.settings;
      await pool.query(`
        UPDATE system_settings SET
          default_cc_email = $1, company_name = $2, reminder_days_before = $3,
          date_format = $4, currency_symbol = $5, session_timeout = $6,
          max_records_per_page = $7
        WHERE id = 1;
      `, [
        s.default_cc_email, s.company_name, s.reminder_days_before,
        s.date_format, s.currency_symbol, s.session_timeout, s.max_records_per_page
      ]);
    }
    await pool.query('COMMIT;');
    res.json({ message: 'Backup restored successfully' });
  } catch (err) {
    await pool.query('ROLLBACK;');
    console.error('Restore error:', err);
    res.status(500).json({ error: 'Failed to restore backup' });
  }
});

// Fallback: serve index.html for any other route (for SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
