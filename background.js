// Service worker: routes messages between content scripts, dashboard, and popup.
// Handles Gemini API calls, Discord webhook dispatch, and data persistence.

import { MessageDB } from './storage/db.js';
import { SettingsManager } from './storage/settings.js';
import { FilterPipeline } from './filters/pipeline.js';
import { sendDiscordAlert } from './discord/webhook.js';

const db = new MessageDB();
const settings = new SettingsManager();
let pipeline = null;

// Categories that trigger Discord alerts.
const ALERT_CATEGORIES = [
  'UMAMUSUME_MERCH',
  'STORE_MENTION',
  'LOCATION_TIP',
  'FIGURE_ANNOUNCEMENT',
];

// -- Initialization --

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[WappExtractor] Extension installed.');
  await db.init();
  await settings.init();
  pipeline = new FilterPipeline(settings);
});

chrome.runtime.onStartup.addListener(async () => {
  await db.init();
  await settings.init();
  pipeline = new FilterPipeline(settings);
});

// Lazy init if needed (service worker can restart).
async function ensureInit() {
  if (!pipeline) {
    await db.init();
    await settings.init();
    pipeline = new FilterPipeline(settings);
  }
}

// -- Message Handling --

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request, sender).then(sendResponse).catch(err => {
    console.error('[WappExtractor] Message handler error:', err);
    sendResponse({ error: err.message });
  });
  return true; // Keep channel open for async response.
});

async function handleMessage(request, sender) {
  await ensureInit();

  switch (request.type) {
    case 'GET_SETTINGS':
      return await settings.getAll();

    case 'SAVE_SETTINGS':
      await settings.save(request.settings);
      pipeline = new FilterPipeline(settings);
      return { ok: true };

    case 'NEW_MESSAGE':
      return await processMessage(request.message);

    case 'BATCH_MESSAGES':
      return await processBatch(request.messages);

    case 'GROUP_CHANGED':
      return { ok: true };

    case 'SCRAPE_PROGRESS':
      // Forward to popup if open.
      broadcastToPopup(request);
      return { ok: true };

    case 'GET_MESSAGES':
      return await db.getMessages(request.filters);

    case 'GET_STATS':
      return await db.getStats();

    case 'UPDATE_MESSAGE_CATEGORY':
      await db.updateCategory(request.messageId, request.category);
      return { ok: true };

    case 'EXPORT_DATA':
      return await db.exportAll();

    case 'TEST_WEBHOOK':
      return await testWebhook(request.webhookUrl);

    case 'TEST_GEMINI':
      return await testGemini(request.apiKey);

    case 'CLASSIFY_MESSAGE':
      return await classifySingle(request.messageId);

    case 'RECLASSIFY_PENDING':
      return await reclassifyPending();

    case 'GET_SUGGESTIONS':
      return await db.getSuggestions();

    case 'APPROVE_SUGGESTION': {
      const { id, term, category } = request;
      // 1. Add to keyword config.
      const config = await settings.getAll(); // Wait, I should use keywords.js instead?
      // No, background.js doesn't import loadKeywords/saveKeywords from filters/keywords.js directly.
      // Wait, let's look at keywords.js.
      return await approveSuggestion(id, term, category);
    }

    case 'DISMISS_SUGGESTION':
      await db.updateSuggestionStatus(request.id, 'dismissed');
      return { ok: true };

    default:
      return { error: `Unknown message type: ${request.type}` };
  }
}

async function approveSuggestion(id, term, category) {
  // Use the existing keywords logic
  const { loadKeywords, saveKeywords } = await import('./filters/keywords.js');
  const config = await loadKeywords();
  const catKey = category.toLowerCase();

  if (!config[catKey]) config[catKey] = { confidence: 'medium', terms: [] };
  if (!config[catKey].terms.includes(term)) {
    config[catKey].terms.push(term);
    await saveKeywords(config);
  }

  await db.updateSuggestionStatus(id, 'approved');
  return { ok: true };
}

