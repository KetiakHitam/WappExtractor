// Auto-scroll logic for historical scraping.
// Scrolls up in the chat to trigger lazy-loading of older messages.
// Uses randomized delays to mimic human behavior.

(function () {
  'use strict';

  let isScrolling = false;
  let scrollAborted = false;
  let scrollStats = {
    messagesFound: 0,
    messagesSaved: 0,
    scrollCount: 0,
    startTime: null,
    batchesSent: 0,
  };

  const SCROLL_CONFIG = {
    minDelay: 1200,
    maxDelay: 2800,
    scrollAmount: 600,
    batchSize: 30,
    maxRetries: 5,
    loadTimeout: 5000,
  };

  // Random delay within range for human-like behavior.
  function randomDelay(min, max) {
    const base = min + Math.random() * (max - min);
    // Occasional longer pause to simulate distraction.
    const pause = Math.random() < 0.1 ? 2000 + Math.random() * 3000 : 0;
    return base + pause;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getScrollContainer() {
    return (
      document.querySelector(WA_SELECTORS.messageListScroller) ||
      document.querySelector(WA_SELECTORS.fallbackMessageList)
    );
  }

  // Check if we've reached the top of chat history.
  function hasReachedTop() {
    const intro = document.querySelector(WA_SELECTORS.chatIntro);
    const sentinel = document.querySelector(WA_SELECTORS.scrollSentinel);
    return !!(intro || sentinel);
  }

  // Scroll the message container up by a variable amount.
  function scrollUp(container) {
    const variation = (Math.random() - 0.5) * 200;
    const amount = SCROLL_CONFIG.scrollAmount + variation;
    container.scrollTop = Math.max(0, container.scrollTop - amount);
  }

  // Wait for new messages to load after scrolling up.
  async function waitForLoad(container, previousHeight) {
    const start = Date.now();
    let retries = 0;

    while (Date.now() - start < SCROLL_CONFIG.loadTimeout) {
      await sleep(300);
      if (container.scrollHeight !== previousHeight) {
        return true;
      }
      retries++;
      if (retries > SCROLL_CONFIG.maxRetries) break;
    }

    return false;
  }

  // Main historical scraping loop.
  async function startHistoricalScrape() {
    if (isScrolling) {
      console.warn('[WappExtractor] Scrape already in progress.');
      return;
    }

    const container = getScrollContainer();
    if (!container) {
      console.error('[WappExtractor] Scroll container not found.');
      reportProgress('error', 'Scroll container not found.');
      return;
    }

    isScrolling = true;
    scrollAborted = false;
    scrollStats = {
      messagesFound: 0,
      messagesSaved: 0,
      scrollCount: 0,
      startTime: Date.now(),
      batchesSent: 0,
    };

    console.log('[WappExtractor] Historical scrape started.');
    reportProgress('started', null);

    let consecutiveNoLoad = 0;
    let messageBatch = [];

    while (!scrollAborted) {
      // Check if we reached the top.
      if (hasReachedTop()) {
        console.log('[WappExtractor] Reached top of chat history.');
        break;
      }

      const previousHeight = container.scrollHeight;
      scrollUp(container);
      scrollStats.scrollCount++;

      const loaded = await waitForLoad(container, previousHeight);

      if (!loaded) {
        consecutiveNoLoad++;
        if (consecutiveNoLoad >= 3) {
          console.log('[WappExtractor] No new content after 3 attempts. Likely at top.');
          break;
        }
      } else {
        consecutiveNoLoad = 0;
      }

      // Extract currently visible messages directly.
      const msgs = window.WappExtractor ? window.WappExtractor.extractAllVisibleMessages() : [];
      if (msgs.length > 0) {
        scrollStats.messagesFound += msgs.length;
        messageBatch.push(...msgs);
      }

      // Send batch to background for storage when large enough.
      if (messageBatch.length >= SCROLL_CONFIG.batchSize) {
        const resp = await chrome.runtime.sendMessage({
          type: 'BATCH_MESSAGES',
          messages: messageBatch,
        });
        if (resp?.ok) scrollStats.messagesSaved += (resp.count || 0);
        scrollStats.batchesSent++;
        messageBatch = [];
      }

      // Report progress periodically.
      if (scrollStats.scrollCount % 10 === 0) {
        reportProgress('progress', null);
      }

      // Randomized delay before next scroll.
      const delay = randomDelay(SCROLL_CONFIG.minDelay, SCROLL_CONFIG.maxDelay);
      await sleep(delay);
    }

    // Send remaining messages.
    if (messageBatch.length > 0) {
      const resp = await chrome.runtime.sendMessage({
        type: 'BATCH_MESSAGES',
        messages: messageBatch,
      });
      if (resp?.ok) scrollStats.messagesSaved += (resp.count || 0);
      scrollStats.batchesSent++;
    }

    isScrolling = false;
    const elapsed = ((Date.now() - scrollStats.startTime) / 1000).toFixed(1);

    console.log(
      `[WappExtractor] Scrape complete. ${scrollStats.messagesFound} messages in ${elapsed}s.`
    );
    reportProgress('complete', null);
  }

  function stopHistoricalScrape() {
    scrollAborted = true;
    console.log('[WappExtractor] Scrape abort requested.');
    reportProgress('aborted', null);
  }

  function reportProgress(status, error) {
    chrome.runtime.sendMessage({
      type: 'SCRAPE_PROGRESS',
      status,
      stats: { ...scrollStats },
      error,
    });
  }

  // Listen for scrape commands.
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.type) {
      case 'START_SCRAPE':
        startHistoricalScrape();
        sendResponse({ ok: true });
        return true;

      case 'STOP_SCRAPE':
        stopHistoricalScrape();
        sendResponse({ ok: true });
        return true;

      case 'SCRAPE_STATUS':
        sendResponse({
          isScrolling,
          stats: { ...scrollStats },
        });
        return true;

      default:
        return false;
    }
  });
})();
