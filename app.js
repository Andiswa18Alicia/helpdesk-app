// ============================================================
//  HelpDesk Pro — Shared Application Logic
//  Firebase Firestore edition — real-time multi-user sync
// ============================================================

// ============================================================
//  🔥 FIREBASE CONFIG
//  Replace these placeholder values with your actual Firebase
//  config from: Firebase Console → Project Settings → Your Apps
// ============================================================
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyAOJY0bTGlq0Tuxe6yKeVEkmHfE4vNKpng",
  authDomain:        "helpdesk-pro-e6c9e.firebaseapp.com",
  projectId:         "helpdesk-pro-e6c9e",
  storageBucket:     "helpdesk-pro-e6c9e.firebasestorage.app",
  messagingSenderId: "241003532299",
  appId:             "1:241003532299:web:1be7e3da3ba4c1a7aa370e"
};

// ============================================================
//  FIREBASE INIT — called after DOM ready
// ============================================================
let _db = null;
let _firebaseReady = false;

function initFirebase() {
  if (FIREBASE_CONFIG.apiKey.startsWith('PASTE_')) {
    _firebaseError = 'Firebase config not set';
    return false;
  }
  try {
    if (typeof firebase === 'undefined') {
      _firebaseError = 'Firebase SDK failed to load — check internet connection';
      return false;
    }
    if (!firebase.apps || !firebase.apps.length) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }
    _db = firebase.firestore();
    _firebaseReady = true;
    // Test actual connectivity with a quick read
    _db.collection('meta').doc('ping').get()
      .then(() => console.log('✅ Firebase connected and responding'))
      .catch(e => {
        console.error('Firestore read test failed:', e.code, e.message);
        // Show error on page if topbar-sub exists
        const sub = document.getElementById('topbar-sub');
        if (sub) sub.textContent = '⚠️ Firestore error: ' + e.code;
      });
    return true;
  } catch (e) {
    _firebaseError = e.message;
    console.error('Firebase init error:', e);
    return false;
  }
}
let _firebaseError = '';

function isFirebaseReady() { return _firebaseReady && _db !== null; }

// ============================================================
//  THEME — works independently of Firebase
// ============================================================
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
  // Update any theme buttons on the page
  ['themeBtn','themeIcon'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = next === 'dark' ? '☀️' : '🌙';
  });
}

// ============================================================
//  LOCAL STORAGE — team & settings (always available)
// ============================================================
const LOCAL = {
  getTeam()       { return JSON.parse(localStorage.getItem('hd_team') || '[]'); },
  saveTeam(t)     { localStorage.setItem('hd_team', JSON.stringify(t)); },
  getSettings()   { return JSON.parse(localStorage.getItem('hd_settings') || '{}'); },
  saveSettings(s) { localStorage.setItem('hd_settings', JSON.stringify(s)); },
};

// ============================================================
//  ADMINS — the 3 fixed admins
// ============================================================
const ADMINS = [
  { name:'Andiswa',    department:'Software', avatar:'A', color:'#0ea5e9', emoji:'💻' },
  { name:'Relebohile', department:'Hardware', avatar:'R', color:'#a855f7', emoji:'🖥️' },
  { name:'Lwando',     department:'Network',  avatar:'L', color:'#22c55e', emoji:'🌐' },
];

// Always sync team to match ADMINS
(function ensureDefaultTeam() {
  LOCAL.saveTeam(ADMINS.map(a => ({
    name:  a.name,
    email: a.name.toLowerCase() + '@helpdesk.com',
    role:  a.department + ' Admin',
    avatar:a.avatar,
    color: a.color,
  })));
})();

// ============================================================
//  FIRESTORE TICKET OPERATIONS
// ============================================================
async function generateTicketId() {
  const ref = _db.collection('meta').doc('counter');
  try {
    const newId = await _db.runTransaction(async tx => {
      const doc = await tx.get(ref);
      const next = (doc.exists ? doc.data().value : 1000) + 1;
      tx.set(ref, { value: next });
      return next;
    });
    return 'TKT-' + newId;
  } catch (e) {
    return 'TKT-' + Date.now().toString().slice(-6);
  }
}

