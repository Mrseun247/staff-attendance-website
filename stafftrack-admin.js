// ═══════════════════════════════════════════
// QR GENERATOR — robust: qrcodejs → Google Charts fallback
// ═══════════════════════════════════════════
function makeQR(targetEl, text, size) {
  targetEl.innerHTML = '';
  size = size || 120;
  if (typeof QRCode !== 'undefined') {
    try {
      new QRCode(targetEl, {
        text: text,
        width: size, height: size,
        colorDark: '#0F1C3F', colorLight: '#FFFFFF',
        correctLevel: QRCode.CorrectLevel.M
      });
      setTimeout(() => {
        if (!targetEl.querySelector('canvas') && !targetEl.querySelector('img')) {
          fallbackQR(targetEl, text, size);
        }
      }, 300);
      return;
    } catch(e) { /* fall through */ }
  }
  fallbackQR(targetEl, text, size);
}

function fallbackQR(targetEl, text, size) {
  targetEl.innerHTML = '';
  const img = document.createElement('img');
  img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=' + size + 'x' + size +
            '&data=' + encodeURIComponent(text) +
            '&color=0F1C3F&bgcolor=FFFFFF&margin=4&ecc=M';
  img.width = size; img.height = size;
  img.style.borderRadius = '4px';
  img.alt = 'QR Code';
  img.onerror = () => {
    targetEl.innerHTML = '<div style="width:' + size + 'px;height:' + size + 'px;background:#f0f4ff;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:11px;color:#666;border:1px dashed #ccc">QR N/A</div>';
  };
  targetEl.appendChild(img);
}


// ═══════════════════════════════════════════
// STATE — cloud is primary, localStorage is cache
// ═══════════════════════════════════════════
let staffList    = JSON.parse(localStorage.getItem('vmis_staff')   || '[]');
let logs         = JSON.parse(localStorage.getItem('vmis_logs')    || '[]');
let scriptUrl    = localStorage.getItem('vmis_script_url')         || 'https://script.google.com/macros/s/AKfycbz2bGmhJq9XjYni5ondNxIPFBzGsquigfPz7e_fmiV9KdYEeT_bC2N59jMDJF8InQM2/exec';
// Always persist so cloud sync works from first load
if (!localStorage.getItem('vmis_script_url')) localStorage.setItem('vmis_script_url', scriptUrl);
let schoolInfo   = JSON.parse(localStorage.getItem('vmis_school')  || '{"name":"","branch":"","session":"2025/2026"}');
let attRules     = JSON.parse(localStorage.getItem('vmis_rules')   || '{"resumption":"07:30","closing":"15:00","late":15}');
let cameraStream = null;
let scanInterval = null;
let scanCooldown = {}; // per-staff cooldown to avoid double-scan
let modalStaff   = null;
let cloudSyncBusy = false;

function freshLogs()       { return JSON.parse(localStorage.getItem('vmis_logs')            || '[]'); }
function freshPins()       { return JSON.parse(localStorage.getItem('vmis_pins')            || '{}'); }
function freshDeviceSess() { return JSON.parse(localStorage.getItem('vmis_device_sessions') || '{}'); }
function savePins(p)       { localStorage.setItem('vmis_pins', JSON.stringify(p));           postCloud('savePins', p); }
function saveDeviceSess(d) { localStorage.setItem('vmis_device_sessions', JSON.stringify(d)); postCloud('saveDeviceSessions', d); }

// ═══════════════════════════════════════════
// CLOUD — Google Apps Script as primary store
// ═══════════════════════════════════════════
function postCloud(action, data) {
  if (!scriptUrl) return Promise.resolve();
  return fetch(scriptUrl, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, data })
  }).catch(e => console.warn('Cloud sync error:', e));
}

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
          if (data.staff)         staffList = data.staff;
          if (data.logs)          logs      = data.logs;
          if (data.school)        schoolInfo = data.school;
          if (data.rules)         attRules   = data.rules;
          localStorage.setItem('vmis_staff',           JSON.stringify(staffList));
          localStorage.setItem('vmis_logs',            JSON.stringify(logs));
          localStorage.setItem('vmis_pins',            JSON.stringify(data.pins || {}));
          localStorage.setItem('vmis_device_sessions', JSON.stringify(data.deviceSessions || {}));
          localStorage.setItem('vmis_school',          JSON.stringify(schoolInfo));
          localStorage.setItem('vmis_rules',           JSON.stringify(attRules));
          resolve(true);
        } else { resolve(false); }
      } finally { cleanup(); }
    };

    script.onerror = () => { cleanup(); resolve(false); };
    script.src = scriptUrl +
      (scriptUrl.includes('?') ? '&' : '?') +
      'callback=' + encodeURIComponent(cb) + '&_=' + Date.now();
    document.body.appendChild(script);
  });
}

async function refreshCloudAndRender() {
  const ok = await loadCloudData();
  if (!ok) {
    logs      = freshLogs();
    staffList = JSON.parse(localStorage.getItem('vmis_staff') || '[]');
  }
  const active = document.querySelector('.page.active');
  if (!active) return;
  if (active.id === 'page-logs')     renderLogs();
  if (active.id === 'page-security') renderSecurityPanel();
  if (active.id === 'page-setup')    renderStaffList();
}

function updateSigninLink() {
  const link = document.getElementById('staffPortalLink') ||
               document.querySelector('a[href^="staffportal.html"], a[href^="attendance.html"], a[href^="signin.html"]');
  if (!link) return;
  link.href = scriptUrl
    ? 'staffportal.html?api=' + encodeURIComponent(scriptUrl)
    : 'staffportal.html';
}

// ═══════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  event.target.classList.add('active');
  refreshCloudAndRender();
  if (id === 'admin')      loadAdminFields();
  if (id === 'superadmin') renderAdminList();
}

