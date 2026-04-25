// Popup logic: status display, monitoring toggle, scrape controls, recent matches.

document.addEventListener('DOMContentLoaded', () => {
  refreshStatus();
  loadRecentMatches();

  document.getElementById('btnToggleMonitor').addEventListener('click', toggleMonitoring);
  document.getElementById('btnStartScrape').addEventListener('click', startScrape);
  document.getElementById('btnStopScrape').addEventListener('click', stopScrape);
  document.getElementById('btnOpenDashboard').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/index.html') });
  });

  // Listen for progress updates from the content script.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SCRAPE_PROGRESS') {
      updateScrapeProgress(msg);
    }
  });

  // Refresh status periodically while popup is open.
  setInterval(refreshStatus, 3000);
});

async function refreshStatus() {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    if (tabs.length === 0) {
      setStatus('No WhatsApp Web tab found', 'idle');
      setGroup('-');
      setProcessed(0);
      return;
    }

    const response = await chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_STATUS' });
    if (!response) return;

    if (response.isMonitoring) {
      setStatus('Monitoring', 'monitoring');
      document.getElementById('btnToggleMonitor').textContent = 'Stop Monitoring';
    } else {
      setStatus('Idle', 'idle');
      document.getElementById('btnToggleMonitor').textContent = 'Start Monitoring';
    }

    setGroup(response.currentGroup || '-');
    setProcessed(response.processedCount || 0);

    // Check if scraping is active.
    const scrapeStatus = await chrome.tabs.sendMessage(tabs[0].id, { type: 'SCRAPE_STATUS' });
    if (scrapeStatus?.isScrolling) {
      setStatus('Scraping', 'scraping');
      document.getElementById('scrapeProgress').style.display = '';
      document.getElementById('scrapeCount').textContent = `${scrapeStatus.stats.messagesFound} messages`;
    }
  } catch (err) {
    // Content script not ready or tab closed.
    setStatus('Reload WhatsApp Tab', 'error');
  }
}

async function toggleMonitoring() {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    if (tabs.length === 0) return;

    const status = await chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_STATUS' });
    if (status?.isMonitoring) {
      await chrome.tabs.sendMessage(tabs[0].id, { type: 'STOP_MONITORING' });
    } else {
      await chrome.tabs.sendMessage(tabs[0].id, { type: 'START_MONITORING' });
    }

    refreshStatus();
  } catch (err) {
    console.warn('[Popup] Toggle monitoring failed:', err);
  }
}

async function startScrape() {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    if (tabs.length === 0) return;

    await chrome.tabs.sendMessage(tabs[0].id, { type: 'START_SCRAPE' });
    document.getElementById('scrapeProgress').style.display = '';
    setStatus('Scraping', 'scraping');
  } catch (err) {
    console.warn('[Popup] Start scrape failed:', err);
  }
}

async function stopScrape() {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    if (tabs.length === 0) return;

    await chrome.tabs.sendMessage(tabs[0].id, { type: 'STOP_SCRAPE' });
    document.getElementById('scrapeProgress').style.display = 'none';
    refreshStatus();
  } catch (err) {
    console.warn('[Popup] Stop scrape failed:', err);
  }
}

function updateScrapeProgress(msg) {
  const progress = document.getElementById('scrapeProgress');
  const fill = document.getElementById('progressFill');
  const count = document.getElementById('scrapeCount');

  if (msg.status === 'complete' || msg.status === 'aborted') {
    progress.style.display = 'none';
    refreshStatus();
    loadRecentMatches();
    return;
  }

  progress.style.display = '';
  const found = msg.stats?.messagesFound || 0;
  const saved = msg.stats?.messagesSaved || 0;
  count.textContent = `${found} Found | ${saved} Saved`;

  // Indeterminate progress (we don't know total).
  const scrollCount = msg.stats?.scrollCount || 0;
  const pct = Math.min(95, scrollCount * 0.5);
  fill.style.width = `${pct}%`;
}

async function loadRecentMatches() {
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'GET_MESSAGES',
      filters: { classifiedOnly: true, limit: 3, offset: 0 },
    });

    const list = document.getElementById('recentList');
    const messages = result?.messages?.filter(m => m.category !== 'NOISE') || [];

    if (messages.length === 0) {
      list.innerHTML = '<div class="recent-empty">No recent matches</div>';
      return;
    }

    list.innerHTML = messages.map(msg => {
      const text = msg.text?.length > 60 ? msg.text.substring(0, 60) + '...' : msg.text || '';
      return `
        <div class="recent-item">
          <div class="recent-item-header">
            <span class="recent-sender">${escapeHtml(msg.sender)}</span>
            <span class="recent-category">${msg.category || 'N/A'}</span>
          </div>
          <div class="recent-text">${escapeHtml(text)}</div>
        </div>
      `;
    }).join('');
  } catch {
    // Background not ready.
  }
}

function setStatus(text, type) {
  const badge = document.getElementById('statusBadge');
  badge.textContent = text;
  badge.className = `status-badge ${type}`;
}

function setGroup(name) {
  document.getElementById('currentGroup').textContent = name;
}

function setProcessed(count) {
  document.getElementById('processedCount').textContent = count;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
