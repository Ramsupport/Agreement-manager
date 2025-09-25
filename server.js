<script>
// Cloud-based API functions
const API_BASE_URL = '/api';

// Authentication functions
async function handleLogin(event) {
    if (event) event.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    if (!username || !password) {
        showNotification('Please enter both username and password', 'error');
        return;
    }

    try {
        console.log('Attempting login for user:', username);
        
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username, password })
        });

        const responseData = await response.json();
        console.log('Login response:', responseData);

        if (response.ok) {
            // Store JWT token properly
            localStorage.setItem('authToken', responseData.user.token);
            localStorage.setItem('currentUser', responseData.user.username);
            localStorage.setItem('userRole', responseData.user.role);
            localStorage.setItem('userId', responseData.user.id);
            
            showNotification('Login successful!', 'success');
            document.getElementById('loginContainer').style.display = 'none';
            document.getElementById('mainApp').style.display = 'block';
            document.getElementById('currentUser').textContent = responseData.user.username;
            document.getElementById('currentUserInfo').textContent = responseData.user.username;
            document.getElementById('loginTime').textContent = new Date().toLocaleString();
            
            // Load initial data
            await loadAgreements();
            await loadSystemSettings();
        } else {
            throw new Error(responseData.error || 'Login failed');
        }
    } catch (error) {
        console.error('Login error:', error);
        showNotification(error.message || 'Login failed. Please check credentials.', 'error');
    }
}

function logout() {
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUser');
    localStorage.removeItem('userRole');
    localStorage.removeItem('userId');
    document.getElementById('mainApp').style.display = 'none';
    document.getElementById('loginContainer').style.display = 'flex';
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    showNotification('Logged out successfully', 'success');
}

// Enhanced API call helper with JWT authentication
async function apiCall(endpoint, options = {}) {
    const token = localStorage.getItem('authToken');
    
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
            ...(token && { 'Authorization': `Bearer ${token}` }),
            ...options.headers
        }
    };

    try {
        console.log('API Call:', endpoint);
        const response = await fetch(`/api${endpoint}`, { ...defaultOptions, ...options });
        
        if (response.status === 401) {
            showNotification('Session expired. Please login again.', 'error');
            logout();
            throw new Error('Authentication required');
        }
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(errorData.error || `HTTP ${response.status}`);
        }
        
        return response;
    } catch (error) {
        console.error('API call error:', error);
        showNotification(error.message || 'Network error. Please try again.', 'error');
        throw error;
    }
}

// Check authentication on page load
function checkAuth() {
    const token = localStorage.getItem('authToken');
    const user = localStorage.getItem('currentUser');
    
    if (token && user) {
        document.getElementById('loginContainer').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        document.getElementById('currentUser').textContent = user;
        document.getElementById('currentUserInfo').textContent = user;
        document.getElementById('loginTime').textContent = new Date().toLocaleString();
        loadAgreements();
        loadSystemSettings();
    }
}

// Tab management
function showTab(tabName, element) {
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    document.getElementById(tabName).classList.add('active');
    element.classList.add('active');
    
    loadTabData(tabName);
}

// Load tab-specific data
async function loadTabData(tabName) {
    try {
        switch(tabName) {
            case 'agreements':
                await loadAgreements();
                break;
            case 'reports':
                await loadAgentsForReports();
                break;
            case 'logs':
                await loadActivityLogs();
                break;
            case 'settings':
                await loadSystemSettings();
                await loadUsers();
                break;
        }
    } catch (error) {
        console.error(`Error loading ${tabName} data:`, error);
    }
}