// Auto-refresh every 15 s so admin sees staff self-sign-in records live
setInterval(refreshCloudAndRender, 15000);

// Live clock
function updateClock() {
  const now = new Date();
  const el  = document.getElementById('clockDisplay');
  if (el) el.textContent =
    now.toLocaleDateString('en-NG', { weekday:'short', day:'numeric', month:'short' }) + ' · ' +
    now.toLocaleTimeString('en-NG', { hour:'2-digit', minute:'2-digit' });
}
setInterval(updateClock, 1000);
updateClock();

// ═══════════════════════════════════════════
// STAFF MANAGEMENT
// ═══════════════════════════════════════════
function addStaff() {
  const name = document.getElementById('staffName').value.trim();
  const id   = document.getElementById('staffId').value.trim().toUpperCase();
  const dept = document.getElementById('staffDept').value;
  const role = document.getElementById('staffRole').value.trim();
  if (!name || !id || !dept || !role) {
    showToast('error', '⚠️', 'Missing Fields', 'Please fill in all fields.'); return;
  }
  if (staffList.find(s => s.id === id)) {
    showToast('error', '⚠️', 'Duplicate ID', 'Staff ID already exists.'); return;
  }
  const staff = { id, name, dept, role, added: new Date().toISOString() };
  staffList.push(staff);
  saveStaff();
  renderStaffList();
  clearStaffForm();
  showToast('success', '✅', name, 'Added & QR generated!');
}

function clearStaffForm() {
  ['staffName','staffId','staffRole'].forEach(i => document.getElementById(i).value = '');
  document.getElementById('staffDept').value = '';
}

function removeStaff(id) {
  if (!confirm('Remove this staff member?')) return;
  staffList = staffList.filter(s => s.id !== id);
  saveStaff();
  renderStaffList();
}

function saveStaff() {
  localStorage.setItem('vmis_staff', JSON.stringify(staffList));
  postCloud('saveStaff', staffList);
}

