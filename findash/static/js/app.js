'use strict';
/* ═══════════════════════════════════════════════════════
   FinDash PFAS — Frontend Application (Updated)
   Changes: auth-aware, daily KPIs, total transactions,
            profile page, import bank message, weekly chart,
            3-month line, monthly table, auto-refresh
═══════════════════════════════════════════════════════ */

// ── State ──────────────────────────────────────────
let allTransactions = [];
let analyticsData   = {};
let charts          = {};
let _importParsed   = null;   // holds pending import

// ── Formatters ─────────────────────────────────────
const fmt    = (n) => '₹' + (n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtDec = (n) => '₹' + (n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

// ── Toast ──────────────────────────────────────────
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  setTimeout(() => (el.className = 'toast'), 3500);
}

// ── Modals ──────────────────────────────────────────
function openModal(id) {
  document.getElementById(`modal-${id}`).classList.add('open');
}
function closeModal(id) {
  const overlay = document.getElementById(`modal-${id}`);
  overlay.classList.remove('open');
  // Reset import modal state
  if (id === 'importTxn') resetImport();
}

document.querySelectorAll('.modal-overlay').forEach(el =>
  el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open'); })
);

// ── Sidebar ─────────────────────────────────────────
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ── Navigation ──────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    const sec = item.dataset.section;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById(`sec-${sec}`).classList.add('active');
    document.getElementById('pageTitle').textContent = item.textContent.trim();
    if (window.innerWidth < 700) document.getElementById('sidebar').classList.remove('open');
    // Load profile data when switching to profile
    if (sec === 'profile') loadProfile();
  });
});

// ── Date Badge ──────────────────────────────────────
document.getElementById('dateBadge').textContent =
  new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

// Set today as default date
const txnDateEl = document.getElementById('txnDate');
if (txnDateEl) txnDateEl.valueAsDate = new Date();

// ── Chart Defaults ──────────────────────────────────
Chart.defaults.color      = '#7c8db5';
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.font.size   = 13;

const CHART_COLORS = [
  '#6366f1','#10b981','#f59e0b','#ef4444',
  '#8b5cf6','#06b6d4','#f97316','#ec4899',
  '#14b8a6','#84cc16'
];

// ── API Helper ──────────────────────────────────────
async function apiFetch(url, opts = {}) {
  const res  = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json();
  if (res.status === 401) { window.location.href = '/login'; return; }
  if (!res.ok) throw new Error(data.error || 'API error');
  return data;
}

// ── Auth: Logout ────────────────────────────────────
async function doLogout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
}

// ── Load All Data (auto-refresh after mutations) ────
async function loadAll() {
  try {
    const [txns, ana] = await Promise.all([
      apiFetch('/api/transactions'),
      apiFetch('/api/analytics'),
    ]);
    allTransactions = txns;
    analyticsData   = ana;

    renderKPIs();
    renderHealthScore();
    renderMonthlyChart();
    renderCategoryChart();
    render3MonthLineChart();
    renderTransactions();
    renderGoals();
    renderAlerts();
    renderRecommendations();
    renderAnalytics();
    renderMonthlyTable();
  } catch (err) {
    toast('Error loading data: ' + err.message, 'error');
  }
}

// ── User Identity ────────────────────────────────────
async function loadIdentity() {
  try {
    const user = await apiFetch('/api/auth/me');
    document.getElementById('sidebarName').textContent = user.full_name || user.username;
    document.getElementById('sidebarAvatar').textContent =
      (user.full_name || user.username || 'U')[0].toUpperCase();
  } catch {}
}

// ── KPI Cards ────────────────────────────────────────
function renderKPIs() {
  const a = analyticsData;
  document.getElementById('kpiIncome').textContent   = fmt(a.total_income);
  document.getElementById('kpiExpense').textContent  = fmt(a.total_expense);
  document.getElementById('kpiSavings').textContent  = (a.savings_rate || 0).toFixed(1) + '%';
  document.getElementById('kpiDailyInc').textContent = fmt(a.daily_income);
  document.getElementById('kpiDailyExp').textContent = fmt(a.daily_expense);
  document.getElementById('kpiTxnTotal').textContent = a.total_transactions || 0;

  const balEl = document.getElementById('kpiBalance');
  balEl.textContent  = fmt(Math.abs(a.balance));
  balEl.style.color  = a.balance >= 0 ? 'var(--green)' : 'var(--red)';
}

