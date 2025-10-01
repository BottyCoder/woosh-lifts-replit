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
function navigateTo(pageName, evt) {
    // Update active nav item
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // If called from a nav item, mark it active
    if (evt && evt.target) {
        const navItem = evt.target.closest('.nav-item');
        if (navItem) {
            navItem.classList.add('active');
        }
    } else {
        // If no event, find and activate by page name
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            const onclick = item.getAttribute('onclick');
            if (onclick && onclick.includes(`'${pageName}'`)) {
                item.classList.add('active');
            }
        });
    }

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
    const targetPage = document.getElementById(`page-${pageName}`);
    if (targetPage) {
        targetPage.classList.add('active');
    }

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
        const response = await authFetch(`${BASE_URL}/admin/status`);
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
        // Load all data including messages for today count
        const [liftsRes, contactsRes, allTicketsRes, messagesRes] = await Promise.all([
            authFetch(`${BASE_URL}/admin/lifts`),
            authFetch(`${BASE_URL}/admin/contacts`),
            authFetch(`${BASE_URL}/admin/tickets?limit=1000`),
            authFetch(`${BASE_URL}/admin/messages?limit=1000`)
        ]);

        const lifts = await liftsRes.json();
        const contacts = await contactsRes.json();
        const allTickets = await allTicketsRes.json();
        const messagesResponse = await messagesRes.json();
        
        // Extract messages array from response (endpoint returns { data: { messages: [...] } })
        const messagesArray = messagesResponse.data?.messages || [];

        // Count active tickets (open or entrapment_awaiting_confirmation)
        const activeTicketsCount = (allTickets.data || []).filter(t => 
            ['open', 'entrapment_awaiting_confirmation'].includes(t.status)
        ).length;

        // Count messages from today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const messagesToday = messagesArray.filter(m => {
            const msgDate = new Date(m.ts || m.created_at);
            return msgDate >= today;
        }).length;

        // Update stats
        document.getElementById('stat-total-lifts').textContent = lifts.data?.length || 0;
        document.getElementById('stat-total-contacts').textContent = contacts.data?.length || 0;
        document.getElementById('stat-active-tickets').textContent = activeTicketsCount;
        document.getElementById('stat-messages-today').textContent = messagesToday;

        // Get recent tickets for display (limit 5, all statuses, sorted by created date)
        const recentTickets = (allTickets.data || [])
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 5);
        
        renderRecentTickets(recentTickets);
        
    } catch (error) {
        console.error('Error loading dashboard:', error);
        document.getElementById('recent-tickets-list').innerHTML = 
            '<div class="empty-state"><h3>Error loading dashboard</h3><p>' + (error.message || 'Unknown error') + '</p></div>';
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
        const [liftsResponse, contactsResponse] = await Promise.all([
            authFetch(`${BASE_URL}/admin/lifts`),
            authFetch(`${BASE_URL}/admin/contacts`)
        ]);

        const liftsResult = await liftsResponse.json();
        const contactsResult = await contactsResponse.json();

        if (!liftsResult.ok) {
            throw new Error(liftsResult.error?.message || 'Failed to load lifts');
        }

        const lifts = liftsResult.data || [];
        const allContacts = contactsResult.data || [];

        if (lifts.length === 0) {
            container.innerHTML = '<div class="empty-state"><h3>No lifts found</h3><p>No lifts registered in the system.</p></div>';
            return;
        }

        // Fetch linked contacts for all lifts
        const liftContactsPromises = lifts.map(lift => 
            authFetch(`${BASE_URL}/admin/lifts/${lift.id}/contacts`)
                .then(res => res.json())
                .then(data => ({ liftId: lift.id, contacts: data.data || [] }))
                .catch(() => ({ liftId: lift.id, contacts: [] }))
        );

        const liftContactsData = await Promise.all(liftContactsPromises);
        const liftContactsMap = {};
        liftContactsData.forEach(lc => {
            liftContactsMap[lc.liftId] = lc.contacts;
        });

        container.innerHTML = `
            <table class="table">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Site Name</th>
                        <th>Building</th>
                        <th>MSISDN</th>
                        <th>Linked Contacts</th>
                        <th>Notes</th>
                        <th>Created</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${lifts.map(lift => {
                        const linkedContacts = liftContactsMap[lift.id] || [];
                        const contactsDisplay = linkedContacts.length > 0 
                            ? linkedContacts.map(c => escapeHtml(c.display_name)).join(', ')
                            : '<span style="color: #94a3b8;">None</span>';
                        
                        return `
                        <tr>
                            <td><strong>#${lift.id}</strong></td>
                            <td>${escapeHtml(lift.site_name || '-')}</td>
                            <td>${escapeHtml(lift.building || '-')}</td>
                            <td>${escapeHtml(lift.msisdn)}</td>
                            <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${contactsDisplay}</td>
                            <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(lift.notes || '-')}</td>
                            <td>${formatDateTime(lift.created_at)}</td>
                            <td>
                                <button class="btn-small" onclick="editLift(${lift.id})">Edit</button>
                                <button class="btn-small btn-danger" onclick="deleteLift(${lift.id})">Delete</button>
                            </td>
                        </tr>
                        `;
                    }).join('')}
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

// Save Lift Function
async function saveLift() {
    const msisdn = document.getElementById('lift-msisdn').value.trim();
    const siteName = document.getElementById('lift-site-name').value.trim();
    const building = document.getElementById('lift-building').value.trim();
    const notes = document.getElementById('lift-notes').value.trim();

    if (!msisdn) {
        alert('MSISDN (phone number) is required');
        return;
    }

    try {
        const response = await authFetch(`${BASE_URL}/admin/lifts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                msisdn,
                site_name: siteName,
                building,
                notes
            })
        });

        const result = await response.json();

        if (!result.ok) {
            throw new Error(result.error?.message || 'Failed to save lift');
        }

        alert('Lift saved successfully!');
        
        // Clear form
        document.getElementById('lift-msisdn').value = '';
        document.getElementById('lift-site-name').value = '';
        document.getElementById('lift-building').value = '';
        document.getElementById('lift-notes').value = '';

        // Reload list
        loadLifts();

    } catch (error) {
        console.error('Error saving lift:', error);
        alert('Error saving lift: ' + error.message);
    }
}