function renderStaffList() {
  const wrap = document.getElementById('staffListWrap');
  if (!wrap) return;

  if (staffList.length === 0) {
    wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">👥</div><h3>No staff added yet</h3><p>Use the form above to add staff members.</p></div>';
    return;
  }

  wrap.innerHTML = '<table class="staff-table"><thead><tr>' +
    '<th>ID</th><th>Name</th><th>Department</th><th>Role</th><th>PIN</th><th>Today</th><th>Actions</th>' +
    '</tr></thead><tbody>' +
    staffList.map(s => {
      const pins     = freshPins();
      const hasPIN   = !!pins[s.id];
      const today    = getDateStr(new Date());
      const todayRec = freshLogs().filter(l => l.id === s.id && l.date === today);
      const hasIn    = todayRec.some(l => l.status === 'IN');
      const hasOut   = todayRec.some(l => l.status === 'OUT');
      let badge = '<span class="badge" style="background:#F3F4F6;color:#6B7280">Absent</span>';
      if (hasIn && hasOut) badge = '<span class="badge badge-green">In &amp; Out ✓</span>';
      else if (hasIn)      badge = '<span class="badge" style="background:#DBEAFE;color:#1D4ED8">Signed In 🌅</span>';
      return '<tr>' +
        '<td><span class="badge badge-navy">' + s.id + '</span></td>' +
        '<td><strong>' + s.name + '</strong></td>' +
        '<td>' + s.dept + '</td><td>' + s.role + '</td>' +
        '<td>' + (hasPIN ? '<span class="badge badge-green">✓ Set</span>' : '<span class="badge badge-gold">Not set</span>') + '</td>' +
        '<td>' + badge + '</td>' +
        '<td style="display:flex;gap:6px;flex-wrap:wrap">' +
          (hasPIN ? '<button class="btn btn-ghost btn-sm" onclick="resetStaffPIN(\'' + s.id + '\',\'' + s.name.replace(/'/g,"\\'") + '\')">🔑 Reset PIN</button>' : '') +
          '<button class="btn btn-ghost btn-sm" onclick="removeStaff(\'' + s.id + '\')">✕ Remove</button>' +
        '</td>' +
      '</tr>';
    }).join('') +
    '</tbody></table>';

  // Regenerate the school QR whenever staff list updates
  generateSchoolQR();
}

// ═══════════════════════════════════════════
// ROTATING QR SECURITY SYSTEM
// Generates N codes; admin picks the active one.
// Only the active token is accepted by the portal.
// Token stored in localStorage + cloud so portal can verify.
// ═══════════════════════════════════════════
let rqrCodes    = [];   // [{token, qrEl, ts}]
let activeToken = null;
let rqrExpirySecs = 300; // default 5 min
let rqrTimerInterval = null;

function saveRqrSettings() {
  const mins = parseInt(document.getElementById('rqrExpiry').value) || 5;
  rqrExpirySecs = mins * 60;
  localStorage.setItem('vmis_rqr_expiry', String(mins));
}

function getPortalBase() {
  return window.location.origin +
    window.location.pathname.replace(/index\.html.*$/, '') +
    'staffportal.html';
}

function generateRotatingQRs(count) {
  count = count || 6;
  rqrCodes = [];
  activeToken = null;

  // clear old active token
  localStorage.removeItem('vmis_active_token');
  postCloud('saveActiveToken', null);

  const grid = document.getElementById('rqrGrid');
  if (!grid) return;
  grid.innerHTML = '';

  for (let i = 0; i < count; i++) {
    const token = 'RQR-' + Date.now().toString(36).toUpperCase() + '-' +
                  Math.random().toString(36).slice(2, 6).toUpperCase();
    const payload = JSON.stringify({
      t: token,
      app: 'StaffTrack'
    });

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

  showToast('success', '🔐', 'QR Set Generated', 'Click a QR code to make it active.');
}

function activateToken(token) {
  if (activeToken === token) return; // already active
  activeToken = token;

  // update cards UI
  rqrCodes.forEach(r => {
    r.card.classList.remove('active');
    const badge = r.card.querySelector('.rqr-active-badge');
    if (badge) badge.remove();
  });
  const active = rqrCodes.find(r => r.token === token);
  if (!active) return;
  active.card.classList.add('active');
  const badge = document.createElement('span');
  badge.className = 'rqr-active-badge';
  badge.textContent = '✓ ACTIVE';
  active.card.insertBefore(badge, active.card.firstChild);

  // save to localStorage + cloud so portal can check
  const expiryMins = parseInt(document.getElementById('rqrExpiry')?.value || '5');
  const expiresAt = expiryMins > 0 ? Date.now() + expiryMins * 60000 : 0;
  const tokenData = { token, expiresAt, schoolName: schoolInfo.name || 'StaffTrack' };
  localStorage.setItem('vmis_active_token', JSON.stringify(tokenData));
  postCloud('saveActiveToken', tokenData);

  startRqrTimer(expiresAt);
  showToast('success', '✅', 'QR Activated', 'Staff can now scan this QR code to sign in.');
}

function startRqrTimer(expiresAt) {
  if (rqrTimerInterval) clearInterval(rqrTimerInterval);
  const wrap  = document.getElementById('rqrTimerWrap');
  const timer = document.getElementById('rqrTimer');
  if (!wrap || !timer) return;

  if (!expiresAt) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';

  function tick() {
    const left = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
    const m = Math.floor(left / 60);
    const s = left % 60;
    timer.textContent = m + ':' + String(s).padStart(2, '0');
    timer.className = left < 60 ? 'danger' : (left < 120 ? 'warn' : '');
    if (left === 0) {
      clearInterval(rqrTimerInterval);
      timer.textContent = 'Expired';
      activeToken = null;
      localStorage.removeItem('vmis_active_token');
      postCloud('saveActiveToken', null);
      // remove active badge
      rqrCodes.forEach(r => {
        r.card.classList.remove('active');
        const b = r.card.querySelector('.rqr-active-badge');
        if (b) b.remove();
      });
      showToast('duplicate', '⏰', 'QR Expired', 'Generate a new QR set to continue sign-ins.');
    }
  }
  tick();
  rqrTimerInterval = setInterval(tick, 1000);
}

function printActiveQR() {
  const active = rqrCodes.find(r => r.token === activeToken);
  if (!active) { showToast('error','⚠️','No Active QR','Click a QR to activate it first.'); return; }
  const canvas = active.qrEl.querySelector('canvas');
  const img    = active.qrEl.querySelector('img');
  const src    = canvas ? canvas.toDataURL() : (img ? img.src : '');
  if (!src) { showToast('error','⚠️','Not Ready','QR not rendered yet, wait a moment.'); return; }
  const win = window.open('', '_blank');
  if (!win) { alert('Allow pop-ups to print.'); return; }
  const expiryMins = document.getElementById('rqrExpiry')?.value || '5';
  const doc = win.document;
  doc.open();
  doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Active QR Code</title>' +
    '<style>body{font-family:sans-serif;text-align:center;padding:60px}' +
    'h2{font-size:26px;font-weight:900;margin-bottom:4px}' +
    '.sub{font-size:14px;color:#666;margin-bottom:24px}' +
    'img{border:3px solid #0F1C3F;border-radius:12px;padding:10px}' +
    '.note{font-size:12px;color:#999;margin-top:20px;line-height:1.7}</style></head><body>');
  doc.write('<h2>' + (schoolInfo.name || 'StaffTrack') + '</h2>');
  doc.write('<div class="sub">Scan to Sign In / Out — Valid for ' + expiryMins + ' min</div>');
  doc.write('<img src="' + src + '" width="240" height="240" alt="QR"/>');
  doc.write('<div class="note">This QR expires in ' + expiryMins + ' minutes.<br>Do not share outside school premises.</div>');
  doc.write('</body></html>');
  doc.close();
  win.addEventListener('load', () => win.print());
}




// ═══════════════════════════════════════════
// CAMERA & QR SCAN — FIXED
// Key fixes:
//  1. QR payload is plain JSON {id,name,dept,role} — no API URL inside
//  2. Scanner handles JSON payload AND plain staff-ID text (fallback)
//  3. Per-staff 3-second cooldown to prevent instant double-scan
//  4. inversionAttempts:'attemptBoth' handles dark/light QR prints
// ═══════════════════════════════════════════
async function startCamera() {
  if (cameraStream) return;
  try {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
      });
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
    }
    cameraStream = stream;
    const video = document.getElementById('scanVideo');
    video.srcObject = stream;
    await video.play();

    const startBtn = document.getElementById('startCamBtn');
    const stopBtn  = document.getElementById('stopCamBtn');
    if (startBtn) { startBtn.textContent = '📷 Camera Active'; startBtn.style.opacity = '0.6'; }
    if (stopBtn)  stopBtn.style.display = 'inline-flex';

    if (scanInterval) clearInterval(scanInterval);
    scanInterval = setInterval(scanFrame, 300);

    showToast('success', '📷', 'Camera Ready', 'Point camera at a staff QR code.');
  } catch (err) {
    console.error('Camera error:', err);
    showToast('error', '❌', 'Camera Error', err.message || 'Allow camera access and try again.');
  }
}

function stopCamera() {
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
  const startBtn = document.getElementById('startCamBtn');
  const stopBtn  = document.getElementById('stopCamBtn');
  if (startBtn) { startBtn.textContent = '📷 Start Camera'; startBtn.style.opacity = '1'; }
  if (stopBtn)  stopBtn.style.display = 'none';
}