// ── Health Score Ring ─────────────────────────────────
function renderHealthScore() {
  const score = analyticsData.health_score || 0;
  const circ  = 2 * Math.PI * 50;
  const ring  = document.getElementById('ringFill');
  ring.style.strokeDasharray  = circ;
  ring.style.strokeDashoffset = circ - (score / 100) * circ;
  ring.style.stroke = score < 40 ? '#ef4444' : score < 70 ? '#f59e0b' : '#10b981';

  document.getElementById('scoreNum').textContent   = score;
  document.getElementById('scoreGrade').textContent =
    score < 40 ? 'Needs Work' : score < 70 ? 'Fair' : 'Excellent';

  const topEl = document.getElementById('topHealthScore');
  topEl.textContent  = score;
  topEl.style.color  = score < 40 ? 'var(--red)' : score < 70 ? 'var(--yellow)' : 'var(--green)';
}

// ── Chart Helpers ─────────────────────────────────────
function destroyChart(key) {
  if (charts[key]) { charts[key].destroy(); delete charts[key]; }
}

const gridColor = 'rgba(255,255,255,0.04)';
const yTick = v => '₹' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v);

// Monthly Bar Chart (dashboard)
function renderMonthlyChart() {
  destroyChart('monthly');
  const mt     = analyticsData.monthly_trend || {};
  const labels = Object.keys(mt);
  charts.monthly = new Chart(document.getElementById('monthlyChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Income',  data: labels.map(k => mt[k].income  || 0), backgroundColor: 'rgba(16,185,129,0.75)', borderRadius: 5 },
        { label: 'Expense', data: labels.map(k => mt[k].expense || 0), backgroundColor: 'rgba(239,68,68,0.75)',   borderRadius: 5 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', labels: { font: { size: 13 } } } },
      scales: {
        x: { grid: { color: gridColor } },
        y: { grid: { color: gridColor }, ticks: { callback: yTick } },
      },
    },
  });
}

