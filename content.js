/**
 * Coursera 10x Speed & Auto-Progression - MAIN Execution World Script
 * Features continuous multi-video persistence, SPA navigation hooks,
 * readyState-safe rate enforcement, and seamless auto-progression across consecutive lectures.
 */

(function () {
  if (window.__COURSERA_SPEED_CONTROLLER_ACTIVE__) return;
  window.__COURSERA_SPEED_CONTROLLER_ACTIVE__ = true;

  // Active configuration state
  const state = {
    enabled: true,
    playbackSpeed: 16.0,
    autoAdvance: true,
    autoAdvanceDelay: 1200,
    isEnforcing: false,
    managedVideos: new WeakSet(),
    autoAdvanceTimer: null,
    currentLectureUrl: window.location.href
  };

  const ISOLATED_BRIDGE_SOURCE = 'COURSERA_SPEED_ISOLATED_BRIDGE';

  function log(...args) {
    console.log(
      '%c[Coursera 16x]%c',
      'background: #6366f1; color: white; border-radius: 3px; padding: 2px 5px; font-weight: bold;',
      '',
      ...args
    );
  }

  /**
   * Safely enforce playback rate on a video element
   */
  function enforceRate(video) {
    if (!state.enabled || !video) return;

    // If media source is still in HAVE_NOTHING (readyState 0), attach a one-time ready listener
    if (video.readyState === 0) {
      const applyWhenReady = () => {
        enforceRate(video);
        video.removeEventListener('loadedmetadata', applyWhenReady);
        video.removeEventListener('canplay', applyWhenReady);
        video.removeEventListener('playing', applyWhenReady);
      };
      video.addEventListener('loadedmetadata', applyWhenReady, { once: true, passive: true });
      video.addEventListener('canplay', applyWhenReady, { once: true, passive: true });
      video.addEventListener('playing', applyWhenReady, { once: true, passive: true });
      return;
    }

    const targetRate = Number(state.playbackSpeed) || 16.0;

    if (Math.abs(video.playbackRate - targetRate) > 0.01) {
      try {
        state.isEnforcing = true;

        // Prevent audio decoder hardware crashes at extreme speeds
        if ('preservesPitch' in video) video.preservesPitch = true;
        if ('webkitPreservesPitch' in video) video.webkitPreservesPitch = true;
        if ('mozPreservesPitch' in video) video.mozPreservesPitch = true;

        video.playbackRate = targetRate;
        video.defaultPlaybackRate = targetRate;

        updateFloatingHud();
      } catch (err) {
        console.warn('[Coursera 10x] Rate setting caught:', err);
      } finally {
        setTimeout(() => {
          state.isEnforcing = false;
        }, 50);
      }
    }
  }

  /**
   * Floating HUD Badge attached directly to document.body
   */
  let hudElement = null;

  function updateFloatingHud() {
    if (!state.enabled) {
      if (hudElement) hudElement.style.display = 'none';
      return;
    }

    const activeVideo = document.querySelector('video');
    if (!activeVideo || activeVideo.offsetParent === null) {
      if (hudElement) hudElement.style.display = 'none';
      return;
    }

    if (!hudElement) {
      hudElement = document.createElement('div');
      hudElement.id = 'coursera-speed-floating-hud';
      hudElement.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147483640;
        background: rgba(15, 23, 42, 0.88);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        color: #38bdf8;
        border: 1px solid rgba(99, 102, 241, 0.35);
        border-radius: 24px;
        padding: 6px 14px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 12.5px;
        font-weight: 700;
        letter-spacing: 0.4px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4), 0 0 12px rgba(99, 102, 241, 0.25);
        display: flex;
        align-items: center;
        gap: 7px;
        pointer-events: none;
        user-select: none;
        transition: opacity 0.3s ease, transform 0.3s ease;
      `;
      document.body.appendChild(hudElement);
    }

    hudElement.style.display = 'flex';
    hudElement.innerHTML = `
      <span style="display:inline-block;width:7px;height:7px;background:#10b981;border-radius:50%;box-shadow:0 0 8px #10b981;"></span>
      <span>${Number(state.playbackSpeed).toFixed(1)}x Speed</span>
    `;
  }

  /**
   * Find Coursera's "Next Item" navigation button in the SPA
   */
  function findNextItemButton() {
    const selectors = [
      'button[data-testid="next-item"]',
      'a[data-testid="next-item"]',
      'button[aria-label="Next Item"]',
      'button[aria-label="Next item"]',
      'button[aria-label="Next lecture"]',
      'button[aria-label="Next"]',
      'a[aria-label="Next Item"]',
      '[data-track-component="item_navigation_next"]',
      'button.c-item-navigation-next',
      '[data-e2e="next-item-button"]',
      '.next-lecture-button',
      '.rc-NextItemButton button',
      'button[data-testid="next-button"]'
    ];

    for (const selector of selectors) {
      try {
        const btn = document.querySelector(selector);
        if (btn && btn.offsetParent !== null && !btn.disabled) {
          return btn;
        }
      } catch (e) {}
    }

    const buttons = document.querySelectorAll('button, a[role="button"]');
    for (const btn of buttons) {
      const text = (btn.textContent || '').trim().toLowerCase();
      if (
        (text.includes('next item') || text.includes('next lecture') || text.includes('go to next')) &&
        btn.offsetParent !== null &&
        !btn.disabled
      ) {
        return btn;
      }
    }

    return null;
  }

  /**
   * Toast notification when auto-advancing
   */
  function showToast(message) {
    const toastId = 'coursera-speed-toast-notification';
    let toast = document.getElementById(toastId);
    if (!toast) {
      toast = document.createElement('div');
      toast.id = toastId;
      toast.style.cssText = `
        position: fixed;
        bottom: 30px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: linear-gradient(135deg, #1e1b4b, #0f172a);
        color: #f8fafc;
        border: 1px solid rgba(99, 102, 241, 0.4);
        padding: 12px 24px;
        border-radius: 12px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 14px;
        font-weight: 600;
        z-index: 2147483647;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 15px rgba(99, 102, 241, 0.3);
        opacity: 0;
        transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        pointer-events: none;
        display: flex;
        align-items: center;
        gap: 10px;
      `;
      document.body.appendChild(toast);
    }

    toast.innerHTML = `
      <span style="font-size:16px;">⚡</span>
      <span>${message}</span>
    `;

    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(-50%) translateY(0)';
    });

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(20px)';
    }, 2800);
  }

  /**
   * Trigger course auto-progression to next lesson
   */
  function triggerAutoProgression() {
    if (!state.enabled || !state.autoAdvance) return;
    if (state.autoAdvanceTimer) return;

    log('Video finished. Initiating auto-progression in', state.autoAdvanceDelay, 'ms...');
    showToast('Lesson complete! Advancing to next item...');

    state.autoAdvanceTimer = setTimeout(() => {
      state.autoAdvanceTimer = null;
      const nextBtn = findNextItemButton();
      if (nextBtn) {
        log('Navigating to next lecture:', nextBtn);
        nextBtn.click();
      } else {
        setTimeout(() => {
          const retryBtn = findNextItemButton();
          if (retryBtn) retryBtn.click();
        }, 1000);
      }
    }, state.autoAdvanceDelay);
  }

  /**
   * Register video listeners and lifecycle hooks
   */
  function registerVideo(video) {
    if (!video || state.managedVideos.has(video)) return;
    state.managedVideos.add(video);

    log('Registering video element in V8 context:', video);

    // Initial enforcement
    enforceRate(video);

    /**
     * High-priority capture-phase ratechange listener
     */
    video.addEventListener(
      'ratechange',
      () => {
        if (state.isEnforcing) return;
        if (!state.enabled) return;

        // When Coursera changes videos or resets speed, re-enforce rate
        enforceRate(video);
      },
      true
    );

    // When a new video source is loaded into the existing video element
    video.addEventListener(
      'loadstart',
      () => {
        state.autoAdvanceTimer = null; // Clear completion lock for new video
        enforceRate(video);
      },
      { passive: true }
    );

    video.addEventListener(
      'emptied',
      () => {
        state.autoAdvanceTimer = null;
      },
      { passive: true }
    );

    // Playback events to maintain speed seamlessly across consecutive lectures
    ['loadedmetadata', 'canplay', 'canplaythrough', 'play', 'playing'].forEach((eventName) => {
      video.addEventListener(
        eventName,
        () => {
          if (state.enabled) {
            enforceRate(video);
          }
        },
        { capture: true, passive: true }
      );
    });

    // Handle buffer waiting / stalling gracefully
    video.addEventListener(
      'waiting',
      () => {
        state.isEnforcing = true;
        setTimeout(() => {
          state.isEnforcing = false;
        }, 200);
      },
      { passive: true }
    );

    video.addEventListener(
      'error',
      () => {
        if (state.enabled && video.playbackRate > 2.0) {
          log('Buffer stall recovery active.');
          try {
            state.isEnforcing = true;
            video.playbackRate = 1.0;
            setTimeout(() => {
              state.isEnforcing = false;
              if (state.enabled && !video.paused) {
                enforceRate(video);
              }
            }, 300);
          } catch (e) {}
        }
      },
      true
    );

    // Progression on finish
    video.addEventListener('ended', () => {
      triggerAutoProgression();
    });

    // Fallback progression check on near-end
    video.addEventListener('timeupdate', () => {
      if (
        state.enabled &&
        state.autoAdvance &&
        video.duration &&
        video.duration > 10 &&
        video.currentTime >= video.duration - 0.4
      ) {
        triggerAutoProgression();
      }
    });
  }

  function scanAndRegisterVideos() {
    const videos = document.querySelectorAll('video');
    videos.forEach((video) => registerVideo(video));
  }

  function setupMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.tagName === 'VIDEO') {
              registerVideo(node);
            } else if (node.querySelectorAll) {
              const videos = node.querySelectorAll('video');
              videos.forEach((v) => registerVideo(v));
            }
          }
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  /**
   * SPA Navigation Interceptor
   * Detects Coursera URL changes when user or auto-advancer moves to next lecture
   */
  function handleUrlChange() {
    if (window.location.href !== state.currentLectureUrl) {
      state.currentLectureUrl = window.location.href;
      log('SPA Navigation detected to new lecture:', state.currentLectureUrl);
      state.autoAdvanceTimer = null;

      // Re-scan and enforce immediately on the new lecture
      setTimeout(() => {
        scanAndRegisterVideos();
        const videos = document.querySelectorAll('video');
        videos.forEach((v) => enforceRate(v));
      }, 200);
    }
  }

  function setupSpaNavigationHooks() {
    const origPushState = history.pushState;
    history.pushState = function (...args) {
      origPushState.apply(this, args);
      handleUrlChange();
    };

    const origReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      origReplaceState.apply(this, args);
      handleUrlChange();
    };

    window.addEventListener('popstate', handleUrlChange);
  }

  /**
   * Background Watchdog Interval
   * Automatically re-applies target speed to any newly playing or transitioning video
   * without requiring the user to toggle the extension on/off
   */
  function setupWatchdog() {
    setInterval(() => {
      if (!state.enabled) return;

      const videos = document.querySelectorAll('video');
      for (const video of videos) {
        if (!state.managedVideos.has(video)) {
          registerVideo(video);
        }

        if (video.readyState >= 1 && !video.paused) {
          const targetRate = Number(state.playbackSpeed) || 16.0;
          if (Math.abs(video.playbackRate - targetRate) > 0.01) {
            enforceRate(video);
          }
        }
      }

      updateFloatingHud();
      handleUrlChange();
    }, 600);
  }

  function applyConfig(newConfig) {
    if (!newConfig) return;
    if (newConfig.enabled !== undefined) state.enabled = Boolean(newConfig.enabled);
    if (newConfig.playbackSpeed !== undefined) state.playbackSpeed = Number(newConfig.playbackSpeed);
    if (newConfig.autoAdvance !== undefined) state.autoAdvance = Boolean(newConfig.autoAdvance);
    if (newConfig.autoAdvanceDelay !== undefined) state.autoAdvanceDelay = Number(newConfig.autoAdvanceDelay);

    log('Applied configuration update:', state);

    const videos = document.querySelectorAll('video');
    videos.forEach((video) => {
      if (state.enabled) {
        enforceRate(video);
      } else {
        try {
          video.playbackRate = 1.0;
        } catch (e) {}
      }
    });

    updateFloatingHud();
  }

  function setupStorageListener() {
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (event.data && event.data.source === ISOLATED_BRIDGE_SOURCE) {
        if (event.data.type === 'CONFIG_UPDATE') {
          applyConfig(event.data.data);
        }
      }
    });

    document.addEventListener('__COURSERA_SPEED_CONFIG_SYNC__', (event) => {
      try {
        const data = JSON.parse(event.detail);
        applyConfig(data);
      } catch (e) {}
    });

    window.postMessage(
      {
        source: 'COURSERA_SPEED_MAIN_WORLD',
        target: ISOLATED_BRIDGE_SOURCE,
        type: 'REQUEST_CONFIG'
      },
      '*'
    );
  }

  // Initialization
  scanAndRegisterVideos();
  setupMutationObserver();
  setupSpaNavigationHooks();
  setupWatchdog();
  setupStorageListener();

  log('Coursera 10x Speed & Auto-Progression running with multi-video persistence.');
})();
