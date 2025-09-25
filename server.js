require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
const path = require('path');
app.use(express.static(path.join(__dirname)));

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Simple base64 hashing for passwords
const simpleHash = (password) => {
  return Buffer.from(password).toString('base64');
};

// Initialize database tables for Agreement Manager
// Add this to your server.js
	async function initializeDatabase() {
	  try {
		console.log('Initializing Agreement Manager database...');

		// Creates the 'agreements' table with all the correct columns
		await pool.query(`
		  CREATE TABLE IF NOT EXISTS agreements (
			id SERIAL PRIMARY KEY,
			owner_name VARCHAR(255) NOT NULL,
			location VARCHAR(255) NOT NULL,
			token_number VARCHAR(100) UNIQUE NOT NULL,
			agreement_date DATE,
			owner_contact VARCHAR(20),
			tenant_contact VARCHAR(20),
			email VARCHAR(255),
			expiry_date DATE,
			reminder_date DATE,
			cc_email VARCHAR(255) DEFAULT 'support@ramnathshetty.com',
			agent_name VARCHAR(255),
			total_payment DECIMAL(15,2) DEFAULT 0,
			payment_owner DECIMAL(15,2) DEFAULT 0,
			payment_tenant DECIMAL(15,2) DEFAULT 0,
			payment_received_date1 DATE,
			payment_received_date2 DATE,
			payment_due DECIMAL(15,2) DEFAULT 0,
			agreement_status VARCHAR(100) DEFAULT 'Drafted',
			biometric_date DATE,
			actual_cost DECIMAL(15,2) DEFAULT 0,
			agent_commission DECIMAL(15,2) DEFAULT 0,
			other_expenses DECIMAL(15,2) DEFAULT 0,
			gross_profit DECIMAL(15,2) DEFAULT 0,
			net_profit DECIMAL(15,2) DEFAULT 0,
			profit_margin DECIMAL(5,2) DEFAULT 0,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		  )`);

		// Creates the 'users' table (syntax corrected)
		await pool.query(`
		  CREATE TABLE IF NOT EXISTS users (
			id SERIAL PRIMARY KEY,
			username VARCHAR(50) UNIQUE,
			password VARCHAR(255),
			role VARCHAR(20),
			status VARCHAR(20) DEFAULT 'Active',
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		  )`);

		// Creates the 'activity_logs' table
		await pool.query(`
		  CREATE TABLE IF NOT EXISTS activity_logs (
			id SERIAL PRIMARY KEY,
			username VARCHAR(50),
			action VARCHAR(255),
			details TEXT,
			ip_address VARCHAR(45),
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		  )`);

		// Creates the 'system_settings' table
		await pool.query(`
		  CREATE TABLE IF NOT EXISTS system_settings (
			id SERIAL PRIMARY KEY,
			setting_key VARCHAR(100) UNIQUE,
			setting_value TEXT,
			description TEXT,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		  )`);

		// Checks if the 'users' table is empty before creating default users
		const userCheck = await pool.query('SELECT COUNT(*) FROM users');
		if (parseInt(userCheck.rows[0].count) === 0) {
			console.log('No users found. Creating default users from environment variables...');

			// Reads passwords from your Railway variables
			const defaultUsers = [
				{ username: 'admin', password: process.env.DEFAULT_ADMIN_PASSWORD, role: 'admin' },
				{ username: 'user', password: process.env.DEFAULT_USER_PASSWORD, role: 'user' },
				{ username: 'agent', password: process.env.DEFAULT_AGENT_PASSWORD, role: 'agent' },
				{ username: 'manager', password: process.env.DEFAULT_MANAGER_PASSWORD, role: 'manager' }
			];

			for (const user of defaultUsers) {
				if (user.password) {
					const hashedPassword = simpleHash(user.password);
					await pool.query(`INSERT INTO users (username, password, role) VALUES ($1, $2, $3)`, [user.username, hashedPassword, user.role]);
				}
			}
			console.log('✅ Default users created successfully.');
		}

		// Checks if 'system_settings' is empty before inserting defaults
		const settingsCheck = await pool.query('SELECT COUNT(*) FROM system_settings');
		if (parseInt(settingsCheck.rows[0].count) === 0) {
			console.log('Inserting default system settings...');
			const defaultSettings = [
				{ key: 'default_cc_email', value: 'support@ramnathshetty.com', description: 'Default CC email address' },
				{ key: 'company_name', value: 'Shetty Legal Advisors', description: 'Company name for correspondence' },
				{ key: 'reminder_days_before', value: '30', description: 'Days before expiry to send reminders' },
				{ key: 'date_format', value: 'DD-MM-YYYY', description: 'Default date format' },
				{ key: 'currency_symbol', value: '₹', description: 'Default currency symbol' },
				{ key: 'session_timeout', value: '60', description: 'Session timeout in minutes' }
			];
			for (const setting of defaultSettings) {
				await pool.query(`INSERT INTO system_settings (setting_key, setting_value, description) VALUES ($1, $2, $3)`, 
					[setting.key, setting.value, setting.description]);
			}
			console.log('✅ Default settings created successfully.');
		}

		console.log('✅ Agreement Manager database initialized successfully');
	  } catch (error) {
		console.error('❌ Error initializing database:', error);
	  }
	}	

   