// Category Doughnut
function renderCategoryChart() {
  destroyChart('category');
  const cb     = analyticsData.category_breakdown || {};
  const labels = Object.keys(cb);
  charts.category = new Chart(document.getElementById('categoryChart'), {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: labels.map(k => cb[k]), backgroundColor: CHART_COLORS, borderColor: '#161b27', borderWidth: 2 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 13, padding: 14, font: { size: 13 } } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmt(ctx.raw)}` } },
      },
    },
  });
}

// 3-Month Line Chart (dashboard)
function render3MonthLineChart() {
  destroyChart('line3m');
  const mt     = analyticsData.monthly_3 || {};
  const labels = Object.keys(mt);
  charts.line3m = new Chart(document.getElementById('lineChart3m'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Income',  data: labels.map(k => mt[k].income  || 0), borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)', fill: true, tension: 0.4, pointRadius: 5 },
        { label: 'Expense', data: labels.map(k => mt[k].expense || 0), borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)',   fill: true, tension: 0.4, pointRadius: 5 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', labels: { font: { size: 13 } } } },
      scales: {
        x: { grid: { color: gridColor } },
        y: { grid: { color: gridColor }, ticks: { callback: yTick } },
      },
    },
  });
}

// ── Analytics Charts ──────────────────────────────────
function renderAnalytics() {
  document.getElementById('avgWeekday').textContent   = fmt(analyticsData.weekday_avg);
  document.getElementById('avgWeekend').textContent   = fmt(analyticsData.weekend_avg);
  document.getElementById('weekendRatio').textContent = (analyticsData.weekend_ratio || 1).toFixed(2) + '×';
  document.getElementById('goalCount').textContent    = analyticsData.goal_count || 0;

  // Weekly bar
  destroyChart('weekly');
  const ws = analyticsData.weekly_spending || {};
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  charts.weekly = new Chart(document.getElementById('weeklyChart'), {
    type: 'bar',
    data: {
      labels: days,
      datasets: [{
        label: 'Spending',
        data: days.map(d => ws[d] || 0),
        backgroundColor: days.map((d, i) => i >= 5 ? 'rgba(245,158,11,0.75)' : 'rgba(99,102,241,0.75)'),
        borderRadius: 5,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: gridColor }, ticks: { callback: yTick } },
      },
    },
  });

  // Weekday vs Weekend
  destroyChart('weekend');
  charts.weekend = new Chart(document.getElementById('weekendChart'), {
    type: 'bar',
    data: {
      labels: ['Weekday Avg/day', 'Weekend Avg/day'],
      datasets: [{
        data: [analyticsData.weekday_avg || 0, analyticsData.weekend_avg || 0],
        backgroundColor: ['rgba(99,102,241,0.75)', 'rgba(245,158,11,0.75)'],
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: gridColor }, ticks: { callback: yTick } },
      },
    },
  });

  // 6-month Line
  destroyChart('aLine');
  const mt6     = analyticsData.monthly_trend || {};
  const labs6   = Object.keys(mt6);
  charts.aLine  = new Chart(document.getElementById('analyticsLineChart'), {
    type: 'line',
    data: {
      labels: labs6,
      datasets: [
        { label: 'Income',  data: labs6.map(k => mt6[k].income  || 0), borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.08)', fill: true, tension: 0.4, pointRadius: 4 },
        { label: 'Expense', data: labs6.map(k => mt6[k].expense || 0), borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.08)',   fill: true, tension: 0.4, pointRadius: 4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: {
        x: { grid: { color: gridColor } },
        y: { grid: { color: gridColor }, ticks: { callback: yTick } },
      },
    },
  });

  // Pie
  destroyChart('aPie');
  const cb2  = analyticsData.category_breakdown || {};
  const labs2 = Object.keys(cb2);
  charts.aPie = new Chart(document.getElementById('analyticsPieChart'), {
    type: 'pie',
    data: {
      labels: labs2,
      datasets: [{ data: labs2.map(k => cb2[k]), backgroundColor: CHART_COLORS, borderColor: '#161b27', borderWidth: 2 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 13, padding: 12 } } },
    },
  });
}

// Monthly Breakdown Table
function renderMonthlyTable() {
  const mt   = analyticsData.monthly_trend || {};
  const body = document.getElementById('monthlyTableBody');
  const rows = Object.entries(mt).sort((a, b) => b[0].localeCompare(a[0]));
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="5" class="empty-row">No data yet.</td></tr>';
    return;
  }
  body.innerHTML = rows.map(([month, d]) => {
    const net = (d.income || 0) - (d.expense || 0);
    const sr  = d.income ? ((net / d.income) * 100).toFixed(1) : '0.0';
    return `<tr>
      <td><strong>${month}</strong></td>
      <td style="color:var(--green)">${fmt(d.income)}</td>
      <td style="color:var(--red)">${fmt(d.expense)}</td>
      <td style="color:${net >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(Math.abs(net))}</td>
      <td>${sr}%</td>
    </tr>`;
  }).join('');
}

// ── Transactions ──────────────────────────────────────
function renderTransactions(filter = '') {
  const typeF = document.getElementById('txnTypeFilter').value;
  const txns  = allTransactions.filter(t => {
    const matchType   = !typeF || t.type === typeF;
    const matchSearch = !filter || [t.category, t.description, t.date]
      .some(v => v && v.toLowerCase().includes(filter.toLowerCase()));
    return matchType && matchSearch;
  });

  const body = document.getElementById('txnBody');
  if (!txns.length) {
    body.innerHTML = `<tr><td colspan="7" class="empty-row">No transactions match your filter.</td></tr>`;
    return;
  }
  body.innerHTML = txns.map(t => `
    <tr>
      <td>${fmtDate(t.date)}</td>
      <td class="time-cell">${fmtTime(t.time_saved, t.created_at)}</td>
      <td><span class="type-badge ${t.type}">${t.type}</span></td>
      <td>${t.category}</td>
      <td>${t.description || '—'}</td>
      <td style="font-family:'Space Grotesk',sans-serif;font-weight:700;color:${t.type === 'income' ? 'var(--green)' : 'var(--red)'}">
        ${t.type === 'income' ? '+' : '−'}${fmt(t.amount)}
      </td>
      <td><button class="btn-del" onclick="deleteTxn(${t.id})" title="Delete">✕</button></td>
    </tr>
  `).join('');
}

function filterTxns() { renderTransactions(document.getElementById('txnSearch').value); }

function fmtDate(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${day} ${months[parseInt(m) - 1]} ${y}`;
}