function scanFrame() {
  if (typeof jsQR === 'undefined') return; // library not loaded yet
  const video  = document.getElementById('scanVideo');
  const canvas = document.getElementById('scanCanvas');
  if (!video || !canvas) return;
  if (video.readyState < 2 || video.videoWidth === 0) return;

  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  // attemptBoth = handles both normal & inverted (printed dark-on-white) QR codes
  const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });
  if (!code || !code.data) return;

  handleScannedData(code.data.trim());
}

function handleScannedData(raw) {
  let parsed = null;

  // Try JSON format first (our QR payload)
  try { parsed = JSON.parse(raw); } catch { /* not JSON */ }

  if (parsed && parsed.id && parsed.name) {
    // Our standard QR format — look up staff or use embedded data
    const knownStaff = staffList.find(s => s.id === parsed.id);
    processAttendance(knownStaff || parsed);
    return;
  }

  // Fallback: plain text Staff ID
  const byId = staffList.find(s => s.id === raw.toUpperCase());
  if (byId) { processAttendance(byId); return; }

  // Unknown QR — log but don't show error toast for every frame
  console.log('Unknown QR scanned:', raw);
}

function manualScan() {
  const id = prompt('Enter Staff ID:');
  if (!id) return;
  const staff = staffList.find(s => s.id === id.trim().toUpperCase());
  if (!staff) { showToast('error', '❌', 'Not Found', 'No staff with ID: ' + id); return; }
  processAttendance(staff);
}

// ═══════════════════════════════════════════
// DATE/TIME HELPERS
// ═══════════════════════════════════════════
function getDateStr(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}
function getTimeStr(d) {
  return String(d.getHours()).padStart(2, '0') + ':' +
    String(d.getMinutes()).padStart(2, '0') + ':' +
    String(d.getSeconds()).padStart(2, '0');
}
function getDayStr(d) {
  return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()];
}

// ═══════════════════════════════════════════
// PROCESS ATTENDANCE — cloud-first + late detection
// ═══════════════════════════════════════════
function processAttendance(data) {
  const now     = new Date();
  const dateStr = getDateStr(now);
  const timeStr = getTimeStr(now);
  const dayStr  = getDayStr(now);

  const now_ms = Date.now();
  if (scanCooldown[data.id] && (now_ms - scanCooldown[data.id]) < 3000) return;
  scanCooldown[data.id] = now_ms;

  logs = freshLogs();

  const todayLogs = logs.filter(l => l.id === data.id && l.date === dateStr);
  const hasIn     = todayLogs.some(l => l.status === 'IN');
  const hasOut    = todayLogs.some(l => l.status === 'OUT');

  if (hasIn && hasOut) {
    showToast('duplicate', '🚫', data.name, 'Already has Sign-In & Sign-Out recorded today.');
    return;
  }

  const status = !hasIn ? 'IN' : 'OUT';
  const shift  = status === 'IN' ? 'morning' : 'afternoon';

  // ── Late detection ──
  let isLate = false;
  let minutesLate = 0;
  if (status === 'IN') {
    const resumption = attRules.resumption || '07:30';
    const [rh, rm]   = resumption.split(':').map(Number);
    const threshold  = (attRules.late || 15);
    const cutoffMins = rh * 60 + rm + threshold;
    const nowMins    = now.getHours() * 60 + now.getMinutes();
    if (nowMins > cutoffMins) {
      isLate      = true;
      minutesLate = nowMins - (rh * 60 + rm);
    }
  }

  const entry = {
    id:         data.id,
    name:       data.name,
    department: data.dept || data.department || '',
    role:       data.role || '',
    date:       dateStr,
    time:       timeStr,
    status,
    day:        dayStr,
    shift,
    device:     'admin-scan',
    isLate,
    minutesLate
  };

  logs.unshift(entry);
  localStorage.setItem('vmis_logs', JSON.stringify(logs));

  if (scriptUrl) {
    postCloud('addLog', entry).catch(e => console.warn('Failed to sync to cloud:', e));
  }

  const icon = status === 'IN' ? (isLate ? '⚠️' : '🌅') : '🌆';
  const msg  = status === 'IN'
    ? (isLate ? `Late Sign-In — ${minutesLate} min late` : 'Morning Sign-In at ' + timeStr)
    : 'Afternoon Sign-Out at ' + timeStr;
  showToast(isLate ? 'duplicate' : (status === 'IN' ? 'success' : 'duplicate'), icon, data.name, msg);
}

// ═══════════════════════════════════════════
// GOOGLE SHEETS SYNC
// ═══════════════════════════════════════════
async function postToSheets(entry) {
  return postCloud('addLog', entry);
}

async function syncToSheets() {
  if (!scriptUrl) {
    showToast('error', '⚙️', 'Not Configured', 'Set the Google Script URL in Admin tab first.');
    return;
  }
  showToast('success', '☁️', 'Syncing…', 'Sending records to Google Sheets.');
  logs = freshLogs();
  const pending = logs.filter(l => !l.synced);
  for (const entry of pending) {
    await postCloud('addLog', entry);
    entry.synced = true;
  }
  localStorage.setItem('vmis_logs', JSON.stringify(logs));
  postCloud('saveLogs', logs);
  showToast('success', '✅', 'Sync Complete', pending.length + ' record(s) sent to Google Sheets.');
}