async function createTicket(data) {
  if (!isFirebaseReady()) { showToast('Firebase not connected — check app.js config', 'error'); return null; }
  const id = await generateTicketId();
  const ticket = {
    id,
    title:          data.title,
    desc:           data.desc || '',
    category:       data.category || 'IT',
    department:     data.department || data.category || 'IT',
    priority:       data.priority || 'medium',
    status:         'open',
    submitter:      data.submitter || 'Anonymous',
    submitterEmail: data.submitterEmail || '',
    assignee:       data.assignee || '',
    created:        new Date().toISOString(),
    updated:        new Date().toISOString(),
    resolvedAt:     null,
    comments:       [],
    attachments:    [],
    watchers:       [],
  };
  await _db.collection('tickets').doc(id).set(ticket);
  return ticket;
}

async function getTicket(id) {
  if (!isFirebaseReady()) return null;
  const doc = await _db.collection('tickets').doc(id).get();
  return doc.exists ? doc.data() : null;
}

async function updateTicket(id, changes) {
  if (!isFirebaseReady()) return;
  const ref = _db.collection('tickets').doc(id);
  const updates = { ...changes, updated: new Date().toISOString() };
  if (changes.status === 'resolved') {
    const snap = await ref.get();
    if (snap.exists && snap.data().status !== 'resolved') {
      updates.resolvedAt = new Date().toISOString();
    }
  }
  await ref.update(updates);
}

async function deleteTicket(id) {
  if (!isFirebaseReady()) return;
  await _db.collection('tickets').doc(id).delete();
}

async function addComment(ticketId, { author, text, type, attachments, mentions }) {
  if (!isFirebaseReady()) return null;
  const comment = {
    id:          'CMT-' + Date.now(),
    author, text,
    type:        type || 'public',
    attachments: attachments || [],
    mentions:    mentions || [],
    created:     new Date().toISOString(),
  };
  await _db.collection('tickets').doc(ticketId).update({
    comments: firebase.firestore.FieldValue.arrayUnion(comment),
    updated:  new Date().toISOString(),
  });
  return comment;
}

// ============================================================
//  REAL-TIME LISTENERS
// ============================================================
function subscribeToTickets(callback) {
  if (!isFirebaseReady()) return () => {};
  return _db.collection('tickets')
    .orderBy('created', 'desc')
    .onSnapshot(
      snap => callback(snap.docs.map(d => d.data())),
      err  => console.error('Listener error:', err)
    );
}

function subscribeToTicket(id, callback) {
  if (!isFirebaseReady()) return () => {};
  return _db.collection('tickets').doc(id)
    .onSnapshot(
      doc => callback(doc.exists ? doc.data() : null),
      err => console.error('Ticket listener error:', err)
    );
}