// Process a single new message through the pipeline.
async function processMessage(message) {
  const stored = await db.addMessage(message);

  const config = await settings.getAll();
  if (!config.geminiApiKey) {
    // No API key configured. Run keyword/URL filtering only.
    const result = pipeline.preClassify(message);
    await db.updateClassification(stored.id, result);
    if (shouldAlert(result) && config.discordWebhookUrl) {
      await sendDiscordAlert(config.discordWebhookUrl, message, result);
    }
    return { ok: true, id: stored.id, classification: result };
  }

  const result = await pipeline.classify(message);
  await db.updateClassification(stored.id, result);

  if (shouldAlert(result) && config.discordWebhookUrl) {
    await sendDiscordAlert(config.discordWebhookUrl, message, result);
  }

  if (result.suggestedKeywords && result.suggestedKeywords.length > 0) {
    // Add context to each suggestion for the user to see where it came from.
    const suggestionsWithContext = result.suggestedKeywords.map(s => ({
      ...s,
      context: message.text
    }));
    await db.addSuggestions(suggestionsWithContext);
  }

  return { ok: true, id: stored.id, classification: result };
}

// Process a batch of messages (from historical scraping).
async function processBatch(messages) {
  if (!messages || messages.length === 0) return { ok: true, processed: 0 };

  let processed = 0;
  for (const msg of messages) {
    try {
      await db.addMessage(msg);
      processed++;
    } catch (err) {
      // Duplicate or storage error. Skip and continue.
      console.warn('[WappExtractor] Batch item skipped:', err.message);
    }
  }

  // Batch classification runs separately to avoid rate limiting.
  // Messages are stored as unclassified, and classified in a background queue.
  queueBatchClassification();

  return { ok: true, count: processed };
}

// Background classification queue for batch-scraped messages.
let classificationRunning = false;

async function queueBatchClassification() {
  if (classificationRunning) return;
  classificationRunning = true;
  broadcastStatus('Classifying...');

  try {
    const config = await settings.getAll();
    const unclassified = await db.getUnclassified(20);

    for (const msg of unclassified) {
      const result = config.geminiApiKey
        ? await pipeline.classify(msg)
        : pipeline.preClassify(msg);

      await db.updateClassification(msg.id, result);

      if (shouldAlert(result) && config.discordWebhookUrl) {
        await sendDiscordAlert(config.discordWebhookUrl, msg, result);
      }

      // Delay between API calls to respect rate limits.
      if (config.geminiApiKey) {
        await new Promise(r => setTimeout(r, 4500));
      }
    }

    // Check if more unclassified messages remain.
    const remaining = await db.getUnclassifiedCount();
    if (remaining > 0) {
      setTimeout(queueBatchClassification, 2000);
    }
  } catch (err) {
    console.error('[WappExtractor] Batch classification error:', err);
  } finally {
    classificationRunning = false;
    broadcastStatus('Idle');
  }
}

function broadcastStatus(status) {
  broadcastToPopup({ type: 'STATUS_UPDATE', status });
}

function shouldAlert(classification) {
  if (!classification) return false;
  return (
    ALERT_CATEGORIES.includes(classification.category) &&
    classification.relevance >= 3
  );
}

// Classify a single stored message by ID.
async function classifySingle(messageId) {
  const msg = await db.getMessage(messageId);
  if (!msg) return { error: 'Message not found.' };

  const config = await settings.getAll();
  const result = config.geminiApiKey
    ? await pipeline.classify(msg)
    : pipeline.preClassify(msg);

  await db.updateClassification(messageId, result);
  return { ok: true, classification: result };
}

// Reclassify all pending/unclassified messages.
async function reclassifyPending() {
  queueBatchClassification();
  return { ok: true };
}

// Forward messages to popup windows.
function broadcastToPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Popup not open. Ignore.
  });
}

// -- Testing --

async function testWebhook(url) {
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [
          {
            title: 'WappExtractor Test',
            description: 'Webhook connection successful.',
            color: 0x7c3aed,
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });
    return { ok: resp.ok, status: resp.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function testGemini(apiKey) {
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: 'Reply with exactly: OK' }],
            },
          ],
        }),
      }
    );
    const data = await resp.json();

    if (!resp.ok) {
      const errMsg = data?.error?.message || `HTTP ${resp.status}`;
      return { ok: false, error: errMsg };
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return { ok: true, response: text.trim() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