// Edit Lift Function
async function editLift(liftId) {
    try {
        const [liftsRes, contactsRes, liftContactsRes] = await Promise.all([
            authFetch(`${BASE_URL}/admin/lifts`),
            authFetch(`${BASE_URL}/admin/contacts`),
            authFetch(`${BASE_URL}/admin/lifts/${liftId}/contacts`)
        ]);

        const liftsData = await liftsRes.json();
        const contactsData = await contactsRes.json();
        const liftContactsData = await liftContactsRes.json();

        const lift = liftsData.data?.find(l => l.id === liftId);
        if (!lift) {
            alert('Lift not found');
            return;
        }

        const allContacts = contactsData.data || [];
        const linkedContacts = liftContactsData.data || [];
        const linkedContactIds = linkedContacts.map(lc => lc.contact_id);

        const modalHTML = `
            <div class="modal-overlay" id="edit-lift-modal" onclick="if(event.target === this) closeEditLiftModal()">
                <div class="modal-content" style="max-width: 800px;">
                    <h3>Edit Lift #${lift.id}</h3>
                    <div style="margin: 20px 0;">
                        <p><strong>MSISDN:</strong> ${escapeHtml(lift.msisdn)}</p>
                        <p><strong>Site:</strong> ${escapeHtml(lift.site_name || '-')}</p>
                        <p><strong>Building:</strong> ${escapeHtml(lift.building || '-')}</p>
                        <p><strong>Notes:</strong> ${escapeHtml(lift.notes || '-')}</p>
                    </div>
                    <h4>Linked Contacts</h4>
                    <div id="linked-contacts-list" style="margin: 15px 0;">
                        ${linkedContacts.length === 0 ? '<p>No contacts linked</p>' : linkedContacts.map(lc => `
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background: #f5f5f5; margin: 5px 0; border-radius: 4px;">
                                <span>${escapeHtml(lc.display_name)} (${escapeHtml(lc.primary_msisdn)})</span>
                                <button class="btn-small btn-danger" onclick="unlinkContact(${liftId}, '${lc.contact_id}')">Unlink</button>
                            </div>
                        `).join('')}
                    </div>
                    <h4>Add Contact</h4>
                    <select id="add-contact-select" style="width: 100%; padding: 8px; margin: 10px 0;">
                        <option value="">Select a contact...</option>
                        ${allContacts.filter(c => !linkedContactIds.includes(c.id)).map(c => `
                            <option value="${c.id}">${escapeHtml(c.display_name)} (${escapeHtml(c.primary_msisdn)})</option>
                        `).join('')}
                    </select>
                    <button class="btn" onclick="linkContact(${liftId})">Link Contact</button>
                    <button class="btn btn-secondary" onclick="closeEditLiftModal()">Close</button>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);

    } catch (error) {
        console.error('Error loading lift details:', error);
        alert('Error loading lift details: ' + error.message);
    }
}

function closeEditLiftModal() {
    const modal = document.getElementById('edit-lift-modal');
    if (modal) modal.remove();
    loadLifts();
}

async function linkContact(liftId) {
    const select = document.getElementById('add-contact-select');
    const contactId = select.value;

    if (!contactId) {
        alert('Please select a contact');
        return;
    }

    try {
        const response = await authFetch(`${BASE_URL}/admin/lifts/${liftId}/contacts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contact_id: contactId, relation: 'tenant' })
        });

        const result = await response.json();

        if (!result.ok) {
            throw new Error(result.error?.message || 'Failed to link contact');
        }

        closeEditLiftModal();
        editLift(liftId);

    } catch (error) {
        console.error('Error linking contact:', error);
        alert('Error linking contact: ' + error.message);
    }
}

