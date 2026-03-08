// ============================================================
//  HelpDesk Pro — Shared Application Logic
// ============================================================

// ---- THEME ----
(function initTheme() {
  const saved = localStorage.getItem('hd_theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
})();

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('hd_theme', next);
  const btn = document.getElementById('themeBtn');
  if (btn) btn.textContent = next === 'dark' ? '☀️' : '🌙';
}

// ---- STORAGE ----
const HD = {
  getTickets()   { return JSON.parse(localStorage.getItem('hd_tickets') || '[]'); },
  saveTickets(t) { localStorage.setItem('hd_tickets', JSON.stringify(t)); },
  getCounter()   { return parseInt(localStorage.getItem('hd_counter') || '1000'); },
  saveCounter(n) { localStorage.setItem('hd_counter', n.toString()); },
  getTeam()      { return JSON.parse(localStorage.getItem('hd_team') || '[]'); },
  saveTeam(t)    { localStorage.setItem('hd_team', JSON.stringify(t)); },
  getSettings()  { return JSON.parse(localStorage.getItem('hd_settings') || '{}'); },
  saveSettings(s){ localStorage.setItem('hd_settings', JSON.stringify(s)); },
};

// ---- TICKET HELPERS ----
function createTicket(data) {
  const tickets = HD.getTickets();
  const counter = HD.getCounter() + 1;
  HD.saveCounter(counter);
  const ticket = {
    id: 'TKT-' + counter,
    title: data.title,
    desc: data.desc || '',
    category: data.category || 'IT',
    department: data.department || 'IT',
    priority: data.priority || 'medium',
    status: 'open',
    submitter: data.submitter || 'Anonymous',
    submitterEmail: data.submitterEmail || '',
    assignee: data.assignee || '',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    resolvedAt: null,
    comments: [],
    attachments: [],
    watchers: [],
  };
  tickets.unshift(ticket);
  HD.saveTickets(tickets);
  sendEmailNotification('created', ticket);
  return ticket;
}

function getTicket(id) {
  return HD.getTickets().find(t => t.id === id) || null;
}

function updateTicket(id, changes) {
  const tickets = HD.getTickets();
  const idx = tickets.findIndex(t => t.id === id);
  if (idx === -1) return null;
  const prev = { ...tickets[idx] };
  tickets[idx] = { ...tickets[idx], ...changes, updated: new Date().toISOString() };
  if (changes.status === 'resolved' && prev.status !== 'resolved') {
    tickets[idx].resolvedAt = new Date().toISOString();
  }
  HD.saveTickets(tickets);
  if (changes.status && changes.status !== prev.status) {
    sendEmailNotification('updated', tickets[idx], prev.status);
  }
  return tickets[idx];
}

function deleteTicket(id) {
  const tickets = HD.getTickets().filter(t => t.id !== id);
  HD.saveTickets(tickets);
}

function addComment(ticketId, { author, text, type, attachments, mentions }) {
  const tickets = HD.getTickets();
  const ticket = tickets.find(t => t.id === ticketId);
  if (!ticket) return;
  const comment = {
    id: 'CMT-' + Date.now(),
    author,
    text,
    type: type || 'public', // 'public' | 'internal'
    attachments: attachments || [],
    mentions: mentions || [],
    created: new Date().toISOString(),
  };
  ticket.comments.push(comment);
  ticket.updated = new Date().toISOString();
  HD.saveTickets(tickets);
  if (mentions && mentions.length) {
    sendEmailNotification('mention', ticket, null, mentions);
  }
  return comment;
}

// ---- STATS ----
function getDashboardStats() {
  const tickets = HD.getTickets();
  const now = Date.now();
  const resolved = tickets.filter(t => t.status === 'resolved' && t.resolvedAt);
  const avgRes = resolved.length
    ? resolved.reduce((sum, t) => sum + (new Date(t.resolvedAt) - new Date(t.created)), 0) / resolved.length
    : 0;

  const byStatus   = count(tickets, 'status');
  const byPriority = count(tickets, 'priority');
  const byCategory = count(tickets, 'category');

  const today = tickets.filter(t => {
    const d = new Date(t.created);
    const n = new Date();
    return d.getDate()===n.getDate() && d.getMonth()===n.getMonth() && d.getFullYear()===n.getFullYear();
  }).length;

  return { total: tickets.length, byStatus, byPriority, byCategory, avgResMs: avgRes, today };
}