// ═══════════════════════════════════════════
// LOGS RENDERING
// ═══════════════════════════════════════════
function renderLogs() {
  logs = freshLogs();
  const search       = (document.getElementById('logSearch')?.value  || '').toLowerCase();
  const dateFilter   =  document.getElementById('logDate')?.value    || '';
  const statusFilter =  document.getElementById('logFilter')?.value  || '';
  const sourceFilter =  document.getElementById('logSource')?.value  || '';

  let filtered = logs;
  if (search)       filtered = filtered.filter(l => l.name.toLowerCase().includes(search) || l.id.toLowerCase().includes(search));
  if (dateFilter)   filtered = filtered.filter(l => l.date === dateFilter);
  if (statusFilter) filtered = filtered.filter(l => l.status === statusFilter);
  if (sourceFilter) filtered = filtered.filter(l => (l.device || 'admin-scan') === sourceFilter);

  const today     = getDateStr(new Date());
  const todayLogs = logs.filter(l => l.date === today);
  const inCount   = todayLogs.filter(l => l.status === 'IN').length;
  const outCount  = todayLogs.filter(l => l.status === 'OUT').length;
  const lateCount = todayLogs.filter(l => l.status === 'IN' && l.isLate).length;
  const fullDone  = staffList.filter(s =>
    todayLogs.some(l => l.id === s.id && l.status === 'IN') &&
    todayLogs.some(l => l.id === s.id && l.status === 'OUT')
  ).length;
  const absent = staffList.filter(s => !todayLogs.some(l => l.id === s.id)).length;

  const statsRow = document.getElementById('statsRow');
  if (statsRow) statsRow.innerHTML =
    '<div class="stat-card"><div class="stat-val">' + staffList.length + '</div><div class="stat-lbl">Total Staff</div></div>' +
    '<div class="stat-card green"><div class="stat-val">' + inCount  + '</div><div class="stat-lbl">🌅 Sign-Ins</div></div>' +
    '<div class="stat-card gold"><div class="stat-val">'  + outCount + '</div><div class="stat-lbl">🌆 Sign-Outs</div></div>' +
    '<div class="stat-card"><div class="stat-val">'       + fullDone + '</div><div class="stat-lbl">✅ Full Day</div></div>' +
    '<div class="stat-card red"><div class="stat-val">' + lateCount + '</div><div class="stat-lbl">⚠️ Late Today</div></div>' +
    '<div class="stat-card" style="border-left:3px solid var(--red)"><div class="stat-val" style="color:var(--red)">' + absent + '</div><div class="stat-lbl">Absent</div></div>';

  // ── Late arrivals card ──
  const lateCard = document.getElementById('lateReportCard');
  const lateWrap = document.getElementById('lateTableWrap');
  const lateBadge = document.getElementById('lateCountBadge');
  const lateLogs  = todayLogs.filter(l => l.status === 'IN' && l.isLate);
  if (lateCard) lateCard.style.display = lateLogs.length > 0 ? 'block' : 'none';
  if (lateBadge) lateBadge.textContent = lateLogs.length + ' late';
  if (lateWrap && lateLogs.length > 0) {
    lateWrap.innerHTML = '<table class="log-table"><thead><tr>' +
      '<th>Name</th><th>Department</th><th>Role</th><th>Time</th><th>Minutes Late</th>' +
      '</tr></thead><tbody>' +
      lateLogs.map(l => '<tr>' +
        '<td><strong>' + l.name + '</strong></td>' +
        '<td>' + (l.department || '') + '</td>' +
        '<td>' + (l.role || '') + '</td>' +
        '<td>' + l.time + '</td>' +
        '<td><span class="badge badge-late">' + (l.minutesLate || '?') + ' min late</span></td>' +
      '</tr>').join('') +
      '</tbody></table>';
  }

  // ── Main table ──
  const wrap = document.getElementById('logsTableWrap');
  if (!wrap) return;
  if (filtered.length === 0) {
    wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><h3>No records found</h3><p>Adjust filters or scan QR codes.</p></div>';
    return;
  }

  wrap.innerHTML = '<table class="log-table"><thead><tr>' +
    '<th>Staff ID</th><th>Name</th><th>Dept</th><th>Role</th>' +
    '<th>Date</th><th>Time</th><th>Day</th><th>Shift</th><th>Source</th><th>Status</th>' +
    '</tr></thead><tbody>' +
    filtered.map(l => {
      const src   = l.device === 'self-signin'
        ? '<span class="badge badge-navy">Self Sign-In</span>'
        : '<span class="badge" style="background:#F3F4F6;color:#374151">Admin Scan</span>';
      const shift = l.shift === 'morning' ? '🌅 Morning' : (l.shift === 'afternoon' ? '🌆 Afternoon' : '—');
      const lateBadgeHtml = (l.status === 'IN' && l.isLate)
        ? ' <span class="badge badge-late" style="font-size:10px">⚠️ Late</span>' : '';
      return '<tr' + (l.isLate ? ' style="background:#FFF5F5"' : '') + '>' +
        '<td><span class="badge badge-navy">' + l.id + '</span></td>' +
        '<td><strong>' + l.name + '</strong>' + lateBadgeHtml + '</td>' +
        '<td>' + (l.department || '') + '</td><td>' + (l.role || '') + '</td>' +
        '<td>' + l.date + '</td><td>' + l.time + '</td><td>' + l.day + '</td>' +
        '<td>' + shift + '</td>' +
        '<td>' + src + '</td>' +
        '<td><span class="status-dot ' + (l.status === 'IN' ? 'in' : 'out') + '"></span>' +
        '<span class="badge ' + (l.status === 'IN' ? 'badge-green' : 'badge-gold') + '">' +
        (l.status === 'IN' ? 'Sign-In' : 'Sign-Out') + '</span></td>' +
      '</tr>';
    }).join('') +
    '</tbody></table>';
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
  const header = ['ID','Name','Department','Role','Date','Time','Day','Shift','Source','Status'];
  const rows = logs.map(l => [l.id, l.name, l.department, l.role, l.date, l.time, l.day, l.shift||'', l.device||'admin-scan', l.status]);
  downloadCSV([header, ...rows], 'attendance_logs.csv');
}

function exportStaffCSV() {
  const header = ['ID','Name','Department','Role'];
  const rows = staffList.map(s => [s.id, s.name, s.dept, s.role]);
  downloadCSV([header, ...rows], 'staff_list.csv');
}

