// Woosh Lifts Admin Dashboard - Client-side Application

// Configuration
const BASE_URL = window.location.origin;
let ADMIN_TOKEN = localStorage.getItem('admin_token') || '';

// State
let currentPage = 'dashboard';
let dashboardData = null;
let refreshInterval = null;

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    // Check for admin token
    if (!ADMIN_TOKEN) {
        const token = prompt('Please enter your admin token:');
        if (token) {
            ADMIN_TOKEN = token;
            localStorage.setItem('admin_token', token);
        } else {
            alert('Admin token is required to use this application.');
            return;
        }
    }

    // Initial setup
    checkSystemStatus();
    loadDashboard();

    // Set up auto-refresh every 30 seconds
    refreshInterval = setInterval(() => {
        if (currentPage === 'dashboard') {
            loadDashboard();
        }
        checkSystemStatus();
    }, 30000);
});

// Navigation
function navigateTo(pageName) {
    // Update active nav item
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    event.target.closest('.nav-item').classList.add('active');

    // Update page title
    const titles = {
        'dashboard': 'Dashboard',
        'tickets': 'Tickets',
        'messages': 'Messages',
        'lifts': 'Lifts',
        'contacts': 'Contacts'
    };
    document.getElementById('page-title').textContent = titles[pageName] || pageName;

    // Show correct page
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });
    document.getElementById(`page-${pageName}`).classList.add('active');

    // Load page data
    currentPage = pageName;
    switch(pageName) {
        case 'dashboard':
            loadDashboard();
            break;
        case 'tickets':
            loadTickets();
            break;
        case 'messages':
            loadMessages();
            break;
        case 'lifts':
            loadLifts();
            break;
        case 'contacts':
            loadContacts();
            break;
    }
}

// API Helper
async function authFetch(url, options = {}) {
    const headers = {
        ...options.headers,
        'X-Admin-Token': ADMIN_TOKEN
    };
    
    const response = await fetch(url, { ...options, headers });
    
    if (response.status === 401 || response.status === 403) {
        localStorage.removeItem('admin_token');
        alert('Authentication failed. Please refresh and enter your token again.');
        throw new Error('Authentication failed');
    }
    
    return response;
}

// System Status Check
async function checkSystemStatus() {
    try {
        const response = await fetch(`${BASE_URL}/admin/status`);
        const data = await response.json();
        
        const statusEl = document.getElementById('system-status');
        if (data.ok && data.db) {
            statusEl.className = 'status-badge status-online';
            statusEl.innerHTML = '<div class="status-dot"></div><span>Online</span>';
        } else {
            statusEl.className = 'status-badge status-offline';
            statusEl.innerHTML = '<div class="status-dot"></div><span>Offline</span>';
        }
    } catch (error) {
        const statusEl = document.getElementById('system-status');
        statusEl.className = 'status-badge status-offline';
        statusEl.innerHTML = '<div class="status-dot"></div><span>Error</span>';
    }
}

// Dashboard
async function loadDashboard() {
    try {
        // Load stats and recent tickets
        const [liftsRes, contactsRes, ticketsRes] = await Promise.all([
            authFetch(`${BASE_URL}/admin/lifts`),
            authFetch(`${BASE_URL}/admin/contacts`),
            authFetch(`${BASE_URL}/admin/tickets?status=open&limit=5`)
        ]);

        const lifts = await liftsRes.json();
        const contacts = await contactsRes.json();
        const tickets = await ticketsRes.json();

        // Update stats
        document.getElementById('stat-total-lifts').textContent = lifts.data?.length || 0;
        document.getElementById('stat-total-contacts').textContent = contacts.data?.length || 0;
        document.getElementById('stat-active-tickets').textContent = 
            tickets.data?.filter(t => ['open', 'entrapment_awaiting_confirmation'].includes(t.status))?.length || 0;
        document.getElementById('stat-messages-today').textContent = '-'; // TODO: Add messages count

        // Render recent tickets
        renderRecentTickets(tickets.data || []);
        
    } catch (error) {
        console.error('Error loading dashboard:', error);
        document.getElementById('recent-tickets-list').innerHTML = 
            '<div class="empty-state"><h3>Error loading dashboard</h3><p>' + error.message + '</p></div>';
    }
}