// Notification function
function showNotification(message, type = 'success') {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notification.classList.add('show');
    
    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

// Profit calculation function
function calculateProfit() {
    const totalPayment = parseFloat(document.getElementById('totalPayment').value) || 0;
    const actualCost = parseFloat(document.getElementById('actualCost').value) || 0;
    const agentCommission = parseFloat(document.getElementById('agentCommission').value) || 0;
    const otherExpenses = parseFloat(document.getElementById('otherExpenses').value) || 0;
    
    const grossProfit = totalPayment - actualCost;
    const netProfit = grossProfit - agentCommission - otherExpenses;
    const profitMargin = totalPayment > 0 ? (netProfit / totalPayment) * 100 : 0;
    
    document.getElementById('grossProfit').value = grossProfit.toFixed(2);
    document.getElementById('netProfit').value = netProfit.toFixed(2);
    document.getElementById('profitMargin').value = profitMargin.toFixed(2);
}

// Calculate due amount
function calculateDue() {
    const total = parseFloat(document.getElementById('totalPayment').value) || 0;
    const owner = parseFloat(document.getElementById('paymentOwner').value) || 0;
    const tenant = parseFloat(document.getElementById('paymentTenant').value) || 0;
    const due = total - owner - tenant;
    document.getElementById('paymentDue').value = due.toFixed(2);
    calculateProfit(); // Recalculate profit when payment changes
}

// Load agreements
async function loadAgreements() {
    try {
        const response = await apiCall('/agreements');
        const agreements = await response.json();
        displayAgreements(agreements.agreements || agreements);
    } catch (error) {
        console.error('Error loading agreements:', error);
        showNotification('Error loading agreements', 'error');
    }
}

// Display agreements
function displayAgreements(agreements) {
    const tbody = document.querySelector('#agreementsTable tbody');
    tbody.innerHTML = '';

    if (!agreements || agreements.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="11" style="text-align: center; padding: 20px; color: #666;">
                    No agreements found. Click "Add Agreement" to create your first agreement.
                </td>
            </tr>
        `;
        return;
    }

    agreements.forEach(agreement => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${escapeHtml(agreement.owner_name || '-')}</td>
            <td>${escapeHtml(agreement.location || '-')}</td>
            <td>${escapeHtml(agreement.token_number || '-')}</td>
            <td>${escapeHtml(agreement.owner_contact || '-')}</td>
            <td>${escapeHtml(agreement.tenant_contact || '-')}</td>
            <td>${escapeHtml(agreement.agent_name || '-')}</td>
            <td>${formatCurrency(agreement.total_payment || 0)}</td>
            <td>${formatCurrency(agreement.payment_due || 0)}</td>
            <td>${escapeHtml(agreement.agreement_status || '-')}</td>
            <td>${formatDate(agreement.expiry_date)}</td>
            <td>
                <button class="btn btn-warning" onclick="editAgreement(${agreement.id})" style="padding: 5px 10px; font-size: 12px;">Edit</button>
                <button class="btn btn-danger" onclick="deleteAgreement(${agreement.id})" style="padding: 5px 10px; font-size: 12px;">Delete</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

// Collect agreement data from form
function collectAgreementData() {
    return {
        ownerName: document.getElementById('ownerName').value,
        location: document.getElementById('location').value,
        tokenNumber: document.getElementById('tokenNumber').value,
        agreementDate: document.getElementById('agreementDate').value,
        ownerContact: document.getElementById('ownerContact').value,
        tenantContact: document.getElementById('tenantContact').value,
        email: document.getElementById('email').value,
        expiryDate: document.getElementById('expiryDate').value,
        reminderDate: document.getElementById('reminderDate').value,
        ccEmail: document.getElementById('ccEmail').value,
        agentName: document.getElementById('agentName').value,
        totalPayment: parseFloat(document.getElementById('totalPayment').value) || 0,
        paymentOwner: parseFloat(document.getElementById('paymentOwner').value) || 0,
        paymentTenant: parseFloat(document.getElementById('paymentTenant').value) || 0,
        paymentDue: parseFloat(document.getElementById('paymentDue').value) || 0,
        agreementStatus: document.getElementById('agreementStatus').value,
        biometricDate: document.getElementById('biometricDate').value,
        actualCost: parseFloat(document.getElementById('actualCost').value) || 0,
        agentCommission: parseFloat(document.getElementById('agentCommission').value) || 0,
        otherExpenses: parseFloat(document.getElementById('otherExpenses').value) || 0
    };
}

// Save agreement
async function saveAgreement() {
    try {
        const agreementData = collectAgreementData();
        
        if (!agreementData.tokenNumber) {
            showNotification('Token number is required', 'error');
            return;
        }

        showNotification('Saving agreement...', 'warning');
        
        const response = await apiCall('/agreements', {
            method: 'POST',
            body: JSON.stringify(agreementData)
        });

        if (response.ok) {
            showNotification('Agreement saved successfully!', 'success');
            clearForm();
            await loadAgreements();
        }
    } catch (error) {
        console.error('Save agreement error:', error);
        showNotification(error.message || 'Error saving agreement', 'error');
    }
}

// Clear form
function clearForm() {
    document.querySelectorAll('#agreements input, #agreements select').forEach(element => {
        if (element.id !== 'ccEmail' && !element.readOnly) {
            element.value = '';
        }
    });
}

// Delete agreement
async function deleteAgreement(id) {
    if (!confirm('Are you sure you want to delete this agreement?')) {
        return;
    }

    try {
        const response = await apiCall(`/agreements/${id}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            showNotification('Agreement deleted successfully!', 'success');
            await loadAgreements();
        }
    } catch (error) {
        showNotification('Error deleting agreement', 'error');
    }
}

