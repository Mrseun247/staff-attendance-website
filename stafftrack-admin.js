// Robust QR generator: tries qrcodejs (canvas), falls back to Google Charts API (img)
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
      // verify it worked (qrcodejs renders a table+canvas/img)
      setTimeout(() => {
        if (!targetEl.querySelector('canvas') && !targetEl.querySelector('img')) {
          fallbackQR(targetEl, text, size);
        }
      }, 200);
      return;
    } catch(e) {}
  }
  fallbackQR(targetEl, text, size);
}

function fallbackQR(targetEl, text, size) {
  targetEl.innerHTML = '';
  const img = document.createElement('img');
  const encoded = encodeURIComponent(text);
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encoded}&color=0F1C3F&bgcolor=FFFFFF&margin=4`;
  img.width = size; img.height = size;
  img.style.borderRadius = '4px';
  img.alt = 'QR Code';
  img.onerror = () => { targetEl.innerHTML = `<div style="width:${size}px;height:${size}px;background:#f0f4ff;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:11px;color:#666;border:1px dashed #ccc">QR unavailable</div>`; };
  targetEl.appendChild(img);
}

// ═══════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════
let staffList   = JSON.parse(localStorage.getItem('vmis_staff')    || '[]');
let logs        = JSON.parse(localStorage.getItem('vmis_logs')     || '[]');
let scriptUrl   = localStorage.getItem('vmis_script_url')          || '';
let schoolInfo  = JSON.parse(localStorage.getItem('vmis_school')   || '{"name":"Victory Montessori Int\'l School","branch":"","session":"2025/2026"}');
let attRules    = JSON.parse(localStorage.getItem('vmis_rules')    || '{"resumption":"07:30","closing":"15:00","late":15}');
let cameraStream = null;
let scanInterval = null;
let modalStaff   = null;

// helpers to always read fresh from localStorage (shared with signin.html)
function freshLogs()       { return JSON.parse(localStorage.getItem('vmis_logs')           || '[]'); }
function freshPins()       { return JSON.parse(localStorage.getItem('vmis_pins')           || '{}'); }
function freshDeviceSess() { return JSON.parse(localStorage.getItem('vmis_device_sessions')|| '{}'); }
function savePins(p)       { localStorage.setItem('vmis_pins', JSON.stringify(p)); }
function saveDeviceSess(d) { localStorage.setItem('vmis_device_sessions', JSON.stringify(d)); }

// ═══════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  event.target.classList.add('active');
  // Always reload logs from storage (signin.html may have added records)
  logs = freshLogs();
  if (id === 'logs')  renderLogs();
  if (id === 'admin') loadAdminFields();
  if (id === 'setup') renderStaffList();
  if (id === 'security') renderSecurityPanel();
}

// Live-refresh logs every 15s so admin sees signin.html records without manual reload
setInterval(() => {
  logs = freshLogs();
  const active = document.querySelector('.page.active');
  if (active && active.id === 'page-logs') renderLogs();
  if (active && active.id === 'page-security') renderSecurityPanel();
}, 15000);

// clock
function updateClock() {
  const now = new Date();
  document.getElementById('clockDisplay').textContent =
    now.toLocaleDateString('en-NG', {weekday:'short',day:'numeric',month:'short'}) + ' · ' +
    now.toLocaleTimeString('en-NG', {hour:'2-digit',minute:'2-digit'});
}
setInterval(updateClock, 1000);
updateClock();

// ═══════════════════════════════════════════
// STAFF MANAGEMENT
// ═══════════════════════════════════════════
function addStaff() {
  const name = document.getElementById('staffName').value.trim();
  const id   = document.getElementById('staffId').value.trim();
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
  showToast('success', '✅', name, 'Added and QR generated!');
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
}

function renderStaffList() {
  const wrap = document.getElementById('staffListWrap');
  const qrGrid = document.getElementById('qrGrid');
  const qrCard = document.getElementById('qrPreviewCard');
  if (staffList.length === 0) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">👥</div><h3>No staff added yet</h3><p>Use the form above to add staff and generate QR codes.</p></div>`;
    qrCard.style.display = 'none';
    return;
  }

  wrap.innerHTML = `<table class="staff-table">
    <thead><tr>
      <th>ID</th><th>Name</th><th>Department</th><th>Role</th><th>PIN</th><th>Today</th><th>Actions</th>
    </tr></thead>
    <tbody>
    ${staffList.map(s => {
      const pins = freshPins();
      const hasPIN = !!pins[s.id];
      const todayStr = getDateStr(new Date());
      const todayRecs = freshLogs().filter(l => l.id === s.id && l.date === todayStr);
      const hasIn  = todayRecs.some(l => l.status === 'IN');
      const hasOut = todayRecs.some(l => l.status === 'OUT');
      let todayBadge = '<span class="badge" style="background:#F3F4F6;color:#6B7280">Absent</span>';
      if (hasIn && hasOut) todayBadge = '<span class="badge badge-green">In &amp; Out ✓</span>';
      else if (hasIn)      todayBadge = '<span class="badge" style="background:#DBEAFE;color:#1D4ED8">Signed In 🌅</span>';
      return `
      <tr>
        <td><span class="badge badge-navy">${s.id}</span></td>
        <td><strong>${s.name}</strong></td>
        <td>${s.dept}</td>
        <td>${s.role}</td>
        <td>${hasPIN
          ? '<span class="badge badge-green">✓ Set</span>'
          : '<span class="badge badge-gold">Not set</span>'}</td>
        <td>${todayBadge}</td>
        <td style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-gold btn-sm" onclick="openQRModal('${s.id}')">🔳 QR</button>
          ${hasPIN ? `<button class="btn btn-ghost btn-sm" onclick="resetStaffPIN('${s.id}','${s.name}')">🔑 Reset PIN</button>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="removeStaff('${s.id}')">✕</button>
        </td>
      </tr>`;
    }).join('')}
    </tbody></table>`;

  // QR grid
  qrCard.style.display = 'block';
  qrGrid.innerHTML = '';

  staffList.forEach((s, idx) => {
    const card = document.createElement('div');
    card.className = 'qr-card';
    card.onclick = () => openQRModal(s.id);

    const qrTarget = document.createElement('div');
    qrTarget.id = 'qrmini_' + s.id;
    qrTarget.style.width = '100px';
    qrTarget.style.height = '100px';
    qrTarget.style.margin = '0 auto 8px';

    const nameEl = document.createElement('div');
    nameEl.className = 'qr-name';
    nameEl.textContent = s.name;

    const roleEl = document.createElement('div');
    roleEl.className = 'qr-role';
    roleEl.textContent = s.dept;

    card.appendChild(qrTarget);
    card.appendChild(nameEl);
    card.appendChild(roleEl);
    qrGrid.appendChild(card);

    // stagger each QR slightly so DOM is fully ready
    setTimeout(() => {
      makeQR(qrTarget, JSON.stringify({ id: s.id, name: s.name, dept: s.dept, role: s.role }), 100);
    }, 100 + idx * 80);
  });
}

// ═══════════════════════════════════════════
// QR MODAL
// ═══════════════════════════════════════════
function openQRModal(id) {
  const s = staffList.find(x => x.id === id);
  if (!s) return;
  modalStaff = s;
  document.getElementById('modalTitle').textContent = s.name;
  document.getElementById('modalSub').textContent = `${s.role} · ${s.dept} · ID: ${s.id}`;
  const modalQREl = document.getElementById('modalQR');
  modalQREl.innerHTML = '';
  document.getElementById('modalBg').classList.add('open');
  setTimeout(() => {
    makeQR(modalQREl, JSON.stringify({ id: s.id, name: s.name, dept: s.dept, role: s.role }), 200);
  }, 100);
}

function closeModal(e) {
  if (e.target.id === 'modalBg') document.getElementById('modalBg').classList.remove('open');
}

function printQR() {
  const s = modalStaff;
  if (!s) return;
  const win = window.open('', '_blank');
  if (!win) { alert('Please allow pop-ups to print QR codes.'); return; }
  const qrContainer = document.getElementById('modalQR');
  const canvas = qrContainer.querySelector('canvas');
  const imgEl = qrContainer.querySelector('img');
  const imgSrc = canvas ? canvas.toDataURL() : (imgEl ? imgEl.src : '');
  if (!imgSrc) { alert('QR not ready, please wait a moment and try again.'); return; }
  const school = schoolInfo.name || 'School';
  const doc = win.document;
  doc.open();
  doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + s.name + ' QR</title>');
  doc.write('<style>body{font-family:sans-serif;text-align:center;padding:40px}.name{font-size:22px;font-weight:bold;margin-bottom:4px}.sub{font-size:14px;color:#666;margin-bottom:16px}.school{font-size:13px;color:#999;margin-top:16px}img{border:2px solid #0F1C3F;border-radius:8px}</style>');
  doc.write('</head><body>');
  doc.write('<div class="school">' + school + '</div>');
  doc.write('<img src="' + imgSrc + '" width="200" height="200" alt="QR code"/>');
  doc.write('<div class="name">' + s.name + '</div>');
  doc.write('<div class="sub">' + s.role + ' · ' + s.dept + '</div>');
  doc.write('<div style="font-size:12px;color:#aaa">ID: ' + s.id + '</div>');
  doc.write('</body></html>');
  doc.close();
  win.addEventListener('load', function() { win.print(); });
}

function printAllQR() {
  if (staffList.length === 0) { showToast('error','⚠️','No Staff','Add staff first.'); return; }
  const win = window.open('', '_blank');
  if (!win) { alert('Please allow pop-ups to print QR codes.'); return; }
  const cards = staffList.map(s => {
    const div = document.createElement('div');
    new QRCode(div, {
      text: JSON.stringify({ id: s.id, name: s.name, dept: s.dept, role: s.role }),
      width: 150, height: 150,
      colorDark: '#0F1C3F', colorLight: '#FFFFFF',
      correctLevel: QRCode.CorrectLevel.M
    });
    return { s, el: div };
  });
  setTimeout(() => {
    const imgs = cards.map(c => {
      const canvas = c.el.querySelector('canvas');
      return '<div class="card"><img src="' + (canvas ? canvas.toDataURL() : '') + '" width="150" alt=""/>' +
        '<div class="name">' + c.s.name + '</div><div class="sub">' + c.s.role + '</div><div class="id">ID: ' + c.s.id + '</div></div>';
    }).join('');
    const doc = win.document;
    doc.open();
    doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>All QR Codes</title>');
    doc.write('<style>body{font-family:sans-serif;padding:20px}h1{text-align:center;margin-bottom:24px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:20px}.card{text-align:center;border:1px solid #ddd;border-radius:8px;padding:16px}.name{font-weight:bold;font-size:14px;margin-top:8px}.sub{font-size:12px;color:#666}.id{font-size:11px;color:#999}img{border-radius:4px}@media print{.card{break-inside:avoid}}</style>');
    doc.write('</head><body><h1>' + (schoolInfo.name || 'School') + ' — Staff QR Codes</h1>');
    doc.write('<div class="grid">' + imgs + '</div></body></html>');
    doc.close();
    win.addEventListener('load', function() { win.print(); });
  }, 500);
}

function copyGasScript() {
  const el = document.getElementById('gasScript');
  if (!el) return;
  const text = el.value || el.textContent || '';
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => showToast('success', '📋', 'Copied', 'Google Apps Script copied to clipboard.'))
      .catch(() => fallbackCopyGas(text));
  } else {
    fallbackCopyGas(text);
  }
}

function fallbackCopyGas(text) {
  const el = document.getElementById('gasScript');
  if (el && el.select) {
    el.focus();
    el.select();
    try {
      document.execCommand('copy');
      showToast('success', '📋', 'Copied', 'Google Apps Script copied to clipboard.');
      return;
    } catch (e) {}
  }
  alert('Copy the script manually from the text box.');
}

// ═══════════════════════════════════════════
// CAMERA & QR SCAN
// ═══════════════════════════════════════════
async function startCamera() {
  if (cameraStream) return; // already running
  try {
    // Try rear camera first, fall back to any camera
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

    document.getElementById('startCamBtn').textContent = '📷 Camera Active';
    document.getElementById('startCamBtn').style.opacity = '0.6';
    document.getElementById('stopCamBtn').style.display = 'inline-flex';

    // scan every 250ms
    if (scanInterval) clearInterval(scanInterval);
    scanInterval = setInterval(scanFrame, 250);

    showToast('success', '📷', 'Camera Ready', 'Point camera at a staff QR code.');
  } catch (err) {
    console.error('Camera error:', err);
    showToast('error', '❌', 'Camera Error', err.message || 'Allow camera access and try again.');
  }
}

function stopCamera() {
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
  document.getElementById('startCamBtn').style.opacity = '1';
  document.getElementById('stopCamBtn').style.display = 'none';
}

function scanFrame() {
  if (typeof jsQR === 'undefined') {
    console.warn('jsQR not loaded yet');
    return;
  }
  const video = document.getElementById('scanVideo');
  const canvas = document.getElementById('scanCanvas');
  if (!video || !canvas) return;
  if (video.readyState < 2) return; // HAVE_CURRENT_DATA or better
  if (video.videoWidth === 0) return;

  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  // try both normal and inverted so printed QR codes always work
  const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });
  if (code && code.data) {
    let parsed = null;
    try { parsed = JSON.parse(code.data); } catch {}
    if (parsed && parsed.id && parsed.name) {
      processAttendance(parsed);
    } else if (code.data.trim()) {
      // QR found but not our format — show what was scanned
      console.log('QR scanned (unknown format):', code.data);
    }
  }
}

function manualScan() {
  const id = prompt('Enter Staff ID:');
  if (!id) return;
  const staff = staffList.find(s => s.id === id.trim());
  if (!staff) { showToast('error', '❌', 'Not Found', `No staff with ID: ${id}`); return; }
  processAttendance(staff);
}

let lastScan = {};

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

function processAttendance(data) {
  const now      = new Date();
  const dateStr  = getDateStr(now);
  const timeStr  = getTimeStr(now);
  const dayStr   = getDayStr(now);
  const minuteKey = dateStr + '-' + now.getHours() + '-' + now.getMinutes();

  // prevent rapid duplicate scan within same minute
  if (lastScan[data.id] === minuteKey) return;
  lastScan[data.id] = minuteKey;

  // Re-read logs fresh so we see records from signin.html too
  logs = freshLogs();

  const todayLogs = logs.filter(l => l.id === data.id && l.date === dateStr);
  const hasIn  = todayLogs.some(l => l.status === 'IN');
  const hasOut = todayLogs.some(l => l.status === 'OUT');

  // Block if both already recorded
  if (hasIn && hasOut) {
    showToast('error', '🚫', data.name, 'Already has IN & OUT recorded today.');
    return;
  }

  const status = !hasIn ? 'IN' : 'OUT';

  const entry = {
    id:         data.id,
    name:       data.name,
    department: data.dept || data.department || '',
    role:       data.role || '',
    date:       dateStr,
    time:       timeStr,
    status,
    day:        dayStr,
    device:     'admin-scan',
    shift:      status === 'IN' ? 'morning' : 'afternoon'
  };

  logs.unshift(entry);
  localStorage.setItem('vmis_logs', JSON.stringify(logs));

  if (scriptUrl) postToSheets(entry);

  const icon = status === 'IN' ? '🌅' : '🌆';
  const msg  = status === 'IN' ? 'Morning Sign-In at ' + timeStr : 'Afternoon Sign-Out at ' + timeStr;
  showToast(status === 'IN' ? 'success' : 'duplicate', icon, data.name, msg);
}

// ═══════════════════════════════════════════
// GOOGLE SHEETS
// ═══════════════════════════════════════════
async function postToSheets(entry) {
  if (!scriptUrl) return;
  try {
    await fetch(scriptUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    });
  } catch (e) {
    console.warn('Sheets sync error:', e);
  }
}

async function syncToSheets() {
  if (!scriptUrl) {
    showToast('error', '⚙️', 'Not configured', 'Set the Google Script URL in Admin tab.');
    return;
  }
  showToast('success', '☁️', 'Syncing…', 'Sending records to Google Sheets.');
  const pending = logs.filter(l => !l.synced);
  for (const entry of pending) {
    await postToSheets(entry);
    entry.synced = true;
  }
  localStorage.setItem('vmis_logs', JSON.stringify(logs));
  showToast('success', '✅', 'Sync Complete', `${pending.length} record(s) sent to Google Sheets.`);
}

// ═══════════════════════════════════════════
// LOGS
// ═══════════════════════════════════════════
function renderLogs() {
  // always pull fresh from storage
  logs = freshLogs();

  const search       = (document.getElementById('logSearch')?.value  || '').toLowerCase();
  const dateFilter   =  document.getElementById('logDate')?.value;
  const statusFilter =  document.getElementById('logFilter')?.value;
  const sourceFilter =  document.getElementById('logSource')?.value || '';

  let filtered = logs;
  if (search)       filtered = filtered.filter(l => l.name.toLowerCase().includes(search) || l.id.toLowerCase().includes(search));
  if (dateFilter)   filtered = filtered.filter(l => l.date === dateFilter);
  if (statusFilter) filtered = filtered.filter(l => l.status === statusFilter);
  if (sourceFilter) filtered = filtered.filter(l => (l.device || 'admin-scan') === sourceFilter);

  // stats
  const today      = getDateStr(new Date());
  const todayLogs  = logs.filter(l => l.date === today);
  const inCount    = todayLogs.filter(l => l.status === 'IN').length;
  const outCount   = todayLogs.filter(l => l.status === 'OUT').length;
  const fullDone   = staffList.filter(s => {
    const r = todayLogs.filter(l => l.id === s.id);
    return r.some(l => l.status === 'IN') && r.some(l => l.status === 'OUT');
  }).length;
  const absent = staffList.filter(s => !todayLogs.some(l => l.id === s.id)).length;

  document.getElementById('statsRow').innerHTML = `
    <div class="stat-card"><div class="stat-val">${staffList.length}</div><div class="stat-lbl">Total Staff</div></div>
    <div class="stat-card green"><div class="stat-val">${inCount}</div><div class="stat-lbl">🌅 Morning Sign-Ins</div></div>
    <div class="stat-card gold"><div class="stat-val">${outCount}</div><div class="stat-lbl">🌆 Afternoon Sign-Outs</div></div>
    <div class="stat-card"><div class="stat-val">${fullDone}</div><div class="stat-lbl">✅ Full Day Done</div></div>
    <div class="stat-card" style="border-left:3px solid var(--red)"><div class="stat-val" style="color:var(--red)">${absent}</div><div class="stat-lbl">Absent Today</div></div>
  `;

  const wrap = document.getElementById('logsTableWrap');
  if (filtered.length === 0) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><h3>No records found</h3><p>Adjust filters or scan QR codes.</p></div>`;
    return;
  }

  wrap.innerHTML = `<table class="log-table">
    <thead><tr>
      <th>Staff ID</th><th>Name</th><th>Department</th><th>Role</th>
      <th>Date</th><th>Time</th><th>Day</th><th>Shift</th><th>Source</th><th>Status</th>
    </tr></thead>
    <tbody>
    ${filtered.map(l => {
      const source = l.device === 'self-signin' ? '<span class="badge badge-navy">Self Sign-In</span>' : '<span class="badge" style="background:#F3F4F6;color:#374151">Admin Scan</span>';
      const shift  = l.shift  === 'morning'     ? '🌅 Morning' : (l.shift === 'afternoon' ? '🌆 Afternoon' : '—');
      return `
      <tr>
        <td><span class="badge badge-navy">${l.id}</span></td>
        <td><strong>${l.name}</strong></td>
        <td>${l.department || ''}</td>
        <td>${l.role || ''}</td>
        <td>${l.date}</td>
        <td>${l.time}</td>
        <td>${l.day}</td>
        <td style="font-size:12px">${shift}</td>
        <td>${source}</td>
        <td>
          <span class="status-dot ${l.status === 'IN' ? 'in' : 'out'}"></span>
          <span class="badge ${l.status === 'IN' ? 'badge-green' : 'badge-gold'}">${l.status === 'IN' ? 'Sign-In' : 'Sign-Out'}</span>
        </td>
      </tr>`;
    }).join('')}
    </tbody></table>`;
}