// ============================================================
//  SEED DEMO DATA (runs once on fresh Firestore)
// ============================================================
async function seedDemoData() {
  if (!isFirebaseReady()) return;
  const snap = await _db.collection('tickets').limit(1).get();
  if (!snap.empty) return;

  const demos = [
    { title:'Cannot connect to VPN from home',     desc:'Auth failed since password reset. Tried restarting.',        category:'Software',  priority:'high',     submitter:'John Mokoena',    submitterEmail:'john@example.com',     assignee:'Andiswa',    status:'open',       daysAgo:0 },
    { title:'App crashes on startup',              desc:'App crashes immediately after launch on Windows 11.',        category:'Software',  priority:'medium',   submitter:'Priya Naidoo',    submitterEmail:'priya.n@example.com',  assignee:'Andiswa',    status:'inprogress', daysAgo:1 },
    { title:'Keyboard not working',                desc:'Keyboard completely unresponsive after spilling water.',     category:'Hardware',  priority:'high',     submitter:'HR Department',   submitterEmail:'hr@example.com',       assignee:'Relebohile', status:'open',       daysAgo:2 },
    { title:'Monitor flickering',                  desc:'Monitor flickers every few minutes, very distracting.',     category:'Hardware',  priority:'medium',   submitter:'Thabo Dlamini',   submitterEmail:'thabo.d@example.com',  assignee:'Relebohile', status:'inprogress', daysAgo:0 },
    { title:'Cannot access shared network drive',  desc:'Getting permission denied when accessing the shared drive.', category:'Network',   priority:'high',     submitter:'Finance Team',    submitterEmail:'finance@example.com',  assignee:'Lwando',     status:'resolved',   daysAgo:3 },
    { title:'WiFi dropping every hour',            desc:'WiFi disconnects every hour and requires manual reconnect.', category:'Network',   priority:'critical', submitter:'Sales Dept',      submitterEmail:'sales@example.com',    assignee:'Lwando',     status:'open',       daysAgo:0 },
    { title:'Printer not connecting',              desc:'Office printer shows offline, cannot print anything.',       category:'Hardware',  priority:'medium',   submitter:'Lindiwe Khumalo', submitterEmail:'lindiwe@example.com',  assignee:'Relebohile', status:'resolved',   daysAgo:5 },
    { title:'Slow internet in meeting room',       desc:'Internet speed in meeting room is very slow during calls.',  category:'Network',   priority:'low',      submitter:'Dev Team Lead',   submitterEmail:'devlead@example.com',  assignee:'Lwando',     status:'open',       daysAgo:4 },
  ];

  await _db.collection('meta').doc('counter').set({ value: 1000 });
  let counter = 1000;
  for (const d of demos) {
    counter++;
    const created = new Date(Date.now() - d.daysAgo*86400000 - Math.random()*3600000).toISOString();
    const resolvedAt = d.status === 'resolved'
      ? new Date(new Date(created).getTime() + (2+Math.random()*10)*3600000).toISOString() : null;
    const t = {
      id:'TKT-'+counter, title:d.title, desc:d.desc, category:d.category,
      department:d.category, priority:d.priority, status:d.status,
      submitter:d.submitter, submitterEmail:d.submitterEmail, assignee:d.assignee,
      created, updated:created, resolvedAt, comments:[], attachments:[], watchers:[],
    };
    if (counter === 1001) {
      t.comments = [
        { id:'CMT-1', author:'Andiswa',    text:'Hi John, looking into this now. Can you confirm which app version you are running? @Relebohile can you check if this is hardware related?', type:'public',   attachments:[], mentions:['Relebohile'], created:new Date(Date.now()-3600000).toISOString() },
        { id:'CMT-2', author:'Relebohile', text:'Checked on my end — looks like a software issue, not hardware. Handing back to Andiswa.', type:'internal', attachments:[], mentions:[], created:new Date(Date.now()-1800000).toISOString() },
      ];
    }
    await _db.collection('tickets').doc(t.id).set(t);
  }
  await _db.collection('meta').doc('counter').set({ value: counter });
  console.log('✅ Demo data seeded');
}

// Filter tickets by admin
function subscribeToTicketsByAdmin(adminName, callback) {
  if (!isFirebaseReady()) return () => {};
  return _db.collection('tickets')
    .orderBy('created', 'desc')
    .onSnapshot(
      snap => callback(snap.docs.map(d => d.data())),
      err  => console.error('Admin filter error:', err)
    );
}

// ============================================================
//  STATS & UTILITIES
// ============================================================
function getDashboardStats(tickets) {
  const resolved = tickets.filter(t => t.status==='resolved' && t.resolvedAt);
  const avgRes = resolved.length
    ? resolved.reduce((s,t) => s+(new Date(t.resolvedAt)-new Date(t.created)),0)/resolved.length : 0;
  const today = tickets.filter(t => {
    const d=new Date(t.created), n=new Date();
    return d.getDate()===n.getDate()&&d.getMonth()===n.getMonth()&&d.getFullYear()===n.getFullYear();
  }).length;
  return {
    total:tickets.length,
    byStatus:   _count(tickets,'status'),
    byPriority: _count(tickets,'priority'),
    byCategory: _count(tickets,'category'),
    avgResMs:avgRes, today,
  };
}