// Edit agreement functionality
let currentEditId = null;

async function editAgreement(id) {
    try {
        const response = await apiCall(`/agreements/${id}`);
        const agreement = await response.json();
        
        currentEditId = id;
        
        // Populate edit form
        document.getElementById('editFormGrid').innerHTML = `
            <div class="form-field">
                <label>Owner Name</label>
                <input type="text" id="editOwnerName" value="${escapeHtml(agreement.owner_name || '')}">
            </div>
            <div class="form-field">
                <label>Token Number</label>
                <input type="text" id="editTokenNumber" value="${escapeHtml(agreement.token_number || '')}">
            </div>
            <div class="form-field">
                <label>Total Payment</label>
                <input type="number" id="editTotalPayment" value="${agreement.total_payment || 0}">
            </div>
            <!-- Add more fields as needed -->
        `;
        
        document.getElementById('editModal').style.display = 'block';
    } catch (error) {
        showNotification('Error loading agreement details', 'error');
    }
}

async function saveEditedAgreement() {
    if (!currentEditId) return;
    
    try {
        const updatedData = {
            ownerName: document.getElementById('editOwnerName').value,
            tokenNumber: document.getElementById('editTokenNumber').value,
            totalPayment: parseFloat(document.getElementById('editTotalPayment').value) || 0
            // Add more fields as needed
        };
        
        const response = await apiCall(`/agreements/${currentEditId}`, {
            method: 'PUT',
            body: JSON.stringify(updatedData)
        });
        
        if (response.ok) {
            showNotification('Agreement updated successfully!', 'success');
            closeEditModal();
            await loadAgreements();
        }
    } catch (error) {
        showNotification('Error updating agreement', 'error');
    }
}

function closeEditModal() {
    document.getElementById('editModal').style.display = 'none';
    currentEditId = null;
}

// Report functions
async function generateProfitReport() {
    try {
        const fromDate = document.getElementById('profitFromDate').value;
        const toDate = document.getElementById('profitToDate').value;
        const agent = document.getElementById('profitAgentFilter').value;
        
        if (!fromDate || !toDate) {
            showNotification('Please select both from and to dates', 'error');
            return;
        }
        
        let url = `/reports/profit?from=${fromDate}&to=${toDate}`;
        if (agent) url += `&agent=${encodeURIComponent(agent)}`;
        
        const response = await apiCall(url);
        const agreements = await response.json();
        
        displayReportResults(agreements);
        
        // Calculate summary
        const totalRevenue = agreements.reduce((sum, ag) => sum + parseFloat(ag.total_payment || 0), 0);
        const totalProfit = agreements.reduce((sum, ag) => sum + parseFloat(ag.net_profit || 0), 0);
        const avgMargin = agreements.length > 0 ? (totalProfit / totalRevenue) * 100 : 0;
        
        document.getElementById('totalRevenue').textContent = formatCurrency(totalRevenue);
        document.getElementById('totalProfit').textContent = formatCurrency(totalProfit);
        document.getElementById('averageMargin').textContent = avgMargin.toFixed(1) + '%';
        document.getElementById('profitSummary').style.display = 'grid';
        
    } catch (error) {
        showNotification('Error generating profit report', 'error');
    }
}