function downloadCSV(rows, filename) {
  const content = rows.map(r => r.map(v => '"' + (v||'').toString().replace(/"/g,'""') + '"').join(',')).join('\n');
  const blob = new Blob([content], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function exportAllData() {
  const data = { staffList, logs, schoolInfo, attRules, exported: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
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
          showToast('success','✅','Imported','Staff data loaded.');
          renderStaffList();
        } else {
          const lines = ev.target.result.split('\n').filter(Boolean);
          lines.slice(1).forEach(line => {
            const [id, name, dept, role] = line.split(',').map(v => v.replace(/^"|"$/g,'').trim());
            if (id && name && !staffList.find(s => s.id === id)) {
              staffList.push({ id, name, dept: dept||'', role: role||'', added: new Date().toISOString() });
            }
          });
          saveStaff(); renderStaffList();
          showToast('success','✅','Imported', staffList.length + ' staff loaded.');
        }
      } catch { showToast('error','❌','Import Failed','Invalid file format.'); }
    };
    reader.readAsText(file);
  };
  input.click();
}

// ═══════════════════════════════════════════
// ADMIN SETTINGS
// ═══════════════════════════════════════════
function loadAdminFields() {
  const sn = document.getElementById('schoolName');     if (sn) sn.value = schoolInfo.name || '';
  const sb = document.getElementById('schoolBranch');   if (sb) sb.value = schoolInfo.branch || '';
  const as = document.getElementById('academicSession'); if (as) as.value = schoolInfo.session || '';
  const rt = document.getElementById('resumptionTime'); if (rt) rt.value = attRules.resumption || '07:30';
  const ct = document.getElementById('closingTime');    if (ct) ct.value = attRules.closing || '15:00';
  const lt = document.getElementById('lateThreshold'); if (lt) lt.value = attRules.late || 15;
}

async function saveScriptUrl() {
  const val = document.getElementById('scriptUrl').value.trim();
  if (!val) { showToast('error','⚠️','Empty URL','Please paste your Google Apps Script URL.'); return; }
  scriptUrl = val;
  localStorage.setItem('vmis_script_url', scriptUrl);
  updateConnStatus();
  updateSigninLink();
  generateSchoolQR();
  // Push all local data to cloud
  await postCloud('saveAll', {
    staff: staffList, logs, pins: freshPins(),
    deviceSessions: freshDeviceSess(), school: schoolInfo, rules: attRules
  });
  // Then pull cloud state down
  await refreshCloudAndRender();
  showToast('success', '✅', 'Saved', 'Google Sheets URL saved & synced.');
}

function updateConnStatus() {
  const dot  = document.getElementById('connDot');
  const text = document.getElementById('connText');
  if (!dot || !text) return;
  if (scriptUrl) {
    dot.className = 'conn-dot connected';
    text.textContent = 'Connected · ' + scriptUrl.substring(0, 60) + (scriptUrl.length > 60 ? '…' : '');
  } else {
    dot.className = 'conn-dot';
    text.textContent = 'Not configured — data stored locally only';
  }
}

async function testConnection() {
  if (!scriptUrl) { showToast('error','⚙️','No URL','Set the Script URL first.'); return; }
  showToast('success', '🔁', 'Testing…', 'Checking Google Sheets connection.');
  try {
    const testEntry = {
      id: 'TEST-CONN', name: 'Connection Test', department: 'System',
      role: 'Test', date: getDateStr(new Date()), time: getTimeStr(new Date()),
      status: 'TEST', day: getDayStr(new Date()), shift: 'test', device: 'test'
    };
    await postCloud('addLog', testEntry);
    showToast('success', '✅', 'Connection OK', 'Test entry sent to Google Sheets.');
    document.getElementById('connDot').className = 'conn-dot connected';
  } catch(e) {
    showToast('error', '❌', 'Connection Failed', 'Check your URL and permissions.');
    document.getElementById('connDot').className = 'conn-dot error';
  }
}

function saveSchoolInfo() {
  schoolInfo = {
    name:    document.getElementById('schoolName').value.trim(),
    branch:  document.getElementById('schoolBranch').value.trim(),
    session: document.getElementById('academicSession').value.trim()
  };
  localStorage.setItem('vmis_school', JSON.stringify(schoolInfo));
  postCloud('saveSchool', schoolInfo);
  showToast('success', '✅', 'Saved', 'School info updated.');
}

function saveAttendanceRules() {
  attRules = {
    resumption: document.getElementById('resumptionTime').value,
    closing:    document.getElementById('closingTime').value,
    late:       parseInt(document.getElementById('lateThreshold').value) || 15
  };
  localStorage.setItem('vmis_rules', JSON.stringify(attRules));
  postCloud('saveRules', attRules);
  showToast('success', '✅', 'Saved', 'Attendance rules updated.');
}

function resetStaffPIN(id, name) {
  if (!confirm('Reset PIN for ' + name + '? They will create a new PIN on next sign-in.')) return;
  const pins = freshPins();
  delete pins[id];
  savePins(pins);
  renderStaffList();
  showToast('success', '🔑', 'PIN Reset', name + "'s PIN cleared.");
}

function confirmReset() {
  if (confirm('⚠️ This will delete ALL staff, attendance, PINs and device sessions. Continue?')) {
    if (confirm('Final warning: This cannot be undone. Proceed?')) {
      if (scriptUrl) postCloud('resetAll', {});
      localStorage.clear();
      staffList = []; logs = []; scriptUrl = '';
      schoolInfo = { name: '', branch: '', session: '' };
      attRules   = { resumption: '07:30', closing: '15:00', late: 15 };
      renderStaffList();
      showToast('success', '✅', 'Reset', 'All data cleared.');
    }
  }
}

// ═══════════════════════════════════════════
// SECURITY PANEL
// ═══════════════════════════════════════════
function renderSecurityPanel() {
  const pins    = freshPins();
  const devSess = freshDeviceSess();
  const today   = getDateStr(new Date());

  const sessWrap = document.getElementById('deviceSessionsWrap');
  if (sessWrap) {
    const todaySess = Object.entries(devSess).filter(([k, v]) => v.date === today);
    if (todaySess.length === 0) {
      sessWrap.innerHTML = '<div class="empty-state" style="padding:32px"><div class="empty-icon">📱</div><h3>No active sessions</h3><p>No device has been used for self sign-in today.</p></div>';
    } else {
      sessWrap.innerHTML = '<table class="log-table"><thead><tr><th>Session Key</th><th>Staff Name</th><th>Time</th><th>Shift</th><th>Action</th></tr></thead><tbody>' +
        todaySess.map(([k, v]) => '<tr>' +
          '<td style="font-family:monospace;font-size:12px;color:var(--gray)">' + k + '</td>' +
          '<td><strong>' + v.staffName + '</strong></td><td>' + v.time + '</td>' +
          '<td><span class="badge ' + (v.shift === 'morning' ? 'badge-navy' : 'badge-gold') + '">' +
          (v.shift === 'morning' ? '🌅 Morning' : '🌆 Afternoon') + '</span></td>' +
          '<td><button class="btn btn-ghost btn-sm" onclick="clearOneSession(\'' + k + '\')">✕ Unlock</button></td>' +
          '</tr>').join('') +
        '</tbody></table>';
    }
  }

  const pinWrap = document.getElementById('pinStatusWrap');
  if (pinWrap) {
    if (staffList.length === 0) {
      pinWrap.innerHTML = '<div class="empty-state" style="padding:32px"><div class="empty-icon">👥</div><h3>No staff registered</h3></div>';
    } else {
      pinWrap.innerHTML = '<table class="log-table"><thead><tr><th>ID</th><th>Name</th><th>Department</th><th>PIN Status</th><th>Action</th></tr></thead><tbody>' +
        staffList.map(s => '<tr>' +
          '<td><span class="badge badge-navy">' + s.id + '</span></td>' +
          '<td><strong>' + s.name + '</strong></td><td>' + s.dept + '</td>' +
          '<td>' + (pins[s.id]
            ? '<span class="badge badge-green">✓ PIN Set</span>'
            : '<span class="badge badge-gold">⚠ Not Set</span>') + '</td>' +
          '<td>' + (pins[s.id]
            ? '<button class="btn btn-ghost btn-sm" onclick="resetStaffPIN(\'' + s.id + '\',\'' + s.name.replace(/'/g,"\\'") + '\')">🔑 Reset</button>'
            : '—') + '</td>' +
          '</tr>').join('') +
        '</tbody></table>';
    }
  }

  const slWrap = document.getElementById('selfSigninLogWrap');
  if (slWrap) {
    const selfLogs = freshLogs().filter(l => l.date === today && l.device === 'self-signin');
    if (selfLogs.length === 0) {
      slWrap.innerHTML = '<div class="empty-state" style="padding:32px"><div class="empty-icon">🧾</div><h3>No self sign-ins today</h3></div>';
    } else {
      slWrap.innerHTML = '<table class="log-table"><thead><tr><th>Staff ID</th><th>Name</th><th>Time</th><th>Shift</th><th>Status</th></tr></thead><tbody>' +
        selfLogs.map(l => '<tr>' +
          '<td><span class="badge badge-navy">' + l.id + '</span></td>' +
          '<td><strong>' + l.name + '</strong></td><td>' + l.time + '</td>' +
          '<td style="font-size:12px">' + (l.shift === 'morning' ? '🌅 Morning' : '🌆 Afternoon') + '</td>' +
          '<td><span class="status-dot ' + (l.status === 'IN' ? 'in' : 'out') + '"></span>' +
          '<span class="badge ' + (l.status === 'IN' ? 'badge-green' : 'badge-gold') + '">' +
          (l.status === 'IN' ? 'Sign-In' : 'Sign-Out') + '</span></td>' +
          '</tr>').join('') +
        '</tbody></table>';
    }
  }
}

function clearOneSession(key) {
  const d = freshDeviceSess();
  delete d[key];
  saveDeviceSess(d);
  renderSecurityPanel();
  showToast('success', '🔓', 'Session Cleared', 'Device can sign in again.');
}

function clearAllDeviceSessions() {
  if (!confirm('Clear ALL device sessions?')) return;
  saveDeviceSess({});
  renderSecurityPanel();
  showToast('success', '🔓', 'All Sessions Cleared', 'All devices are now unlocked.');
}

function clearAllPINs() {
  if (!confirm('Reset ALL staff PINs?')) return;
  savePins({});
  renderSecurityPanel(); renderStaffList();
  showToast('success', '🔑', 'All PINs Reset', 'Staff will set new PINs on next sign-in.');
}

// ═══════════════════════════════════════════
// TOAST — always animates fresh on each call
// ═══════════════════════════════════════════
let toastTimer;
function showToast(type, icon, name, msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;

  // force reset off-screen so animation always replays
  toast.classList.remove('show');
  toast.className = type; // sets type class, removes show

  document.getElementById('toastIcon').textContent = icon;
  document.getElementById('toastName').textContent = name;
  document.getElementById('toastMsg').textContent  = msg;

  // micro-delay lets browser register the off-screen state before sliding in
  clearTimeout(toastTimer);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.classList.add('show');
      toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
    });
  });
}

