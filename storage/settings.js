// Chrome Storage Sync wrapper for user-configurable settings.
// Small data only (sync storage has a 100KB limit).

const DEFAULT_SETTINGS = {
  targetGroups: [],
  discordWebhookUrl: '',
  geminiApiKey: '',
  monitoringEnabled: true,
  filterSensitivity: 'balanced', // 'aggressive', 'balanced', 'conservative'
  alertCategories: [
    'UMAMUSUME_MERCH',
    'STORE_MENTION',
    'LOCATION_TIP',
    'FIGURE_ANNOUNCEMENT',
  ],
  minAlertRelevance: 3,
};

export class SettingsManager {
  constructor() {
    this.cache = null;
  }

  async init() {
    this.cache = await this.getAll();
  }

  // Get all settings, merged with defaults.
  async getAll() {
    return new Promise(resolve => {
      chrome.storage.sync.get('settings', result => {
        const saved = result.settings || {};
        const merged = { ...DEFAULT_SETTINGS, ...saved };
        this.cache = merged;
        resolve(merged);
      });
    });
  }

  // Get a specific setting.
  async get(key) {
    if (!this.cache) await this.init();
    return this.cache[key];
  }

  // Save settings (partial update).
  async save(updates) {
    if (!this.cache) await this.init();
    this.cache = { ...this.cache, ...updates };

    return new Promise((resolve, reject) => {
      chrome.storage.sync.set({ settings: this.cache }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  // Reset to defaults.
  async reset() {
    this.cache = { ...DEFAULT_SETTINGS };
    return new Promise((resolve, reject) => {
      chrome.storage.sync.set({ settings: this.cache }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }
}
