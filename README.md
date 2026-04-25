<p align="center">
  <img src="icons/icon128.png" width="100" alt="WappExtractor Logo">
</p>

<h1 align="center">WappExtractor</h1>

<p align="center">
  <strong>A Chrome extension that scrapes, classifies, and alerts on WhatsApp Web group messages using a 3-layer AI filtering pipeline.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-7c3aed?style=flat-square" alt="Manifest V3">
  <img src="https://img.shields.io/badge/Gemini-Flash-a855f7?style=flat-square" alt="Gemini Flash">
  <img src="https://img.shields.io/badge/Storage-IndexedDB-c084fc?style=flat-square" alt="IndexedDB">
  <img src="https://img.shields.io/badge/Alerts-Discord_Webhooks-5865F2?style=flat-square" alt="Discord">
  <img src="https://img.shields.io/badge/License-Private-gray?style=flat-square" alt="Private">
</p>

---

## Overview

WappExtractor is a Manifest V3 Chrome Extension built for monitoring WhatsApp Web group chats in real time. It extracts messages from the DOM, runs them through a multi-layered classification pipeline (keywords, URL analysis, and Google Gemini LLM), stores everything locally in IndexedDB, and pushes high-priority matches to Discord via webhooks.

Originally built for tracking **Umamusume (Uma Musume Pretty Derby)** anime merchandise deals across Malaysian buy/sell/trade groups, it is fully configurable for any niche.

---

## Features

### Real-Time Message Extraction
- Injects a content script into WhatsApp Web and monitors target groups via `MutationObserver`.
- Automatically detects chat switches and starts/stops monitoring based on your configured target group list.
- Extracts sender name, timestamp, message text, embedded links, and image URLs from the DOM.
- Generates a content-hash ID per message to prevent duplicates across sessions.

### Historical Scraping
- Scrolls up through chat history to lazy-load and capture older messages.
- Randomized scroll delays (1.2s - 2.8s) with occasional longer pauses to mimic human behavior.
- Detects end-of-history via WhatsApp's encryption intro bubble.
- Batches messages (30 per batch) and sends them to the background service worker for storage.
- Live progress feedback in the popup: `Found` (seen on page) vs `Saved` (new to database).

### 3-Layer Classification Pipeline

The pipeline processes every message through up to three layers, with each layer adding more intelligence:

#### Layer 1: Keyword Matching (`filters/keywords.js`)
- Case-insensitive matching against a configurable keyword database organized by category.
- Categories: `umamusume`, `merch`, `stores`, `locations`, `announcements`, `exclude`.
- Each category has a confidence level (`high`, `medium`, `low`).
- Multi-category scoring: a single message can hit keywords across multiple categories.
- Exclusion list support to suppress common false positives (greetings, filler words).
- Keywords are editable live from the dashboard and take effect immediately (no extension reload required).

#### Layer 2: URL Detection & Categorization (`filters/url_parser.js`)
- Regex extraction of all URLs from message text, merged with DOM-extracted links.
- Domain-based categorization into: `marketplace` (Shopee, Lazada, Carousell), `jp_store` (AmiAmi, Mandarake, Suruga-ya), `proxy` (Buyee, ZenMarket), `manufacturer` (Good Smile, Kotobukiya), `location` (Google Maps, Waze), `auction` (Yahoo Auctions), `social`, and `image`.
- Convenience arrays for quick access to store links, location links, and marketplace links.
- Scoring contribution: store links (+4), marketplace links (+3), location links (+5), unknown links (+1).