// ═══════════════════════════════════════════
// ADMIN LOGIN & SUPER ADMIN
// Default super admin: username=superadmin, password=superadmin123
// Default admin:       username=admin,      password=admin123
// ═══════════════════════════════════════════
const DEFAULT_ADMINS = [
  { name: 'Super Admin', username: 'superadmin', password: 'superadmin123', role: 'superadmin' },
  { name: 'Admin',       username: 'admin',       password: 'admin123',       role: 'admin'      }
];

function getAdminAccounts() {
  const raw = localStorage.getItem('vmis_admins');
  return raw ? JSON.parse(raw) : DEFAULT_ADMINS;
}
function saveAdminAccounts(list) {
  localStorage.setItem('vmis_admins', JSON.stringify(list));
  postCloud('saveAdmins', list);
}

let currentAdmin = null;

function doLogin() {
  const user = (document.getElementById('loginUser')?.value || '').trim().toLowerCase();
  const pass = (document.getElementById('loginPass')?.value || '').trim();
  const err  = document.getElementById('loginError');
  const accounts = getAdminAccounts();
  const match = accounts.find(a => a.username.toLowerCase() === user && a.password === pass);
  if (!match) {
    if (err) { err.style.display = 'block'; }
    return;
  }
  if (err) err.style.display = 'none';
  currentAdmin = match;
  document.getElementById('loginScreen').classList.add('hidden');
  const loggedEl = document.getElementById('loggedInAs');
  if (loggedEl) loggedEl.textContent = match.name + ' (' + match.role + ')';
  // show super admin tab only for superadmin role
  const saTab = document.getElementById('superAdminTab');
  if (saTab) saTab.style.display = match.role === 'superadmin' ? 'inline-flex' : 'none';
  // run normal init after login
  _initApp();
}