function clearTodayLogs() {
  const today = getDateStr(new Date());
  if (!confirm("Clear all of today's records?")) return;
  logs = logs.filter(l => l.date !== today);
  localStorage.setItem('vmis_logs', JSON.stringify(logs));
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
  const content = rows.map(r => r.map(v => `"${(v||'').toString().replace(/"/g,'""')}"`).join(',')).join('\n');
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
  input.type = 'file';
  input.accept = '.json,.csv';
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
          // CSV import for staff
          const lines = ev.target.result.split('\n').filter(Boolean);
          lines.slice(1).forEach(line => {
            const [id, name, dept, role] = line.split(',').map(v => v.replace(/^"|"$/g,'').trim());
            if (id && name && !staffList.find(s => s.id === id)) {
              staffList.push({ id, name, dept: dept||'', role: role||'', added: new Date().toISOString() });
            }
          });
          saveStaff();
          renderStaffList();
          showToast('success', '✅', 'Imported', `CSV loaded — ${staffList.length} staff.`);
        }
      } catch { showToast('error', '❌', 'Import Failed', 'Invalid file format.'); }
    };
    reader.readAsText(file);
  };
  input.click();
}

// ═══════════════════════════════════════════
// ADMIN
// ═══════════════════════════════════════════
function loadAdminFields() {
  document.getElementById('scriptUrl').value = scriptUrl;
  document.getElementById('schoolName').value = schoolInfo.name || '';
  document.getElementById('schoolBranch').value = schoolInfo.branch || '';
  document.getElementById('academicSession').value = schoolInfo.session || '';
  document.getElementById('resumptionTime').value = attRules.resumption || '07:30';
  document.getElementById('closingTime').value = attRules.closing || '15:00';
  document.getElementById('lateThreshold').value = attRules.late || 15;
  updateConnStatus();
}