#### Layer 3: Gemini LLM Classification (`filters/llm_classifier.js`)
- Calls Google Gemini (Flash) via REST API for intelligent classification.
- Prompt is tuned for Malay-English mixed text with heavy abbreviations (e.g., "blh" = "boleh", "dpt" = "dapat", "kdai" = "kedai").
- Returns structured JSON: `category`, `relevance` (1-5), `summary`, `reasoning`, and `suggestedKeywords`.
- Rate-limited to 14 requests/minute (staying under the free tier's 15 RPM limit).
- Exponential backoff on 429 errors with up to 3 retries.
- Temperature set to 0.1 for deterministic, consistent classifications.

#### Pipeline Orchestration (`filters/pipeline.js`)
The `FilterPipeline` class ties all three layers together with a strict override hierarchy:

1. If a keyword hits the `umamusume` category, force `UMAMUSUME_MERCH` with relevance 4+.
2. If keywords hit `merch` or `stores`, force `FIGURE_SALE` with relevance 3.
3. If keywords hit `locations`, force `LOCATION_TIP` with relevance 3.
4. If keywords hit `announcements`, force `FIGURE_ANNOUNCEMENT` with relevance 3.
5. Otherwise, trust the LLM classification.

This hierarchy ensures that keyword matches always override LLM hallucinations, providing deterministic results for known terms while still leveraging AI for unknown content.

### AI Suggestion Engine (Active Learning)
- Gemini proactively identifies shorthands, abbreviations, or terms in messages that it believes should be added to the keyword database.
- Suggestions are stored in a dedicated `suggestions` table in IndexedDB with fields: `term`, `category`, `confidence` (1-100), `reason`, `context` (the original message snippet), and `status` (pending/approved/dismissed).
- The dashboard displays pending suggestions as cards with confidence meters, reasoning, and original context.
- One-click "Approve" adds the term directly to the keyword configuration. "Dismiss" removes it from view.
- Works during both live monitoring and historical batch processing.

### Discord Webhook Alerts
- Formats classified messages as rich Discord embeds, color-coded by category:
  - Purple (`#7c3aed`) for Umamusume Merch
  - Amber (`#f59e0b`) for Figure Sales
  - Green (`#10b981`) for Store Mentions
  - Blue (`#3b82f6`) for Location Tips
  - Pink (`#ec4899`) for Figure Announcements
- Embed fields include: category badge, visual relevance bar, group name, sender, summary, links, and keyword hits.
- Rate-limited to 25 messages/minute (buffer under Discord's 30/min limit).
- Alerts trigger when a message's category is in the alert list AND relevance >= 3.

### Dashboard
A full-featured analytics interface built with a Supabase-inspired dark purple theme.

**Messages View:**
- Paginated table of all scraped messages with search and filters (group, category, relevance).
- Click any row to open a detail modal showing: sender, group, timestamp, full message, links, category badge, relevance dots, AI summary, reasoning, and keyword hits.
- Manual category override per message via dropdown.

**Keywords View:**
- Visual editor for all keyword categories.
- Add/remove keywords per category with automatic lowercase normalization.
- Duplicate detection: rejects entries that already exist (case-insensitive).
- Changes persist to `chrome.storage.local` and take effect immediately.

**Suggestions View:**
- Displays AI-discovered keyword suggestions as cards in a responsive grid.
- Each card shows: the suggested term, target category, confidence percentage bar, reasoning, and the original message context.
- Approve or dismiss with one click. Approved terms are instantly added to the keyword configuration.
- Badge counter on the sidebar nav item shows the number of pending suggestions.

**Settings View:**
- Target group names (comma-separated list of WhatsApp group names to monitor).
- Discord webhook URL with a "Test Webhook" button.
- Gemini API key with a "Test Gemini" button.
- Filter sensitivity selector.
- Minimum alert relevance threshold.
- Export all data as JSON.

**Stats View:**
- Overview cards: total messages, classified messages, match count.
- Breakdown bar charts by category and by group.

**Status Indicator:**
- Real-time status in the sidebar footer: `Idle`, `Classifying...` (with pulsing animation), or `Monitoring`.
- Updates automatically as the background service worker processes messages.

### Extension Popup
A compact control panel accessible by clicking the extension icon:
- Current status badge (Idle / Monitoring / Scraping / Error).
- Active group name display.
- Processed message count.
- Toggle monitoring on/off.
- Start/Stop historical scrape with live progress bar.
- Open Dashboard shortcut.
- Recent matches preview (last 3 non-noise classified messages).

---

## Architecture

```
WappExtractor/
|-- manifest.json              # Chrome Extension manifest (V3)
|-- background.js              # Service worker: message routing, API calls, webhook dispatch
|-- content/
|   |-- selectors.js           # Centralized WhatsApp Web DOM selectors
|   |-- extractor.js           # DOM scraping, MutationObserver, message extraction
|   |-- scroller.js            # Historical scrape auto-scroll logic
|-- storage/
|   |-- db.js                  # IndexedDB wrapper (messages + suggestions tables)
|   |-- settings.js            # Chrome Storage Sync wrapper for user config
|-- filters/
|   |-- keywords.js            # Layer 1: keyword matching engine
|   |-- url_parser.js          # Layer 2: URL detection and domain categorization
|   |-- llm_classifier.js      # Layer 3: Gemini API integration
|   |-- pipeline.js            # Pipeline orchestrator (Layer 1 + 2 + 3)
|-- discord/
|   |-- webhook.js             # Discord embed builder and rate-limited sender
|-- config/
|   |-- keywords.json          # Default keyword configuration
|-- dashboard/
|   |-- index.html             # Dashboard UI layout
|   |-- style.css              # Dark purple theme design system
|   |-- script.js              # Dashboard logic and interactivity
|-- popup/
|   |-- popup.html             # Extension popup layout
|   |-- popup.css              # Popup styling
|   |-- popup.js               # Popup logic and status polling
|-- icons/
|   |-- icon16.png             # Extension icon (16x16)
|   |-- icon48.png             # Extension icon (48x48)
|   |-- icon128.png            # Extension icon (128x128)
```

### Data Flow

```
WhatsApp Web DOM
      |
      v
[Content Script: extractor.js]  -- MutationObserver detects new messages
      |
      v
[Background: background.js]     -- Routes message to pipeline
      |
      v
[FilterPipeline]
  |-- Layer 1: keywords.js      -- Keyword scoring
  |-- Layer 2: url_parser.js    -- URL categorization
  |-- Layer 3: llm_classifier.js -- Gemini API classification
      |
      v
[IndexedDB: db.js]              -- Store classified message + suggestions
      |
      v
[Discord: webhook.js]           -- Send alert if criteria met
[Dashboard: script.js]          -- Display in UI
```

---

## Installation

### Prerequisites
- Google Chrome (or any Chromium-based browser)
- A Google Gemini API key ([Get one here](https://aistudio.google.com/app/apikey)) -- free tier is sufficient
- A Discord webhook URL (optional, for alerts)

### Steps

1. **Clone the repository:**
   ```bash
   git clone https://github.com/KetiakHitam/WappExtractor.git
   ```

2. **Load the extension in Chrome:**
   - Open `chrome://extensions/`
   - Enable **Developer mode** (toggle in the top-right corner)
   - Click **Load unpacked**
   - Select the `WappExtractor` folder

3. **Configure the extension:**
   - Click the WappExtractor icon in the toolbar to open the popup
   - Click **Open Dashboard**
   - Go to **Settings** and configure:
     - **Target Groups**: Enter the exact names of WhatsApp groups to monitor (comma-separated)
     - **Gemini API Key**: Paste your Google Gemini API key
     - **Discord Webhook URL**: Paste your Discord channel webhook URL
   - Click **Save All Settings**

4. **Start monitoring:**
   - Open [WhatsApp Web](https://web.whatsapp.com/) and log in
   - Navigate to one of your target groups
   - The extension will automatically start monitoring for new messages
   - Use **Historical Scrape** from the popup to capture older messages

---

## Configuration

### Target Groups
Group names are matched case-insensitively using partial matching. If your group is called "Anime Figures MY Trading", entering `anime figures` will match it.

### Keywords
The default `config/keywords.json` ships with an extensive list of Umamusume character names, merchandise terms, Malaysian store names, and location identifiers. All keywords can be modified live from the dashboard without restarting the extension.

### Filter Sensitivity
- **Aggressive**: Sends more messages to Gemini for classification (higher API usage, fewer false negatives)
- **Balanced**: Default. Only sends "candidate" messages (keyword or URL hits) to Gemini.
- **Conservative**: Only classifies messages with strong keyword matches.

---

## Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Extension Framework | Chrome Extension Manifest V3 | Service workers, content script isolation, modern Chrome APIs |
| Language | Vanilla JavaScript (ES Modules) | Zero build tools, native Chrome extension support |
| Local Storage | IndexedDB | High-capacity local message storage (handles 100K+ messages) |
| Config Storage | Chrome Storage Sync API | Small config data synced across Chrome instances |
| LLM | Google Gemini API (Flash) | Intelligent message classification with Malay/English support |
| Notifications | Discord Webhooks | Instant alerts via rich embeds |
| UI Framework | Vanilla CSS + HTML | Custom dark theme, no external CSS dependencies |
| Typography | Inter (Google Fonts) | Clean, modern readability |

---

## Anti-Detection Design

WappExtractor is designed to be invisible to WhatsApp's detection systems:

- **Read-only**: No DOM modifications, no network request interception, no automated interactions (no sending, clicking, or typing).
- **Isolated execution**: Content scripts run in Chrome's isolated world, invisible to WhatsApp's page JavaScript.
- **Human-like scrolling**: Randomized delays (1.2s - 2.8s) with Gaussian distribution and occasional longer pauses during historical scraping.
- **API isolation**: All Gemini API calls are routed through the background service worker, never from the content script.
- **Batched processing**: Messages are queued and processed with jitter delays to avoid burst patterns.

---

## Storage & Performance

- **Storage footprint**: Text-only storage. No images or media are downloaded. 100,000 messages take approximately 100MB.
- **API usage**: Gemini Flash free tier allows ~1,500 requests/day. With the 4.5-second delay between calls, batch processing handles ~800 messages/hour.
- **Memory**: IndexedDB is managed by Chrome. The extension itself has no persistent memory allocation beyond the service worker lifecycle.

---

## Development

### File Naming Convention
- All filenames are lowercase, descriptive, and short.
- No build tools, transpilers, or bundlers required.
- Load the extension directly from the source folder.

### Updating WhatsApp Selectors
When WhatsApp updates their DOM structure, only `content/selectors.js` needs to be modified. All CSS selectors are centralized in the `WA_SELECTORS` object with primary and fallback selectors for resilience.

### Adding New Categories
1. Add the category to `config/keywords.json` with terms and confidence level.
2. Add the category constant and label to `discord/webhook.js`, `dashboard/script.js`, and `filters/pipeline.js`.
3. Update the pipeline hierarchy in `pipeline.js` if the new category should override LLM classifications.

---

## Limitations

- **Tab must remain active during historical scraping.** Chrome throttles background tabs, which prevents WhatsApp from loading new messages into the DOM.
- **WhatsApp DOM changes.** WhatsApp Web frequently updates its internal DOM structure. When this happens, `content/selectors.js` may need updating.
- **Gemini free tier rate limits.** The free tier is limited to 15 RPM. Batch processing of large chat histories can take significant time.
- **No image/media analysis.** Only text content and URLs are extracted and classified. Image-based posts (e.g., figure photos with no caption) will be missed.

---

## License

This project is private and not licensed for redistribution.