function count(arr, key) {
  return arr.reduce((acc, item) => {
    acc[item[key]] = (acc[item[key]] || 0) + 1;
    return acc;
  }, {});
}

function formatDuration(ms) {
  if (!ms) return '—';
  const h = Math.floor(ms / 3600000);
  const d = Math.floor(h / 24);
  if (d > 0) return d + 'd ' + (h % 24) + 'h';
  if (h > 0) return h + 'h';
  return Math.floor(ms / 60000) + 'm';
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Highlight @mentions in text
function renderMentions(text) {
  return escHtml(text).replace(/@(\w+)/g, '<span class="mention">@$1</span>');
}

// Extract @mentions from text
function extractMentions(text) {
  const matches = text.match(/@(\w+)/g);
  return matches ? matches.map(m => m.slice(1)) : [];
}

// ---- EMAILJS ----
function initEmailJS() {
  const settings = HD.getSettings();
  if (settings.emailjsPublicKey && typeof emailjs !== 'undefined') {
    emailjs.init(settings.emailjsPublicKey);
  }
}

function sendEmailNotification(event, ticket, prevStatus, mentions) {
  const settings = HD.getSettings();
  if (!settings.emailjsEnabled || !settings.emailjsServiceId || !settings.emailjsTemplateId) return;
  if (typeof emailjs === 'undefined') return;

  const team = HD.getTeam();
  let recipients = [];

  if (event === 'created' && ticket.submitterEmail) {
    recipients.push(ticket.submitterEmail);
  }
  if (event === 'updated' && ticket.submitterEmail) {
    recipients.push(ticket.submitterEmail);
  }
  if (event === 'mention' && mentions) {
    mentions.forEach(name => {
      const member = team.find(m => m.name.toLowerCase() === name.toLowerCase());
      if (member && member.email) recipients.push(member.email);
    });
  }
  if (ticket.assignee) {
    const assignee = team.find(m => m.name === ticket.assignee);
    if (assignee && assignee.email && !recipients.includes(assignee.email)) {
      recipients.push(assignee.email);
    }
  }

  recipients = [...new Set(recipients)];
  if (!recipients.length) return;

  const subject = event === 'created'
    ? `[HelpDesk] New Ticket: ${ticket.id} — ${ticket.title}`
    : event === 'mention'
    ? `[HelpDesk] You were mentioned in ${ticket.id}`
    : `[HelpDesk] Ticket ${ticket.id} updated: ${prevStatus} → ${ticket.status}`;

  recipients.forEach(email => {
    emailjs.send(settings.emailjsServiceId, settings.emailjsTemplateId, {
      to_email: email,
      subject,
      ticket_id: ticket.id,
      ticket_title: ticket.title,
      ticket_status: ticket.status,
      ticket_priority: ticket.priority,
      ticket_url: window.location.origin + '/ticket.html?id=' + ticket.id,
      message: event === 'mention'
        ? 'You were mentioned in a ticket comment.'
        : `Ticket status: ${ticket.status}. Priority: ${ticket.priority}.`,
    }).catch(err => console.warn('EmailJS error:', err));
  });
}

// ---- TOAST ----
function showToast(msg, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `<span class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span><span>${msg}</span>`;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('toast-show'), 10);
  setTimeout(() => { t.classList.remove('toast-show'); setTimeout(() => t.remove(), 300); }, 3200);
}

