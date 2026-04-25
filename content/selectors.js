// Centralized WhatsApp Web DOM selectors.
// When WhatsApp updates their DOM structure, only this file needs updating.

const WA_SELECTORS = {
  // Main chat area
  chatPanel: '#main',
  chatHeader: 'header',
  chatHeaderTitle: 'span[data-testid="conversation-info-header-chat-title"]',
  fallbackHeaderTitle: '#main header span[dir="auto"]',

  // Message list
  messageList: 'div[role="application"]',
  messageListScroller: 'div[data-testid="conversation-panel-messages"]',
  fallbackMessageList: '#main div.copyable-area div[tabindex="0"]',

  // Individual messages
  messageRow: 'div[data-id]',
  messageIn: 'div.message-in',
  messageOut: 'div.message-out',
  messageContainer: 'div[data-testid="msg-container"]',

  // Message content
  messageText: 'span[data-testid="selectable-text"]',
  messageTextInner: 'span[dir]',
  quotedMessage: 'div[data-testid="quoted-message"]',

  // Sender info (group messages only)
  senderName: 'span[data-testid="msg-meta"] span[aria-label]',
  fallbackSenderName: 'div.copyable-text span[dir="auto"]:first-child',
  pushName: 'span[data-testid="author"]',

  // Timestamp
  timestamp: 'div[data-testid="msg-meta"] span',
  fallbackTimestamp: 'span[data-testid="msg-time"]',

  // Media
  imageThumb: 'img[src*="blob:"]',
  imageContainer: 'div[data-testid="image-thumb"]',
  linkPreview: 'a[href]',
  linkPreviewTitle: 'span[data-testid="link-preview-title"]',

  // Chat list sidebar
  chatList: 'div[aria-label="Chat list"]',
  chatListItem: 'div[data-testid="cell-frame-container"]',
  chatListTitle: 'span[data-testid="cell-frame-title"]',

  // Scroll sentinel (top of chat, indicates all history loaded)
  scrollSentinel: 'div[data-testid="intro-md-beta-text"]',
  chatIntro: 'div[data-testid="chat-intro"]',
};

// Helper to query with fallback selectors.
function queryWA(container, primary, fallback) {
  const el = container.querySelector(primary);
  if (el) return el;
  if (fallback) return container.querySelector(fallback);
  return null;
}

// Helper to query all matching elements.
function queryAllWA(container, selector) {
  return Array.from(container.querySelectorAll(selector));
}