// Format time for display - accepts "HH:MM:SS" or full "YYYY-MM-DD HH:MM:SS"
function fmtTime(timeSaved, createdAt) {
  var raw = (timeSaved && timeSaved.length >= 8) ? timeSaved : (createdAt || '');
  if (!raw) return '-';
  // Find HH:MM:SS anywhere in the string
  var parts = raw.split(' ');
  var timePart = parts.length > 1 ? parts[1] : parts[0];
  var hms = timePart.split(':');
  if (hms.length < 3) return '-';
  var hh = parseInt(hms[0], 10);
  var mm = hms[1];
  var ss = hms[2].substring(0, 2);
  var period = hh >= 12 ? 'PM' : 'AM';
  var h12 = hh % 12 || 12;
  return (h12 < 10 ? '0' : '') + h12 + ':' + mm + ':' + ss + ' ' + period;
}

async function submitTransaction() {
  const type     = document.getElementById('txnType').value;
  const amount   = parseFloat(document.getElementById('txnAmount').value);
  const category = document.getElementById('txnCategory').value;
  const date     = document.getElementById('txnDate').value;
  const desc     = document.getElementById('txnDesc').value.trim();

  if (!amount || amount <= 0) { toast('Enter a valid amount.', 'error'); return; }
  if (!date)                  { toast('Select a date.', 'error'); return; }

  try {
    await apiFetch('/api/transactions', {
      method: 'POST',
      body: JSON.stringify({ type, amount, category, date, description: desc }),
    });
    closeModal('addTxn');
    document.getElementById('txnAmount').value = '';
    document.getElementById('txnDesc').value   = '';
    document.getElementById('txnDate').valueAsDate = new Date();
    toast(`${type === 'income' ? '💰 Income' : '💸 Expense'} of ${fmt(amount)} added!`,
          type === 'income' ? 'success' : 'warning');
    await loadAll();
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteTxn(id) {
  if (!confirm('Delete this transaction?')) return;
  await apiFetch(`/api/transactions/${id}`, { method: 'DELETE' });
  toast('Transaction deleted.', 'warning');
  await loadAll();
}

// ── Bank Message Import ───────────────────────────────
async function previewImport() {
  const text = document.getElementById('importMsgText').value.trim();
  const err  = document.getElementById('importErr');
  const prev = document.getElementById('importPreview');
  err.textContent = ''; prev.style.display = 'none';
  document.getElementById('importConfirmBtn').style.display = 'none';
  _importParsed = null;

  if (!text) { err.textContent = 'Paste a bank message first.'; return; }

  try {
    const data = await apiFetch('/api/transactions/import', {
      method: 'POST',
      body: JSON.stringify({ message: text, dry_run: true }),
    });
    _importParsed = data.transaction;
    const t = _importParsed;
    document.getElementById('importPreviewGrid').innerHTML = `
      <div class="import-field">
        <div class="import-field-label">Type</div>
        <div class="import-field-value ${t.type}">${t.type.toUpperCase()}</div>
      </div>
      <div class="import-field">
        <div class="import-field-label">Amount</div>
        <div class="import-field-value">${fmt(t.amount)}</div>
      </div>
      <div class="import-field">
        <div class="import-field-label">Date</div>
        <div class="import-field-value">${fmtDate(t.date)}</div>
      </div>
      <div class="import-field">
        <div class="import-field-label">Merchant / Source</div>
        <div class="import-field-value">${t.description || '—'}</div>
      </div>
      <div class="import-field">
        <div class="import-field-label">Category</div>
        <div class="import-field-value">${t.category}</div>
      </div>
    `;
    prev.style.display = 'block';
    document.getElementById('importConfirmBtn').style.display = '';
  } catch (err2) {
    err.textContent = err2.message;
  }
}

async function confirmImport() {
  const text = document.getElementById('importMsgText').value.trim();
  const err  = document.getElementById('importErr');
  err.textContent = '';
  try {
    await apiFetch('/api/transactions/import', {
      method: 'POST',
      body: JSON.stringify({ message: text }),
    });
    closeModal('importTxn');
    toast('✅ Transaction imported from bank message!', 'success');
    await loadAll();
  } catch (e) { err.textContent = e.message; }
}

function resetImport() {
  document.getElementById('importMsgText').value = '';
  document.getElementById('importPreview').style.display = 'none';
  document.getElementById('importConfirmBtn').style.display = 'none';
  document.getElementById('importErr').textContent = '';
  _importParsed = null;
}

// ── Goals ─────────────────────────────────────────────
async function renderGoals() {
  const goals   = await apiFetch('/api/goals');
  const planner = analyticsData.planner || [];
  const grid    = document.getElementById('goalsGrid');

  if (!goals.length) {
    grid.innerHTML = '<div class="goal-empty">No goals yet. Add one to start planning.</div>';
    return;
  }

  const pm = {};
  planner.forEach(p => (pm[p.name] = p));

  grid.innerHTML = goals.map(g => {
    const pct  = Math.min(100, (g.saved_amt / g.target_amt) * 100) || 0;
    const info = pm[g.name] || {};
    return `
      <div class="goal-card">
        <div class="goal-top">
          <div class="goal-name">${g.name}</div>
          <span class="goal-on-track ${info.on_track ? 'yes' : 'no'}">
            ${info.on_track ? '✓ On Track' : '⚡ Needs Boost'}
          </span>
        </div>
        <div class="goal-amounts">
          <span>Saved: <strong>${fmt(g.saved_amt)}</strong></span>
          <span>Target: <strong>${fmt(g.target_amt)}</strong></span>
        </div>
        <div class="goal-bar"><div class="goal-bar-fill" style="width:${pct}%"></div></div>
        <div class="goal-meta">
          <span>${pct.toFixed(1)}% complete</span>
          <span>Need <strong>${fmtDec(info.monthly_needed || 0)}/mo</strong> · ${info.months_left || '?'} months left</span>
        </div>
        <div class="goal-actions">
          <button class="btn-tiny del"  onclick="deleteGoal(${g.id})">Remove</button>
          <button class="btn-tiny fund" onclick="fundGoal(${g.id},${g.saved_amt},${g.target_amt})">Add Funds</button>
        </div>
      </div>
    `;
  }).join('');
}

async function submitGoal() {
  const name     = document.getElementById('goalName').value.trim();
  const target   = parseFloat(document.getElementById('goalTarget').value);
  const saved    = parseFloat(document.getElementById('goalSaved').value) || 0;
  const deadline = document.getElementById('goalDeadline').value;

  if (!name)    { toast('Enter a goal name.', 'error'); return; }
  if (!target)  { toast('Enter a target amount.', 'error'); return; }
  if (!deadline){ toast('Set a deadline.', 'error'); return; }

  try {
    await apiFetch('/api/goals', {
      method: 'POST',
      body: JSON.stringify({ name, target_amt: target, saved_amt: saved, deadline }),
    });
    closeModal('addGoal');
    ['goalName','goalTarget','goalSaved','goalDeadline'].forEach(id => document.getElementById(id).value = '');
    toast(`Goal "${name}" created!`);
    await loadAll();
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteGoal(id) {
  if (!confirm('Remove this goal?')) return;
  await apiFetch(`/api/goals/${id}`, { method: 'DELETE' });
  toast('Goal removed.', 'warning');
  await loadAll();
}

async function fundGoal(id, current, target) {
  const add = parseFloat(prompt(`Current savings: ${fmt(current)}\nHow much to add? (₹)`));
  if (!add || add <= 0) return;
  const newSaved = Math.min(current + add, target);
  await apiFetch(`/api/goals/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ saved_amt: newSaved }),
  });
  toast(`Added ${fmt(add)} to goal!`);
  await loadAll();
}

// ── Alerts ────────────────────────────────────────────
function renderAlerts() {
  const alerts = analyticsData.alerts || [];
  const el     = document.getElementById('alertsList');
  if (!alerts.length) {
    el.innerHTML = '<div class="alert-empty">✅ No alerts. Your finances look clean!</div>';
    return;
  }
  el.innerHTML = alerts.map(a => {
    const cls = a.startsWith('⚠') ? 'critical' : a.startsWith('📅') ? '' : 'info';
    return `<div class="alert-item ${cls}">${a}</div>`;
  }).join('');
}

// ── Recommendations ───────────────────────────────────
function renderRecommendations() {
  const recs = analyticsData.recommendations || [];
  const el   = document.getElementById('recsList');
  el.innerHTML = recs.length
    ? recs.map(r => `<li>${r}</li>`).join('')
    : '<li class="rec-empty">Add transactions to generate recommendations.</li>';
}

// ── Profile Page ──────────────────────────────────────
async function loadProfile() {
  try {
    const user = await apiFetch('/api/auth/me');
    document.getElementById('pFullName').value = user.full_name || '';
    document.getElementById('pUsername').value = user.username  || '';
    if (user.sq1_question) {
      document.getElementById('pSq1Q').value = user.sq1_question;
      document.getElementById('pSq2Q').value = user.sq2_question || '';
    }
  } catch {}
}

async function saveProfile() {
  const fullName = document.getElementById('pFullName').value.trim();
  const errEl    = document.getElementById('profileErr');
  const sucEl    = document.getElementById('profileSuc');
  errEl.textContent = ''; sucEl.textContent = '';

  if (!fullName) { errEl.textContent = 'Full name cannot be empty.'; return; }

  try {
    await apiFetch('/api/auth/profile', {
      method: 'PUT',
      body: JSON.stringify({ full_name: fullName }),
    });
    sucEl.textContent = 'Profile updated successfully.';
    document.getElementById('sidebarName').textContent = fullName;
    document.getElementById('sidebarAvatar').textContent = fullName[0].toUpperCase();
  } catch (err) { errEl.textContent = err.message; }
}

async function changePassword() {
  const old_password = document.getElementById('pOldPw').value;
  const new_password = document.getElementById('pNewPw').value;
  const confirm      = document.getElementById('pConfirmPw').value;
  const errEl        = document.getElementById('pwErr');
  const sucEl        = document.getElementById('pwSuc');
  errEl.textContent  = ''; sucEl.textContent = '';

  try {
    await apiFetch('/api/auth/change-password', {
      method: 'PUT',
      body: JSON.stringify({ old_password, new_password, confirm }),
    });
    sucEl.textContent = 'Password changed successfully.';
    ['pOldPw','pNewPw','pConfirmPw'].forEach(id => document.getElementById(id).value = '');
  } catch (err) { errEl.textContent = err.message; }
}

async function saveSecurityQuestions() {
  const sq1_question = document.getElementById('pSq1Q').value;
  const sq1_answer   = document.getElementById('pSq1A').value.trim();
  const sq2_question = document.getElementById('pSq2Q').value;
  const sq2_answer   = document.getElementById('pSq2A').value.trim();
  const errEl        = document.getElementById('sqErr');
  const sucEl        = document.getElementById('sqSuc');
  errEl.textContent  = ''; sucEl.textContent = '';

  try {
    await apiFetch('/api/auth/security-questions', {
      method: 'PUT',
      body: JSON.stringify({ sq1_question, sq1_answer, sq2_question, sq2_answer }),
    });
    sucEl.textContent = 'Security questions saved successfully.';
  } catch (err) { errEl.textContent = err.message; }
}

// ── PDF Report ────────────────────────────────────────
async function generatePDF() {
  toast('Generating PDF report…');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = 210, margin = 16;
  let y = 20;

  // Header bar
  doc.setFillColor(13, 17, 23);
  doc.rect(0, 0, pageW, 42, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(22);
  doc.text('FinDash PFAS', margin, 18);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.setTextColor(160, 170, 200);
  doc.text('Personal Finance Analysis & Smart Advisory Report', margin, 27);
  doc.text(`Generated: ${new Date().toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' })}`, margin, 35);
  y = 52;

  const section = title => {
    doc.setFillColor(30, 37, 54);
    doc.rect(margin, y, pageW - margin * 2, 9, 'F');
    doc.setTextColor(129, 140, 248); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text(title.toUpperCase(), margin + 4, y + 6);
    y += 13;
    doc.setTextColor(50, 50, 50); doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  };

  const row = (label, value, color) => {
    doc.setTextColor(80, 80, 80); doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text(label, margin + 4, y);
    doc.setFont('helvetica', 'bold');
    if (color) doc.setTextColor(...color); else doc.setTextColor(20, 20, 20);
    doc.text(value, pageW - margin - 4, y, { align: 'right' });
    doc.setTextColor(220, 220, 220);
    doc.line(margin, y + 2, pageW - margin, y + 2);
    y += 9;
  };

  const a = analyticsData;

  section('Financial Summary');
  row('Total Income',       fmt(a.total_income),  [16,185,129]);
  row('Total Expenses',     fmt(a.total_expense), [239,68,68]);
  row('Net Balance',        fmt(a.balance),       a.balance >= 0 ? [16,185,129] : [239,68,68]);
  row('Savings Rate',       (a.savings_rate || 0).toFixed(1) + '%');
  row('Total Transactions', String(a.total_transactions || 0));
  row('Daily Income Today', fmt(a.daily_income));
  row('Daily Expense Today',fmt(a.daily_expense));
  y += 4;

  section('FinHealth Score');
  const score = a.health_score || 0;
  const grade = score < 40 ? 'Poor' : score < 70 ? 'Fair' : 'Excellent';
  doc.setFont('helvetica', 'bold'); doc.setFontSize(26);
  doc.setTextColor(score < 40 ? 239 : score < 70 ? 245 : 16,
                   score < 40 ? 68  : score < 70 ? 158 : 185,
                   score < 40 ? 68  : score < 70 ? 11  : 129);
  doc.text(`${score} / 100  —  ${grade}`, margin + 4, y + 7);
  y += 18; doc.setFontSize(10);

  section('Spending Pattern Analysis');
  row('Avg Weekday Spend/day', fmt(a.weekday_avg));
  row('Avg Weekend Spend/day', fmt(a.weekend_avg));
  row('Weekend Ratio',         (a.weekend_ratio || 1).toFixed(2) + '×');
  y += 4;

  section('Category-wise Expense Breakdown');
  const cb = a.category_breakdown || {};
  Object.entries(cb).sort((x, z) => z[1] - x[1]).slice(0, 8)
    .forEach(([cat, amt]) => row(cat, fmt(amt)));
  y += 4;

  if ((a.alerts || []).length) {
    section('Smart Alerts');
    a.alerts.forEach(alert => {
      doc.setTextColor(80, 80, 80); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      const lines = doc.splitTextToSize('• ' + alert.replace(/[⚠📅💡]/g, '').trim(), pageW - margin * 2 - 8);
      doc.text(lines, margin + 4, y);
      y += lines.length * 6;
    });
    y += 4;
  }

  if ((a.recommendations || []).length) {
    section('Personalised Recommendations');
    a.recommendations.forEach(rec => {
      doc.setTextColor(80, 80, 80); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      const lines = doc.splitTextToSize('• ' + rec, pageW - margin * 2 - 8);
      doc.text(lines, margin + 4, y);
      y += lines.length * 6;
    });
  }

  // Footer
  doc.setFillColor(13, 17, 23);
  doc.rect(0, 285, pageW, 12, 'F');
  doc.setTextColor(100, 110, 140); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  doc.text('FinDash PFAS  |  Personal Finance Analysis System  |  Confidential', pageW / 2, 292, { align: 'center' });

  doc.save(`FinDash_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
  toast('PDF report downloaded!', 'success');
}

// ── Init ───────────────────────────────────────────────
loadIdentity();
loadAll();
