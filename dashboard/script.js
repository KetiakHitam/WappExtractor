// Dashboard logic: navigation, message display, keyword management,
// settings, stats, and modal interactions.

// -- State --
let currentSection = 'messages';
let currentPage = 0;
const PAGE_SIZE = 50;
let currentFilters = {};
let selectedMessageId = null;

const CATEGORY_LABELS = {
  UMAMUSUME_MERCH: 'Umamusume Merch',
  STORE_MENTION: 'Store Mention',
  LOCATION_TIP: 'Location Tip',
  FIGURE_SALE: 'Figure Sale',
  FIGURE_ANNOUNCEMENT: 'Figure Announcement',
  NOISE: 'Noise',
};

// -- Initialization --

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initFilters();
  initSettings();
  initModal();
  loadMessages();
  loadStats();
  loadSettings();
  loadKeywords();
  loadSuggestions();

  // Listen for real-time status updates from background.
  chrome.runtime.onMessage.addListener((request) => {
    if (request.type === 'STATUS_UPDATE') {
      updateStatusUI(request.status);
      if (request.status === 'Idle') {
        loadMessages();
        loadStats();
        loadSuggestions();
      }
    }
  });
 
  // Refresh data periodically.
  setInterval(() => {
    if (currentSection === 'messages') loadMessages();
    if (currentSection === 'stats') loadStats();
    if (currentSection === 'suggestions') loadSuggestions();
  }, 10000);
});

// -- Navigation --

function initNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      const section = item.dataset.section;
      switchSection(section);
    });
  });
}

function switchSection(section) {
  currentSection = section;

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`.nav-item[data-section="${section}"]`)?.classList.add('active');

  document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
  document.getElementById(`section-${section}`)?.classList.add('active');

  document.getElementById('pageTitle').textContent =
    section.charAt(0).toUpperCase() + section.slice(1);

  if (section === 'messages') loadMessages();
  if (section === 'stats') loadStats();
  if (section === 'keywords') loadKeywords();
  if (section === 'suggestions') loadSuggestions();
  if (section === 'settings') loadSettings();
}

// -- Messages --

function initFilters() {
  const searchInput = document.getElementById('searchInput');
  let searchTimeout;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      currentPage = 0;
      loadMessages();
    }, 300);
  });

  ['filterGroup', 'filterCategory', 'filterRelevance'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      currentPage = 0;
      loadMessages();
    });
  });

  document.getElementById('btnPrev').addEventListener('click', () => {
    if (currentPage > 0) { currentPage--; loadMessages(); }
  });
  document.getElementById('btnNext').addEventListener('click', () => {
    currentPage++;
    loadMessages();
  });
  document.getElementById('btnReclassify').addEventListener('click', async () => {
    await sendMsg({ type: 'RECLASSIFY_PENDING' });
    showToast('Reclassification started.', 'info');
  });
}

async function loadMessages() {
  const filters = {
    search: document.getElementById('searchInput').value,
    groupName: document.getElementById('filterGroup').value,
    category: document.getElementById('filterCategory').value,
    minRelevance: parseInt(document.getElementById('filterRelevance').value) || 0,
    classifiedOnly: false,
    limit: PAGE_SIZE,
    offset: currentPage * PAGE_SIZE,
  };

  const result = await sendMsg({ type: 'GET_MESSAGES', filters });
  if (!result || result.error) return;

  const { messages } = result;
  renderMessages(messages);
  updateTopStats();

  document.getElementById('btnPrev').disabled = currentPage === 0;
  document.getElementById('btnNext').disabled = messages.length < PAGE_SIZE;
  document.getElementById('pageInfo').textContent = `Page ${currentPage + 1}`;
}

