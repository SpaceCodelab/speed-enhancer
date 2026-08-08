/**
 * Settings UI Controller (popup.js)
 * Manages preferences persistence via chrome.storage.sync and real-time UI synchronization.
 */

document.addEventListener('DOMContentLoaded', () => {
  const toggleEnabled = document.getElementById('toggle-enabled');
  const toggleAutoAdvance = document.getElementById('toggle-autoadvance');
  const speedSlider = document.getElementById('speed-slider');
  const speedInput = document.getElementById('speed-input');
  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');
  const presetButtons = document.querySelectorAll('.preset-btn');

  // Load preferences from chrome.storage.sync
  chrome.storage.sync.get(['enabled', 'playbackSpeed', 'autoAdvance'], (data) => {
    const isEnabled = data.enabled !== undefined ? data.enabled : true;
    const speed = data.playbackSpeed !== undefined ? Number(data.playbackSpeed) : 16.0;
    const isAutoAdvance = data.autoAdvance !== undefined ? data.autoAdvance : true;

    toggleEnabled.checked = isEnabled;
    toggleAutoAdvance.checked = isAutoAdvance;
    speedSlider.value = speed;
    speedInput.value = speed.toFixed(1);

    updateStatusUI(isEnabled);
    updatePresetHighlight(speed);
  });

  // Master switch change
  toggleEnabled.addEventListener('change', (e) => {
    const isEnabled = e.target.checked;
    chrome.storage.sync.set({ enabled: isEnabled }, () => {
      updateStatusUI(isEnabled);
    });
  });

  // Auto-advance toggle change
  toggleAutoAdvance.addEventListener('change', (e) => {
    const isAutoAdvance = e.target.checked;
    chrome.storage.sync.set({ autoAdvance: isAutoAdvance });
  });

  // Slider change
  speedSlider.addEventListener('input', (e) => {
    const speed = parseFloat(e.target.value);
    speedInput.value = speed.toFixed(1);
    updatePresetHighlight(speed);
    saveSpeed(speed);
  });

  // Numeric input change
  speedInput.addEventListener('change', (e) => {
    let speed = parseFloat(e.target.value);
    if (isNaN(speed) || speed < 0.5) speed = 0.5;
    if (speed > 16.0) speed = 16.0;

    speed = Math.round(speed * 2) / 2; // snap to 0.5 steps
    speedInput.value = speed.toFixed(1);
    speedSlider.value = speed;
    updatePresetHighlight(speed);
    saveSpeed(speed);
  });

  // Preset button clicks
  presetButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const speed = parseFloat(btn.getAttribute('data-speed'));
      speedSlider.value = speed;
      speedInput.value = speed.toFixed(1);
      updatePresetHighlight(speed);
      saveSpeed(speed);
    });
  });

  function saveSpeed(speed) {
    chrome.storage.sync.set({ playbackSpeed: speed });
  }

  function updateStatusUI(isEnabled) {
    if (isEnabled) {
      statusBadge.classList.remove('disabled');
      statusText.textContent = 'Active';
    } else {
      statusBadge.classList.add('disabled');
      statusText.textContent = 'Paused';
    }
  }

  function updatePresetHighlight(currentSpeed) {
    presetButtons.forEach((btn) => {
      const btnSpeed = parseFloat(btn.getAttribute('data-speed'));
      if (Math.abs(btnSpeed - currentSpeed) < 0.05) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }
});
