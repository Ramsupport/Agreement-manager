// server.js - Updated for frontend compatibility
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
    // Updated users table with additional fields
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY, 
        username TEXT UNIQUE NOT NULL, 
        password TEXT NOT NULL, 
        full_name TEXT,
        role TEXT NOT NULL, 
        status TEXT DEFAULT 'active',
        created_at TIMESTAMP DEFAULT now(),
        last_login TIMESTAMP
      );`);

    // Updated agreements table with all required fields
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agreements (
        id SERIAL PRIMARY KEY, 
        owner_name TEXT, 
        location TEXT, 
        token_number TEXT UNIQUE, 
        password TEXT,
        agreement_date DATE, 
        owner_contact TEXT, 
        tenant_contact TEXT, 
        email TEXT, 
        expiry_date DATE, 
        reminder_date DATE, 
        cc_email TEXT,
        staff_name TEXT,
        total_payment NUMERIC DEFAULT 0,
        payment_owner NUMERIC DEFAULT 0,
        payment_date1 DATE,
        payment_date2 DATE,
        payment_tenant NUMERIC DEFAULT 0,
        payment_due NUMERIC DEFAULT 0,
        sent_reminder INTEGER DEFAULT 0,
        agreement_status TEXT,
        agent_name TEXT,
        biometric_date DATE,
        created_by TEXT,
        created_at TIMESTAMP DEFAULT now()
      );`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS agents (
        id SERIAL PRIMARY KEY, 
        name TEXT UNIQUE NOT NULL
      );`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id SERIAL PRIMARY KEY, 
        username TEXT, 
        action TEXT, 
        details TEXT, 
        ip_address TEXT, 
        created_at TIMESTAMP DEFAULT now()
      );`);

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
      );`);

    // Seed default data
    const usersRes = await pool.query(`SELECT COUNT(*) FROM users;`);
    if (parseInt(usersRes.rows[0].count) === 0) {
      const hashedPassword = await argon2.hash('admin123');
      await pool.query(
        `INSERT INTO users (username, password, full_name, role) VALUES ($1, $2, $3, $4);`, 
        ['admin', hashedPassword, 'Administrator', 'admin']
      );
      
      // Add sample users for frontend compatibility
      const sampleUsers = [
        ['user1', 'user123', 'Regular User', 'user'],
        ['Ram', 'ram123', 'Ram Kumar', 'admin'],
        ['Prema', 'prema123', 'Prema Singh', 'user'],
        ['agent', 'agent123', 'Agent Smith', 'agent'],
        ['executive', 'exec123', 'Executive Manager', 'executive']
      ];
      
      for (const [username, password, fullName, role] of sampleUsers) {
        const hashedPwd = await argon2.hash(password);
        await pool.query(
          `INSERT INTO users (username, password, full_name, role) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING;`, 
          [username, hashedPwd, fullName, role]
        );
      }
      console.log('Seeded default users.');
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
      await pool.query(
        `INSERT INTO system_settings (id, default_cc_email, company_name, reminder_days_before, date_format, currency_symbol, session_timeout, max_records_per_page) 
         VALUES (1, $1, $2, $3, $4, $5, $6, $7);`, 
        ['support@ramnathshetty.com', 'Shetty Legal Advisors', 30, 'DD-MM-YYYY', '₹', 60, 25]
      );
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

// --- Serve Static Files ---
app.use(express.static(path.join(__dirname)));

// --- API Routes ---

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'healthy', timestamp: new Date().toISOString() }));

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({ status: 'Backend is running', timestamp: new Date().toISOString() });
});

// Authentication
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1;', [username]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    
    const user = result.rows[0];
    const validPassword = await argon2.verify(user.password, password);
    if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });

    // Update last login
    await pool.query('UPDATE users SET last_login = $1 WHERE id = $2;', [new Date(), user.id]);

    const token = jwt.sign({ 
      id: user.id, 
      username: user.username, 
      role: user.role 
    }, JWT_SECRET, { expiresIn: '24h' });

    res.json({ 
      message: 'Login successful', 
      user: { 
        id: user.id, 
        username: user.username, 
        fullName: user.full_name || user.username,
        role: user.role, 
        status: user.status || 'active',
        token 
      } 
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during authentication' });
  }
});

// Change password
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

// Agreements endpoints
app.get('/api/agreements', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM agreements ORDER BY created_at DESC;');
    res.json({ agreements: result.rows });
  } catch (err) {
    console.error('Fetch agreements error:', err);
    res.status(500).json({ error: 'Failed to fetch agreements' });
  }
});

app.post('/api/agreements', authenticateToken, async (req, res) => {
  const data = req.body;
  try {
    const params = [
      data.ownerName,
      data.location,
      data.tokenNumber,
      data.password || '',
      data.agreementDate || null,
      data.ownerContact || '',
      data.tenantContact || '',
      data.email || '',
      data.expiryDate || null,
      data.reminderDate || null,
      data.ccEmail || 'support@ramnathshetty.com',
      data.staffName || '',
      parseFloat(data.totalPayment) || 0,
      parseFloat(data.ownerPayment) || 0,
      data.paymentDate1 || null,
      data.paymentDate2 || null,
      parseFloat(data.tenantPayment) || 0,
      parseFloat(data.paymentDue) || 0,
      parseInt(data.sentReminder) || 0,
      data.agreementStatus || 'Drafted',
      data.agentName || '',
      data.biometricDate || null,
      req.user.username
    ];

    const result = await pool.query(`
      INSERT INTO agreements (
        owner_name, location, token_number, password, agreement_date, owner_contact, 
        tenant_contact, email, expiry_date, reminder_date, cc_email, staff_name,
        total_payment, payment_owner, payment_date1, payment_date2, payment_tenant,
        payment_due, sent_reminder, agreement_status, agent_name, biometric_date, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23) 
      RETURNING *;`, params);
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Save agreement error:', err);
    if (err.code === '23505') return res.status(409).json({ error: 'Token number already exists' });
    res.status(500).json({ error: 'Failed to save agreement' });
  }
});

app.get('/api/agreements/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM agreements WHERE id = $1;', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Agreement not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch agreement' });
  }
});

app.put('/api/agreements/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const data = req.body;
  try {
    const params = [
      data.ownerName,
      data.location,
      data.tokenNumber,
      data.password || '',
      data.agreementDate || null,
      data.ownerContact || '',
      data.tenantContact || '',
      data.email || '',
      data.expiryDate || null,
      data.reminderDate || null,
      data.ccEmail || 'support@ramnathshetty.com',
      data.staffName || '',
      parseFloat(data.totalPayment) || 0,
      parseFloat(data.ownerPayment) || 0,
      data.paymentDate1 || null,
      data.paymentDate2 || null,
      parseFloat(data.tenantPayment) || 0,
      parseFloat(data.paymentDue) || 0,
      parseInt(data.sentReminder) || 0,
      data.agreementStatus || 'Drafted',
      data.agentName || '',
      data.biometricDate || null,
      id
    ];

    const result = await pool.query(`
      UPDATE agreements SET 
        owner_name = $1, location = $2, token_number = $3, password = $4, agreement_date = $5, 
        owner_contact = $6, tenant_contact = $7, email = $8, expiry_date = $9, reminder_date = $10, 
        cc_email = $11, staff_name = $12, total_payment = $13, payment_owner = $14, payment_date1 = $15, 
        payment_date2 = $16, payment_tenant = $17, payment_due = $18, sent_reminder = $19, 
        agreement_status = $20, agent_name = $21, biometric_date = $22
      WHERE id = $23 RETURNING *;`, params);
    
    if (result.rows.length === 0) return res.status(404).json({ error: 'Agreement not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update agreement error:', err);
    res.status(500).json({ error: 'Failed to update agreement' });
  }
});

app.delete('/api/agreements/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM agreements WHERE id = $1;', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Agreement not found' });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete agreement' });
  }
});

// Users management
app.get('/api/users', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, full_name, role, status, created_at, last_login FROM users ORDER BY username;');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.post('/api/users', authenticateToken, checkAdmin, async (req, res) => {
  const { username, password, role, fullName } = req.body;
  try {
    const hashedPassword = await argon2.hash(password);
    const result = await pool.query(
      `INSERT INTO users (username, password, full_name, role) VALUES ($1, $2, $3, $4) 
       RETURNING id, username, full_name, role, status;`, 
      [username, hashedPassword, fullName || username, role]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username already exists' });
    res.status(500).json({ error: 'Failed to add user' });
  }
});

app.delete('/api/users/:id', authenticateToken, checkAdmin, async (req, res) => {
  const { id } = req.params;
  if (parseInt(id, 10) === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account.' });
  try {
    const result = await pool.query('DELETE FROM users WHERE id = $1;', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// System info
app.get('/api/system/info', authenticateToken, async (req, res) => {
  try {
    const agreementsCount = await pool.query('SELECT COUNT(*) FROM agreements;');
    const usersCount = await pool.query('SELECT COUNT(*) FROM users;');
    
    res.json({
      totalRecords: parseInt(agreementsCount.rows[0].count),
      totalUsers: parseInt(usersCount.rows[0].count),
      appVersion: '2.0.0',
      dbStatus: 'Connected'
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get system info' });
  }
});

// Backup/Export
app.get('/api/backup/export', authenticateToken, async (req, res) => {
  try {
    const agreements = await pool.query('SELECT * FROM agreements;');
    const users = await pool.query('SELECT username, full_name, role, status, created_at FROM users;');
    
    const backupData = {
      agreements: agreements.rows,
      users: users.rows,
      timestamp: new Date().toISOString(),
      version: '2.0'
    };
    
    res.json(backupData);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create backup' });
  }
});

// Import backup
app.post('/api/backup/import', authenticateToken, checkAdmin, async (req, res) => {
  const { agreements, users } = req.body;
  try {
    // Clear existing data
    await pool.query('DELETE FROM agreements;');
    await pool.query('DELETE FROM users WHERE role != $1;', ['admin']);
    
    // Import agreements
    for (const agreement of agreements) {
      await pool.query(`
        INSERT INTO agreements (
          owner_name, location, token_number, password, agreement_date, owner_contact, 
          tenant_contact, email, expiry_date, reminder_date, cc_email, staff_name,
          total_payment, payment_owner, payment_date1, payment_date2, payment_tenant,
          payment_due, sent_reminder, agreement_status, agent_name, biometric_date, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23) 
        ON CONFLICT (token_number) DO NOTHING;`, 
        Object.values(agreement)
      );
    }
    
    // Import users (skip if username exists to preserve admin)
    for (const user of users) {
      if (user.username !== 'admin') {
        await pool.query(`
          INSERT INTO users (username, full_name, role, status) 
          VALUES ($1, $2, $3, $4) ON CONFLICT (username) DO NOTHING;`, 
          [user.username, user.full_name, user.role, user.status || 'active']
        );
      }
    }
    
    res.json({ message: 'Backup imported successfully', imported: { agreements: agreements.length, users: users.length } });
  } catch (err) {
    console.error('Import backup error:', err);
    res.status(500).json({ error: 'Failed to import backup' });
  }
});

// Reports
app.get('/api/reports', authenticateToken, async (req, res) => {
  try {
    let query = 'SELECT * FROM agreements';
    const params = [];
    let whereClauses = [];

    if (req.query.agentName) {
      params.push(req.query.agentName);
      whereClauses.push(`agent_name = $${params.length}`);
    }
    if (req.query.ownerName) {
      params.push(req.query.ownerName);
      whereClauses.push(`owner_name = $${params.length}`);
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

// Profit reports
app.get('/api/reports/profit', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        token_number,
        owner_name,
        total_payment as revenue,
        (total_payment * 0.3) as estimated_expenses,
        (total_payment - (total_payment * 0.3)) as profit,
        agreement_status
      FROM agreements 
      ORDER BY created_at DESC;`);
    
    res.json(result.rows);
  } catch (err) {
    console.error('Profit report error:', err);
    res.status(500).json({ error: 'Failed to generate profit report' });
  }
});

// Agents list
app.get('/api/agents', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT name FROM agents ORDER BY name;');
    res.json(result.rows.map(row => row.name));
  } catch(err) {
    res.status(500).json({ error: 'Failed to fetch agents'});
  }
});

// Settings
app.get('/api/settings', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM system_settings WHERE id = 1;');
    if (result.rows.length === 0) return res.status(404).json({ error: 'System settings not found.'});
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Catch-all handler for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Initialize database and start server
initDb().then(() => {
  const PORT = process.env.PORT || 8000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Health check available at: http://localhost:${PORT}/api/health`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});