async function unlinkContact(liftId, contactId) {
    if (!confirm('Are you sure you want to unlink this contact?')) return;

    try {
        const response = await authFetch(`${BASE_URL}/admin/lifts/${liftId}/contacts/${contactId}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (!result.ok) {
            throw new Error(result.error?.message || 'Failed to unlink contact');
        }

        closeEditLiftModal();
        editLift(liftId);

    } catch (error) {
        console.error('Error unlinking contact:', error);
        alert('Error unlinking contact: ' + error.message);
    }
}

async function deleteLift(liftId) {
    if (!confirm('Are you sure you want to delete this lift? This cannot be undone.')) return;

    try {
        const response = await authFetch(`${BASE_URL}/admin/lifts/${liftId}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (!result.ok) {
            throw new Error(result.error?.message || 'Failed to delete lift');
        }

        alert('Lift deleted successfully!');
        loadLifts();

    } catch (error) {
        console.error('Error deleting lift:', error);
        alert('Error deleting lift: ' + error.message);
    }
}

// Save Contact Function
async function saveContact() {
    const displayName = document.getElementById('contact-name').value.trim();
    const msisdn = document.getElementById('contact-msisdn').value.trim();
    const email = document.getElementById('contact-email').value.trim();
    const role = document.getElementById('contact-role').value.trim();

    if (!displayName || !msisdn) {
        alert('Display name and phone number are required');
        return;
    }

    try {
        const response = await authFetch(`${BASE_URL}/admin/contacts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                display_name: displayName,
                primary_msisdn: msisdn,
                email: email || null,
                role: role || null
            })
        });

        const result = await response.json();

        if (!result.ok) {
            throw new Error(result.error?.message || 'Failed to save contact');
        }

        alert('Contact saved successfully!');
        
        // Clear form
        document.getElementById('contact-name').value = '';
        document.getElementById('contact-msisdn').value = '';
        document.getElementById('contact-email').value = '';
        document.getElementById('contact-role').value = '';

        // Reload list
        loadContacts();

    } catch (error) {
        console.error('Error saving contact:', error);
        alert('Error saving contact: ' + error.message);
    }
}
