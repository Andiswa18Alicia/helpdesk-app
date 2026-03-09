// ============================================================
//  HelpDesk Pro — Shared Application Logic
//  Firebase Firestore edition — real-time multi-user sync
// ============================================================

// ============================================================
//  🔥 FIREBASE CONFIG — paste your config object here
//  Get it from: Firebase Console → Project Settings → Your Apps
// ============================================================
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAOJY0bTGlq0Tuxe6yKeVEkmHfE4vNKpng",
  authDomain: "helpdesk-pro-e6c9e.firebaseapp.com",
  projectId: "helpdesk-pro-e6c9e",
  storageBucket: "helpdesk-pro-e6c9e.firebasestorage.app",
  messagingSenderId: "241003532299",
  appId: "1:241003532299:web:1be7e3da3ba4c1a7aa370e",
  measurementId: "G-RLQDSF296X"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

// ============================================================
//  FIREBASE INIT
// ============================================================
let _db = null;
let _firebaseReady = false;

function initFirebase() {
  try {
    if (typeof firebase === 'undefined') {
      console.warn('Firebase SDK not loaded');
      return false;
    }
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    _db = firebase.firestore();
    _firebaseReady = true;
    return true;
  } catch (e) {
    console.error('Firebase init error:', e);
    return false;
  }
}

function isFirebaseReady() { return _firebaseReady && _db !== null; }

// ---- THEME ----
(function initTheme() {
  const saved = localStorage.getItem('hd_theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', saved || (prefersDark ? 'dark' : 'light'));
})();

function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('hd_theme', next);
  const btn = document.getElementById('themeBtn');
  if (btn) btn.textContent = next === 'dark' ? '☀️' : '🌙';
  const icon = document.getElementById('themeIcon');
  if (icon) icon.textContent = next === 'dark' ? '☀️' : '🌙';
}

// ---- LOCAL STORAGE (team & settings only) ----
const LOCAL = {
  getTeam()       { return JSON.parse(localStorage.getItem('hd_team') || '[]'); },
  saveTeam(t)     { localStorage.setItem('hd_team', JSON.stringify(t)); },
  getSettings()   { return JSON.parse(localStorage.getItem('hd_settings') || '{}'); },
  saveSettings(s) { localStorage.setItem('hd_settings', JSON.stringify(s)); },
};

// ---- TICKET ID GENERATOR ----
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