function saveScriptUrl() {
  scriptUrl = document.getElementById('scriptUrl').value.trim();
  localStorage.setItem('vmis_script_url', scriptUrl);
  updateConnStatus();
  showToast('success', '✅', 'Saved', 'Google Sheets URL saved.');
}

function updateConnStatus() {
  const dot = document.getElementById('connDot');
  const text = document.getElementById('connText');
  if (scriptUrl) {
    dot.className = 'conn-dot connected';
    text.textContent = 'Connected · ' + scriptUrl.substring(0, 50) + '…';
  } else {
    dot.className = 'conn-dot';
    text.textContent = 'Not configured';
  }
}

async function testConnection() {
  if (!scriptUrl) { showToast('error','⚙️','No URL','Set the Script URL first.'); return; }
  showToast('success', '🔁', 'Testing…', 'Checking Google Sheets connection.');
  try {
    const testData = {
      id: 'TEST-001', name: 'Connection Test', department: 'System',
      role: 'Test', date: new Date().toLocaleDateString(), time: new Date().toLocaleTimeString(),
      status: 'TEST', day: 'Test'
    };
    await fetch(scriptUrl, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testData)
    });
    showToast('success', '✅', 'Connection OK', 'Test entry sent to Google Sheets!');
    document.getElementById('connDot').className = 'conn-dot connected';
  } catch (e) {
    showToast('error', '❌', 'Connection Failed', 'Check the URL and try again.');
    document.getElementById('connDot').className = 'conn-dot error';
  }
}