// Add these to your server.js

// Profit reports endpoint
app.get('/api/reports/profit', async (req, res) => {
    try {
        const { from, to, agent } = req.query;
        let query = 'SELECT * FROM agreements WHERE agreement_date BETWEEN $1 AND $2';
        let params = [from, to];
        
        if (agent) {
            query += ' AND agent_name = $3';
            params.push(agent);
        }
        
        query += ' ORDER BY net_profit DESC';
        
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Token number uniqueness check
app.get('/api/agreements/check-token', async (req, res) => {
    try {
        const { token } = req.query;
        const result = await pool.query('SELECT id FROM agreements WHERE token_number = $1', [token]);
        res.json({ unique: result.rows.length === 0 });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Backup restoration endpoint
app.post('/api/backup/restore', async (req, res) => {
    try {
        const { agreements } = req.body;
        
        // Clear existing data
        await pool.query('DELETE FROM agreements');
        
        // Restore agreements
        for (const agreement of agreements) {
            await pool.query(`
                INSERT INTO agreements (
                    owner_name, location, token_number, agreement_date, owner_contact, 
                    tenant_contact, email, expiry_date, reminder_date, cc_email, 
                    agent_name, total_payment, payment_owner, payment_tenant, 
                    payment_received_date1, payment_received_date2, payment_due, 
                    agreement_status, biometric_date, actual_cost, agent_commission, 
                    other_expenses, gross_profit, net_profit, profit_margin
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
            `, [
                agreement.owner_name, agreement.location, agreement.token_number, 
                agreement.agreement_date, agreement.owner_contact, agreement.tenant_contact,
                agreement.email, agreement.expiry_date, agreement.reminder_date, 
                agreement.cc_email, agreement.agent_name, agreement.total_payment,
                agreement.payment_owner, agreement.payment_tenant, 
                agreement.payment_received_date1, agreement.payment_received_date2,
                agreement.payment_due, agreement.agreement_status, agreement.biometric_date,
                agreement.actual_cost, agreement.agent_commission, agreement.other_expenses,
                agreement.gross_profit, agreement.net_profit, agreement.profit_margin
            ]);
        }
        
        res.json({ message: 'Backup restored successfully', restored: agreements.length });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ===== DEBUG ENDPOINTS =====
app.get('/api/debug/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, role, password FROM users ORDER BY id');
    res.json({ users: result.rows });
  } catch (error) { res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/debug/agreements', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM agreements ORDER BY created_at DESC');
    res.json({ agreements: result.rows });
  } catch (error) { res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/debug/reset-db', async (req, res) => {
  try {
    await pool.query('DROP TABLE IF EXISTS agreements, users, activity_logs, system_settings CASCADE');
    await initializeDatabase();
    res.json({ message: 'Database reset successfully' });
  } catch (error) { res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/test', (req, res) => {
    res.json({ 
        message: 'API is working!', 
        timestamp: new Date().toISOString(),
        users: ['Try: admin/admin123', 'user/user123', 'agent/agent123', 'manager/manager123']
    });
})

// ===== AUTHENTICATION ROUTES =====

// ===== PASSWORD CHANGE ENDPOINT =====
app.put('/api/users/change-password', async (req, res) => {
  try {
    const { username, currentPassword, newPassword } = req.body;
    
    if (!username || !currentPassword || !newPassword) {
      return res.status(400).json({ error: 'All password fields are required' });
    }
    
    // Verify current password
    const userResult = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = userResult.rows[0];
    const currentHashedPassword = simpleHash(currentPassword);
    
    if (currentHashedPassword !== user.password) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    
    // Update password
    const newHashedPassword = simpleHash(newPassword);
    await pool.query('UPDATE users SET password = $1 WHERE username = $2', [newHashedPassword, username]);
    
    // Log activity
    await pool.query('INSERT INTO activity_logs (username, action, details) VALUES ($1, $2, $3)', 
      [username, 'Password Change', 'User changed password successfully']);
    
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const userResult = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const user = userResult.rows[0];
    const base64Password = simpleHash(password);

    // Check if password matches
    if (base64Password === user.password) {
      // Log login activity
      await pool.query('INSERT INTO activity_logs (username, action, details) VALUES ($1, $2, $3)', 
        [username, 'Login', 'User logged in successfully']);
      
      return res.json({ 
        message: 'Login successful', 
        username: user.username, 
        role: user.role,
        token: 'agreement-manager-token' // Simple token for demo
      });
    }

    // Check default passwords for migration
    const defaultPasswords = {
      'admin': 'admin123', 
      'user': 'user123', 
      'agent': 'agent123', 
      'manager': 'manager123'
    };

    if (defaultPasswords[username] === password) {
      const newHashedPassword = simpleHash(password);
      await pool.query('UPDATE users SET password = $1 WHERE username = $2', [newHashedPassword, username]);
      
      await pool.query('INSERT INTO activity_logs (username, action, details) VALUES ($1, $2, $3)', 
        [username, 'Login', 'User logged in and password migrated']);
      
      return res.json({ 
        message: 'Login successful (password migrated)', 
        username: user.username, 
        role: user.role,
        token: 'agreement-manager-token'
      });
    }

    return res.status(401).json({ error: 'Invalid username or password' });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== AGREEMENTS API ROUTES =====
app.get('/api/agreements', async (req, res) => {
  try { 
    const result = await pool.query('SELECT * FROM agreements ORDER BY created_at DESC'); 
    res.json(result.rows); 
  } catch (error) { 
    console.error('Error fetching agreements:', error);
    res.status(500).json({ error: 'Internal server error' }); 
  }
});

// Add this route for deleting users
app.delete('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Prevent deletion of the primary admin user (optional but good practice)
    if (id === '1') {
      return res.status(403).json({ error: 'Cannot delete the primary admin account.' });
    }

    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING username', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: `User '${result.rows[0].username}' deleted successfully.` });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/agreements', async (req, res) => {
  try {
    const {
      ownerName, location, tokenNumber, agreementDate, ownerContact, tenantContact,
      email, expiryDate, reminderDate, ccEmail, agentName, totalPayment, paymentOwner,
      paymentTenant, paymentReceivedDate1, paymentReceivedDate2, paymentDue,
      agreementStatus, biometricDate
    } = req.body;

    // Validate required fields
    if (!ownerName || !location || !tokenNumber) {
      return res.status(400).json({ error: 'Owner name, location, and token number are required' });
    }

    const result = await pool.query(`
      INSERT INTO agreements (
        owner_name, location, token_number, agreement_date, owner_contact, tenant_contact,
        email, expiry_date, reminder_date, cc_email, agent_name, total_payment, payment_owner,
        payment_tenant, payment_received_date1, payment_received_date2, payment_due,
        agreement_status, biometric_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING *
    `, [
      ownerName, location, tokenNumber, agreementDate, ownerContact, tenantContact,
      email, expiryDate, reminderDate, ccEmail || 'support@ramnathshetty.com', agentName, 
      totalPayment || 0, paymentOwner || 0, paymentTenant || 0, paymentReceivedDate1, 
      paymentReceivedDate2, paymentDue || 0, agreementStatus || 'Drafted', biometricDate
    ]);

    // Log activity
    await pool.query('INSERT INTO activity_logs (username, action, details) VALUES ($1, $2, $3)', 
      ['system', 'Agreement Created', `Agreement added for ${ownerName} (Token: ${tokenNumber})`]);

    res.status(201).json(result.rows[0]);
  } catch (error) { 
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Token number already exists' });
    }
    console.error('Error creating agreement:', error);
    res.status(500).json({ error: 'Internal server error' }); 
  }
});

app.put('/api/agreements/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      ownerName, location, tokenNumber, agreementDate, ownerContact, tenantContact,
      email, expiryDate, reminderDate, ccEmail, agentName, totalPayment, paymentOwner,
      paymentTenant, paymentReceivedDate1, paymentReceivedDate2, paymentDue,
      agreementStatus, biometricDate
    } = req.body;

    const result = await pool.query(`
      UPDATE agreements SET 
        owner_name = $1, location = $2, token_number = $3, agreement_date = $4, 
        owner_contact = $5, tenant_contact = $6, email = $7, expiry_date = $8, 
        reminder_date = $9, cc_email = $10, agent_name = $11, total_payment = $12, 
        payment_owner = $13, payment_tenant = $14, payment_received_date1 = $15, 
        payment_received_date2 = $16, payment_due = $17, agreement_status = $18, 
        biometric_date = $19, updated_at = CURRENT_TIMESTAMP 
      WHERE id = $20 
      RETURNING *
    `, [
      ownerName, location, tokenNumber, agreementDate, ownerContact, tenantContact,
      email, expiryDate, reminderDate, ccEmail, agentName, totalPayment, paymentOwner,
      paymentTenant, paymentReceivedDate1, paymentReceivedDate2, paymentDue,
      agreementStatus, biometricDate, id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Agreement not found' });
    }

    // Log activity
    await pool.query('INSERT INTO activity_logs (username, action, details) VALUES ($1, $2, $3)', 
      ['system', 'Agreement Updated', `Agreement updated for ${ownerName} (ID: ${id})`]);

    res.json(result.rows[0]);
  } catch (error) { 
    console.error('Error updating agreement:', error);
    res.status(500).json({ error: 'Internal server error' }); 
  }
});


// ===== REPORTS API ROUTES =====
app.get('/api/reports/agent/:agentName', async (req, res) => {
  try {
    const { agentName } = req.params;
    const result = await pool.query('SELECT * FROM agreements WHERE agent_name = $1 ORDER BY created_at DESC', [agentName]);
    res.json(result.rows);
  } catch (error) { 
    console.error('Error generating agent report:', error);
    res.status(500).json({ error: 'Internal server error' }); 
  }
});

// Add this route to fetch a list of agents for dropdowns
app.get('/api/agents', async (req, res) => {
  try {
    const result = await pool.query("SELECT username as name FROM users WHERE role = 'agent' ORDER BY username");
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching agents:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/reports/expiring', async (req, res) => {
  try {
    const { from, to } = req.query;
    const result = await pool.query('SELECT * FROM agreements WHERE expiry_date BETWEEN $1 AND $2 ORDER BY expiry_date', [from, to]);
    res.json(result.rows);
  } catch (error) { 
    console.error('Error generating expiring report:', error);
    res.status(500).json({ error: 'Internal server error' }); 
  }
});

app.get('/api/reports/pending', async (req, res) => {
  try {
    const { filter } = req.query;
    let query = 'SELECT * FROM agreements WHERE payment_due > 0 ORDER BY payment_due DESC';
    
    if (filter === 'less') {
      query = 'SELECT * FROM agreements WHERE payment_due < 0 ORDER BY payment_due';
    }
    
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) { 
    console.error('Error generating pending report:', error);
    res.status(500).json({ error: 'Internal server error' }); 
  }
});

// ===== USERS MANAGEMENT =====
app.get('/api/users', async (req, res) => {
  try { 
    const result = await pool.query('SELECT id, username, role, status, created_at FROM users ORDER BY id'); 
    res.json(result.rows); 
  } catch (error) { 
    res.status(500).json({ error: 'Internal server error' }); 
  }
});

app.post('/api/users', async (req, res) => {
  try {
    const { username, password, role } = req.body;
    const hashedPassword = simpleHash(password);
    
    const result = await pool.query(`INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING id, username, role, status`, [username, hashedPassword, role]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Username already exists' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== SYSTEM SETTINGS =====
app.get('/api/settings', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM system_settings');
    const settings = {};
    result.rows.forEach(row => {
      settings[row.setting_key] = row.setting_value;
    });
    res.json(settings);
  } catch (error) { 
    res.status(500).json({ error: 'Internal server error' }); 
  }
});

app.put('/api/settings', async (req, res) => {
  try {
    const settings = req.body;
    
    for (const [key, value] of Object.entries(settings)) {
      await pool.query(`
        INSERT INTO system_settings (setting_key, setting_value) 
        VALUES ($1, $2) 
        ON CONFLICT (setting_key) 
        DO UPDATE SET setting_value = $2, updated_at = CURRENT_TIMESTAMP
      `, [key, value]);
    }
    
    res.json({ message: 'Settings updated successfully' });
  } catch (error) { 
    res.status(500).json({ error: 'Internal server error' }); 
  }
});

// ===== ACTIVITY LOGS =====
app.get('/api/activity-logs', async (req, res) => {
  try {
    const { limit = 100 } = req.query;
    const result = await pool.query('SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT $1', [limit]);
    res.json(result.rows);
  } catch (error) { 
    res.status(500).json({ error: 'Internal server error' }); 
  }
});

// ===== SERVER SETUP =====
app.get('/', (req, res) => { 
  res.sendFile(path.join(__dirname, 'index.html')); 
});

app.get('/health', (req, res) => { 
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(), 
    message: 'Agreement Manager Server is running correctly',
    version: '2.0.0'
  }); 
});

// 404 handler
app.use('*', (req, res) => { 
  res.status(404).json({ 
    error: 'Endpoint not found', 
    requestedUrl: req.originalUrl 
  }); 
});

// Initialize database and start server
initializeDatabase().then(() => {
  app.listen(port, () => {
    console.log('\n' + '='.repeat(60));
    console.log('📄 Agreement Manager Server Started');
    console.log('='.repeat(60));
    console.log(`📡 Server running on port ${port}`);
    console.log(`🌐 Local: http://localhost:${port}`);
    console.log(`❤️  Health check: http://localhost:${port}/health`);
    console.log(`🔍 Debug users: http://localhost:${port}/api/debug/users`);
    console.log('\n👤 Default Login Credentials:');
    console.log('   📋 admin / admin123 (Admin)');
    console.log('   📋 user / user123 (User)');
    console.log('   📋 agent / agent123 (Agent)');
    console.log('   📋 manager / manager123 (Manager)');
    console.log('='.repeat(60) + '\n');
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received');
  pool.end(() => {
    console.log('Database pool closed');
    process.exit(0);
  });
});