function displayReportResults(agreements) {
    const table = document.getElementById('reportTable');
    const tbody = table.querySelector('tbody');
    const noResults = document.getElementById('noResults');
    
    tbody.innerHTML = '';
    
    if (!agreements || agreements.length === 0) {
        table.style.display = 'none';
        noResults.style.display = 'block';
        return;
    }
    
    table.style.display = 'table';
    noResults.style.display = 'none';
    
    agreements.forEach(agreement => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${escapeHtml(agreement.owner_name || '-')}</td>
            <td>${escapeHtml(agreement.token_number || '-')}</td>
            <td>${escapeHtml(agreement.location || '-')}</td>
            <td>${formatCurrency(agreement.total_payment || 0)}</td>
            <td>${formatCurrency(agreement.payment_due || 0)}</td>
            <td>${escapeHtml(agreement.agent_name || '-')}</td>
        `;
        tbody.appendChild(row);
    });
}

// User management
async function addNewUser(event) {
    event.preventDefault();
    
    try {
        const username = document.getElementById('newUsername').value;
        const password = document.getElementById('newUserPassword').value;
        const role = document.getElementById('newUserRole').value;
        
        const response = await apiCall('/users', {
            method: 'POST',
            body: JSON.stringify({ username, password, role })
        });
        
        if (response.ok) {
            showNotification('User added successfully!', 'success');
            event.target.reset();
            await loadUsers();
        }
    } catch (error) {
        showNotification('Error adding user', 'error');
    }
}

async function loadUsers() {
    try {
        const response = await apiCall('/users');
        const users = await response.json();
        
        const tbody = document.querySelector('#usersTable tbody');
        tbody.innerHTML = '';
        
        users.forEach(user => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${escapeHtml(user.username)}</td>
                <td>${escapeHtml(user.role)}</td>
                <td>${formatDate(user.created_at)}</td>
                <td>
                    <button class="btn btn-danger" onclick="deleteUser(${user.id})" style="padding: 3px 8px; font-size: 11px;">Delete</button>
                </td>
            `;
            tbody.appendChild(row);
        });
        
        document.getElementById('userListContainer').style.display = 'block';
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

async function deleteUser(userId) {
    if (!confirm('Are you sure you want to delete this user?')) return;
    
    try {
        const response = await apiCall(`/users/${userId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showNotification('User deleted successfully!', 'success');
            await loadUsers();
        }
    } catch (error) {
        showNotification('Error deleting user', 'error');
    }
}

function showUserList() {
    loadUsers();
}

// Settings management
async function loadSystemSettings() {
    try {
        const response = await apiCall('/settings');
        const settings = await response.json();
        
        if (settings.default_cc_email) {
            document.getElementById('defaultCCEmail').value = settings.default_cc_email;
            document.getElementById('ccEmail').value = settings.default_cc_email;
        }
        if (settings.company_name) document.getElementById('companyName').value = settings.company_name;
        if (settings.reminder_days_before) document.getElementById('reminderDaysBefore').value = settings.reminder_days_before;
        if (settings.date_format) document.getElementById('dateFormat').value = settings.date_format;
        if (settings.currency_symbol) document.getElementById('currencySymbol').value = settings.currency_symbol;
        if (settings.max_records_per_page) document.getElementById('maxRecordsPerPage').value = settings.max_records_per_page;
        if (settings.session_timeout) document.getElementById('sessionTimeout').value = settings.session_timeout;
        
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

async function saveSystemSettings() {
    try {
        const settings = {
            default_cc_email: document.getElementById('defaultCCEmail').value,
            company_name: document.getElementById('companyName').value,
            reminder_days_before: parseInt(document.getElementById('reminderDaysBefore').value),
            date_format: document.getElementById('dateFormat').value,
            currency_symbol: document.getElementById('currencySymbol').value,
            max_records_per_page: parseInt(document.getElementById('maxRecordsPerPage').value),
            session_timeout: parseInt(document.getElementById('sessionTimeout').value)
        };
        
        const response = await apiCall('/settings', {
            method: 'PUT',
            body: JSON.stringify(settings)
        });
        
        if (response.ok) {
            showNotification('Settings saved successfully!', 'success');
        }
    } catch (error) {
        showNotification('Error saving settings', 'error');
    }
}

// Utility functions
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatCurrency(amount) {
    return `₹${parseFloat(amount).toFixed(2)}`;
}

function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN');
}

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    checkAuth();
    document.getElementById('buildDate').textContent = new Date().toISOString().split('T')[0];
    
    // Set default dates for reports
    const today = new Date().toISOString().split('T')[0];
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const oneMonthAgoStr = oneMonthAgo.toISOString().split('T')[0];
    
    document.getElementById('profitFromDate').value = oneMonthAgoStr;
    document.getElementById('profitToDate').value = today;
    document.getElementById('expiryFromDate').value = today;
    
    const threeMonthsLater = new Date();
    threeMonthsLater.setMonth(threeMonthsLater.getMonth() + 3);
    document.getElementById('expiryToDate').value = threeMonthsLater.toISOString().split('T')[0];
});

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('editModal');
    if (event.target === modal) {
        closeEditModal();
    }
}
</script>