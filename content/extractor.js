// Content script: extracts messages from WhatsApp Web DOM
// and monitors for new messages via MutationObserver.

(function () {
  'use strict';

  const EXTENSION_ID = 'wappextractor';
  let currentGroupName = null;
  let targetGroups = [];
  let isMonitoring = false;
  let observer = null;
  let processedMessageIds = new Set();

  // -- Initialization --

  async function init() {
    console.log('[WappExtractor] Content script loaded.');

    const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    if (settings && settings.targetGroups) {
      targetGroups = settings.targetGroups.map(g => g.toLowerCase().trim());
    }

    waitForChatPanel();
    observeChatSwitch();
  }

  // Wait for the main chat panel to load before doing anything.
  function waitForChatPanel() {
    const check = setInterval(() => {
      const panel = document.querySelector(WA_SELECTORS.chatPanel);
      if (panel) {
        clearInterval(check);
        onChatPanelReady(panel);
      }
    }, 1000);
  }

  function onChatPanelReady(panel) {
    detectCurrentGroup(panel);
  }

  // -- Group Detection --

  function detectCurrentGroup(panel) {
    const header = panel ? panel.querySelector(WA_SELECTORS.chatHeader) : null;
    if (!header) return null;

    const titleEl = queryWA(
      header,
      WA_SELECTORS.chatHeaderTitle,
      WA_SELECTORS.fallbackHeaderTitle
    );

    const groupName = titleEl ? titleEl.textContent.trim() : null;

    if (groupName !== currentGroupName) {
      currentGroupName = groupName;
      const isTarget = isTargetGroup(groupName);
      console.log(
        `[WappExtractor] Chat switched: "${groupName}" | Target: ${isTarget}`
      );

      chrome.runtime.sendMessage({
        type: 'GROUP_CHANGED',
        groupName: groupName,
        isTarget: isTarget,
      });

      if (isTarget) {
        startMonitoring();
      } else {
        stopMonitoring();
      }
    }

    return groupName;
  }

  function isTargetGroup(name) {
    if (!name || targetGroups.length === 0) return false;
    const lower = name.toLowerCase().trim();
    return targetGroups.some(
      target => lower.includes(target) || target.includes(lower)
    );
  }

  // Watch for chat switches by observing header changes.
  function observeChatSwitch() {
    const mainPanel = document.querySelector(WA_SELECTORS.chatPanel);
    if (!mainPanel) {
      setTimeout(observeChatSwitch, 2000);
      return;
    }

    const headerObserver = new MutationObserver(() => {
      detectCurrentGroup(mainPanel);
    });

    const header = mainPanel.querySelector(WA_SELECTORS.chatHeader);
    if (header) {
      headerObserver.observe(header, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
  }

  // -- Message Monitoring --

  function startMonitoring() {
    if (isMonitoring) return;
    isMonitoring = true;

    const messageContainer = getMessageContainer();
    if (!messageContainer) {
      console.warn('[WappExtractor] Message container not found.');
      isMonitoring = false;
      return;
    }

    observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          processNewNode(node);
        }
      }
    });

    observer.observe(messageContainer, {
      childList: true,
      subtree: true,
    });

    console.log(`[WappExtractor] Monitoring started for "${currentGroupName}"`);
  }

  function stopMonitoring() {
    if (!isMonitoring) return;
    isMonitoring = false;

    if (observer) {
      observer.disconnect();
      observer = null;
    }

    console.log('[WappExtractor] Monitoring stopped.');
  }

  function getMessageContainer() {
    return (
      document.querySelector(WA_SELECTORS.messageListScroller) ||
      document.querySelector(WA_SELECTORS.messageList) ||
      document.querySelector(WA_SELECTORS.fallbackMessageList)
    );
  }

  // -- Message Extraction --

  function processNewNode(node) {
    // Check if the node itself is a message row.
    const rows = [];
    if (node.matches && node.matches(WA_SELECTORS.messageRow)) {
      rows.push(node);
    }
    // Also check children for message rows.
    rows.push(...queryAllWA(node, WA_SELECTORS.messageRow));

    for (const row of rows) {
      const message = extractMessage(row);
      if (message && !processedMessageIds.has(message.id)) {
        processedMessageIds.add(message.id);
        sendMessage(message);
      }
    }
  }

  function extractMessage(rowEl) {
    // Determine message direction (in = from others, out = from user).
    const msgIn = rowEl.querySelector(WA_SELECTORS.messageIn);
    const msgOut = rowEl.querySelector(WA_SELECTORS.messageOut);
    const msgEl = msgIn || msgOut;
    if (!msgEl) return null;

    // Extract text content.
    const textEl = queryWA(msgEl, WA_SELECTORS.messageText, null);
    const text = textEl ? textEl.textContent.trim() : '';

    // Skip empty messages (stickers, deleted messages, etc).
    if (!text) return null;

    // Sender name (only relevant for incoming messages in groups).
    let sender = 'You';
    if (msgIn) {
      const senderEl =
        queryWA(msgEl, WA_SELECTORS.pushName, null) ||
        queryWA(msgEl, WA_SELECTORS.senderName, WA_SELECTORS.fallbackSenderName);
      sender = senderEl ? senderEl.textContent.trim() : 'Unknown';
    }

    // Timestamp.
    const timeEl = queryWA(
      msgEl,
      WA_SELECTORS.timestamp,
      WA_SELECTORS.fallbackTimestamp
    );
    const timestamp = timeEl ? timeEl.textContent.trim() : '';

    // Extract URLs from the message text.
    const links = extractLinks(text, msgEl);

    // Extract image thumbnails.
    const imageUrls = extractImages(msgEl);

    // Build a unique-ish ID from content to avoid duplicates.
    const id = generateMessageId(sender, timestamp, text);

    return {
      id,
      groupName: currentGroupName,
      sender,
      timestamp,
      text,
      links,
      imageUrls,
      direction: msgIn ? 'in' : 'out',
      extractedAt: Date.now(),
    };
  }

  function extractLinks(text, msgEl) {
    const links = [];

    // From message text via regex.
    const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
    const textUrls = text.match(urlRegex);
    if (textUrls) links.push(...textUrls);

    // From anchor elements in the DOM.
    const anchors = queryAllWA(msgEl, WA_SELECTORS.linkPreview);
    for (const a of anchors) {
      const href = a.getAttribute('href');
      if (href && href.startsWith('http') && !links.includes(href)) {
        links.push(href);
      }
    }

    return links;
  }

  function extractImages(msgEl) {
    const images = [];
    const imgEls = queryAllWA(msgEl, WA_SELECTORS.imageThumb);
    for (const img of imgEls) {
      const src = img.getAttribute('src');
      if (src) images.push(src);
    }
    return images;
  }

  function generateMessageId(sender, timestamp, text) {
    const raw = `${sender}|${timestamp}|${text.substring(0, 50)}`;
    // Simple hash to create a short ID.
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const char = raw.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return `msg_${Math.abs(hash).toString(36)}`;
  }

  // -- Bulk Extraction (for historical scraping) --

  function extractAllVisibleMessages() {
    const container = getMessageContainer();
    if (!container) return [];

    const rows = queryAllWA(container, WA_SELECTORS.messageRow);
    const messages = [];

    for (const row of rows) {
      const msg = extractMessage(row);
      if (msg && !processedMessageIds.has(msg.id)) {
        processedMessageIds.add(msg.id);
        messages.push(msg);
      }
    }

    return messages;
  }

  // -- Communication with Background --

  function sendMessage(message) {
    chrome.runtime.sendMessage({
      type: 'NEW_MESSAGE',
      message: message,
    });
  }

  // Listen for commands from the popup or background.
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.type) {
      case 'GET_STATUS':
        sendResponse({
          isMonitoring,
          currentGroup: currentGroupName,
          isTarget: isTargetGroup(currentGroupName),
          processedCount: processedMessageIds.size,
        });
        return true;

      case 'EXTRACT_VISIBLE':
        const messages = extractAllVisibleMessages();
        sendResponse({ messages, count: messages.length });
        return true;

      case 'UPDATE_TARGET_GROUPS':
        targetGroups = (request.groups || []).map(g => g.toLowerCase().trim());
        // Re-evaluate current group.
        const panel = document.querySelector(WA_SELECTORS.chatPanel);
        if (panel) detectCurrentGroup(panel);
        sendResponse({ ok: true });
        return true;

      case 'START_MONITORING':
        if (isTargetGroup(currentGroupName)) {
          startMonitoring();
          sendResponse({ ok: true });
        } else {
          sendResponse({ ok: false, reason: 'Not in a target group.' });
        }
        return true;

      case 'STOP_MONITORING':
        stopMonitoring();
        sendResponse({ ok: true });
        return true;

      default:
        return false;
    }
  });

  // -- Boot --
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
