function saveSchoolInfo() {
  schoolInfo = {
    name: document.getElementById('schoolName').value,
    branch: document.getElementById('schoolBranch').value,
    session: document.getElementById('academicSession').value,
  };
  localStorage.setItem('vmis_school', JSON.stringify(schoolInfo));
  postCloud('saveSchool', schoolInfo);
  showToast('success', '✅', 'Saved', 'School info updated.');
}

function saveAttendanceRules() {
  attRules = {
    resumption: document.getElementById('resumptionTime').value,
    closing: document.getElementById('closingTime').value,
    late: parseInt(document.getElementById('lateThreshold').value),
  };
  localStorage.setItem('vmis_rules', JSON.stringify(attRules));
  postCloud('saveRules', attRules);
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
      const url = scriptUrl;
      if (url) postCloud('resetAll', {});
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
updateSigninLink();
refreshCloudAndRender();