function renderMessages(messages) {
  const tbody = document.getElementById('messagesBody');
  const emptyState = document.getElementById('emptyState');

  if (!messages || messages.length === 0) {
    tbody.innerHTML = '';
    emptyState.classList.add('visible');
    return;
  }

  emptyState.classList.remove('visible');

  tbody.innerHTML = messages.map(msg => {
    const category = msg.userOverride || msg.category || 'pending';
    const label = CATEGORY_LABELS[category] || (msg.classified ? category : 'Pending');
    const relevance = msg.relevance || 0;

    const dots = Array.from({ length: 5 }, (_, i) => {
      const filled = i < relevance;
      const high = relevance >= 4;
      return `<span class="relevance-dot${filled ? ' filled' : ''}${filled && high ? ' high' : ''}"></span>`;
    }).join('');

    const truncatedText = msg.text?.length > 80
      ? msg.text.substring(0, 80) + '...'
      : msg.text || '';

    return `
      <tr data-id="${msg.id}">
        <td class="msg-sender">${escapeHtml(msg.sender)}</td>
        <td class="msg-text" title="${escapeHtml(msg.text)}">${escapeHtml(truncatedText)}</td>
        <td class="msg-group">${escapeHtml(msg.groupName)}</td>
        <td><span class="category-badge ${category}">${label}</span></td>
        <td><div class="relevance-dots">${dots}</div></td>
        <td><button class="btn btn-ghost btn-view-msg" data-id="${msg.id}">View</button></td>
      </tr>
    `;
  }).join('');

  // Attach event listeners for View buttons (CSP fix)
  tbody.querySelectorAll('.btn-view-msg').forEach(btn => {
    btn.addEventListener('click', e => {
      const id = e.target.dataset.id;
      if (id) openMessageModal(id);
    });
  });
}

async function updateTopStats() {
  const stats = await sendMsg({ type: 'GET_STATS' });
  if (!stats) return;

  setText('totalMessages', 'stat-value', stats.total);
  setText('classifiedCount', 'stat-value', stats.classified);

  const matchCount = Object.entries(stats.byCategory || {})
    .filter(([cat]) => cat !== 'NOISE')
    .reduce((sum, [, count]) => sum + count, 0);
  setText('matchCount', 'stat-value', matchCount);

  const badge = document.getElementById('unclassifiedBadge');
  if (stats.unclassified > 0) {
    badge.textContent = stats.unclassified;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }

  const sugBadge = document.getElementById('suggestionsBadge');
  const suggestions = await sendMsg({ type: 'GET_SUGGESTIONS' });
  const pending = (suggestions || []).filter(s => s.status === 'pending');
  if (pending.length > 0) {
    sugBadge.textContent = pending.length;
    sugBadge.style.display = '';
  } else {
    sugBadge.style.display = 'none';
  }

  // Populate Group Filter dropdown
  const groupSelect = document.getElementById('filterGroup');
  const currentVal = groupSelect.value;
  const groups = Object.keys(stats.byGroup || {}).sort();
  
  groupSelect.innerHTML = '<option value="">All Groups</option>' + 
    groups.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
  groupSelect.value = currentVal;
}

// -- Modal --

function initModal() {
  document.getElementById('btnCloseModal').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.getElementById('btnOverrideCategory').addEventListener('click', overrideCategory);
}

window.openMessageModal = async function (id) {
  const numericId = Number(id);
  selectedMessageId = numericId;
  const msg = await sendMsg({ type: 'GET_MESSAGES', filters: {} });
  const message = msg?.messages?.find(m => m.id === numericId);
  if (!message) return;

  const body = document.getElementById('modalBody');
  const links = (message.links || [])
    .map(l => `<a href="${escapeHtml(l)}" target="_blank">${escapeHtml(l)}</a>`)
    .join('<br>') || 'None';

  const keywords = (message.keywordHits || [])
    .map(k => `<span class="category-badge pending">${escapeHtml(k)}</span>`)
    .join(' ') || 'None';

  body.innerHTML = `
    <div class="detail-row">
      <div class="detail-label">Sender</div>
      <div class="detail-value">${escapeHtml(message.sender)}</div>
    </div>
    <div class="detail-row">
      <div class="detail-label">Group</div>
      <div class="detail-value">${escapeHtml(message.groupName)}</div>
    </div>
    <div class="detail-row">
      <div class="detail-label">Timestamp</div>
      <div class="detail-value">${escapeHtml(message.timestamp)}</div>
    </div>
    <div class="detail-row">
      <div class="detail-label">Full Message</div>
      <div class="detail-value">${escapeHtml(message.text)}</div>
    </div>
    <div class="detail-row">
      <div class="detail-label">Links</div>
      <div class="detail-value">${links}</div>
    </div>
    <div class="detail-row">
      <div class="detail-label">Category</div>
      <div class="detail-value"><span class="category-badge ${message.category || 'pending'}">${CATEGORY_LABELS[message.category] || 'Pending'}</span></div>
    </div>
    <div class="detail-row">
      <div class="detail-label">Relevance</div>
      <div class="detail-value">${message.relevance || 0}/5</div>
    </div>
    <div class="detail-row">
      <div class="detail-label">Summary</div>
      <div class="detail-value">${escapeHtml(message.summary || 'N/A')}</div>
    </div>
    <div class="detail-row">
      <div class="detail-label">Reasoning</div>
      <div class="detail-value">${escapeHtml(message.reasoning || 'N/A')}</div>
    </div>
    <div class="detail-row">
      <div class="detail-label">Keyword Hits</div>
      <div class="detail-value">${keywords}</div>
    </div>
  `;

  if (message.category) {
    document.getElementById('modalCategorySelect').value = message.category;
  }

  document.getElementById('modalOverlay').classList.add('visible');
};