function _count(arr, key) {
  return arr.reduce((a,i)=>{ a[i[key]]=(a[i[key]]||0)+1; return a; }, {});
}
function formatDuration(ms) {
  if (!ms) return '—';
  const h=Math.floor(ms/3600000), d=Math.floor(h/24);
  return d>0?d+'d '+(h%24)+'h':h>0?h+'h':Math.floor(ms/60000)+'m';
}
function timeAgo(iso) {
  const m=Math.floor((Date.now()-new Date(iso).getTime())/60000);
  if(m<1) return 'just now'; if(m<60) return m+'m ago';
  const h=Math.floor(m/60); if(h<24) return h+'h ago';
  return Math.floor(h/24)+'d ago';
}
function escHtml(s) {
  if(!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function renderMentions(text) {
  return escHtml(text).replace(/@(\w+)/g,'<span class="mention">@$1</span>');
}
function extractMentions(text) {
  const m=text.match(/@(\w+)/g); return m?m.map(x=>x.slice(1)):[];
}
function fileIcon(type) {
  if(!type) return '📄';
  if(type.startsWith('image/')) return '🖼️';
  if(type==='application/pdf') return '📋';
  if(type.includes('word')) return '📝';
  if(type.includes('csv')||type.includes('sheet')) return '📊';
  return '📄';
}


// ============================================================
//  COMMUNITY CHANNEL — Firestore operations
// ============================================================
async function postMessage(data) {
  if (!isFirebaseReady()) { showToast('Firebase not connected', 'error'); return null; }
  const msg = {
    id:          'MSG-' + Date.now(),
    author:      data.author || 'Anonymous',
    text:        data.text || '',
    attachments: data.attachments || [],
    pinned:      false,
    reactions:   {},   // { emoji: [author1, author2, ...] }
    created:     new Date().toISOString(),
    isAdmin:     ADMINS.some(a => a.name === data.author),
  };
  await _db.collection('community').doc(msg.id).set(msg);
  return msg;
}

async function deleteMessage(id) {
  if (!isFirebaseReady()) return;
  await _db.collection('community').doc(id).delete();
}

async function pinMessage(id, pinned) {
  if (!isFirebaseReady()) return;
  await _db.collection('community').doc(id).update({ pinned });
}

async function reactToMessage(id, emoji, author) {
  if (!isFirebaseReady()) return;
  const ref = _db.collection('community').doc(id);
  const doc = await ref.get();
  if (!doc.exists) return;
  const reactions = doc.data().reactions || {};
  const users = reactions[emoji] || [];
  const idx = users.indexOf(author);
  if (idx === -1) users.push(author);
  else users.splice(idx, 1);
  reactions[emoji] = users;
  await ref.update({ reactions });
}

function subscribeToMessages(callback) {
  if (!isFirebaseReady()) return () => {};
  return _db.collection('community')
    .orderBy('created', 'asc')
    .onSnapshot(
      snap => callback(snap.docs.map(d => d.data())),
      err  => console.error('Community listener error:', err)
    );
}

// ============================================================
//  TOAST
// ============================================================
function showToast(msg, type='success') {
  const ex=document.querySelector('.toast'); if(ex) ex.remove();
  const t=document.createElement('div');
  t.className=`toast toast-${type}`;
  t.innerHTML=`<span class="toast-icon">${type==='success'?'✓':type==='error'?'✕':'ℹ'}</span><span>${msg}</span>`;
  document.body.appendChild(t);
  setTimeout(()=>t.classList.add('toast-show'),10);
  setTimeout(()=>{t.classList.remove('toast-show');setTimeout(()=>t.remove(),300);},3200);
}

// ============================================================
//  AUTH — Users, Sessions, Access Requests
//  Senior Admin: Andiswa
// ============================================================
const SENIOR_ADMIN = 'Andiswa';

// Simple hash — good enough for a small internal tool
async function hashPassword(password) {
  const msgBuffer = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Generate a username from name e.g. "John Mokoena" → "john.mokoena"
function generateUsername(name) {
  return name.toLowerCase().replace(/\s+/g, '.').replace(/[^a-z.]/g, '');
}

// Generate a random password
function generatePassword(len = 10) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#';
  return Array.from({length: len}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ── SESSION ──────────────────────────────────────────────────
const SESSION = {
  get()       { try { return JSON.parse(localStorage.getItem('hd_session') || 'null'); } catch { return null; } },
  set(user)   { localStorage.setItem('hd_session', JSON.stringify(user)); },
  clear()     { localStorage.removeItem('hd_session'); },
  isAdmin()   { const s = SESSION.get(); return s && ADMINS.some(a => a.name === s.name); },
  isSenior()  { const s = SESSION.get(); return s && s.name === SENIOR_ADMIN; },
};

// ── LOGIN ─────────────────────────────────────────────────────
async function loginUser(username, password) {
  if (!isFirebaseReady()) return { ok: false, msg: 'Firebase not connected' };

  // Check if logging in as an admin (by name OR by their helpdesk email)
  const adminMatch = ADMINS.find(a =>
    a.name.toLowerCase() === username.toLowerCase() ||
    (a.name.toLowerCase() + '@helpdesk.com') === username.toLowerCase()
  );
  if (adminMatch) {
    // Admin passwords stored in Firestore users collection — force server read to avoid stale cache
    const snap = await _db.collection('users').doc(username.toLowerCase()).get({ source: 'server' });
    if (!snap.exists) return { ok: false, msg: 'Account not found' };
    const data = snap.data();
    const hash = await hashPassword(password);
    if (data.passwordHash !== hash) return { ok: false, msg: 'Incorrect password' };
    SESSION.set({ name: adminMatch.name, username: username.toLowerCase(), role: 'admin', department: adminMatch.department, email: data.email || '', color: adminMatch.color, avatar: adminMatch.avatar, emoji: adminMatch.emoji });
    return { ok: true, role: 'admin' };
  }

  // Regular user login — force server read to avoid stale cache
  const lookupKey = username.toLowerCase().trim();
  const snap = await _db.collection('users').doc(lookupKey).get({ source: 'server' });
  if (!snap.exists) return { ok: false, msg: 'Account not found. Check your username (it is your email address).' };
  const data = snap.data();
  if (!data.approved) return { ok: false, msg: 'Your account is pending approval by the Senior Admin.' };
  const hash = await hashPassword(password);
  if (data.passwordHash !== hash) return { ok: false, msg: 'Incorrect password. Try again.' };
  SESSION.set({ name: data.name, username: lookupKey, role: 'user', department: data.department, email: data.email, color: '#64748b', avatar: data.name[0].toUpperCase() });
  return { ok: true, role: 'user' };
}

// ── SETUP ADMIN ACCOUNTS (run once) ──────────────────────────
async function ensureAdminAccounts() {
  if (!isFirebaseReady()) return;
  try {
    for (const admin of ADMINS) {
      const key = admin.name.toLowerCase();
      const doc = await _db.collection('users').doc(key).get();
      if (!doc.exists) {
        const hash = await hashPassword('Admin@2025!');
        await _db.collection('users').doc(key).set({
          name: admin.name, username: key, email: key + '@helpdesk.com',
          department: admin.department, role: 'admin',
          passwordHash: hash, approved: true,
          created: new Date().toISOString(),
        });
        console.log('Admin account ready:', admin.name);
      }
    }
  } catch(e) { console.warn('ensureAdminAccounts error:', e.message); }
}

// ── ACCESS REQUESTS ───────────────────────────────────────────
async function submitAccessRequest(data) {
  if (!isFirebaseReady()) return { ok: false, msg: 'Firebase not connected' };
  // Check if email already has an account or pending request
  const existing = await _db.collection('users').where('email', '==', data.email).get();
  if (!existing.empty) return { ok: false, msg: 'An account with this email already exists' };
  const pending = await _db.collection('accessRequests').where('email', '==', data.email).where('status', '==', 'pending').get();
  if (!pending.empty) return { ok: false, msg: 'A request with this email is already pending' };

  const reqId = 'REQ-' + Date.now();
  await _db.collection('accessRequests').doc(reqId).set({
    id: reqId, name: data.name, email: data.email, department: data.department,
    status: 'pending', created: new Date().toISOString(),
  });
  return { ok: true, id: reqId };
}

async function getAccessRequests() {
  if (!isFirebaseReady()) return [];
  const snap = await _db.collection('accessRequests').where('status', '==', 'pending').get();
  return snap.docs.map(d => d.data());
}

function subscribeToAccessRequests(callback) {
  if (!isFirebaseReady()) return () => {};
  return _db.collection('accessRequests').where('status', '==', 'pending')
    .onSnapshot(snap => callback(snap.docs.map(d => d.data())), err => console.error(err));
}

async function approveAccessRequest(reqId, req) {
  if (!isFirebaseReady()) return { ok: false, msg: 'Firebase not connected' };
  try {
    // Username = their email (clean), password = auto-generated
    const username = req.email.trim().toLowerCase();
    const password = generatePassword();
    const hash     = await hashPassword(password);

    // Create user account (keyed by email)
    await _db.collection('users').doc(username).set({
      name: req.name, username, email: req.email, department: req.department,
      role: 'user', passwordHash: hash, approved: true,
      created: new Date().toISOString(),
    });

    // Mark the access request as approved
    await _db.collection('accessRequests').doc(reqId).update({
      status: 'approved',
      approvedAt: new Date().toISOString(),
      username,
      generatedPassword: password,
    });

    return { ok: true, username, password };
  } catch(e) {
    console.error('approveAccessRequest error:', e);
    return { ok: false, msg: e.message };
  }
}

async function denyAccessRequest(reqId) {
  if (!isFirebaseReady()) return;
  await _db.collection('accessRequests').doc(reqId).update({ status: 'denied', deniedAt: new Date().toISOString() });
}

// ── USER TICKET QUERIES ───────────────────────────────────────
function subscribeToUserTickets(email, department, callback) {
  if (!isFirebaseReady()) return () => {};
  // Fetch all tickets, filter client-side (avoids composite index requirements)
  return _db.collection('tickets')
    .orderBy('created', 'desc')
    .onSnapshot(snap => {
      const all = snap.docs.map(d => d.data());
      const filtered = all.filter(t =>
        t.submitterEmail === email ||
        (t.department || t.category || '').toLowerCase() === department.toLowerCase()
      );
      callback(filtered);
    }, err => console.error('subscribeToUserTickets error:', err));
}

// ── CHANGE PASSWORD ──────────────────────────────────────────
async function changePassword(username, oldPassword, newPassword) {
  if (!isFirebaseReady()) return { ok: false, msg: 'Firebase not connected' };
  try {
    const snap = await _db.collection('users').doc(username.toLowerCase()).get({ source: 'server' });
    if (!snap.exists) return { ok: false, msg: 'Account not found' };
    const data = snap.data();
    const oldHash = await hashPassword(oldPassword);
    if (data.passwordHash !== oldHash) return { ok: false, msg: 'Current password is incorrect' };
    if (newPassword.length < 8) return { ok: false, msg: 'New password must be at least 8 characters' };
    const newHash = await hashPassword(newPassword);
    await _db.collection('users').doc(username.toLowerCase()).update({ passwordHash: newHash });
    return { ok: true };
  } catch(e) { return { ok: false, msg: e.message }; }
}

// ── ADMIN: RESET ANOTHER USER'S PASSWORD ─────────────────────
// Only callable by admins — resets to a new generated password
async function resetPasswordForUser(userEmail) {
  if (!isFirebaseReady()) return { ok: false, msg: 'Firebase not connected' };
  if (!SESSION.isAdmin()) return { ok: false, msg: 'Only admins can reset passwords' };
  try {
    const key = userEmail.toLowerCase().trim();
    const snap = await _db.collection('users').doc(key).get();
    if (!snap.exists) return { ok: false, msg: 'User not found' };
    const newPassword = generatePassword();
    const hash = await hashPassword(newPassword);
    await _db.collection('users').doc(key).update({ passwordHash: hash });
    return { ok: true, newPassword, username: key };
  } catch(e) { return { ok: false, msg: e.message }; }
}

// ── ADD NEW ADMIN (senior admin only) ────────────────────────
async function addAdmin(name, department) {
  if (!isFirebaseReady()) return { ok: false, msg: 'Firebase not connected' };
  if (!SESSION.isSenior()) return { ok: false, msg: 'Only the senior admin can add admins' };
  try {
    const username = name.trim().toLowerCase().replace(/[^a-z0-9]/g,'');
    const existing = await _db.collection('users').doc(username).get();
    if (existing.exists) return { ok: false, msg: 'An account with that name already exists' };
    const password = generatePassword();
    const hash     = await hashPassword(password);
    await _db.collection('users').doc(username).set({
      name: name.trim(), username, email: username + '@helpdesk.com',
      department, role: 'admin', passwordHash: hash, approved: true,
      created: new Date().toISOString(),
    });
    return { ok: true, username, password };
  } catch(e) { return { ok: false, msg: e.message }; }
}

// ── SUBSCRIBE TO ALL REQUESTS (for persistent history) ───────
function subscribeToAllRequests(callback) {
  if (!isFirebaseReady()) return () => {};
  return _db.collection('accessRequests')
    .orderBy('created', 'desc')
    .onSnapshot(snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => console.error('allRequests error:', err));
}
