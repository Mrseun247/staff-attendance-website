// ═══════════════════════════════════════════
// STAFFTRACK — unified single-file app
// Admin and staff both log in with their own credentials.
// Staff login (Staff ID + password) replaces the old shared-kiosk
// "pick your name + PIN" flow — each person authenticates as themselves.
// ═══════════════════════════════════════════

// ── QR GENERATOR (admin side — rotating security QR + printed QR) ──
function makeQR(targetEl, text, size) {
  targetEl.innerHTML = '';
  size = size || 120;
  if (typeof QRCode !== 'undefined') {
    try {
      new QRCode(targetEl, { text, width: size, height: size, colorDark: '#0F1C3F', colorLight: '#FFFFFF', correctLevel: QRCode.CorrectLevel.M });
      return;
    } catch (e) { /* fall through */ }
  }
  const img = document.createElement('img');
  img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=' + size + 'x' + size + '&data=' + encodeURIComponent(text) + '&color=0F1C3F&bgcolor=FFFFFF&margin=4&ecc=M';
  img.width = size; img.height = size; img.style.borderRadius = '4px'; img.alt = 'QR Code';
  targetEl.appendChild(img);
}

// ═══════════════════════════════════════════
// STATE — cloud is primary, localStorage is cache
// ═══════════════════════════════════════════
let staffList  = JSON.parse(localStorage.getItem('vmis_staff')  || '[]');
let logs       = JSON.parse(localStorage.getItem('vmis_logs')   || '[]');
let scriptUrl  = localStorage.getItem('vmis_script_url')        || 'https://script.google.com/macros/s/AKfycbz2bGmhJq9XjYni5ondNxIPFBzGsquigfPz7e_fmiV9KdYEeT_bC2N59jMDJF8InQM2/exec';
if (!localStorage.getItem('vmis_script_url')) localStorage.setItem('vmis_script_url', scriptUrl);
let schoolInfo = JSON.parse(localStorage.getItem('vmis_school') || '{"name":"","branch":"","session":"2025/2026"}');
let attRules   = JSON.parse(localStorage.getItem('vmis_rules')  || '{"resumption":"07:30","closing":"15:00","late":15}');

function freshLogs() { return JSON.parse(localStorage.getItem('vmis_logs') || '[]'); }

// ═══════════════════════════════════════════
// PASSWORD HASHING (SHA-256 — good enough for local/small-school use)
// ═══════════════════════════════════════════
async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(password + ':StaffTrack:' + salt);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ═══════════════════════════════════════════
// CLOUD — Google Apps Script as primary store
// ═══════════════════════════════════════════
function postCloud(action, data) {
  if (!scriptUrl) return Promise.resolve();
  return fetch(scriptUrl, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, data }) })
    .catch(e => console.warn('Cloud sync error:', e));
}

let cloudSyncBusy = false;
function loadCloudData() {
  if (!scriptUrl || cloudSyncBusy) return Promise.resolve(false);
  cloudSyncBusy = true;
  const cb = 'stc_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  return new Promise(resolve => {
    const script = document.createElement('script');
    const cleanup = () => { delete window[cb]; script.remove(); cloudSyncBusy = false; };
    window[cb] = data => {
      try {
        if (data && data.ok) {
          if (data.staff)  staffList  = data.staff;
          if (data.logs)   logs       = data.logs;
          if (data.school) schoolInfo = data.school;
          if (data.rules)  attRules   = data.rules;
          localStorage.setItem('vmis_staff',  JSON.stringify(staffList));
          localStorage.setItem('vmis_logs',   JSON.stringify(logs));
          localStorage.setItem('vmis_school', JSON.stringify(schoolInfo));
          localStorage.setItem('vmis_rules',  JSON.stringify(attRules));
          if (data.admins) localStorage.setItem('vmis_admins', JSON.stringify(data.admins));
          if (data.activeToken) localStorage.setItem('vmis_active_token', JSON.stringify(data.activeToken));
          resolve(true);
        } else { resolve(false); }
      } finally { cleanup(); }
    };
    script.onerror = () => { cleanup(); resolve(false); };
    script.src = scriptUrl + (scriptUrl.includes('?') ? '&' : '?') + 'action=getData&callback=' + encodeURIComponent(cb) + '&_=' + Date.now();
    document.body.appendChild(script);
  });
}

async function refreshCloudAndRender() {
  const ok = await loadCloudData();
  if (!ok) { logs = freshLogs(); staffList = JSON.parse(localStorage.getItem('vmis_staff') || '[]'); }
  if (!currentAdmin && !currentStaff) return;
  if (currentAdmin) {
    const active = document.querySelector('#adminApp .page.active');
    if (active) {
      if (active.id === 'page-logs')     renderLogs();
      if (active.id === 'page-security') renderSecurityPanel();
      if (active.id === 'page-setup')    renderStaffList();
    }
  }
  if (currentStaff) renderStaffHome();
}
setInterval(() => { if (currentAdmin || currentStaff) refreshCloudAndRender(); }, 15000);