function saveSchoolInfo() {
  schoolInfo = {
    name: document.getElementById('schoolName').value,
    branch: document.getElementById('schoolBranch').value,
    session: document.getElementById('academicSession').value,
  };
  localStorage.setItem('vmis_school', JSON.stringify(schoolInfo));
  showToast('success', '✅', 'Saved', 'School info updated.');
}

function saveAttendanceRules() {
  attRules = {
    resumption: document.getElementById('resumptionTime').value,
    closing: document.getElementById('closingTime').value,
    late: parseInt(document.getElementById('lateThreshold').value),
  };
  localStorage.setItem('vmis_rules', JSON.stringify(attRules));
  showToast('success', '✅', 'Saved', 'Attendance rules updated.');
}

function resetStaffPIN(id, name) {
  if (!confirm(`Reset PIN for ${name}? They will be prompted to create a new PIN on their next sign-in.`)) return;
  const pins = freshPins();
  delete pins[id];
  savePins(pins);
  renderStaffList();
  showToast('success', '🔑', 'PIN Reset', `${name}'s PIN has been cleared.`);
}

function confirmReset() {
  if (confirm('⚠️ This will delete ALL staff, attendance, PINs and device sessions. Are you sure?')) {
    if (confirm('Final warning: This cannot be undone. Proceed?')) {
      localStorage.clear();
      staffList = []; logs = []; scriptUrl = '';
      schoolInfo = { name: '', branch: '', session: '' };
      showToast('success', '✅', 'Reset', 'All data cleared.');
      renderStaffList();
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

  // ── Device Sessions ──
  const sessWrap = document.getElementById('deviceSessionsWrap');
  const todaySessions = Object.entries(devSess).filter(([k, v]) => v.date === today);
  if (todaySessions.length === 0) {
    sessWrap.innerHTML = `<div class="empty-state" style="padding:32px"><div class="empty-icon">📱</div><h3>No active sessions</h3><p>No device has been used for self sign-in today.</p></div>`;
  } else {
    sessWrap.innerHTML = `<table class="log-table">
      <thead><tr><th>Session Key</th><th>Staff Name</th><th>Time</th><th>Shift</th><th>Action</th></tr></thead>
      <tbody>
      ${todaySessions.map(([k, v]) => `
        <tr>
          <td style="font-family:monospace;font-size:12px;color:var(--gray)">${k}</td>
          <td><strong>${v.staffName}</strong></td>
          <td>${v.time}</td>
          <td><span class="badge ${v.shift === 'morning' ? 'badge-navy' : 'badge-gold'}">${v.shift === 'morning' ? '🌅 Morning' : '🌆 Afternoon'}</span></td>
          <td><button class="btn btn-ghost btn-sm" onclick="clearOneSession('${k}')">✕ Unlock</button></td>
        </tr>`).join('')}
      </tbody></table>`;
  }

  // ── PIN Status ──
  const pinWrap = document.getElementById('pinStatusWrap');
  if (staffList.length === 0) {
    pinWrap.innerHTML = `<div class="empty-state" style="padding:32px"><div class="empty-icon">👥</div><h3>No staff registered</h3></div>`;
  } else {
    pinWrap.innerHTML = `<table class="log-table">
      <thead><tr><th>ID</th><th>Name</th><th>Department</th><th>PIN Status</th><th>Action</th></tr></thead>
      <tbody>
      ${staffList.map(s => `
        <tr>
          <td><span class="badge badge-navy">${s.id}</span></td>
          <td><strong>${s.name}</strong></td>
          <td>${s.dept}</td>
          <td>${pins[s.id]
            ? '<span class="badge badge-green">✓ PIN Set</span>'
            : '<span class="badge badge-gold">⚠ Not Set — will be prompted on first sign-in</span>'}</td>
          <td>${pins[s.id]
            ? `<button class="btn btn-ghost btn-sm" onclick="resetStaffPIN('${s.id}','${s.name}')">🔑 Reset PIN</button>`
            : '—'}</td>
        </tr>`).join('')}
      </tbody></table>`;
  }

  // ── Today's Self Sign-In Activity ──
  const selfLogs = freshLogs().filter(l => l.date === today && l.device === 'self-signin');
  const slWrap   = document.getElementById('selfSigninLogWrap');
  if (selfLogs.length === 0) {
    slWrap.innerHTML = `<div class="empty-state" style="padding:32px"><div class="empty-icon">🧾</div><h3>No self sign-ins today</h3><p>Staff haven't used the self sign-in portal yet today.</p></div>`;
  } else {
    slWrap.innerHTML = `<table class="log-table">
      <thead><tr><th>Staff ID</th><th>Name</th><th>Time</th><th>Shift</th><th>Status</th></tr></thead>
      <tbody>
      ${selfLogs.map(l => `
        <tr>
          <td><span class="badge badge-navy">${l.id}</span></td>
          <td><strong>${l.name}</strong></td>
          <td>${l.time}</td>
          <td style="font-size:12px">${l.shift === 'morning' ? '🌅 Morning' : '🌆 Afternoon'}</td>
          <td><span class="status-dot ${l.status === 'IN' ? 'in' : 'out'}"></span>
              <span class="badge ${l.status === 'IN' ? 'badge-green' : 'badge-gold'}">${l.status === 'IN' ? 'Sign-In' : 'Sign-Out'}</span></td>
        </tr>`).join('')}
      </tbody></table>`;
  }
}

function clearOneSession(key) {
  const d = freshDeviceSess();
  delete d[key];
  saveDeviceSess(d);
  renderSecurityPanel();
  showToast('success', '🔓', 'Session Cleared', 'Device can now be used again for self sign-in.');
}

function clearAllDeviceSessions() {
  if (!confirm('Clear ALL device sessions? All devices will be unlocked immediately.')) return;
  saveDeviceSess({});
  renderSecurityPanel();
  showToast('success', '🔓', 'All Sessions Cleared', 'All devices are now unlocked.');
}

function clearAllPINs() {
  if (!confirm('Reset ALL staff PINs? Every staff member will be prompted to create a new PIN on their next sign-in.')) return;
  savePins({});
  renderSecurityPanel();
  renderStaffList();
  showToast('success', '🔑', 'All PINs Reset', 'Staff will set new PINs on next sign-in.');
}

// ═══════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════
let toastTimer;
function showToast(type, icon, name, msg) {
  const toast = document.getElementById('toast');
  toast.className = type;
  document.getElementById('toastIcon').textContent = icon;
  document.getElementById('toastName').textContent = name;
  document.getElementById('toastMsg').textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}

// init
logs = freshLogs();
renderStaffList();