async function overrideCategory() {
  if (!selectedMessageId) return;
  const category = document.getElementById('modalCategorySelect').value;
  await sendMsg({ type: 'UPDATE_MESSAGE_CATEGORY', messageId: selectedMessageId, category });
  showToast(`Category updated to ${CATEGORY_LABELS[category]}.`, 'success');
  closeModal();
  loadMessages();
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('visible');
  selectedMessageId = null;
}

// -- Keywords --

async function loadKeywords() {
  const grid = document.getElementById('keywordsGrid');
  if (!grid) return;

  // Fetch keyword config via background.
  let config;
  try {
    const resp = await fetch(chrome.runtime.getURL('config/keywords.json'));
    config = await resp.json();
  } catch {
    config = {};
  }

  // Check for user-customized keywords in storage.
  const stored = await new Promise(resolve => {
    chrome.storage.local.get('keywords', r => resolve(r.keywords));
  });
  if (stored) config = stored;

  grid.innerHTML = Object.entries(config)
    .filter(([cat]) => cat !== 'exclude')
    .map(([category, data]) => {
      const terms = data.terms || [];
      const tags = terms
        .map(t => `<span class="keyword-tag" data-category="${category}" data-term="${escapeHtml(t)}">${escapeHtml(t)}<span class="remove-tag" data-cat="${category}" data-term="${escapeHtml(t)}">&times;</span></span>`)
        .join('');

      return `
        <div class="keyword-card">
          <div class="keyword-card-header">
            <span class="keyword-card-title">${category}</span>
            <span class="keyword-card-count">${terms.length} terms</span>
          </div>
          <div class="keyword-tags">${tags}</div>
          <div class="keyword-add">
            <input type="text" placeholder="Add keyword..." id="addKeyword-${category}">
            <button class="btn btn-secondary btn-add-keyword" data-cat="${category}">Add</button>
          </div>
        </div>
      `;
    }).join('');

  // Attach event listeners (Chrome CSP forbids inline onclick attributes)
  grid.querySelectorAll('.remove-tag').forEach(btn => {
    btn.addEventListener('click', e => {
      removeKeyword(e.target.dataset.cat, e.target.dataset.term);
    });
  });

  grid.querySelectorAll('.btn-add-keyword').forEach(btn => {
    btn.addEventListener('click', e => {
      addKeyword(e.target.dataset.cat);
    });
  });

  grid.querySelectorAll('input[id^="addKeyword-"]').forEach(input => {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const cat = input.id.replace('addKeyword-', '');
        addKeyword(cat);
      }
    });
  });
}

window.addKeyword = async function (category) {
  const input = document.getElementById(`addKeyword-${category}`);
  const term = input.value.trim().toLowerCase();
  if (!term) return;

  const config = await getKeywordConfig();
  if (!config[category]) config[category] = { confidence: 'medium', terms: [] };
  
  if (!config[category].terms.map(t => t.toLowerCase()).includes(term)) {
    config[category].terms.push(term);
    await saveKeywordConfig(config);
    input.value = '';
    loadKeywords();
    showToast(`Added "${term}" to ${category}.`, 'success');
  } else {
    input.value = '';
    showToast(`"${term}" is already in ${category}.`, 'info');
  }
};