// ---- SEED DEMO DATA ----
function seedDemoData() {
  if (HD.getTickets().length > 0) return;
  HD.saveTeam([
    { name: 'Andiswa', email: 'andiswa@helpdesk.com', role: 'Agent', avatar: 'A' },
    { name: 'Thabo', email: 'thabo@helpdesk.com', role: 'Agent', avatar: 'T' },
    { name: 'Priya', email: 'priya@helpdesk.com', role: 'Manager', avatar: 'P' },
    { name: 'Sipho', email: 'sipho@helpdesk.com', role: 'Agent', avatar: 'S' },
  ]);

  const demos = [
    { title: 'Cannot connect to VPN from home', desc: 'Getting authentication failed error since password reset yesterday. Tried restarting but no luck.', category: 'IT', priority: 'high', submitter: 'John Mokoena', submitterEmail: 'john@example.com', assignee: 'Andiswa', status: 'open', daysAgo: 0 },
    { title: 'Outlook crashes on startup', desc: 'Microsoft Outlook crashes immediately after launching. Windows 11, Office 365. Already tried repair install with no success.', category: 'IT', priority: 'medium', submitter: 'Priya Naidoo', submitterEmail: 'priya.n@example.com', assignee: 'Thabo', status: 'inprogress', daysAgo: 1 },
    { title: 'New employee laptop setup', desc: 'New employee starting Monday. Needs laptop configured with standard software, VPN access, and domain join.', category: 'IT', priority: 'low', submitter: 'HR Department', submitterEmail: 'hr@example.com', assignee: 'Sipho', status: 'open', daysAgo: 2 },
    { title: 'Suspected phishing email received', desc: 'Received email claiming to be from IT asking for login credentials. Forwarded to security. Awaiting guidance.', category: 'Security', priority: 'critical', submitter: 'Thabo Dlamini', submitterEmail: 'thabo.d@example.com', assignee: 'Priya', status: 'inprogress', daysAgo: 0 },
    { title: 'Payroll system login issue', desc: 'Unable to access payroll portal. Says account locked after 3 failed attempts. Payroll run is tomorrow.', category: 'HR', priority: 'high', submitter: 'Finance Team', submitterEmail: 'finance@example.com', assignee: 'Andiswa', status: 'resolved', daysAgo: 3 },
    { title: 'Invoice not generating in billing system', desc: 'Client invoice for account #4821 failed to generate. Error code: BIL-404. Urgent as client is waiting.', category: 'Billing', priority: 'critical', submitter: 'Sales Dept', submitterEmail: 'sales@example.com', assignee: 'Thabo', status: 'open', daysAgo: 0 },
    { title: 'Printer offline in Finance office', desc: 'HP LaserJet 3rd floor shows offline. Multiple users affected. Tried restarting print spooler.', category: 'IT', priority: 'medium', submitter: 'Lindiwe Khumalo', submitterEmail: 'lindiwe@example.com', assignee: 'Sipho', status: 'resolved', daysAgo: 5 },
    { title: 'Request for additional monitor', desc: 'Developer team requesting second monitors. 4 units needed. Please advise on procurement process.', category: 'Facilities', priority: 'low', submitter: 'Dev Team Lead', submitterEmail: 'devlead@example.com', assignee: '', status: 'open', daysAgo: 4 },
  ];

  let counter = 1000;
  const tickets = demos.map(d => {
    counter++;
    const created = new Date(Date.now() - d.daysAgo * 86400000 - Math.random() * 3600000).toISOString();
    const resolvedAt = d.status === 'resolved'
      ? new Date(new Date(created).getTime() + (2 + Math.random() * 10) * 3600000).toISOString()
      : null;
    const t = {
      id: 'TKT-' + counter,
      ...d,
      department: d.category,
      created,
      updated: created,
      resolvedAt,
      comments: [],
      attachments: [],
      watchers: [],
    };
    delete t.daysAgo;
    // Add a sample comment to first ticket
    if (counter === 1001) {
      t.comments.push({
        id: 'CMT-1', author: 'Andiswa', text: 'Hi John, I\'m looking into this now. Can you confirm which VPN client version you\'re using? @Thabo can you check the auth logs?',
        type: 'public', attachments: [], mentions: ['Thabo'], created: new Date(Date.now() - 3600000).toISOString(),
      });
      t.comments.push({
        id: 'CMT-2', author: 'Thabo', text: 'Checked the logs — seeing auth failures from this IP. Looks like the user profile needs to be refreshed in AD.',
        type: 'internal', attachments: [], mentions: [], created: new Date(Date.now() - 1800000).toISOString(),
      });
    }
    return t;
  });

  HD.saveTickets(tickets);
  HD.saveCounter(counter);
}

seedDemoData();
