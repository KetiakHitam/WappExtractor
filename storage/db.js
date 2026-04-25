// IndexedDB wrapper for storing extracted messages.
// Handles CRUD operations, filtering, stats, and export.

export class MessageDB {
  constructor() {
    this.dbName = 'WappExtractorDB';
    this.dbVersion = 1;
    this.db = null;
  }

  async init() {
    if (this.db) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = event => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains('messages')) {
          const store = db.createObjectStore('messages', {
            keyPath: 'id',
            autoIncrement: true,
          });

          store.createIndex('messageId', 'messageId', { unique: true });
          store.createIndex('groupName', 'groupName', { unique: false });
          store.createIndex('category', 'category', { unique: false });
          store.createIndex('relevance', 'relevance', { unique: false });
          store.createIndex('timestamp', 'extractedAt', { unique: false });
          store.createIndex('classified', 'classified', { unique: false });
          store.createIndex('sender', 'sender', { unique: false });
        }

        if (!db.objectStoreNames.contains('suggestions')) {
          const store = db.createObjectStore('suggestions', {
            keyPath: 'id',
            autoIncrement: true,
          });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
          store.createIndex('term', 'term', { unique: true });
        }
      };

      request.onsuccess = event => {
        this.db = event.target.result;
        resolve();
      };

      request.onerror = event => {
        reject(new Error(`IndexedDB error: ${event.target.error}`));
      };
    });
  }

  // Add a message. Returns the stored record with its auto-generated ID.
  async addMessage(message) {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('messages', 'readwrite');
      const store = tx.objectStore('messages');

      const record = {
        messageId: message.id,
        groupName: message.groupName || '',
        sender: message.sender || 'Unknown',
        timestamp: message.timestamp || '',
        text: message.text || '',
        imageUrls: message.imageUrls || [],
        links: message.links || [],
        direction: message.direction || 'in',
        extractedAt: message.extractedAt || Date.now(),
        // Classification fields (populated later).
        category: null,
        relevance: 0,
        summary: null,
        reasoning: null,
        keywordHits: [],
        classified: false,
        userOverride: null,
      };

      const req = store.add(record);

      req.onsuccess = () => {
        record.id = req.result;
        resolve(record);
      };

      req.onerror = event => {
        // Likely duplicate messageId.
        if (event.target.error?.name === 'ConstraintError') {
          reject(new Error(`Duplicate message: ${message.id}`));
        } else {
          reject(new Error(`Store error: ${event.target.error}`));
        }
      };
    });
  }

  // Get a single message by auto-generated ID.
  async getMessage(id) {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('messages', 'readonly');
      const store = tx.objectStore('messages');
      const req = store.get(id);

      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(new Error(`Get error: ${req.error}`));
    });
  }

  // Update classification fields for a message.
  async updateClassification(id, classification) {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('messages', 'readwrite');
      const store = tx.objectStore('messages');
      const getReq = store.get(id);

      getReq.onsuccess = () => {
        const record = getReq.result;
        if (!record) {
          reject(new Error(`Message ${id} not found.`));
          return;
        }

        record.category = classification.category || null;
        record.relevance = classification.relevance || 0;
        record.summary = classification.summary || null;
        record.reasoning = classification.reasoning || null;
        record.keywordHits = classification.keywordHits || [];
        record.classified = true;

        const putReq = store.put(record);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(new Error(`Update error: ${putReq.error}`));
      };

      getReq.onerror = () => reject(new Error(`Get error: ${getReq.error}`));
    });
  }

  // Manual category override by user.
  async updateCategory(id, category) {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('messages', 'readwrite');
      const store = tx.objectStore('messages');
      const getReq = store.get(id);

      getReq.onsuccess = () => {
        const record = getReq.result;
        if (!record) {
          reject(new Error(`Message ${id} not found.`));
          return;
        }

        record.userOverride = category;
        record.category = category;

        const putReq = store.put(record);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(new Error(`Update error: ${putReq.error}`));
      };

      getReq.onerror = () => reject(new Error(`Get error: ${getReq.error}`));
    });
  }

  // Get messages with optional filters.
  // filters: { groupName, category, minRelevance, limit, offset, search }
  async getMessages(filters = {}) {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('messages', 'readonly');
      const store = tx.objectStore('messages');
      const results = [];

      const cursorReq = store.openCursor(null, 'prev'); // Newest first.
      let skipped = 0;
      const offset = filters.offset || 0;
      const limit = filters.limit || 50;

      cursorReq.onsuccess = event => {
        const cursor = event.target.result;
        if (!cursor || results.length >= limit) {
          resolve({ messages: results, total: results.length });
          return;
        }

        const record = cursor.value;
        let match = true;

        if (filters.groupName && record.groupName !== filters.groupName) {
          match = false;
        }
        if (filters.category && record.category !== filters.category) {
          match = false;
        }
        if (
          filters.minRelevance &&
          record.relevance < filters.minRelevance
        ) {
          match = false;
        }
        if (
          filters.classifiedOnly &&
          !record.classified
        ) {
          match = false;
        }
        if (filters.search) {
          const searchLower = filters.search.toLowerCase();
          const textMatch = record.text?.toLowerCase().includes(searchLower);
          const senderMatch = record.sender?.toLowerCase().includes(searchLower);
          if (!textMatch && !senderMatch) match = false;
        }

        if (match) {
          if (skipped < offset) {
            skipped++;
          } else {
            results.push(record);
          }
        }

        cursor.continue();
      };

      cursorReq.onerror = () =>
        reject(new Error(`Cursor error: ${cursorReq.error}`));
    });
  }

  // Get unclassified messages for batch processing.
  async getUnclassified(limit = 20) {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('messages', 'readonly');
      const store = tx.objectStore('messages');
      const index = store.index('classified');
      const results = [];

      const req = index.openCursor(IDBKeyRange.only(false));

      req.onsuccess = event => {
        const cursor = event.target.result;
        if (!cursor || results.length >= limit) {
          resolve(results);
          return;
        }
        results.push(cursor.value);
        cursor.continue();
      };

      req.onerror = () => reject(new Error(`Cursor error: ${req.error}`));
    });
  }

  // Count unclassified messages.
  async getUnclassifiedCount() {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('messages', 'readonly');
      const store = tx.objectStore('messages');
      const index = store.index('classified');
      const req = index.count(IDBKeyRange.only(false));

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error(`Count error: ${req.error}`));
    });
  }

  // Stats for the dashboard.
  async getStats() {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('messages', 'readonly');
      const store = tx.objectStore('messages');

      const stats = {
        total: 0,
        classified: 0,
        unclassified: 0,
        byCategory: {},
        byGroup: {},
      };

      const req = store.openCursor();

      req.onsuccess = event => {
        const cursor = event.target.result;
        if (!cursor) {
          stats.unclassified = stats.total - stats.classified;
          resolve(stats);
          return;
        }

        const r = cursor.value;
        stats.total++;

        if (r.classified) {
          stats.classified++;
          const cat = r.category || 'UNCATEGORIZED';
          stats.byCategory[cat] = (stats.byCategory[cat] || 0) + 1;
        }

        const grp = r.groupName || 'Unknown';
        stats.byGroup[grp] = (stats.byGroup[grp] || 0) + 1;

        cursor.continue();
      };

      req.onerror = () => reject(new Error(`Stats error: ${req.error}`));
    });
  }

  // Export all messages as JSON.
  async exportAll() {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('messages', 'readonly');
      const store = tx.objectStore('messages');
      const req = store.getAll();

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error(`Export error: ${req.error}`));
    });
  }

  // --- Suggestions ---

  async addSuggestions(suggestions) {
    await this.init();
    if (!suggestions || suggestions.length === 0) return;

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('suggestions', 'readwrite');
      const store = tx.objectStore('suggestions');

      suggestions.forEach(s => {
        store.put({
          term: s.term.toLowerCase(),
          category: s.category,
          confidence: s.confidence || 50,
          reason: s.reason || '',
          context: s.context || '',
          status: 'pending',
          createdAt: Date.now()
        });
      });

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('Failed to add suggestions'));
    });
  }

  async getSuggestions() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('suggestions', 'readonly');
      const store = tx.objectStore('suggestions');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error('Failed to get suggestions'));
    });
  }

  async updateSuggestionStatus(id, status) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('suggestions', 'readwrite');
      const store = tx.objectStore('suggestions');
      const getReq = store.get(id);

      getReq.onsuccess = () => {
        const record = getReq.result;
        if (!record) return resolve();
        record.status = status;
        store.put(record);
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('Failed to update suggestion'));
    });
  }
}