function doLogout() {
  currentAdmin = null;
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
}

function addAdminAccount() {
  if (!currentAdmin || currentAdmin.role !== 'superadmin') {
    showToast('error','🚫','Access Denied','Only super admins can add accounts.'); return;
  }
  const name = document.getElementById('newAdminName').value.trim();
  const user = document.getElementById('newAdminUser').value.trim().toLowerCase();
  const pass = document.getElementById('newAdminPass').value.trim();
  const role = document.getElementById('newAdminRole').value;
  if (!name || !user || !pass) { showToast('error','⚠️','Missing Fields','Fill in all fields.'); return; }
  const accounts = getAdminAccounts();
  if (accounts.find(a => a.username === user)) { showToast('error','⚠️','Duplicate','Username already exists.'); return; }
  accounts.push({ name, username: user, password: pass, role });
  saveAdminAccounts(accounts);
  ['newAdminName','newAdminUser','newAdminPass'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
  renderAdminList();
  showToast('success','✅', name, 'Admin account created.');
}

function removeAdminAccount(username) {
  if (username === 'superadmin') { showToast('error','🚫','Cannot Remove','Default super admin cannot be removed.'); return; }
  if (!confirm('Remove admin account "' + username + '"?')) return;
  let accounts = getAdminAccounts().filter(a => a.username !== username);
  saveAdminAccounts(accounts);
  renderAdminList();
  showToast('success','✅','Removed','Admin account deleted.');
}

function renderAdminList() {
  const wrap = document.getElementById('adminListWrap');
  if (!wrap) return;
  const accounts = getAdminAccounts();
  wrap.innerHTML = accounts.map(a =>
    '<div class="admin-mgr-card">' +
      '<div class="admin-mgr-avatar">' + a.name.charAt(0).toUpperCase() + '</div>' +
      '<div class="admin-mgr-info">' +
        '<div class="amn">' + a.name + '</div>' +
        '<div class="amu">@' + a.username + '</div>' +
        '<span class="amr ' + a.role + '">' + (a.role === 'superadmin' ? '👑 Super Admin' : '🔧 Admin') + '</span>' +
      '</div>' +
      (a.username !== 'superadmin'
        ? '<button class="btn btn-danger btn-sm" onclick="removeAdminAccount(\'' + a.username + '\')">Remove</button>'
        : '') +
    '</div>'
  ).join('');
}

// ── Late report per-staff (cumulative) ──
function renderLateReport() {
  const allLogs = freshLogs();
  const lateLogs = allLogs.filter(l => l.status === 'IN' && l.isLate);
  // group by staff
  const byStaff = {};
  lateLogs.forEach(l => {
    if (!byStaff[l.id]) byStaff[l.id] = { name: l.name, role: l.role || '', dept: l.department || '', count: 0, entries: [] };
    byStaff[l.id].count++;
    byStaff[l.id].entries.push(l);
  });
  const wrap = document.getElementById('lateReportOutput');
  if (!wrap) return;
  const list = Object.values(byStaff).sort((a,b) => b.count - a.count);
  if (list.length === 0) {
    wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">✅</div><h3>No late arrivals</h3><p>All staff have been arriving on time.</p></div>';
    return;
  }
  wrap.innerHTML = '<div class="late-report-grid">' +
    list.map(s =>
      '<div class="late-staff-card">' +
        '<div class="lsc-name">' + s.name + '</div>' +
        '<div class="lsc-role">' + s.role + ' · ' + s.dept + '</div>' +
        '<span class="lsc-count">' + s.count + ' time' + (s.count > 1 ? 's' : '') + ' late</span>' +
        '<div style="margin-top:10px;font-size:12px;color:var(--gray)">' +
          s.entries.slice(0,3).map(e => '<div style="padding:3px 0;border-bottom:1px solid #f0f0f0">' + e.date + ' · ' + e.time + ' <span style="color:#DC2626">(' + (e.minutesLate||'?') + ' min)</span></div>').join('') +
          (s.entries.length > 3 ? '<div style="padding:3px 0;color:#999">+' + (s.entries.length-3) + ' more…</div>' : '') +
        '</div>' +
      '</div>'
    ).join('') + '</div>';
}

// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════
function _initApp() {
  logs = freshLogs();
  renderStaffList();
  updateSigninLink();
  updateConnStatus();
  generateSchoolQR();
  refreshCloudAndRender();
}
// Login screen is shown by default — app starts after doLogin()
