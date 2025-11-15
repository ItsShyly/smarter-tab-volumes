// ^^^ Handles local storage operations for volume settings ^^^ 
// >>> This script is made by SHYLY

// vvv Storage Keys vvv
// >>> Storage key constants
const STORAGE_KEYS = {
  TAB_VOLUMES: 'tabVolumes',                  // <<< Individual tab volumes
  WEBSITE_VOLUMES: 'websiteVolumes'           // <<< Synced website volumes
};

// vvv Storage Manager Object vvv
const StorageManager = {
  // >>> Get a value from local storage
  async get(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key]);                 // <<< Return stored value
      });
    });
  },

  // >>> Set a value in local storage
  async set(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, () => {
        resolve();                            // <<< Resolve when done
      });
    });
  },

  // >>> Get multiple values from local storage
  async getMultiple(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (result) => {
        resolve(result);                      // <<< Return all values
      });
    });
  },

  // >>> Set multiple values in local storage
  async setMultiple(items) {
    return new Promise((resolve) => {
      chrome.storage.local.set(items, () => {
        resolve();                            // <<< Resolve when done
      });
    });
  },

  // >>> Remove a value from local storage
  async remove(key) {
    return new Promise((resolve) => {
      chrome.storage.local.remove([key], () => {
        resolve();                            // <<< Resolve when done
      });
    });
  }
};

// vvv Volume Settings Manager vvv
const VolumeSettings = {
  // >>> Sync individual tab volume (per-tab setting when sync is OFF)
  async syncTabVolume(tabId, volume) {
    const tabVolumes = await StorageManager.get(STORAGE_KEYS.TAB_VOLUMES) || {};
    tabVolumes[tabId] = volume; // <<< Store volume for tab
    await StorageManager.set(STORAGE_KEYS.TAB_VOLUMES, tabVolumes);
  },

  // >>> Get individual tab volume
  async getTabVolume(tabId) {
    const tabVolumes = await StorageManager.get(STORAGE_KEYS.TAB_VOLUMES) || {};
    return tabVolumes[tabId] !== undefined ? tabVolumes[tabId] : null;
  },

  // >>> Remove individual tab volume
  async removeTabVolume(tabId) {
    const tabVolumes = await StorageManager.get(STORAGE_KEYS.TAB_VOLUMES) || {};
    delete tabVolumes[tabId]; // <<< Remove tab entry
    await StorageManager.set(STORAGE_KEYS.TAB_VOLUMES, tabVolumes);
  },

  // >>> Sync website volume (global setting when sync is ON)
  async syncWebsiteVolume(pattern, volume) {
    const websiteVolumes = await StorageManager.get(STORAGE_KEYS.WEBSITE_VOLUMES) || {};
    websiteVolumes[pattern] = volume; // <<< Store volume for website pattern
    await StorageManager.set(STORAGE_KEYS.WEBSITE_VOLUMES, websiteVolumes);
  },

  // >>> Get website volume by pattern
  async getWebsiteVolume(pattern) {
    const websiteVolumes = await StorageManager.get(STORAGE_KEYS.WEBSITE_VOLUMES) || {};
    return websiteVolumes[pattern] !== undefined ? websiteVolumes[pattern] : null;
  },

  // >>> Check if a website has a synced volume
  async isWebsiteSynced(domain) {
    const websiteVolumes = await StorageManager.get(STORAGE_KEYS.WEBSITE_VOLUMES) || {};
    // Check if any pattern starts with this domain
    return Object.keys(websiteVolumes).some(pattern => pattern.startsWith(domain));
  },

  // >>> Get website pattern for a domain
  async getWebsitePattern(domain) {
    const websiteVolumes = await StorageManager.get(STORAGE_KEYS.WEBSITE_VOLUMES) || {};
    // >>> Find the pattern that matches this domain
    return Object.keys(websiteVolumes).find(pattern => pattern.startsWith(domain)) || null;
  },

  // >>> Remove website volume
  async removeWebsiteVolume(pattern) {
    const websiteVolumes = await StorageManager.get(STORAGE_KEYS.WEBSITE_VOLUMES) || {};
    delete websiteVolumes[pattern];           // <<< Remove website entry
    await StorageManager.set(STORAGE_KEYS.WEBSITE_VOLUMES, websiteVolumes);
  },

  // >>> Get all synced website volumes
  async getAllWebsiteVolumes() {
    return await StorageManager.get(STORAGE_KEYS.WEBSITE_VOLUMES) || {};
  }
};