// ═══════════════════════════════════════════
// DATE/TIME HELPERS
// ═══════════════════════════════════════════
function getDateStr(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function getTimeStr(d) { return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0'); }
function getDayStr(d)  { return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()]; }
function fmtTime(d) { return d.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }); }
function fmtDate(d) { return d.toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
function getShift() { return new Date().getHours() < 12 ? 'morning' : 'afternoon'; }

function updateClock() {
  const now = new Date();
  const el = document.getElementById('clockDisplay');
  if (el) el.textContent = now.toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + now.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
  const sc = document.getElementById('shomeClock'); if (sc) sc.textContent = fmtTime(now);
  const sd = document.getElementById('shomeDate');  if (sd) sd.textContent = fmtDate(now);
}
setInterval(updateClock, 1000);
updateClock();

// ═══════════════════════════════════════════
// UNIFIED LOGIN — checks admin accounts, then staff accounts
// ═══════════════════════════════════════════
const DEFAULT_ADMINS = [
  { name: 'Super Admin', username: 'superadmin', password: 'superadmin123', role: 'superadmin' },
  { name: 'Admin',       username: 'admin',      password: 'admin123',      role: 'admin' },
];
function getAdminAccounts() { const raw = localStorage.getItem('vmis_admins'); return raw ? JSON.parse(raw) : DEFAULT_ADMINS; }
function saveAdminAccounts(list) { localStorage.setItem('vmis_admins', JSON.stringify(list)); postCloud('saveAdmins', list); }

let currentAdmin = null;
let currentStaff = null;

async function doLogin() {
  const userRaw = (document.getElementById('loginUser')?.value || '').trim();
  const pass    = (document.getElementById('loginPass')?.value || '').trim();
  const err     = document.getElementById('loginError');
  const reveal  = document.getElementById('loginReveal');
  if (err) err.style.display = 'none';
  if (reveal) reveal.style.display = 'none';
  if (!userRaw || !pass) { if (err) { err.textContent = 'Enter your username/ID and password.'; err.style.display = 'block'; } return; }

  showLoading('Signing in…');
  await loadCloudData(); // pull the latest accounts before checking, so login works on any device
  hideLoading();

  // 1) Try admin accounts
  const admins = getAdminAccounts();
  const adminMatch = admins.find(a => a.username.toLowerCase() === userRaw.toLowerCase() && a.password === pass);
  if (adminMatch) {
    currentAdmin = adminMatch;
    currentStaff = null;
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('adminApp').classList.add('active');
    document.getElementById('staffApp').classList.remove('active');
    document.getElementById('loggedInAs').textContent = adminMatch.name + ' (' + adminMatch.role + ')';
    document.getElementById('superAdminTab').style.display = adminMatch.role === 'superadmin' ? 'inline-flex' : 'none';
    _initAdminApp();
    return;
  }

  // 2) Try staff accounts (Staff ID = username)
  const staffMatch = staffList.find(s => s.id.toLowerCase() === userRaw.toLowerCase());
  if (staffMatch && staffMatch.password) {
    const hashed = await hashPassword(pass, staffMatch.id);
    if (hashed === staffMatch.password) {
      currentStaff = staffMatch;
      currentAdmin = null;
      document.getElementById('loginScreen').classList.add('hidden');
      document.getElementById('staffApp').classList.add('active');
      document.getElementById('adminApp').classList.remove('active');
      _initStaffApp();
      return;
    }
  }

  if (err) { err.textContent = 'Incorrect username/ID or password.'; err.style.display = 'block'; }
}

function doLogout() {
  currentAdmin = null;
  currentStaff = null;
  stopStaffCamera();
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('adminApp').classList.remove('active');
  document.getElementById('staffApp').classList.remove('active');
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
  document.querySelectorAll('#staffApp .screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-shome').classList.add('active');
}

function showLoading(msg) { const el = document.getElementById('loadingOverlay'); const t = document.getElementById('loadingTxt'); if (el) el.classList.add('open'); if (t) t.textContent = msg || 'Loading…'; }
function hideLoading() { const el = document.getElementById('loadingOverlay'); if (el) el.classList.remove('open'); }

// ═══════════════════════════════════════════════════════════════
// ══════════════════════ ADMIN APP ═══════════════════════════════
// ═══════════════════════════════════════════════════════════════
function showPage(id) {
  document.querySelectorAll('#adminApp .page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  event.target.classList.add('active');
  refreshCloudAndRender();
}

function _initAdminApp() {
  logs = freshLogs();
  renderStaffList();
  updateConnStatus();
  const su = document.getElementById('scriptUrl'); if (su) su.value = scriptUrl;
  loadAdminFields();
  refreshCloudAndRender();
  renderAdminList();
}

// ── Staff management ──
function addStaff() {
  const name = document.getElementById('staffName').value.trim();
  const id   = document.getElementById('staffId').value.trim().toUpperCase();
  const dept = document.getElementById('staffDept').value;
  const role = document.getElementById('staffRole').value.trim();
  const pass = document.getElementById('staffPassword').value.trim();
  if (!name || !id || !dept || !role || !pass) { showToast('error', '⚠️', 'Missing Fields', 'Please fill in all fields, including a login password.'); return; }
  if (pass.length < 4) { showToast('error', '⚠️', 'Weak Password', 'Password must be at least 4 characters.'); return; }
  if (staffList.find(s => s.id === id)) { showToast('error', '⚠️', 'Duplicate ID', 'Staff ID already exists.'); return; }

  hashPassword(pass, id).then(hashed => {
    const staff = { id, name, dept, role, password: hashed, added: new Date().toISOString() };
    staffList.push(staff);
    saveStaff();
    renderStaffList();
    const reveal = document.getElementById('staffPasswordReveal');
    if (reveal) {
      reveal.style.display = 'block';
      reveal.innerHTML = `🔑 Login for <strong>${name}</strong> — Staff ID: <code>${id}</code>, Password: <code>${pass}</code><br><span style="font-size:11px;">Share this with them now — it cannot be shown again.</span>`;
    }
    clearStaffForm();
    showToast('success', '✅', name, 'Added — share the login shown below.');
  });
}
function clearStaffForm() {
  ['staffName', 'staffId', 'staffRole', 'staffPassword'].forEach(i => document.getElementById(i).value = '');
  document.getElementById('staffDept').value = '';
}
function removeStaff(id) {
  if (!confirm('Remove this staff member? They will no longer be able to log in.')) return;
  staffList = staffList.filter(s => s.id !== id);
  saveStaff();
  renderStaffList();
}
function saveStaff() { localStorage.setItem('vmis_staff', JSON.stringify(staffList)); postCloud('saveStaff', staffList); }

function resetStaffPassword(id, name) {
  const newPass = prompt('Enter a new password for ' + name + ' (min 4 characters):');
  if (!newPass) return;
  if (newPass.trim().length < 4) { showToast('error', '⚠️', 'Weak Password', 'Password must be at least 4 characters.'); return; }
  hashPassword(newPass.trim(), id).then(hashed => {
    const s = staffList.find(x => x.id === id);
    if (!s) return;
    s.password = hashed;
    saveStaff();
    renderStaffList();
    const reveal = document.getElementById('staffPasswordReveal');
    if (reveal) {
      reveal.style.display = 'block';
      reveal.innerHTML = `🔑 New password for <strong>${name}</strong> (${id}): <code>${newPass.trim()}</code><br><span style="font-size:11px;">Share this with them now — it cannot be shown again.</span>`;
    }
    showToast('success', '🔑', 'Password Reset', name + "'s password has been changed.");
  });
}

function renderStaffList() {
  const wrap = document.getElementById('staffListWrap');
  if (!wrap) return;
  if (staffList.length === 0) {
    wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">👥</div><h3>No staff added yet</h3><p>Use the form above to add staff members.</p></div>';
    return;
  }
  wrap.innerHTML = '<table class="staff-table"><thead><tr><th>ID</th><th>Name</th><th>Department</th><th>Role</th><th>Today</th><th>Actions</th></tr></thead><tbody>' +
    staffList.map(s => {
      const today = getDateStr(new Date());
      const todayRec = freshLogs().filter(l => l.id === s.id && l.date === today);
      const hasIn = todayRec.some(l => l.status === 'IN');
      const hasOut = todayRec.some(l => l.status === 'OUT');
      let badge = '<span class="badge" style="background:#F3F4F6;color:#6B7280">Absent</span>';
      if (hasIn && hasOut) badge = '<span class="badge badge-green">In &amp; Out ✓</span>';
      else if (hasIn) badge = '<span class="badge" style="background:#DBEAFE;color:#1D4ED8">Signed In 🌅</span>';
      return '<tr>' +
        '<td><span class="badge badge-navy">' + s.id + '</span></td>' +
        '<td><strong>' + s.name + '</strong></td>' +
        '<td>' + s.dept + '</td><td>' + s.role + '</td>' +
        '<td>' + badge + '</td>' +
        '<td style="display:flex;gap:6px;flex-wrap:wrap">' +
          '<button class="btn btn-ghost btn-sm" onclick="resetStaffPassword(\'' + s.id + '\',\'' + s.name.replace(/'/g, "\\'") + '\')">🔑 Reset Password</button>' +
          '<button class="btn btn-ghost btn-sm" onclick="removeStaff(\'' + s.id + '\')">✕ Remove</button>' +
        '</td></tr>';
    }).join('') + '</tbody></table>';
}

// ── Rotating QR security ──
let rqrCodes = [];
let activeToken = null;
let rqrTimerInterval = null;

function saveRqrSettings() { localStorage.setItem('vmis_rqr_expiry', String(parseInt(document.getElementById('rqrExpiry').value) || 5)); }

function generateRotatingQRs(count) {
  count = count || 6;
  rqrCodes = [];
  activeToken = null;
  localStorage.removeItem('vmis_active_token');
  // No cloud clear here — activateToken(firstToken) below is the single source of
  // truth for the cloud's activeToken. Firing a separate "clear" POST first created a
  // race: on a real network the clear could land AFTER the activate, wiping it back to null.
  const grid = document.getElementById('rqrGrid');
  if (!grid) return;
  grid.innerHTML = '';
  let firstToken = null;
  for (let i = 0; i < count; i++) {
    const token = 'RQR-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    if (i === 0) firstToken = token;
    const payload = JSON.stringify({ t: token, app: 'StaffTrack' });
    const card = document.createElement('div');
    card.className = 'rqr-card';
    card.dataset.token = token;
    card.innerHTML = '<div class="rqr-num">QR ' + (i + 1) + '</div>';
    const qrEl = document.createElement('div');
    qrEl.style.cssText = 'width:100px;height:100px;margin:0 auto 6px';
    card.appendChild(qrEl);
    card.onclick = () => activateToken(token);
    grid.appendChild(card);
    rqrCodes.push({ token, card, qrEl });
    setTimeout(() => makeQR(qrEl, payload, 100), 80 * i);
  }
  // QR 1 is active immediately — otherwise none of the codes work until the admin
  // remembers to click one, which reads to staff as "QR expired".
  if (firstToken) activateToken(firstToken);
  showToast('success', '🔐', 'QR Set Generated', 'QR 1 is active now. Click a different card to rotate to another code.');
}

function activateToken(token) {
  if (activeToken === token) return;
  activeToken = token;
  rqrCodes.forEach(r => { r.card.classList.remove('active'); const b = r.card.querySelector('.rqr-active-badge'); if (b) b.remove(); });
  const active = rqrCodes.find(r => r.token === token);
  if (!active) return;
  active.card.classList.add('active');
  const badge = document.createElement('span');
  badge.className = 'rqr-active-badge';
  badge.textContent = '✓ ACTIVE';
  active.card.insertBefore(badge, active.card.firstChild);

  const expiryMins = parseInt(document.getElementById('rqrExpiry')?.value || '5');
  const expiresAt = expiryMins > 0 ? Date.now() + expiryMins * 60000 : 0;
  const tokenData = { token, expiresAt, schoolName: schoolInfo.name || 'StaffTrack' };
  localStorage.setItem('vmis_active_token', JSON.stringify(tokenData));
  postCloud('saveActiveToken', tokenData);

  const tokenDisplay = document.getElementById('activeTokenDisplay');
  const tokenText = document.getElementById('activeTokenText');
  if (tokenDisplay) tokenDisplay.style.display = 'block';
  if (tokenText) tokenText.textContent = token;

  startRqrTimer(expiresAt);
  showToast('success', '✅', 'QR Activated', 'Staff can now scan this QR or type the token to confirm they are on-site.');
}

function startRqrTimer(expiresAt) {
  if (rqrTimerInterval) clearInterval(rqrTimerInterval);
  const wrap = document.getElementById('rqrTimerWrap');
  const timer = document.getElementById('rqrTimer');
  if (!wrap || !timer) return;
  if (!expiresAt) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  function tick() {
    const left = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
    const m = Math.floor(left / 60), s = left % 60;
    timer.textContent = m + ':' + String(s).padStart(2, '0');
    timer.className = left < 60 ? 'danger' : (left < 120 ? 'warn' : '');
    if (left === 0) {
      clearInterval(rqrTimerInterval);
      timer.textContent = 'Expired';
      activeToken = null;
      localStorage.removeItem('vmis_active_token');
      postCloud('saveActiveToken', null);
      const td = document.getElementById('activeTokenDisplay'); if (td) td.style.display = 'none';
      rqrCodes.forEach(r => { r.card.classList.remove('active'); const b = r.card.querySelector('.rqr-active-badge'); if (b) b.remove(); });
      showToast('duplicate', '⏰', 'QR Expired', 'Generate a new QR set to continue sign-ins.');
    }
  }
  tick();
  rqrTimerInterval = setInterval(tick, 1000);
}

function printActiveQR() {
  const active = rqrCodes.find(r => r.token === activeToken);
  if (!active) { showToast('error', '⚠️', 'No Active QR', 'Click a QR to activate it first.'); return; }
  const canvas = active.qrEl.querySelector('canvas');
  const img = active.qrEl.querySelector('img');
  const src = canvas ? canvas.toDataURL() : (img ? img.src : '');
  if (!src) { showToast('error', '⚠️', 'Not Ready', 'QR not rendered yet, wait a moment.'); return; }
  const win = window.open('', '_blank');
  if (!win) { alert('Allow pop-ups to print.'); return; }
  const expiryMins = document.getElementById('rqrExpiry')?.value || '5';
  const doc = win.document;
  doc.open();
  doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Active QR Code</title><style>body{font-family:sans-serif;text-align:center;padding:60px}h2{font-size:26px;font-weight:900;margin-bottom:4px}.sub{font-size:14px;color:#666;margin-bottom:24px}img{border:3px solid #0F1C3F;border-radius:12px;padding:10px}.note{font-size:12px;color:#999;margin-top:20px;line-height:1.7}</style></head><body>');
  doc.write('<h2>' + (schoolInfo.name || 'StaffTrack') + '</h2>');
  doc.write('<div class="sub">Scan to confirm on-site — Valid for ' + expiryMins + ' min</div>');
  doc.write('<img src="' + src + '" width="240" height="240" alt="QR"/>');
  doc.write('<div style="font-size:22px;font-weight:900;letter-spacing:3px;margin:16px 0;color:#0F1C3F">' + active.token + '</div>');
  doc.write('<div class="note">Staff log in with their own account, then scan this QR (or type the token) to sign in / out.<br>Expires in ' + expiryMins + ' minutes.</div>');
  doc.write('</body></html>');
  doc.close();
  win.addEventListener('load', () => win.print());
}

// ── Logs rendering ──
function renderLogs() {
  logs = freshLogs();
  const search = (document.getElementById('logSearch')?.value || '').toLowerCase();
  const dateFilter = document.getElementById('logDate')?.value || '';
  const statusFilter = document.getElementById('logFilter')?.value || '';

  let filtered = logs;
  if (search) filtered = filtered.filter(l => l.name.toLowerCase().includes(search) || l.id.toLowerCase().includes(search));
  if (dateFilter) filtered = filtered.filter(l => l.date === dateFilter);
  if (statusFilter) filtered = filtered.filter(l => l.status === statusFilter);

  const today = getDateStr(new Date());
  const todayLogs = logs.filter(l => l.date === today);
  const inCount = todayLogs.filter(l => l.status === 'IN').length;
  const outCount = todayLogs.filter(l => l.status === 'OUT').length;
  const lateCount = todayLogs.filter(l => l.status === 'IN' && l.isLate).length;
  const fullDone = staffList.filter(s => todayLogs.some(l => l.id === s.id && l.status === 'IN') && todayLogs.some(l => l.id === s.id && l.status === 'OUT')).length;
  const absent = staffList.filter(s => !todayLogs.some(l => l.id === s.id)).length;

  const statsRow = document.getElementById('statsRow');
  if (statsRow) statsRow.innerHTML =
    '<div class="stat-card"><div class="stat-val">' + staffList.length + '</div><div class="stat-lbl">Total Staff</div></div>' +
    '<div class="stat-card green"><div class="stat-val">' + inCount + '</div><div class="stat-lbl">🌅 Sign-Ins</div></div>' +
    '<div class="stat-card gold"><div class="stat-val">' + outCount + '</div><div class="stat-lbl">🌆 Sign-Outs</div></div>' +
    '<div class="stat-card"><div class="stat-val">' + fullDone + '</div><div class="stat-lbl">✅ Full Day</div></div>' +
    '<div class="stat-card red"><div class="stat-val">' + lateCount + '</div><div class="stat-lbl">⚠️ Late Today</div></div>' +
    '<div class="stat-card" style="border-left:3px solid var(--red)"><div class="stat-val" style="color:var(--red)">' + absent + '</div><div class="stat-lbl">Absent</div></div>';

  const lateCard = document.getElementById('lateReportCard');
  const lateWrap = document.getElementById('lateTableWrap');
  const lateBadge = document.getElementById('lateCountBadge');
  const lateLogs = todayLogs.filter(l => l.status === 'IN' && l.isLate);
  if (lateCard) lateCard.style.display = lateLogs.length > 0 ? 'block' : 'none';
  if (lateBadge) lateBadge.textContent = lateLogs.length + ' late';
  if (lateWrap && lateLogs.length > 0) {
    lateWrap.innerHTML = '<table class="log-table"><thead><tr><th>Name</th><th>Department</th><th>Role</th><th>Time</th><th>Minutes Late</th></tr></thead><tbody>' +
      lateLogs.map(l => '<tr><td><strong>' + l.name + '</strong></td><td>' + (l.department || '') + '</td><td>' + (l.role || '') + '</td><td>' + l.time + '</td><td><span class="badge badge-late">' + (l.minutesLate || '?') + ' min late</span></td></tr>').join('') +
      '</tbody></table>';
  }

  const wrap = document.getElementById('logsTableWrap');
  if (!wrap) return;
  if (filtered.length === 0) { wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><h3>No records found</h3><p>Adjust filters, or wait for staff to sign in.</p></div>'; return; }
  wrap.innerHTML = '<table class="log-table"><thead><tr><th>Staff ID</th><th>Name</th><th>Dept</th><th>Role</th><th>Date</th><th>Time</th><th>Day</th><th>Shift</th><th>Status</th></tr></thead><tbody>' +
    filtered.map(l => {
      const shift = l.shift === 'morning' ? '🌅 Morning' : (l.shift === 'afternoon' ? '🌆 Afternoon' : '—');
      const lateBadgeHtml = (l.status === 'IN' && l.isLate) ? ' <span class="badge badge-late" style="font-size:10px">⚠️ Late</span>' : '';
      return '<tr' + (l.isLate ? ' style="background:#FFF5F5"' : '') + '>' +
        '<td><span class="badge badge-navy">' + l.id + '</span></td>' +
        '<td><strong>' + l.name + '</strong>' + lateBadgeHtml + '</td>' +
        '<td>' + (l.department || '') + '</td><td>' + (l.role || '') + '</td>' +
        '<td>' + l.date + '</td><td>' + l.time + '</td><td>' + l.day + '</td>' +
        '<td>' + shift + '</td>' +
        '<td><span class="status-dot ' + (l.status === 'IN' ? 'in' : 'out') + '"></span><span class="badge ' + (l.status === 'IN' ? 'badge-green' : 'badge-gold') + '">' + (l.status === 'IN' ? 'Sign-In' : 'Sign-Out') + '</span></td>' +
      '</tr>';
    }).join('') + '</tbody></table>';
}

function clearTodayLogs() {
  const today = getDateStr(new Date());
  if (!confirm("Clear all of today's records?")) return;
  logs = logs.filter(l => l.date !== today);
  localStorage.setItem('vmis_logs', JSON.stringify(logs));
  postCloud('saveLogs', logs);
  renderLogs();
}

function exportLogsCSV() {
  logs = freshLogs();
  const header = ['ID', 'Name', 'Department', 'Role', 'Date', 'Time', 'Day', 'Shift', 'Status'];
  const rows = logs.map(l => [l.id, l.name, l.department, l.role, l.date, l.time, l.day, l.shift || '', l.status]);
  downloadCSV([header, ...rows], 'attendance_logs.csv');
}
function exportStaffCSV() {
  const header = ['ID', 'Name', 'Department', 'Role'];
  const rows = staffList.map(s => [s.id, s.name, s.dept, s.role]);
  downloadCSV([header, ...rows], 'staff_list.csv');
}
function downloadCSV(rows, filename) {
  const content = rows.map(r => r.map(v => '"' + (v || '').toString().replace(/"/g, '""') + '"').join(',')).join('\n');
  const blob = new Blob([content], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function exportAllData() {
  const data = { staffList, logs, schoolInfo, attRules, exported: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'attendance_backup.json'; a.click();
  URL.revokeObjectURL(url);
}
function importData() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json,.csv';
  input.onchange = e => {
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        if (file.name.endsWith('.json')) {
          const data = JSON.parse(ev.target.result);
          if (data.staffList) { staffList = data.staffList; saveStaff(); }
          showToast('success', '✅', 'Imported', 'Staff data loaded.');
          renderStaffList();
        } else {
          const lines = ev.target.result.split('\n').filter(Boolean);
          lines.slice(1).forEach(line => {
            const [id, name, dept, role] = line.split(',').map(v => v.replace(/^"|"$/g, '').trim());
            if (id && name && !staffList.find(s => s.id === id)) {
              staffList.push({ id, name, dept: dept || '', role: role || '', added: new Date().toISOString() });
            }
          });
          saveStaff(); renderStaffList();
          showToast('success', '✅', 'Imported', staffList.length + ' staff loaded. Note: CSV import has no password — use Reset Password for each.');
        }
      } catch { showToast('error', '❌', 'Import Failed', 'Invalid file format.'); }
    };
    reader.readAsText(file);
  };
  input.click();
}

// ── Admin settings ──
function loadAdminFields() {
  const sn = document.getElementById('schoolName'); if (sn) sn.value = schoolInfo.name || '';
  const sb = document.getElementById('schoolBranch'); if (sb) sb.value = schoolInfo.branch || '';
  const as = document.getElementById('academicSession'); if (as) as.value = schoolInfo.session || '';
  const rt = document.getElementById('resumptionTime'); if (rt) rt.value = attRules.resumption || '07:30';
  const ct = document.getElementById('closingTime'); if (ct) ct.value = attRules.closing || '15:00';
  const lt = document.getElementById('lateThreshold'); if (lt) lt.value = attRules.late || 15;
}
async function saveScriptUrl() {
  const val = document.getElementById('scriptUrl').value.trim();
  if (!val) { showToast('error', '⚠️', 'Empty URL', 'Please paste your Google Apps Script URL.'); return; }
  scriptUrl = val;
  localStorage.setItem('vmis_script_url', scriptUrl);
  updateConnStatus();
  await postCloud('saveAll', { staff: staffList, logs, school: schoolInfo, rules: attRules, admins: getAdminAccounts() });
  await refreshCloudAndRender();
  showToast('success', '✅', 'Saved', 'Google Sheets URL saved & synced.');
}
function updateConnStatus() {
  const dot = document.getElementById('connDot'); const text = document.getElementById('connText');
  if (!dot || !text) return;
  if (scriptUrl) { dot.className = 'conn-dot connected'; text.textContent = 'Connected · ' + scriptUrl.substring(0, 60) + (scriptUrl.length > 60 ? '…' : ''); }
  else { dot.className = 'conn-dot'; text.textContent = 'Not configured — data stored locally only'; }
}
async function testConnection() {
  if (!scriptUrl) { showToast('error', '⚙️', 'No URL', 'Set the Script URL first.'); return; }
  showToast('success', '🔁', 'Testing…', 'Checking Google Sheets connection.');
  try {
    const testEntry = { id: 'TEST-CONN', name: 'Connection Test', department: 'System', role: 'Test', date: getDateStr(new Date()), time: getTimeStr(new Date()), status: 'TEST', day: getDayStr(new Date()), shift: 'test' };
    await postCloud('addLog', testEntry);
    showToast('success', '✅', 'Connection OK', 'Test entry sent to Google Sheets.');
    document.getElementById('connDot').className = 'conn-dot connected';
  } catch (e) {
    showToast('error', '❌', 'Connection Failed', 'Check your URL and permissions.');
    document.getElementById('connDot').className = 'conn-dot error';
  }
}
function saveSchoolInfo() {
  schoolInfo = { name: document.getElementById('schoolName').value.trim(), branch: document.getElementById('schoolBranch').value.trim(), session: document.getElementById('academicSession').value.trim() };
  localStorage.setItem('vmis_school', JSON.stringify(schoolInfo));
  postCloud('saveSchool', schoolInfo);
  showToast('success', '✅', 'Saved', 'School info updated.');
}
function saveAttendanceRules() {
  attRules = { resumption: document.getElementById('resumptionTime').value, closing: document.getElementById('closingTime').value, late: parseInt(document.getElementById('lateThreshold').value) || 15 };
  localStorage.setItem('vmis_rules', JSON.stringify(attRules));
  postCloud('saveRules', attRules);
  showToast('success', '✅', 'Saved', 'Attendance rules updated.');
}
function confirmReset() {
  if (confirm('⚠️ This will delete ALL staff and attendance records. Continue?')) {
    if (confirm('Final warning: This cannot be undone. Proceed?')) {
      if (scriptUrl) postCloud('resetAll', {});
      localStorage.removeItem('vmis_staff'); localStorage.removeItem('vmis_logs');
      staffList = []; logs = [];
      schoolInfo = { name: '', branch: '', session: '' };
      attRules = { resumption: '07:30', closing: '15:00', late: 15 };
      renderStaffList();
      showToast('success', '✅', 'Reset', 'All staff and attendance data cleared.');
    }
  }
}

// ── Security panel ──
function renderSecurityPanel() {
  const today = getDateStr(new Date());
  const pinWrap = document.getElementById('pinStatusWrap');
  if (pinWrap) {
    if (staffList.length === 0) {
      pinWrap.innerHTML = '<div class="empty-state" style="padding:32px"><div class="empty-icon">👥</div><h3>No staff registered</h3></div>';
    } else {
      pinWrap.innerHTML = '<table class="log-table"><thead><tr><th>ID</th><th>Name</th><th>Department</th><th>Login</th><th>Action</th></tr></thead><tbody>' +
        staffList.map(s => '<tr>' +
          '<td><span class="badge badge-navy">' + s.id + '</span></td>' +
          '<td><strong>' + s.name + '</strong></td><td>' + s.dept + '</td>' +
          '<td>' + (s.password ? '<span class="badge badge-green">✓ Active</span>' : '<span class="badge badge-gold">⚠ No password</span>') + '</td>' +
          '<td><button class="btn btn-ghost btn-sm" onclick="resetStaffPassword(\'' + s.id + '\',\'' + s.name.replace(/'/g, "\\'") + '\')">🔑 Reset</button></td>' +
        '</tr>').join('') + '</tbody></table>';
    }
  }
  const slWrap = document.getElementById('selfSigninLogWrap');
  if (slWrap) {
    const selfLogs = freshLogs().filter(l => l.date === today && l.device === 'self-signin');
    if (selfLogs.length === 0) {
      slWrap.innerHTML = '<div class="empty-state" style="padding:32px"><div class="empty-icon">🧾</div><h3>No self sign-ins today</h3></div>';
    } else {
      slWrap.innerHTML = '<table class="log-table"><thead><tr><th>Staff ID</th><th>Name</th><th>Time</th><th>Shift</th><th>Status</th></tr></thead><tbody>' +
        selfLogs.map(l => '<tr><td><span class="badge badge-navy">' + l.id + '</span></td><td><strong>' + l.name + '</strong></td><td>' + l.time + '</td>' +
          '<td style="font-size:12px">' + (l.shift === 'morning' ? '🌅 Morning' : '🌆 Afternoon') + '</td>' +
          '<td><span class="status-dot ' + (l.status === 'IN' ? 'in' : 'out') + '"></span><span class="badge ' + (l.status === 'IN' ? 'badge-green' : 'badge-gold') + '">' + (l.status === 'IN' ? 'Sign-In' : 'Sign-Out') + '</span></td></tr>').join('') +
        '</tbody></table>';
    }
  }
}

// ── Toast (admin-side feedback) ──
let toastTimer;
function showToast(type, icon, name, msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.classList.remove('show');
  toast.className = type;
  document.getElementById('toastIcon').textContent = icon;
  document.getElementById('toastName').textContent = name;
  document.getElementById('toastMsg').textContent = msg;
  clearTimeout(toastTimer);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    toast.classList.add('show');
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
  }));
}

// ── Admin account management (super admin) ──
function addAdminAccount() {
  if (!currentAdmin || currentAdmin.role !== 'superadmin') { showToast('error', '🚫', 'Access Denied', 'Only super admins can add accounts.'); return; }
  const name = document.getElementById('newAdminName').value.trim();
  const user = document.getElementById('newAdminUser').value.trim().toLowerCase();
  const pass = document.getElementById('newAdminPass').value.trim();
  const role = document.getElementById('newAdminRole').value;
  if (!name || !user || !pass) { showToast('error', '⚠️', 'Missing Fields', 'Fill in all fields.'); return; }
  const accounts = getAdminAccounts();
  if (accounts.find(a => a.username === user)) { showToast('error', '⚠️', 'Duplicate', 'Username already exists.'); return; }
  accounts.push({ name, username: user, password: pass, role });
  saveAdminAccounts(accounts);
  ['newAdminName', 'newAdminUser', 'newAdminPass'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  renderAdminList();
  showToast('success', '✅', name, 'Admin account created.');
}
function removeAdminAccount(username) {
  if (username === 'superadmin') { showToast('error', '🚫', 'Cannot Remove', 'Default super admin cannot be removed.'); return; }
  if (!confirm('Remove admin account "' + username + '"?')) return;
  saveAdminAccounts(getAdminAccounts().filter(a => a.username !== username));
  renderAdminList();
  showToast('success', '✅', 'Removed', 'Admin account deleted.');
}
function renderAdminList() {
  const wrap = document.getElementById('adminListWrap');
  if (!wrap) return;
  wrap.innerHTML = getAdminAccounts().map(a =>
    '<div class="admin-mgr-card"><div class="admin-mgr-avatar">' + a.name.charAt(0).toUpperCase() + '</div>' +
    '<div class="admin-mgr-info"><div class="amn">' + a.name + '</div><div class="amu">@' + a.username + '</div>' +
    '<span class="amr ' + a.role + '">' + (a.role === 'superadmin' ? '👑 Super Admin' : '🔧 Admin') + '</span></div>' +
    (a.username !== 'superadmin' ? '<button class="btn btn-danger btn-sm" onclick="removeAdminAccount(\'' + a.username + '\')">Remove</button>' : '') + '</div>'
  ).join('');
}

// ═══════════════════════════════════════════════════════════════
// ══════════════════════ STAFF APP ════════════════════════════════
// Logged-in staff member's own attendance screen — no more picker,
// no more PIN. Login already proves who they are; the QR/token step
// just confirms they're physically on-site before recording.
// ═══════════════════════════════════════════════════════════════
// Mobile Safari leaves the page scrolled after the on-screen keyboard closes, which can
// push a position:fixed screen out of the visible area. Reset on every transition.
function resetStaffViewport_() {
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  window.scrollTo(0, 0);
}

function showStaffScreen(id) {
  document.querySelectorAll('#staffApp .screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
  resetStaffViewport_();
}

function _initStaffApp() {
  renderStaffHome();
}

function renderStaffHome() {
  if (!currentStaff) return;
  const school = schoolInfo.name || "Victory Montessori Int'l School";
  document.getElementById('shomeSchool').textContent = school;
  document.getElementById('shomeAvatar').textContent = currentStaff.name.charAt(0).toUpperCase();
  document.getElementById('shomeName').textContent = currentStaff.name.split(' ')[0];

  logs = freshLogs();
  const today = getDateStr(new Date());
  const todayLogs = logs.filter(l => l.id === currentStaff.id && l.date === today);
  const inLog = todayLogs.find(l => l.status === 'IN');
  const outLog = todayLogs.find(l => l.status === 'OUT');

  const inEl = document.getElementById('shomeInStatus');
  const outEl = document.getElementById('shomeOutStatus');
  inEl.textContent = inLog ? inLog.time : 'Not yet';
  inEl.className = 'val ' + (inLog ? 'done' : 'pending');
  outEl.textContent = outLog ? outLog.time : 'Not yet';
  outEl.className = 'val ' + (outLog ? 'done' : 'pending');

  const btn = document.getElementById('btnStaffAction');
  if (inLog && outLog) {
    btn.textContent = '✅ All Done for Today';
    btn.disabled = true;
  } else if (!inLog) {
    btn.textContent = '📷 Confirm On-Site to Sign In';
    btn.disabled = false;
  } else {
    btn.textContent = '📷 Confirm On-Site to Sign Out';
    btn.disabled = false;
  }
  showStaffScreen('shome');
}

function staffGoHome() { renderStaffHome(); }

function getActiveToken() { const raw = localStorage.getItem('vmis_active_token'); return raw ? JSON.parse(raw) : null; }

// ── Scanner ──
let staffCameraStream = null;
let staffScanningActive = false;
let staffScanCooldown = false;

async function openStaffScanner() {
  showLoading('Loading latest data…');
  await loadCloudData();
  hideLoading();

  const isSecure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!isSecure || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toggleStaffTokenEntry(true, 'Camera requires HTTPS. Enter the token shown on the admin screen.');
    return;
  }

  showStaffScreen('sscan');
  document.getElementById('sScanHint').textContent = '⏳ Starting camera…';
  try {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } }); }
    catch { stream = await navigator.mediaDevices.getUserMedia({ video: true }); }
    staffCameraStream = stream;
    const video = document.getElementById('sScanVideo');
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    video.muted = true;
    try { await video.play(); } catch (e) {}
    staffScanningActive = true;
    staffScanCooldown = false;
    requestAnimationFrame(staffScanLoop);
  } catch (err) {
    stopStaffCamera();
    renderStaffHome();
    toggleStaffTokenEntry(true, 'Camera access denied. Enter the token shown on the admin screen.');
  }
}
function closeStaffScanner() { stopStaffCamera(); renderStaffHome(); }
function stopStaffCamera() {
  staffScanningActive = false;
  if (staffCameraStream) { staffCameraStream.getTracks().forEach(t => t.stop()); staffCameraStream = null; }
  const video = document.getElementById('sScanVideo');
  if (video) video.srcObject = null;
}

function staffScanLoop() {
  if (!staffScanningActive) return;
  const video = document.getElementById('sScanVideo');
  const canvas = document.getElementById('sScanCanvas');
  if (!video || !canvas || !video.videoWidth || !video.videoHeight) { requestAnimationFrame(staffScanLoop); return; }
  const hint = document.getElementById('sScanHint');
  if (hint && !hint.textContent.includes('steady')) hint.textContent = '📋 Hold QR code steady inside the frame';

  if (!staffScanCooldown && typeof jsQR !== 'undefined') {
    try {
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: 'attemptBoth' });
      if (code && code.data && code.data.trim().length > 0) {
        const raw = code.data.trim();
        staffScanCooldown = true;
        stopStaffCamera();
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch {}
        if (parsed && parsed.t && parsed.app === 'StaffTrack') {
          const tokenData = getActiveToken();
          const valid = tokenData && tokenData.token === parsed.t && (tokenData.expiresAt === 0 || Date.now() < tokenData.expiresAt);
          if (!valid) {
            renderStaffHome();
            staffScanCooldown = false;
            toggleStaffTokenEntry(true, 'QR code has expired. Ask admin to activate a new one.');
            return;
          }
        }
        recordAttendance(currentStaff);
        return;
      }
    } catch (e) {}
  }
  requestAnimationFrame(staffScanLoop);
}

function toggleStaffTokenEntry(forceShow, msg) {
  const wrap = document.getElementById('staffTokenEntryWrap');
  const btn = document.getElementById('toggleStaffTokenBtn');
  const showing = wrap && wrap.style.display !== 'none';
  const show = forceShow !== undefined ? forceShow : !showing;
  if (wrap) wrap.style.display = show ? 'block' : 'none';
  if (btn) btn.textContent = show ? 'Hide token entry' : "Can't scan? Enter token instead";
  if (show) {
    const input = document.getElementById('staffTokenInput');
    if (input) { input.value = ''; input.focus(); }
    const err = document.getElementById('staffTokenError');
    if (err) { if (msg) { err.textContent = msg; err.style.display = 'block'; } else { err.style.display = 'none'; } }
  }
}

async function submitStaffToken() {
  const input = document.getElementById('staffTokenInput');
  const errEl = document.getElementById('staffTokenError');
  const raw = (input?.value || '').trim().toUpperCase();
  if (!raw) return;
  if (errEl) errEl.style.display = 'none';

  showLoading('Verifying token…');
  await loadCloudData();
  hideLoading();

  const tokenData = getActiveToken();
  const valid = tokenData && tokenData.token && tokenData.token.toUpperCase() === raw && (tokenData.expiresAt === 0 || Date.now() < tokenData.expiresAt);
  if (!valid) { if (errEl) errEl.style.display = 'block'; if (input) input.select(); return; }

  const wrap = document.getElementById('staffTokenEntryWrap');
  if (wrap) wrap.style.display = 'none';
  if (input) input.value = '';
  recordAttendance(currentStaff);
}

// ── Record attendance for the logged-in staff member ──
function recordAttendance(staff) {
  const now = new Date();
  const today = getDateStr(now);
  const shift = getShift();
  logs = freshLogs();
  const todayRecords = logs.filter(l => l.id === staff.id && l.date === today);
  const hasIn = todayRecords.some(l => l.status === 'IN');
  const hasOut = todayRecords.some(l => l.status === 'OUT');

  if (hasIn && hasOut) { showStaffBlocked({ reason: 'done', staff, todayRecords }); return; }

  const action = !hasIn ? 'IN' : 'OUT';
  if (action === 'OUT' && shift === 'morning') { showStaffBlocked({ reason: 'already_in', staff, todayRecords }); return; }

  let isLate = false, minutesLate = 0;
  if (action === 'IN') {
    const resumption = attRules.resumption || '07:30';
    const [rh, rm] = resumption.split(':').map(Number);
    const threshold = attRules.late || 15;
    const cutoff = rh * 60 + rm + threshold;
    const nowMins = now.getHours() * 60 + now.getMinutes();
    if (nowMins > cutoff) { isLate = true; minutesLate = nowMins - (rh * 60 + rm); }
  }

  const entry = { id: staff.id, name: staff.name, department: staff.dept || '', role: staff.role || '', date: today, time: getTimeStr(now), status: action, day: getDayStr(now), device: 'self-signin', shift, isLate, minutesLate };
  logs.unshift(entry);
  localStorage.setItem('vmis_logs', JSON.stringify(logs));
  postCloud('addLog', entry);

  showStaffSuccess(staff, entry, now);
  staffScanCooldown = false;
}

let staffAutoReturnTimer = null;
function showStaffSuccess(staff, entry, now) {
  const isIn = entry.status === 'IN';
  document.querySelectorAll('#staffApp .screen').forEach(s => s.classList.remove('active'));
  const screen = document.getElementById('screen-ssuccess');
  screen.className = `screen active type-${isIn ? 'in' : 'out'}`;
  resetStaffViewport_();
  document.getElementById('sSuccessIcon').textContent = isIn ? (entry.isLate ? '⚠️' : '🌅') : '🌆';
  document.getElementById('sSuccessTitle').textContent = isIn ? (entry.isLate ? 'Signed In — Late' : 'Signed In!') : 'Signed Out!';
  document.getElementById('sSuccessSub').textContent = isIn
    ? (entry.isLate ? `${staff.name.split(' ')[0]}, you are ${entry.minutesLate} min late today.` : `Welcome, ${staff.name.split(' ')[0]}! Have a productive day.`)
    : `Good job today, ${staff.name.split(' ')[0]}! See you tomorrow.`;
  document.getElementById('sSuccessTime').textContent = fmtTime(now);

  const DURATION = 5;
  const bar = document.getElementById('sCountdownBar');
  bar.style.setProperty('--drain-duration', DURATION + 's');
  bar.style.animation = 'none'; bar.offsetHeight; bar.style.animation = `drainBar ${DURATION}s linear forwards`;

  let secs = DURATION;
  document.getElementById('sCountdownTxt').textContent = `Returning to home in ${secs}s…`;
  if (staffAutoReturnTimer) clearInterval(staffAutoReturnTimer);
  staffAutoReturnTimer = setInterval(() => {
    secs--;
    if (secs <= 0) { clearInterval(staffAutoReturnTimer); staffGoHome(); return; }
    document.getElementById('sCountdownTxt').textContent = `Returning to home in ${secs}s…`;
  }, 1000);
}

function showStaffBlocked({ reason, staff, todayRecords }) {
  const icon = document.getElementById('sBlockedIcon');
  const title = document.getElementById('sBlockedTitle');
  const msg = document.getElementById('sBlockedMsg');
  const card = document.getElementById('sBlockedInfoCard');
  if (reason === 'done') {
    const inLog = todayRecords.find(l => l.status === 'IN');
    const outLog = todayRecords.find(l => l.status === 'OUT');
    icon.textContent = '✅'; title.textContent = 'All Done for Today!';
    msg.textContent = `${staff.name}, you have already completed both sign-in and sign-out for today.`;
    card.innerHTML = `<div class="blocked-row"><span class="lbl">Morning Sign-In</span><span class="val green">${inLog ? inLog.time : '—'}</span></div><div class="blocked-row"><span class="lbl">Afternoon Sign-Out</span><span class="val amber">${outLog ? outLog.time : '—'}</span></div>`;
  } else if (reason === 'already_in') {
    const inLog = todayRecords.find(l => l.status === 'IN');
    icon.textContent = '🌅'; title.textContent = 'Already Signed In';
    msg.textContent = `${staff.name}, you already signed in this morning. Sign-out is only available in the afternoon session.`;
    card.innerHTML = `<div class="blocked-row"><span class="lbl">Morning Sign-In</span><span class="val green">${inLog ? inLog.time : '—'}</span></div><div class="blocked-row"><span class="lbl">Sign-Out opens</span><span class="val amber">12:00 PM onwards</span></div>`;
  }
  staffScanCooldown = false;
  showStaffScreen('sblocked');
}

// Prevent back gesture from closing the page on mobile, and right-click on kiosk screens
history.pushState(null, '', location.href);
window.addEventListener('popstate', () => history.pushState(null, '', location.href));