function renderRecentTickets(tickets) {
    const container = document.getElementById('recent-tickets-list');
    
    if (!tickets || tickets.length === 0) {
        container.innerHTML = '<div class="empty-state"><h3>No recent tickets</h3><p>All clear!</p></div>';
        return;
    }

    container.innerHTML = `
        <table class="table">
            <thead>
                <tr>
                    <th>Ticket Ref</th>
                    <th>Lift</th>
                    <th>Status</th>
                    <th>Button Clicked</th>
                    <th>Created</th>
                </tr>
            </thead>
            <tbody>
                ${tickets.map(ticket => `
                    <tr>
                        <td><strong>${escapeHtml(ticket.ticket_reference || `#${ticket.id}`)}</strong></td>
                        <td>${escapeHtml(ticket.lift_name || 'Unknown')}</td>
                        <td>${renderStatusBadge(ticket.status)}</td>
                        <td>${ticket.button_clicked ? renderButtonBadge(ticket.button_clicked) : '-'}</td>
                        <td>${formatDateTime(ticket.created_at)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

// Tickets Page
async function loadTickets() {
    const container = document.getElementById('tickets-list');
    container.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading tickets...</p></div>';

    try {
        const response = await authFetch(`${BASE_URL}/admin/tickets`);
        const result = await response.json();

        if (!result.ok) {
            throw new Error(result.error?.message || 'Failed to load tickets');
        }

        const tickets = result.data || [];

        if (tickets.length === 0) {
            container.innerHTML = '<div class="empty-state"><h3>No tickets found</h3><p>No emergency tickets in the system.</p></div>';
            return;
        }

        container.innerHTML = `
            <table class="table">
                <thead>
                    <tr>
                        <th>Ticket Ref</th>
                        <th>Lift</th>
                        <th>Status</th>
                        <th>Button Clicked</th>
                        <th>Responded By</th>
                        <th>Reminders</th>
                        <th>Created</th>
                        <th>Resolved</th>
                    </tr>
                </thead>
                <tbody>
                    ${tickets.map(ticket => `
                        <tr>
                            <td><strong>${escapeHtml(ticket.ticket_reference || `#${ticket.id}`)}</strong></td>
                            <td>${escapeHtml(ticket.lift_name || 'Unknown')}</td>
                            <td>${renderStatusBadge(ticket.status)}</td>
                            <td>${ticket.button_clicked ? renderButtonBadge(ticket.button_clicked) : '-'}</td>
                            <td>${ticket.responded_by || '-'}</td>
                            <td>${ticket.reminder_count || 0}/3</td>
                            <td>${formatDateTime(ticket.created_at)}</td>
                            <td>${ticket.resolved_at ? formatDateTime(ticket.resolved_at) : '-'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

    } catch (error) {
        console.error('Error loading tickets:', error);
        container.innerHTML = '<div class="empty-state"><h3>Error loading tickets</h3><p>' + error.message + '</p></div>';
    }
}

// Messages Page
async function loadMessages() {
    const container = document.getElementById('messages-list');
    container.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading messages...</p></div>';

    try {
        const response = await authFetch(`${BASE_URL}/admin/messages?limit=50`);
        const result = await response.json();

        if (!result.ok) {
            throw new Error(result.error?.message || 'Failed to load messages');
        }

        const messages = result.data?.messages || [];

        if (messages.length === 0) {
            container.innerHTML = '<div class="empty-state"><h3>No messages found</h3><p>No messages in the system.</p></div>';
            return;
        }

        container.innerHTML = `
            <table class="table">
                <thead>
                    <tr>
                        <th>Direction</th>
                        <th>Type</th>
                        <th>Lift</th>
                        <th>Body</th>
                        <th>Status</th>
                        <th>Delivery Status</th>
                        <th>Sent</th>
                    </tr>
                </thead>
                <tbody>
                    ${messages.map(msg => `
                        <tr>
                            <td>${msg.direction === 'in' ? '<span class="badge badge-info">IN</span>' : '<span class="badge badge-success">OUT</span>'}</td>
                            <td><span class="badge badge-gray">${escapeHtml(msg.type || 'sms')}</span></td>
                            <td>${escapeHtml(msg.lift_name || 'Unknown')}</td>
                            <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(msg.body || '-')}</td>
                            <td><span class="badge badge-${msg.status === 'sent' ? 'success' : 'gray'}">${escapeHtml(msg.status || '-')}</span></td>
                            <td>${renderMessageStatus(msg)}</td>
                            <td>${formatDateTime(msg.ts)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

    } catch (error) {
        console.error('Error loading messages:', error);
        container.innerHTML = '<div class="empty-state"><h3>Error loading messages</h3><p>' + error.message + '</p></div>';
    }
}

// Lifts Page
async function loadLifts() {
    const container = document.getElementById('lifts-list');
    container.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading lifts...</p></div>';

    try {
        const response = await authFetch(`${BASE_URL}/admin/lifts`);
        const result = await response.json();

        if (!result.ok) {
            throw new Error(result.error?.message || 'Failed to load lifts');
        }

        const lifts = result.data || [];

        if (lifts.length === 0) {
            container.innerHTML = '<div class="empty-state"><h3>No lifts found</h3><p>No lifts registered in the system.</p></div>';
            return;
        }

        container.innerHTML = `
            <table class="table">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Site Name</th>
                        <th>Building</th>
                        <th>MSISDN</th>
                        <th>Notes</th>
                        <th>Created</th>
                    </tr>
                </thead>
                <tbody>
                    ${lifts.map(lift => `
                        <tr>
                            <td><strong>#${lift.id}</strong></td>
                            <td>${escapeHtml(lift.site_name || '-')}</td>
                            <td>${escapeHtml(lift.building || '-')}</td>
                            <td>${escapeHtml(lift.msisdn)}</td>
                            <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(lift.notes || '-')}</td>
                            <td>${formatDateTime(lift.created_at)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

    } catch (error) {
        console.error('Error loading lifts:', error);
        container.innerHTML = '<div class="empty-state"><h3>Error loading lifts</h3><p>' + error.message + '</p></div>';
    }
}

// Contacts Page
async function loadContacts() {
    const container = document.getElementById('contacts-list');
    container.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading contacts...</p></div>';

    try {
        const response = await authFetch(`${BASE_URL}/admin/contacts`);
        const result = await response.json();

        if (!result.ok) {
            throw new Error(result.error?.message || 'Failed to load contacts');
        }

        const contacts = result.data || [];

        if (contacts.length === 0) {
            container.innerHTML = '<div class="empty-state"><h3>No contacts found</h3><p>No contacts registered in the system.</p></div>';
            return;
        }

        container.innerHTML = `
            <table class="table">
                <thead>
                    <tr>
                        <th>Display Name</th>
                        <th>MSISDN</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Created</th>
                    </tr>
                </thead>
                <tbody>
                    ${contacts.map(contact => `
                        <tr>
                            <td><strong>${escapeHtml(contact.display_name || 'Unnamed')}</strong></td>
                            <td>${escapeHtml(contact.primary_msisdn)}</td>
                            <td>${escapeHtml(contact.email || '-')}</td>
                            <td><span class="badge badge-info">${escapeHtml(contact.role || 'none')}</span></td>
                            <td>${formatDateTime(contact.created_at)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

    } catch (error) {
        console.error('Error loading contacts:', error);
        container.innerHTML = '<div class="empty-state"><h3>Error loading contacts</h3><p>' + error.message + '</p></div>';
    }
}

// Rendering Helpers
function renderStatusBadge(status) {
    const badges = {
        'open': '<span class="badge badge-warning">Open</span>',
        'entrapment_awaiting_confirmation': '<span class="badge badge-danger">Awaiting Confirmation</span>',
        'resolved': '<span class="badge badge-success">Resolved</span>',
        'auto_closed': '<span class="badge badge-gray">Auto-Closed</span>'
    };
    return badges[status] || `<span class="badge badge-gray">${escapeHtml(status)}</span>`;
}

function renderButtonBadge(button) {
    const badges = {
        'test': '<span class="badge badge-info">Test</span>',
        'maintenance': '<span class="badge badge-warning">Maintenance</span>',
        'entrapment': '<span class="badge badge-danger">Entrapment</span>',
        'yes': '<span class="badge badge-success">Yes</span>'
    };
    return badges[button] || `<span class="badge badge-gray">${escapeHtml(button)}</span>`;
}

function renderMessageStatus(msg) {
    // Check for WhatsApp message with status tracking
    if (msg.wa_id && msg.current_status) {
        const icons = {
            'sent': '✓',
            'delivered': '✓✓',
            'read': '✓✓',
            'failed': '✗'
        };
        
        const classes = {
            'sent': 'msg-status-sent',
            'delivered': 'msg-status-delivered',
            'read': 'msg-status-read',
            'failed': 'msg-status-failed'
        };
        
        return `<span class="msg-status ${classes[msg.current_status] || 'msg-status-sent'}">
            ${icons[msg.current_status] || '?'} ${escapeHtml(msg.current_status)}
        </span>`;
    }
    
    return '-';
}

// Utility Functions
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDateTime(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    
    // If less than 1 minute ago
    if (diff < 60000) {
        return 'Just now';
    }
    
    // If less than 1 hour ago
    if (diff < 3600000) {
        const minutes = Math.floor(diff / 60000);
        return `${minutes}m ago`;
    }
    
    // If less than 24 hours ago
    if (diff < 86400000) {
        const hours = Math.floor(diff / 3600000);
        return `${hours}h ago`;
    }
    
    // Otherwise show date
    return date.toLocaleDateString('en-ZA', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}
