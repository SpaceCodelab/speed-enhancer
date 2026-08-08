/**
 * Background Service Worker / Script for Coursera 10x Speed & Auto-Advancer
 * Compatible with Chrome (Service Worker) and Firefox (Background Script) MV3
 */

const DEFAULT_CONFIG = {
  enabled: true,
  playbackSpeed: 16.0,
  autoAdvance: true,
  autoAdvanceDelay: 1200
};

// Initialize settings on install or update
chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.sync.get(['enabled', 'playbackSpeed', 'autoAdvance', 'autoAdvanceDelay'], (result) => {
    const newConfig = {};
    if (result.enabled === undefined) newConfig.enabled = DEFAULT_CONFIG.enabled;
    if (result.playbackSpeed === undefined) newConfig.playbackSpeed = DEFAULT_CONFIG.playbackSpeed;
    if (result.autoAdvance === undefined) newConfig.autoAdvance = DEFAULT_CONFIG.autoAdvance;
    if (result.autoAdvanceDelay === undefined) newConfig.autoAdvanceDelay = DEFAULT_CONFIG.autoAdvanceDelay;

    if (Object.keys(newConfig).length > 0) {
      chrome.storage.sync.set(newConfig, () => {
        console.log('[Coursera 10x Speed] Initialized default configuration:', newConfig);
      });
    }
  });
});

// Handle incoming messages from content scripts or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'GET_CONFIG') {
    chrome.storage.sync.get(['enabled', 'playbackSpeed', 'autoAdvance', 'autoAdvanceDelay'], (result) => {
      sendResponse({
        enabled: result.enabled !== undefined ? result.enabled : DEFAULT_CONFIG.enabled,
        playbackSpeed: result.playbackSpeed !== undefined ? result.playbackSpeed : DEFAULT_CONFIG.playbackSpeed,
        autoAdvance: result.autoAdvance !== undefined ? result.autoAdvance : DEFAULT_CONFIG.autoAdvance,
        autoAdvanceDelay: result.autoAdvanceDelay !== undefined ? result.autoAdvanceDelay : DEFAULT_CONFIG.autoAdvanceDelay
      });
    });
    return true; // Keep message channel open for asynchronous response
  }
});