window.removeKeyword = async function (category, term) {
  const config = await getKeywordConfig();
  if (config[category]?.terms) {
    config[category].terms = config[category].terms.filter(t => t !== term);
    await saveKeywordConfig(config);
    loadKeywords();
    showToast(`Removed "${term}" from ${category}.`, 'info');
  }
};

async function getKeywordConfig() {
  return new Promise(resolve => {
    chrome.storage.local.get('keywords', async result => {
      if (result.keywords) {
        resolve(result.keywords);
      } else {
        const resp = await fetch(chrome.runtime.getURL('config/keywords.json'));
        resolve(await resp.json());
      }
    });
  });
}

async function saveKeywordConfig(config) {
  return new Promise(resolve => {
    chrome.storage.local.set({ keywords: config }, resolve);
  });
}

// -- Suggestions --

async function loadSuggestions() {
  const suggestions = await sendMsg({ type: 'GET_SUGGESTIONS' });
  if (!suggestions) return;

  const pending = suggestions.filter(s => s.status === 'pending');
  renderSuggestions(pending);

  const badge = document.getElementById('suggestionsBadge');
  if (pending.length > 0) {
    badge.textContent = pending.length;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

function renderSuggestions(suggestions) {
  const grid = document.getElementById('suggestionsGrid');
  const empty = document.getElementById('suggestionsEmpty');

  if (!suggestions || suggestions.length === 0) {
    grid.innerHTML = '';
    empty.classList.add('visible');
    return;
  }

  empty.classList.remove('visible');
  grid.innerHTML = suggestions.map(s => `
    <div class="suggestion-card">
      <div class="suggestion-header">
        <span class="suggestion-term">${escapeHtml(s.term)}</span>
        <span class="suggestion-cat">${escapeHtml(s.category)}</span>
      </div>
      <div class="suggestion-confidence">
        <span>Confidence</span>
        <div class="confidence-bar">
          <div class="confidence-fill" style="width: ${s.confidence}%"></div>
        </div>
        <span>${s.confidence}%</span>
      </div>
      <div class="suggestion-reason">${escapeHtml(s.reason)}</div>
      <div class="suggestion-context">${escapeHtml(s.context)}</div>
      <div class="suggestion-actions">
        <button class="btn btn-primary btn-approve" data-id="${s.id}" data-term="${s.term}" data-cat="${s.category}">Approve</button>
        <button class="btn btn-ghost btn-dismiss" data-id="${s.id}">Dismiss</button>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('.btn-approve').forEach(btn => {
    btn.onclick = () => approveSuggestion(btn.dataset.id, btn.dataset.term, btn.dataset.cat);
  });
  grid.querySelectorAll('.btn-dismiss').forEach(btn => {
    btn.onclick = () => dismissSuggestion(btn.dataset.id);
  });
}

async function approveSuggestion(id, term, category) {
  const result = await sendMsg({ type: 'APPROVE_SUGGESTION', id: parseInt(id), term, category });
  if (result?.ok) {
    showToast(`Added "${term}" to ${category}`, 'success');
    loadSuggestions();
    loadKeywords();
  }
}

async function dismissSuggestion(id) {
  const result = await sendMsg({ type: 'DISMISS_SUGGESTION', id: parseInt(id) });
  if (result?.ok) {
    loadSuggestions();
  }
}

// -- Settings --

function initSettings() {
  document.getElementById('btnSaveSettings').addEventListener('click', saveSettings);
  document.getElementById('btnResetSettings').addEventListener('click', resetSettings);
  document.getElementById('btnTestWebhook').addEventListener('click', testWebhook);
  document.getElementById('btnTestGemini').addEventListener('click', testGemini);
  document.getElementById('btnExportData').addEventListener('click', exportData);
}

async function loadSettings() {
  const settings = await sendMsg({ type: 'GET_SETTINGS' });
  if (!settings) return;

  document.getElementById('inputGroups').value = (settings.targetGroups || []).join(', ');
  document.getElementById('inputWebhook').value = settings.discordWebhookUrl || '';
  document.getElementById('inputGeminiKey').value = settings.geminiApiKey || '';
  document.getElementById('inputSensitivity').value = settings.filterSensitivity || 'balanced';
  document.getElementById('inputMinRelevance').value = settings.minAlertRelevance || 3;
}

async function saveSettings() {
  const groups = document.getElementById('inputGroups').value
    .split(',').map(g => g.trim()).filter(Boolean);

  const updates = {
    targetGroups: groups,
    discordWebhookUrl: document.getElementById('inputWebhook').value.trim(),
    geminiApiKey: document.getElementById('inputGeminiKey').value.trim(),
    filterSensitivity: document.getElementById('inputSensitivity').value,
    minAlertRelevance: parseInt(document.getElementById('inputMinRelevance').value) || 3,
  };

  await sendMsg({ type: 'SAVE_SETTINGS', settings: updates });
  showToast('Settings saved.', 'success');
}

async function resetSettings() {
  if (!confirm('Reset all settings to defaults?')) return;
  await sendMsg({ type: 'SAVE_SETTINGS', settings: {} });
  loadSettings();
  showToast('Settings reset to defaults.', 'info');
}

async function testWebhook() {
  const url = document.getElementById('inputWebhook').value.trim();
  if (!url) { showToast('Enter a webhook URL first.', 'error'); return; }
  const result = await sendMsg({ type: 'TEST_WEBHOOK', webhookUrl: url });
  showToast(result?.ok ? 'Webhook test sent.' : `Webhook failed: ${result?.error}`, result?.ok ? 'success' : 'error');
}

async function testGemini() {
  const key = document.getElementById('inputGeminiKey').value.trim();
  if (!key) { showToast('Enter an API key first.', 'error'); return; }
  const result = await sendMsg({ type: 'TEST_GEMINI', apiKey: key });
  showToast(result?.ok ? `Gemini connected: ${result.response}` : `Gemini failed: ${result?.error}`, result?.ok ? 'success' : 'error');
}

async function exportData() {
  const data = await sendMsg({ type: 'EXPORT_DATA' });
  if (!data) return;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wappextractor-export-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Data exported.', 'success');
}

// -- Stats --

function updateStatusUI(status) {
  const dot = document.querySelector('#statusIndicator .status-dot');
  const text = document.querySelector('#statusIndicator .status-text');
  if (!dot || !text) return;

  text.textContent = status;
  dot.className = 'status-dot'; // Reset

  if (status.includes('Classifying')) {
    dot.classList.add('scraping');
  } else if (status === 'Idle') {
    dot.classList.add('idle');
  } else {
    dot.classList.add('monitoring');
  }
}

async function loadStats() {
  const stats = await sendMsg({ type: 'GET_STATS' });
  if (!stats) return;

  document.getElementById('statTotal').textContent = stats.total || 0;
  document.getElementById('statClassified').textContent = stats.classified || 0;
  document.getElementById('statUnclassified').textContent = stats.unclassified || 0;

  renderBreakdown('categoryBars', stats.byCategory || {}, stats.total);
  renderBreakdown('groupBars', stats.byGroup || {}, stats.total);
}

function renderBreakdown(containerId, data, total) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:var(--font-size-sm)">No data yet</p>';
    return;
  }

  const maxVal = Math.max(...entries.map(e => e[1]));

  container.innerHTML = entries.map(([label, count]) => {
    const pct = maxVal > 0 ? (count / maxVal) * 100 : 0;
    const displayLabel = CATEGORY_LABELS[label] || label;
    return `
      <div class="breakdown-bar-item">
        <span class="breakdown-label">${escapeHtml(displayLabel)}</span>
        <div class="breakdown-track">
          <div class="breakdown-fill" style="width:${pct}%"></div>
        </div>
        <span class="breakdown-value">${count}</span>
      </div>
    `;
  }).join('');
}

// -- Utilities --

function sendMsg(message) {
  return chrome.runtime.sendMessage(message).catch(err => {
    console.warn('[Dashboard] Message failed:', err);
    return null;
  });
}

function setText(parentId, className, value) {
  const parent = document.getElementById(parentId);
  if (parent) {
    const el = parent.querySelector(`.${className}`);
    if (el) el.textContent = value;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// -- Toast --

let toastContainer = null;

function showToast(message, type = 'info') {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 300ms ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