// ---- TICKET CRUD ----
async function createTicket(data) {
  if (!isFirebaseReady()) { showToast('Database not connected', 'error'); return null; }
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
    const doc = await ref.get();
    if (doc.exists && doc.data().status !== 'resolved') {
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

// ---- REAL-TIME LISTENERS ----
function subscribeToTickets(callback) {
  if (!isFirebaseReady()) return () => {};
  return _db.collection('tickets').orderBy('created', 'desc')
    .onSnapshot(snap => callback(snap.docs.map(d => d.data())),
                err  => console.error('Listener error:', err));
}

function subscribeToTicket(id, callback) {
  if (!isFirebaseReady()) return () => {};
  return _db.collection('tickets').doc(id)
    .onSnapshot(doc => callback(doc.exists ? doc.data() : null),
                err  => console.error('Ticket listener error:', err));
}

// ---- SEED DEMO DATA (runs once on fresh DB) ----
async function seedDemoData() {
  if (!isFirebaseReady()) return;
  const snap = await _db.collection('tickets').limit(1).get();
  if (!snap.empty) return;

  LOCAL.saveTeam([
    { name:'Andiswa', email:'andiswa@helpdesk.com', role:'Agent',   avatar:'A' },
    { name:'Thabo',   email:'thabo@helpdesk.com',   role:'Agent',   avatar:'T' },
    { name:'Priya',   email:'priya@helpdesk.com',   role:'Manager', avatar:'P' },
    { name:'Sipho',   email:'sipho@helpdesk.com',   role:'Agent',   avatar:'S' },
  ]);

  const demos = [
    { title:'Cannot connect to VPN from home',     desc:'Auth failed error since password reset. Tried restarting.',         category:'IT',        priority:'high',     submitter:'John Mokoena',    submitterEmail:'john@example.com',    assignee:'Andiswa', status:'open',       daysAgo:0 },
    { title:'Outlook crashes on startup',          desc:'Crashes immediately after launch. Win 11, Office 365.',             category:'IT',        priority:'medium',   submitter:'Priya Naidoo',    submitterEmail:'priya.n@example.com', assignee:'Thabo',   status:'inprogress', daysAgo:1 },
    { title:'New employee laptop setup',           desc:'New employee Monday. Needs laptop, VPN, domain join.',              category:'IT',        priority:'low',      submitter:'HR Department',   submitterEmail:'hr@example.com',      assignee:'Sipho',   status:'open',       daysAgo:2 },
    { title:'Suspected phishing email received',   desc:'Email claiming to be IT asking for credentials. Forwarded.',        category:'Security',  priority:'critical', submitter:'Thabo Dlamini',   submitterEmail:'thabo.d@example.com', assignee:'Priya',   status:'inprogress', daysAgo:0 },
    { title:'Payroll system login issue',          desc:'Payroll portal locked after 3 failed attempts. Run is tomorrow.',   category:'HR',        priority:'high',     submitter:'Finance Team',    submitterEmail:'finance@example.com', assignee:'Andiswa', status:'resolved',   daysAgo:3 },
    { title:'Invoice not generating in billing',   desc:'Client invoice #4821 failed. Error: BIL-404. Client waiting.',      category:'Billing',   priority:'critical', submitter:'Sales Dept',      submitterEmail:'sales@example.com',   assignee:'Thabo',   status:'open',       daysAgo:0 },
    { title:'Printer offline in Finance office',   desc:'HP LaserJet 3rd floor offline. Multiple users affected.',           category:'IT',        priority:'medium',   submitter:'Lindiwe Khumalo', submitterEmail:'lindiwe@example.com', assignee:'Sipho',   status:'resolved',   daysAgo:5 },
    { title:'Request for additional monitors',     desc:'Dev team needs 4 second monitors. Advise on procurement.',          category:'Facilities',priority:'low',      submitter:'Dev Team Lead',   submitterEmail:'devlead@example.com', assignee:'',        status:'open',       daysAgo:4 },
  ];

  await _db.collection('meta').doc('counter').set({ value: 1000 });
  let counter = 1000;
  for (const d of demos) {
    counter++;
    const created = new Date(Date.now() - d.daysAgo*86400000 - Math.random()*3600000).toISOString();
    const resolvedAt = d.status === 'resolved'
      ? new Date(new Date(created).getTime() + (2+Math.random()*10)*3600000).toISOString() : null;
    const t = {
      id: 'TKT-'+counter, title:d.title, desc:d.desc, category:d.category,
      department:d.category, priority:d.priority, status:d.status,
      submitter:d.submitter, submitterEmail:d.submitterEmail, assignee:d.assignee,
      created, updated:created, resolvedAt, comments:[], attachments:[], watchers:[],
    };
    if (counter === 1001) {
      t.comments = [
        { id:'CMT-1', author:'Andiswa', text:"Hi John, looking into this now. Which VPN client version? @Thabo can you check the auth logs?", type:'public',   attachments:[], mentions:['Thabo'], created:new Date(Date.now()-3600000).toISOString() },
        { id:'CMT-2', author:'Thabo',   text:'Checked logs — auth failures from this IP. User profile needs refresh in AD.',                   type:'internal', attachments:[], mentions:[],       created:new Date(Date.now()-1800000).toISOString() },
      ];
    }
    await _db.collection('tickets').doc(t.id).set(t);
  }
  await _db.collection('meta').doc('counter').set({ value: counter });
}

// ---- STATS (computed from tickets array) ----
function getDashboardStats(tickets) {
  const resolved = tickets.filter(t => t.status==='resolved' && t.resolvedAt);
  const avgRes = resolved.length
    ? resolved.reduce((s,t) => s+(new Date(t.resolvedAt)-new Date(t.created)),0)/resolved.length : 0;
  const today = tickets.filter(t => {
    const d=new Date(t.created),n=new Date();
    return d.getDate()===n.getDate()&&d.getMonth()===n.getMonth()&&d.getFullYear()===n.getFullYear();
  }).length;
  return {
    total: tickets.length,
    byStatus:   count(tickets,'status'),
    byPriority: count(tickets,'priority'),
    byCategory: count(tickets,'category'),
    avgResMs: avgRes, today,
  };
}

function count(arr, key) {
  return arr.reduce((a,i)=>{ a[i[key]]=(a[i[key]]||0)+1; return a; },{});
}
function formatDuration(ms) {
  if (!ms) return '—';
  const h=Math.floor(ms/3600000), d=Math.floor(h/24);
  return d>0?d+'d '+(h%24)+'h':h>0?h+'h':Math.floor(ms/60000)+'m';
}
function timeAgo(iso) {
  const m=Math.floor((Date.now()-new Date(iso).getTime())/60000);
  if(m<1) return 'just now';
  if(m<60) return m+'m ago';
  const h=Math.floor(m/60);
  if(h<24) return h+'h ago';
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

// ---- TOAST ----
function showToast(msg, type='success') {
  const ex=document.querySelector('.toast'); if(ex) ex.remove();
  const t=document.createElement('div');
  t.className=`toast toast-${type}`;
  t.innerHTML=`<span class="toast-icon">${type==='success'?'✓':type==='error'?'✕':'ℹ'}</span><span>${msg}</span>`;
  document.body.appendChild(t);
  setTimeout(()=>t.classList.add('toast-show'),10);
  setTimeout(()=>{t.classList.remove('toast-show');setTimeout(()=>t.remove(),300);},3200);
}

// Auto-init Firebase when script loads
initFirebase();
