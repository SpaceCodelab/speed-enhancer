/**
 * Isolated World Bridge Content Script
 * Bridges chrome.storage.sync settings and real-time changes directly to the MAIN execution world.
 */

(function () {
  const MESSAGE_SOURCE = 'COURSERA_SPEED_ISOLATED_BRIDGE';
  const MAIN_TARGET = 'COURSERA_SPEED_MAIN_WORLD';

  // Read initial configuration from chrome.storage.sync
  function broadcastConfig() {
    chrome.storage.sync.get(['enabled', 'playbackSpeed', 'autoAdvance', 'autoAdvanceDelay'], (result) => {
      const config = {
        enabled: result.enabled !== undefined ? result.enabled : true,
        playbackSpeed: result.playbackSpeed !== undefined ? Number(result.playbackSpeed) : 16.0,
        autoAdvance: result.autoAdvance !== undefined ? result.autoAdvance : true,
        autoAdvanceDelay: result.autoAdvanceDelay !== undefined ? Number(result.autoAdvanceDelay) : 1200
      };

      // Broadcast via window.postMessage to the MAIN world
      window.postMessage({
        source: MESSAGE_SOURCE,
        type: 'CONFIG_UPDATE',
        data: config
      }, '*');

      // Also dispatch CustomEvent on document for immediate low-overhead capture
      try {
        const event = new CustomEvent('__COURSERA_SPEED_CONFIG_SYNC__', {
          detail: JSON.stringify(config)
        });
        document.dispatchEvent(event);
      } catch (e) {
        // Fallback for older DOM environments
      }
    });
  }

  // Broadcast settings immediately upon script execution
  broadcastConfig();

  // Listen for storage changes in real-time (from popup.js)
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync') {
      broadcastConfig();
    }
  });

  // Listen for handshake or request messages from the MAIN world
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data && event.data.target === MESSAGE_SOURCE) {
      if (event.data.type === 'REQUEST_CONFIG') {
        broadcastConfig();
      }
    }
  });

  // Fallback injector for browsers/contexts where "world": "MAIN" might not be supported directly in manifest
  function injectMainWorldFallback() {
    if (document.getElementById('coursera-speed-controller-main-guard')) return;
    
    // Check if main world script is already active
    const script = document.createElement('script');
    script.id = 'coursera-speed-controller-main-guard';
    script.src = chrome.runtime.getURL('content.js');
    script.async = false;
    (document.head || document.documentElement).appendChild(script);
    script.onload = () => script.remove();
  }

  // Ensure DOM is ready for fallback if needed
  if (document.documentElement) {
    // Check if MAIN world is executed via custom property check after small delay
    setTimeout(() => {
      if (!window.__COURSERA_SPEED_CONTROLLER_ACTIVE__) {
        injectMainWorldFallback();
      }
    }, 150);
  }
})();
