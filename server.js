// server.js
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// --- Database Setup ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-development';

// --- Database Initialization ---
async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL, created_at TIMESTAMP DEFAULT now()
      );`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agents (
        id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL
      );`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agreements (
        id SERIAL PRIMARY KEY, owner_name TEXT, location TEXT, token_number TEXT UNIQUE, agreement_date DATE, owner_contact TEXT, 
        tenant_contact TEXT, email TEXT, expiry_date DATE, reminder_date DATE, cc_email TEXT, agent_name TEXT, total_payment NUMERIC, 
        payment_owner NUMERIC, payment_tenant NUMERIC, payment_due NUMERIC, agreement_status TEXT, biometric_date DATE, 
        actual_cost NUMERIC, agent_commission NUMERIC, other_expenses NUMERIC, gross_profit NUMERIC, net_profit NUMERIC, 
        profit_margin NUMERIC, created_at TIMESTAMP DEFAULT now()
      );`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id SERIAL PRIMARY KEY, username TEXT, action TEXT, details TEXT, ip_address TEXT, created_at TIMESTAMP DEFAULT now()
      );`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        id INTEGER PRIMARY KEY DEFAULT 1, default_cc_email TEXT, company_name TEXT, reminder_days_before INTEGER, date_format TEXT, 
        currency_symbol TEXT, session_timeout INTEGER, max_records_per_page INTEGER
      );`);

    const usersRes = await pool.query(`SELECT COUNT(*) FROM users;`);
    if (parseInt(usersRes.rows[0].count) === 0) {
      const hashedPassword = await argon2.hash('admin123');
      await pool.query(`INSERT INTO users (username, password, role) VALUES ($1, $2, $3);`, ['admin', hashedPassword, 'admin']);
      console.log('Seeded default admin user (admin/admin123).');
    }
    const agentsRes = await pool.query(`SELECT COUNT(*) FROM agents;`);
    if (parseInt(agentsRes.rows[0].count) === 0) {
      const defaultAgents = ['Ramnath', 'Agent 1', 'Agent 2', 'Agent 3'];
      for (const name of defaultAgents) {
        await pool.query(`INSERT INTO agents (name) VALUES ($1) ON CONFLICT DO NOTHING;`, [name]);
      }
      console.log('Seeded default agents.');
    }
    const settingsRes = await pool.query(`SELECT COUNT(*) FROM system_settings;`);
    if (parseInt(settingsRes.rows[0].count) === 0) {
      await pool.query(`INSERT INTO system_settings (id, default_cc_email, company_name, reminder_days_before, date_format, currency_symbol, session_timeout, max_records_per_page) VALUES (1, $1, $2, $3, $4, $5, $6, $7);`, ['support@ramnathshetty.com', 'Shetty Legal Advisors', 30, 'DD-MM-YYYY', '₹', 60, 25]);
      console.log('Seeded default system settings.');
    }
    console.log('Database initialization completed successfully.');
  } catch (err) {
    console.error('Error initializing database:', err.stack);
    throw err;
  }
}

// --- Middleware ---
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
};

const checkAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: 'Forbidden: Admin access required' });
    }
};

// --- API Routes ---
app.use(express.static(path.join(__dirname)));

app.get('/api/health', (req, res) => res.json({ status: 'healthy' }));

app.get('/api/test', (req, res) => {
  res.json({ status: 'Backend is running', timestamp: new Date().toISOString() });
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1;', [username]);
        if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
        const user = result.rows[0];
        const validPassword = await argon2.verify(user.password, password);
        if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ message: 'Login successful', user: { id: user.id, username: user.username, role: user.role, token } });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error during authentication' });
    }
});

app.put('/api/auth/change-password', authenticateToken, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;
    try {
        const userResult = await pool.query('SELECT password FROM users WHERE id = $1;', [userId]);
        if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
        const user = userResult.rows[0];
        const validPassword = await argon2.verify(user.password, currentPassword);
        if (!validPassword) return res.status(401).json({ error: 'Invalid current password.' });
        const newHashedPassword = await argon2.hash(newPassword);
        await pool.query('UPDATE users SET password = $1 WHERE id = $2;', [newHashedPassword, userId]);
        res.json({ message: 'Password updated successfully.' });
    } catch (err) {
        console.error('Change password error:', err);
        res.status(500).json({ error: 'Failed to change password' });
    }
});

// --- Agreements Endpoints ---
app.get('/api/agreements', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM agreements ORDER BY created_at DESC;');
    res.json({ agreements: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch agreements' });
  }
});

app.post('/api/agreements', authenticateToken, async (req, res) => {
  const data = req.body;
  try {
    const totalPayment = parseFloat(data.totalPayment) || 0, actualCost = parseFloat(data.actualCost) || 0, agentCommission = parseFloat(data.agentCommission) || 0, otherExpenses = parseFloat(data.otherExpenses) || 0;
    const grossProfit = totalPayment - actualCost;
    const netProfit = grossProfit - agentCommission - otherExpenses;
    const profitMargin = totalPayment > 0 ? (netProfit / totalPayment) * 100 : 0;
    const params = [
      data.ownerName, data.location, data.tokenNumber, data.agreementDate || null, data.ownerContact, data.tenantContact, data.email, data.expiryDate || null,
      data.reminderDate || null, data.ccEmail, data.agentName, totalPayment, parseFloat(data.paymentOwner) || 0, parseFloat(data.paymentTenant) || 0, 
      parseFloat(data.paymentDue) || 0, data.agreementStatus, data.biometricDate || null, actualCost, agentCommission, otherExpenses, grossProfit, netProfit, profitMargin
    ];
    const result = await pool.query(`INSERT INTO agreements (owner_name, location, token_number, agreement_date, owner_contact, tenant_contact, email, expiry_date, reminder_date, cc_email, agent_name, total_payment, payment_owner, payment_tenant, payment_due, agreement_status, biometric_date, actual_cost, agent_commission, other_expenses, gross_profit, net_profit, profit_margin) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23) RETURNING *;`, params);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Save agreement error:', err);
    res.status(500).json({ error: 'Failed to save agreement' });
  }
});

app.get('/api/agreements/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('SELECT * FROM agreements WHERE id = $1;', [id]);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch agreement' });
    }
});

app.put('/api/agreements/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const data = req.body;
    try {
        const totalPayment = parseFloat(data.totalPayment) || 0, actualCost = parseFloat(data.actualCost) || 0, agentCommission = parseFloat(data.agentCommission) || 0, otherExpenses = parseFloat(data.otherExpenses) || 0;
        const grossProfit = totalPayment - actualCost;
        const netProfit = grossProfit - agentCommission - otherExpenses;
        const profitMargin = totalPayment > 0 ? (netProfit / totalPayment) * 100 : 0;
        const params = [
            data.ownerName, data.location, data.tokenNumber, data.agreementDate || null, data.ownerContact, data.tenantContact, data.email, data.expiryDate || null,
            data.reminderDate || null, data.ccEmail, data.agentName, totalPayment, parseFloat(data.paymentOwner) || 0, parseFloat(data.paymentTenant) || 0, 
            parseFloat(data.paymentDue) || 0, data.agreementStatus, data.biometricDate || null, actualCost, agentCommission, otherExpenses, grossProfit, netProfit, profitMargin, id
        ];
        const result = await pool.query(`UPDATE agreements SET owner_name = $1, location = $2, token_number = $3, agreement_date = $4, owner_contact = $5, tenant_contact = $6, email = $7, expiry_date = $8, reminder_date = $9, cc_email = $10, agent_name = $11, total_payment = $12, payment_owner = $13, payment_tenant = $14, payment_due = $15, agreement_status = $16, biometric_date = $17, actual_cost = $18, agent_commission = $19, other_expenses = $20, gross_profit = $21, net_profit = $22, profit_margin = $23 WHERE id = $24 RETURNING *;`, params);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Update agreement error:', err);
        res.status(500).json({ error: 'Failed to update agreement' });
    }
});

app.delete('/api/agreements/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM agreements WHERE id = $1;', [id]);
        res.status(204).send();
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete agreement' });
    }
});

// --- Users, Settings, Reports, etc. ---
app.get('/api/users', authenticateToken, checkAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, role, created_at FROM users ORDER BY username;');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

app.post('/api/users', authenticateToken, checkAdmin, async (req, res) => {
    const { username, password, role } = req.body;
    try {
        const hashedPassword = await argon2.hash(password);
        const result = await pool.query(`INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING id, username, role;`, [username, hashedPassword, role]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'Username already exists' });
        res.status(500).json({ error: 'Failed to add user' });
    }
});

app.delete('/api/users/:id', authenticateToken, checkAdmin, async (req, res) => {
    const { id } = req.params;
    if (parseInt(id, 10) === req.user.id) return res.status(400).json({ error: 'Admin cannot delete their own account.' });
    try {
        await pool.query('DELETE FROM users WHERE id = $1;', [id]);
        res.status(204).send();
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

app.get('/api/settings', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM system_settings WHERE id = 1;');
        if (result.rows.length === 0) return res.status(404).json({ error: 'System settings not found.'});
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
});

app.put('/api/settings', authenticateToken, checkAdmin, async (req, res) => {
    const s = req.body;
    try {
        const params = [s.defaultCCEmail, s.companyName, parseInt(s.reminderDaysBefore), s.dateFormat, s.currencySymbol, parseInt(s.sessionTimeout), parseInt(s.maxRecordsPerPage)];
        const result = await pool.query(`UPDATE system_settings SET default_cc_email = $1, company_name = $2, reminder_days_before = $3, date_format = $4, currency_symbol = $5, session_timeout = $6, max_records_per_page = $7 WHERE id = 1 RETURNING *;`, params);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

app.get('/api/agents', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT name FROM agents ORDER BY name;');
        res.json(result.rows);
    } catch(err) {
        res.status(500).json({ error: 'Failed to fetch agents'});
    }
});

app.get('/api/activity-logs', authenticateToken, checkAdmin, async (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    try {
        const result = await pool.query('SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT $1;', [limit]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch activity logs' });
    }
});

// --- Report Endpoints ---
app.get('/api/reports', authenticateToken, async (req, res) => {
    try {
        let query = 'SELECT * FROM agreements';
        const params = [];
        let whereClauses = [];

        if (req.query.agentName) {
            params.push(req.query.agentName);
            whereClauses.push(`agent_name = $${params.length}`);
        }
        if (req.query.expiryFromDate && req.query.expiryToDate) {
            params.push(req.query.expiryFromDate);
            whereClauses.push(`expiry_date >= $${params.length}`);
            params.push(req.query.expiryToDate);
            whereClauses.push(`expiry_date <= $${params.length}`);
        }
        if (req.query.pendingAmount) {
            if (req.query.pendingAmount === 'greater') whereClauses.push('payment_due > 0');
            else if (req.query.pendingAmount === 'less') whereClauses.push('payment_due < 0');
        }
        
        if (whereClauses.length > 0) query += ' WHERE ' + whereClauses.join(' AND ');
        query += ' ORDER BY created_at DESC;';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Report generation error:', err);
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

app.get('/api/reports/profit', authenticateToken, async (req, res) => {
    try {
        let detailsQuery = `SELECT agent_name, owner_name, token_number, total_payment, actual_cost, agent_commission, other_expenses, net_profit, profit_margin FROM agreements`;
        let summaryQuery = `SELECT SUM(total_payment) as total_revenue, SUM(net_profit) as total_profit, AVG(profit_margin) as average_margin FROM agreements`;
        const params = [];
        let whereClauses = [];

        if (req.query.fromDate && req.query.toDate) {
            params.push(req.query.fromDate);
            whereClauses.push(`agreement_date >= $${params.length}`);
            params.push(req.query.toDate);
            whereClauses.push(`agreement_date <= $${params.length}`);
        }
        if (req.query.agentName) {
            params.push(req.query.agentName);
            whereClauses.push(`agent_name = $${params.length}`);
        }

        if (whereClauses.length > 0) {
            const whereString = ' WHERE ' + whereClauses.join(' AND ');
            detailsQuery += whereString;
            summaryQuery += whereString;
        }

        const detailsResult = await pool.query(detailsQuery, params);
        const summaryResult = await pool.query(summaryQuery, params);
        const topAgentQuery = `SELECT agent_name, SUM(net_profit) as total_profit FROM agreements ${whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : ''} GROUP BY agent_name ORDER BY total_profit DESC LIMIT 1;`;
        const topAgentResult = await pool.query(topAgentQuery, params);
        
        res.json({
            details: detailsResult.rows,
            summary: summaryResult.rows[0],
            topAgent: topAgentResult.rows.length > 0 ? topAgentResult.rows[0].agent_name : '-'
        });
    } catch (err) {
        console.error('Profit report error:', err);
        res.status(500).json({ error: 'Failed to generate profit report' });
    }
});

// --- Final Setup ---
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

initDb().catch(e => console.error(e));

const PORT = process.env.PORT || 8000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});