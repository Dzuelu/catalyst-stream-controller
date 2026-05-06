/**
 * Web Companion Client — Phase 4
 *
 * A standalone, mobile-first web app served by VirtualWebServer.
 * Vanilla HTML/CSS/JS — no framework dependencies.
 *
 * Features:
 * - PIN authentication screen
 * - Device selection (auto-select if only one)
 * - Responsive button grid with rendered key images
 * - Encoder knob widgets (circular drag + vertical swipe + press)
 * - Slider widgets (touch drag with smooth scrubbing)
 * - All 5 button trigger types via touch/mouse
 * - Haptic feedback via navigator.vibrate()
 * - Auto-reconnect with connection status indicator
 * - Cross-browser compatible (Chrome, Safari, Firefox mobile)
 */

export const WEB_COMPANION_HTML = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no, viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="theme-color" content="#0f0f14">
  <title>Catalyst Stream Controller</title>
  <style>
    /* ─── Reset & Foundation ────────────────────────────────────── */
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%; height: 100%;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: #0f0f14;
      color: #e0e0e0;
      -webkit-tap-highlight-color: transparent;
      -webkit-touch-callout: none;
      -webkit-user-select: none;
      user-select: none;
      touch-action: none;
    }

    /* ─── Screen Container ──────────────────────────────────────── */
    .screen {
      position: absolute; inset: 0;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      padding: env(safe-area-inset-top) env(safe-area-inset-right)
               env(safe-area-inset-bottom) env(safe-area-inset-left);
      transition: opacity 0.25s ease;
    }
    .screen.hidden { display: none; opacity: 0; pointer-events: none; }

    /* ─── Connection Status Bar ─────────────────────────────────── */
    #status-bar {
      position: fixed; top: 0; left: 0; right: 0;
      z-index: 100;
      padding: 6px 12px;
      padding-top: calc(6px + env(safe-area-inset-top));
      font-size: 0.75rem;
      text-align: center;
      background: #1a1a2e;
      color: #7c7cff;
      transition: transform 0.3s ease, background 0.3s ease;
      transform: translateY(-100%);
    }
    #status-bar.visible { transform: translateY(0); }
    #status-bar.error { background: #2e1a1a; color: #ff6b6b; }
    #status-bar.connecting { background: #2e2a1a; color: #ffbb5c; }

    /* ─── PIN Screen ────────────────────────────────────────────── */
    #pin-screen .icon { font-size: 3.5rem; margin-bottom: 1rem; }
    #pin-screen h1 { font-size: 1.4rem; margin-bottom: 0.25rem; color: #fff; }
    #pin-screen .subtitle { font-size: 0.85rem; color: #888; margin-bottom: 2rem; }
    #pin-screen .pin-container { display: flex; flex-direction: column; align-items: center; gap: 1rem; width: 100%; max-width: 280px; }

    .pin-dots {
      display: flex; gap: 12px; margin-bottom: 0.5rem; height: 20px;
    }
    .pin-dot {
      width: 14px; height: 14px; border-radius: 50%;
      border: 2px solid #555; background: transparent;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .pin-dot.filled { background: #7c7cff; border-color: #7c7cff; }
    .pin-dot.error { border-color: #ff6b6b; background: #ff6b6b; }

    .pin-pad {
      display: grid; grid-template-columns: repeat(3, 1fr);
      gap: 10px; width: 100%;
    }
    .pin-btn {
      aspect-ratio: 1.4;
      border: none; border-radius: 12px;
      background: #1a1a2e; color: #fff;
      font-size: 1.5rem; font-weight: 500;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.1s ease, transform 0.1s ease;
      -webkit-tap-highlight-color: transparent;
    }
    .pin-btn:active { background: #2a2a4e; transform: scale(0.95); }
    .pin-btn.backspace { font-size: 1.2rem; color: #888; }
    .pin-btn.submit { background: #3a3a8e; color: #aaf; }
    .pin-btn.submit:active { background: #4a4abe; }
    .pin-btn.submit:disabled { opacity: 0.3; pointer-events: none; }

    .pin-error-msg {
      font-size: 0.8rem; color: #ff6b6b; min-height: 1.2em;
      transition: opacity 0.2s ease;
    }

    /* ─── Device Selection Screen ───────────────────────────────── */
    #device-screen { padding: 2rem; }
    #device-screen h2 { font-size: 1.2rem; margin-bottom: 1.5rem; color: #fff; }
    .device-list { display: flex; flex-direction: column; gap: 0.75rem; width: 100%; max-width: 340px; }
    .device-item {
      padding: 1rem 1.25rem;
      background: #1a1a2e; border-radius: 12px;
      cursor: pointer; font-size: 1rem;
      transition: background 0.15s ease, transform 0.1s ease;
      display: flex; align-items: center; gap: 0.75rem;
    }
    .device-item:active { background: #2a2a4e; transform: scale(0.98); }
    .device-item .device-icon { font-size: 1.5rem; }
    .device-item .device-name { flex: 1; }
    .device-item .device-arrow { color: #555; font-size: 1.2rem; }

    /* ─── Deck Screen ───────────────────────────────────────────── */
    #deck-screen {
      padding: 8px;
      padding-top: calc(8px + env(safe-area-inset-top));
      justify-content: flex-start;
    }

    .deck-layout {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      width: 100%;
      height: 100%;
    }

    /* ─── Button Grid ───────────────────────────────────────────── */
    .button-grid {
      display: grid;
      gap: 6px;
      flex: 1;
      width: 100%;
      justify-items: center;
      align-items: center;
    }

    .deck-key {
      position: relative;
      width: 100%; aspect-ratio: 1;
      border: none; border-radius: 10px;
      background: #1a1a2e;
      overflow: hidden;
      cursor: pointer;
      transition: transform 0.08s ease;
      -webkit-tap-highlight-color: transparent;
    }
    .deck-key:active { transform: scale(0.93); }
    .deck-key.pressed { transform: scale(0.90); box-shadow: 0 0 0 2px #7c7cff; }
    .deck-key img {
      position: absolute; inset: 0;
      width: 100%; height: 100%;
      object-fit: cover;
      border-radius: 10px;
      pointer-events: none;
    }

    /* ─── Encoder Row ───────────────────────────────────────────── */
    .encoder-row {
      display: flex;
      gap: 16px;
      justify-content: center;
      align-items: center;
      padding: 8px 0;
      flex-shrink: 0;
    }

    .encoder-widget {
      display: flex; flex-direction: column;
      align-items: center; gap: 4px;
    }
    .encoder-label {
      font-size: 0.65rem; color: #666;
      text-transform: uppercase; letter-spacing: 0.05em;
    }
    .encoder-knob {
      position: relative;
      width: 64px; height: 64px;
      border-radius: 50%;
      background: radial-gradient(circle at 40% 35%, #2a2a4e, #151528);
      border: 2px solid #333;
      cursor: grab;
      transition: border-color 0.15s ease;
      display: flex; align-items: center; justify-content: center;
    }
    .encoder-knob:active { cursor: grabbing; }
    .encoder-knob.active { border-color: #7c7cff; }
    .encoder-knob-indicator {
      position: absolute;
      width: 6px; height: 6px;
      border-radius: 50%;
      background: #7c7cff;
      top: 8px; left: 50%;
      transform: translateX(-50%);
      transition: opacity 0.15s;
    }
    .encoder-knob-center {
      width: 20px; height: 20px;
      border-radius: 50%;
      background: #252540;
      border: 1px solid #444;
    }

    /* ─── Slider Row ────────────────────────────────────────────── */
    .slider-row {
      display: flex;
      gap: 20px;
      justify-content: center;
      align-items: center;
      padding: 8px 0;
      flex-shrink: 0;
    }

    .slider-widget {
      display: flex; flex-direction: column;
      align-items: center; gap: 4px;
    }
    .slider-label {
      font-size: 0.65rem; color: #666;
      text-transform: uppercase; letter-spacing: 0.05em;
    }
    .slider-track {
      position: relative;
      width: 40px; height: 140px;
      background: #151528;
      border-radius: 20px;
      border: 1px solid #333;
      cursor: pointer;
      overflow: hidden;
    }
    .slider-fill {
      position: absolute;
      bottom: 0; left: 0; right: 0;
      background: linear-gradient(to top, #3a3a8e, #5a5adf);
      border-radius: 0 0 20px 20px;
      transition: height 0.05s ease;
      pointer-events: none;
    }
    .slider-thumb {
      position: absolute;
      left: 50%; transform: translateX(-50%);
      width: 34px; height: 16px;
      background: #ddd;
      border-radius: 8px;
      pointer-events: none;
      transition: bottom 0.05s ease;
      box-shadow: 0 1px 4px rgba(0,0,0,0.5);
    }
    .slider-value {
      font-size: 0.7rem; color: #888;
      font-variant-numeric: tabular-nums;
    }

    /* ─── Back Button (on deck screen) ──────────────────────────── */
    .back-btn {
      position: fixed; top: 8px; left: 8px;
      top: calc(8px + env(safe-area-inset-top));
      left: calc(8px + env(safe-area-inset-left));
      z-index: 50;
      width: 36px; height: 36px;
      border: none; border-radius: 50%;
      background: rgba(26,26,46,0.85);
      color: #aaa; font-size: 1.2rem;
      cursor: pointer; display: flex;
      align-items: center; justify-content: center;
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    }
    .back-btn:active { background: rgba(42,42,78,0.9); }

    /* ─── Utility ───────────────────────────────────────────────── */
    .fade-in { animation: fadeIn 0.25s ease forwards; }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  </style>
</head>
<body>

  <!-- Status Bar -->
  <div id="status-bar">Connecting...</div>

  <!-- PIN Authentication Screen -->
  <div id="pin-screen" class="screen fade-in">
    <div class="icon">🔒</div>
    <h1>Web Companion</h1>
    <p class="subtitle">Enter PIN to connect</p>
    <div class="pin-container">
      <div class="pin-dots" id="pin-dots"></div>
      <p class="pin-error-msg" id="pin-error">&nbsp;</p>
      <div class="pin-pad" id="pin-pad"></div>
    </div>
  </div>

  <!-- Device Selection Screen -->
  <div id="device-screen" class="screen hidden">
    <h2>Select a device</h2>
    <div class="device-list" id="device-list"></div>
  </div>

  <!-- Deck Screen -->
  <div id="deck-screen" class="screen hidden">
    <button class="back-btn" id="back-btn" aria-label="Back">‹</button>
    <div class="deck-layout" id="deck-layout"></div>
  </div>

<script>
(function() {
  'use strict';

  // ─── Constants ───────────────────────────────────────────────
  const BINARY_MSG_KEY_IMAGE = 0x01;
  const LONG_PRESS_MS = 500;
  const DOUBLE_TAP_MS = 300;
  const RECONNECT_DELAY_MS = 2000;
  const MAX_PIN_LENGTH = 8;
  const MIN_PIN_LENGTH = 4;

  // ─── State ───────────────────────────────────────────────────
  let ws = null;
  let authenticated = false;
  let selectedDeviceId = null;
  let deviceConfig = null;
  let reconnectTimer = null;
  let pinValue = '';
  let devices = [];

  // Interaction state per key
  const keyState = new Map();

  // Encoder rotation tracking
  const encoderState = new Map();

  // Slider positions
  const sliderValues = new Map();

  // ─── DOM References ──────────────────────────────────────────
  const statusBar = document.getElementById('status-bar');
  const pinScreen = document.getElementById('pin-screen');
  const deviceScreen = document.getElementById('device-screen');
  const deckScreen = document.getElementById('deck-screen');
  const pinDots = document.getElementById('pin-dots');
  const pinError = document.getElementById('pin-error');
  const pinPad = document.getElementById('pin-pad');
  const deviceList = document.getElementById('device-list');
  const deckLayout = document.getElementById('deck-layout');
  const backBtn = document.getElementById('back-btn');

  // ─── Haptics ─────────────────────────────────────────────────
  function haptic(ms) {
    try { navigator.vibrate && navigator.vibrate(ms || 10); } catch {}
  }

  // ─── Screen Navigation ──────────────────────────────────────
  function showScreen(screen) {
    [pinScreen, deviceScreen, deckScreen].forEach(s => {
      s.classList.toggle('hidden', s !== screen);
    });
    if (screen === deckScreen) {
      backBtn.style.display = 'flex';
    } else {
      backBtn.style.display = 'none';
    }
  }

  // ─── Status Bar ──────────────────────────────────────────────
  function showStatus(msg, type, persistent) {
    statusBar.textContent = msg;
    statusBar.className = 'visible' + (type ? ' ' + type : '');
    if (!persistent) {
      setTimeout(() => { statusBar.className = ''; }, 3000);
    }
  }

  function hideStatus() {
    statusBar.className = '';
  }

  // ─── PIN Pad ─────────────────────────────────────────────────
  function buildPinPad() {
    // Build dots (start with MAX_PIN_LENGTH dots)
    pinDots.innerHTML = '';
    for (let i = 0; i < MAX_PIN_LENGTH; i++) {
      const dot = document.createElement('div');
      dot.className = 'pin-dot';
      pinDots.appendChild(dot);
    }

    // Build pad
    pinPad.innerHTML = '';
    const buttons = [1,2,3,4,5,6,7,8,9,'⌫',0,'→'];
    buttons.forEach(val => {
      const btn = document.createElement('button');
      btn.className = 'pin-btn';
      if (val === '⌫') btn.classList.add('backspace');
      if (val === '→') { btn.classList.add('submit'); btn.disabled = true; }
      btn.textContent = val;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        haptic(5);
        if (val === '⌫') {
          pinValue = pinValue.slice(0, -1);
        } else if (val === '→') {
          submitPin();
          return;
        } else {
          if (pinValue.length < MAX_PIN_LENGTH) {
            pinValue += val;
          }
        }
        updatePinDots();
      });
      pinPad.appendChild(btn);
    });
  }

  function updatePinDots() {
    const dots = pinDots.querySelectorAll('.pin-dot');
    dots.forEach((dot, i) => {
      dot.classList.toggle('filled', i < pinValue.length);
      dot.classList.remove('error');
    });
    // Enable/disable submit
    const submitBtn = pinPad.querySelector('.submit');
    if (submitBtn) submitBtn.disabled = pinValue.length < MIN_PIN_LENGTH;
    // Clear error
    pinError.textContent = '\\u00a0';
  }

  function showPinError(msg) {
    pinError.textContent = msg;
    const dots = pinDots.querySelectorAll('.pin-dot');
    dots.forEach(d => d.classList.add('error'));
    setTimeout(() => {
      pinValue = '';
      updatePinDots();
    }, 800);
  }

  function submitPin() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'auth', pin: pinValue }));
  }

  // ─── WebSocket Connection ────────────────────────────────────
  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = proto + '//' + location.host + '/ws';

    showStatus('Connecting...', 'connecting', true);

    ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      showStatus('Connected', '', false);
      if (authenticated && selectedDeviceId) {
        // Re-auth and re-subscribe on reconnect
        ws.send(JSON.stringify({ type: 'auth', pin: pinValue }));
      }
    };

    ws.onclose = () => {
      ws = null;
      if (authenticated) {
        showStatus('Disconnected — reconnecting...', 'error', true);
      }
      scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose will fire after this
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        handleBinaryMessage(event.data);
      } else {
        try {
          handleJsonMessage(JSON.parse(event.data));
        } catch {}
      }
    };
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => connect(), RECONNECT_DELAY_MS);
  }

  // ─── Message Handlers ────────────────────────────────────────
  function handleJsonMessage(msg) {
    switch (msg.type) {
      case 'auth-result':
        if (msg.success) {
          authenticated = true;
          hideStatus();
          // Wait for device-list
        } else {
          showPinError(msg.error || 'Invalid PIN');
        }
        break;

      case 'device-list':
        devices = msg.devices || [];
        if (selectedDeviceId) {
          // Reconnect scenario: re-subscribe
          ws.send(JSON.stringify({ type: 'subscribe', deviceId: selectedDeviceId }));
        } else if (devices.length === 1) {
          // Auto-select single device
          selectDevice(devices[0].id);
        } else if (devices.length > 0) {
          showDeviceList();
        } else {
          showStatus('No virtual devices configured', 'error', true);
        }
        break;

      case 'device-config':
        deviceConfig = msg.config;
        deviceConfig.deviceId = msg.deviceId;
        buildDeck();
        showScreen(deckScreen);
        break;

      case 'slider-value':
        updateSliderValue(msg.slider, msg.value);
        break;
    }
  }

  function handleBinaryMessage(buffer) {
    const view = new DataView(buffer);
    if (view.byteLength < 3) return;

    const msgType = view.getUint8(0);
    if (msgType !== BINARY_MSG_KEY_IMAGE) return;

    const keyIndex = view.getUint16(1, false); // big-endian
    const imageData = new Uint8Array(buffer, 3);

    // Determine image type from magic bytes
    let mimeType = 'image/png';
    if (imageData.length >= 2 && imageData[0] === 0xFF && imageData[1] === 0xD8) {
      mimeType = 'image/jpeg';
    }

    const blob = new Blob([imageData], { type: mimeType });
    const url = URL.createObjectURL(blob);

    const img = document.getElementById('key-img-' + keyIndex);
    if (img) {
      // Revoke old URL to prevent memory leaks
      if (img._blobUrl) URL.revokeObjectURL(img._blobUrl);
      img.src = url;
      img._blobUrl = url;
    }
  }

  // ─── Device Selection ────────────────────────────────────────
  function showDeviceList() {
    deviceList.innerHTML = '';
    devices.forEach(d => {
      const item = document.createElement('div');
      item.className = 'device-item';
      item.innerHTML = '<span class="device-icon">🎛️</span>' +
        '<span class="device-name">' + escapeHtml(d.name) + '</span>' +
        '<span class="device-arrow">›</span>';
      item.addEventListener('pointerdown', () => {
        haptic(10);
        selectDevice(d.id);
      });
      deviceList.appendChild(item);
    });
    showScreen(deviceScreen);
  }

  function selectDevice(id) {
    selectedDeviceId = id;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'subscribe', deviceId: id }));
    }
  }

  // ─── Deck Building ──────────────────────────────────────────
  function buildDeck() {
    if (!deviceConfig) return;
    deckLayout.innerHTML = '';

    const { rows, cols, encoders, sliders } = deviceConfig;

    // Determine if encoders/sliders go on top, bottom, or sides
    const topEncoders = encoders.filter(e => e.side === 'bottom'); // "bottom" in config = bottom of device = top in portrait mobile
    const topSliders = sliders.filter(s => s.side === 'bottom');

    // Build encoder row (if any)
    if (encoders.length > 0) {
      const row = document.createElement('div');
      row.className = 'encoder-row';
      encoders.forEach(enc => {
        row.appendChild(buildEncoderWidget(enc));
      });
      deckLayout.appendChild(row);
    }

    // Build button grid
    const grid = document.createElement('div');
    grid.className = 'button-grid';
    grid.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
    grid.style.gridTemplateRows = 'repeat(' + rows + ', 1fr)';

    const totalKeys = rows * cols;
    for (let i = 0; i < totalKeys; i++) {
      grid.appendChild(buildKeyButton(i));
    }
    deckLayout.appendChild(grid);

    // Build slider row (if any)
    if (sliders.length > 0) {
      const row = document.createElement('div');
      row.className = 'slider-row';
      sliders.forEach(sl => {
        row.appendChild(buildSliderWidget(sl));
      });
      deckLayout.appendChild(row);
    }
  }

  // ─── Key Button ──────────────────────────────────────────────
  function buildKeyButton(index) {
    const btn = document.createElement('button');
    btn.className = 'deck-key';
    btn.setAttribute('aria-label', 'Key ' + (index + 1));
    btn.id = 'key-' + index;

    const img = document.createElement('img');
    img.id = 'key-img-' + index;
    img.alt = '';
    img.draggable = false;
    btn.appendChild(img);

    // Interaction state
    const state = {
      isDown: false,
      longPressTimer: null,
      longPressFired: false,
      lastTapTime: 0,
      doubleTapTimer: null
    };
    keyState.set(index, state);

    function pointerDown(e) {
      e.preventDefault();
      if (state.isDown) return;
      state.isDown = true;
      state.longPressFired = false;
      btn.classList.add('pressed');
      haptic(5);

      // Send key-down
      sendMsg({ type: 'key-down', deviceId: selectedDeviceId, key: index });

      // Start long-press timer
      state.longPressTimer = setTimeout(() => {
        if (state.isDown) {
          state.longPressFired = true;
          haptic(20);
        }
      }, LONG_PRESS_MS);
    }

    function pointerUp(e) {
      e.preventDefault();
      if (!state.isDown) return;
      state.isDown = false;
      btn.classList.remove('pressed');
      clearTimeout(state.longPressTimer);

      // Send key-up
      sendMsg({ type: 'key-up', deviceId: selectedDeviceId, key: index });

      // Double-tap detection (only if long press didn't fire)
      if (!state.longPressFired) {
        const now = Date.now();
        if (now - state.lastTapTime < DOUBLE_TAP_MS) {
          // Double tap detected — the interaction manager on the server
          // handles this via the down/up timing, so we just need rapid taps
          clearTimeout(state.doubleTapTimer);
          state.lastTapTime = 0;
        } else {
          state.lastTapTime = now;
        }
      }
    }

    function pointerCancel(e) {
      e.preventDefault();
      if (!state.isDown) return;
      state.isDown = false;
      btn.classList.remove('pressed');
      clearTimeout(state.longPressTimer);
      sendMsg({ type: 'key-up', deviceId: selectedDeviceId, key: index });
    }

    btn.addEventListener('pointerdown', pointerDown);
    btn.addEventListener('pointerup', pointerUp);
    btn.addEventListener('pointercancel', pointerCancel);
    btn.addEventListener('pointerleave', pointerCancel);
    // Prevent context menu on long press
    btn.addEventListener('contextmenu', e => e.preventDefault());

    return btn;
  }

  // ─── Encoder Widget ──────────────────────────────────────────
  function buildEncoderWidget(encoder) {
    const widget = document.createElement('div');
    widget.className = 'encoder-widget';

    const knob = document.createElement('div');
    knob.className = 'encoder-knob';

    const indicator = document.createElement('div');
    indicator.className = 'encoder-knob-indicator';
    knob.appendChild(indicator);

    const center = document.createElement('div');
    center.className = 'encoder-knob-center';
    knob.appendChild(center);

    const label = document.createElement('div');
    label.className = 'encoder-label';
    label.textContent = encoder.label || encoder.id;

    widget.appendChild(knob);
    widget.appendChild(label);

    // Encoder interaction state
    const state = {
      isDown: false,
      startAngle: 0,
      currentAngle: 0,
      totalDelta: 0,
      lastSentDelta: 0,
      centerX: 0,
      centerY: 0,
      pointerId: null
    };
    encoderState.set(encoder.id, state);

    function getAngle(x, y) {
      return Math.atan2(y - state.centerY, x - state.centerX);
    }

    function pointerDown(e) {
      e.preventDefault();
      if (state.isDown) return;
      state.isDown = true;
      state.pointerId = e.pointerId;
      knob.classList.add('active');
      knob.setPointerCapture(e.pointerId);
      haptic(5);

      const rect = knob.getBoundingClientRect();
      state.centerX = rect.left + rect.width / 2;
      state.centerY = rect.top + rect.height / 2;
      state.startAngle = getAngle(e.clientX, e.clientY);
      state.totalDelta = 0;
      state.lastSentDelta = 0;
    }

    function pointerMove(e) {
      if (!state.isDown || e.pointerId !== state.pointerId) return;
      e.preventDefault();

      const angle = getAngle(e.clientX, e.clientY);
      let diff = angle - state.startAngle;

      // Normalize to [-PI, PI]
      if (diff > Math.PI) diff -= 2 * Math.PI;
      if (diff < -Math.PI) diff += 2 * Math.PI;

      state.totalDelta = diff;

      // Convert radians to rotation "clicks" (each ~15° = 1 click)
      const clicks = Math.round(state.totalDelta / (Math.PI / 12));
      const delta = clicks - state.lastSentDelta;

      if (delta !== 0) {
        state.lastSentDelta = clicks;
        sendMsg({
          type: 'encoder-rotate',
          deviceId: selectedDeviceId,
          encoder: encoder.id,
          delta: delta
        });
        haptic(3);

        // Visual: rotate the indicator
        indicator.style.transform = 'translateX(-50%) rotate(' + (clicks * 15) + 'deg)';
      }
    }

    function pointerUp(e) {
      if (!state.isDown || e.pointerId !== state.pointerId) return;
      e.preventDefault();

      const wasDrag = Math.abs(state.lastSentDelta) > 0;
      state.isDown = false;
      state.pointerId = null;
      knob.classList.remove('active');

      // Reset indicator rotation
      indicator.style.transform = 'translateX(-50%)';

      // If no rotation happened, treat as a press/click
      if (!wasDrag) {
        sendMsg({ type: 'encoder-press', deviceId: selectedDeviceId, encoder: encoder.id });
        haptic(10);
        // Brief visual feedback
        knob.classList.add('active');
        setTimeout(() => knob.classList.remove('active'), 150);
      }
    }

    function pointerCancel(e) {
      if (state.isDown && e.pointerId === state.pointerId) {
        state.isDown = false;
        state.pointerId = null;
        knob.classList.remove('active');
        indicator.style.transform = 'translateX(-50%)';
      }
    }

    knob.addEventListener('pointerdown', pointerDown);
    knob.addEventListener('pointermove', pointerMove);
    knob.addEventListener('pointerup', pointerUp);
    knob.addEventListener('pointercancel', pointerCancel);
    knob.addEventListener('contextmenu', e => e.preventDefault());

    return widget;
  }

  // ─── Slider Widget ───────────────────────────────────────────
  function buildSliderWidget(slider) {
    const widget = document.createElement('div');
    widget.className = 'slider-widget';

    const label = document.createElement('div');
    label.className = 'slider-label';
    label.textContent = slider.label || slider.id;

    const track = document.createElement('div');
    track.className = 'slider-track';
    track.id = 'slider-track-' + slider.id;

    const fill = document.createElement('div');
    fill.className = 'slider-fill';
    fill.id = 'slider-fill-' + slider.id;
    track.appendChild(fill);

    const thumb = document.createElement('div');
    thumb.className = 'slider-thumb';
    thumb.id = 'slider-thumb-' + slider.id;
    track.appendChild(thumb);

    const valueLabel = document.createElement('div');
    valueLabel.className = 'slider-value';
    valueLabel.id = 'slider-value-' + slider.id;
    valueLabel.textContent = '0';

    widget.appendChild(label);
    widget.appendChild(track);
    widget.appendChild(valueLabel);

    // Initialize
    sliderValues.set(slider.id, 0);
    updateSliderUI(slider.id, 0);

    // Slider interaction
    let isDragging = false;
    let pointerId = null;

    function valueFromPointer(e) {
      const rect = track.getBoundingClientRect();
      const y = e.clientY - rect.top;
      // Invert: top = 127, bottom = 0
      const normalized = 1 - Math.max(0, Math.min(1, y / rect.height));
      return Math.round(normalized * 127);
    }

    function pointerDown(e) {
      e.preventDefault();
      isDragging = true;
      pointerId = e.pointerId;
      track.setPointerCapture(e.pointerId);
      haptic(5);

      const val = valueFromPointer(e);
      setSliderValue(slider.id, val);
    }

    function pointerMove(e) {
      if (!isDragging || e.pointerId !== pointerId) return;
      e.preventDefault();
      const val = valueFromPointer(e);
      setSliderValue(slider.id, val);
    }

    function pointerUp(e) {
      if (e.pointerId !== pointerId) return;
      isDragging = false;
      pointerId = null;
    }

    track.addEventListener('pointerdown', pointerDown);
    track.addEventListener('pointermove', pointerMove);
    track.addEventListener('pointerup', pointerUp);
    track.addEventListener('pointercancel', pointerUp);
    track.addEventListener('contextmenu', e => e.preventDefault());

    return widget;
  }

  function setSliderValue(sliderId, value) {
    const prev = sliderValues.get(sliderId);
    if (prev === value) return;
    sliderValues.set(sliderId, value);
    updateSliderUI(sliderId, value);
    sendMsg({
      type: 'slider-change',
      deviceId: selectedDeviceId,
      slider: sliderId,
      value: value
    });
  }

  function updateSliderValue(sliderId, value) {
    sliderValues.set(sliderId, value);
    updateSliderUI(sliderId, value);
  }

  function updateSliderUI(sliderId, value) {
    const pct = (value / 127) * 100;
    const fill = document.getElementById('slider-fill-' + sliderId);
    const thumb = document.getElementById('slider-thumb-' + sliderId);
    const label = document.getElementById('slider-value-' + sliderId);
    if (fill) fill.style.height = pct + '%';
    if (thumb) thumb.style.bottom = 'calc(' + pct + '% - 8px)';
    if (label) label.textContent = value;
  }

  // ─── Helpers ─────────────────────────────────────────────────
  function sendMsg(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Back Button ─────────────────────────────────────────────
  backBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    haptic(10);
    selectedDeviceId = null;
    deviceConfig = null;
    keyState.clear();
    encoderState.clear();
    sliderValues.clear();
    if (devices.length === 1) {
      // Can't go back if there's only one device — disconnect
      showScreen(pinScreen);
      authenticated = false;
      pinValue = '';
      updatePinDots();
      if (ws) ws.close();
    } else {
      showDeviceList();
    }
  });

  // ─── Initialization ─────────────────────────────────────────
  buildPinPad();
  showScreen(pinScreen);
  connect();

})();
</script>
</body>
</html>`;
