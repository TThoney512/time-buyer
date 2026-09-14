// Module: audio.js
// Pooled Web Audio effects. Oscillators stay running and are reused by
// resetting frequency/gain, so rapid sounds do not allocate new nodes.

const AUDIO_POOL_SIZE = 8;
const RELEASE_PADDING_MS = 40;

let _audioCtx = null;
let _pool = null;

export function getAudioContext() {
  if (_audioCtx) {
    return _audioCtx;
  }
  try {
    if (typeof window !== 'undefined' && window.AudioContext) {
      _audioCtx = new window.AudioContext();
    } else if (typeof window !== 'undefined' && window.webkitAudioContext) {
      _audioCtx = new window.webkitAudioContext();
    }
  } catch (error) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('音效初始化失败', error);
    }
  }
  return _audioCtx;
}

function ensurePool() {
  const ctx = getAudioContext();
  if (!ctx) {
    return null;
  }
  if (_pool && _pool.length > 0) {
    return _pool;
  }
  _pool = [];
  for (let i = 0; i < AUDIO_POOL_SIZE; i += 1) {
    try {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.value = 0;
      oscillator.type = 'sine';
      oscillator.frequency.value = 440;
      oscillator.start(0);
      _pool.push({
        oscillator: oscillator,
        gain: gain,
        inUse: false,
        freeAt: 0,
        releaseTimer: null
      });
    } catch (error) {
      // 单个槽位创建失败时跳过，保留其余可用槽位。
    }
  }
  return _pool;
}

function acquireSlot() {
  const pool = ensurePool();
  if (!pool || pool.length === 0) {
    return null;
  }
  const now = Date.now();
  let slot = null;
  for (let i = 0; i < pool.length; i += 1) {
    const candidate = pool[i];
    if (!candidate.inUse && now >= candidate.freeAt) {
      slot = candidate;
      break;
    }
  }
  if (!slot) {
    let earliest = pool[0];
    for (let i = 1; i < pool.length; i += 1) {
      if (pool[i].freeAt < earliest.freeAt) {
        earliest = pool[i];
      }
    }
    slot = earliest;
  }
  if (slot.releaseTimer) {
    clearTimeout(slot.releaseTimer);
    slot.releaseTimer = null;
  }
  slot.inUse = true;
  return slot;
}

function releaseSlot(slot, ctx) {
  if (!slot) {
    return;
  }
  slot.inUse = false;
  slot.freeAt = Date.now();
  if (slot.releaseTimer) {
    clearTimeout(slot.releaseTimer);
    slot.releaseTimer = null;
  }
  try {
    slot.gain.gain.cancelScheduledValues(ctx.currentTime);
    slot.gain.gain.setValueAtTime(0, ctx.currentTime);
  } catch (error) {
    // 回收失败时槽位仍标记为空闲，可被下一次播放复用。
  }
}

export function playTone(freq, duration, type, volume) {
  const ctx = getAudioContext();
  if (!ctx) {
    return;
  }
  try {
    if (ctx.state === 'suspended' && ctx.resume) {
      ctx.resume();
    }
  } catch (error) {
    // 自动恢复失败时继续尝试播放。
  }
  const slot = acquireSlot();
  if (!slot) {
    return;
  }
  const oscillator = slot.oscillator;
  const gain = slot.gain;
  const startTime = ctx.currentTime;
  const safeDuration = Math.max(0.02, Number(duration) || 0.06);
  try {
    oscillator.type = type || 'sine';
    oscillator.frequency.cancelScheduledValues(startTime);
    oscillator.frequency.setValueAtTime(freq, startTime);
    gain.gain.cancelScheduledValues(startTime);
    gain.gain.setValueAtTime(volume || 0.15, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + safeDuration);
  } catch (error) {
    // 节点参数异常时保持静默，不影响游戏流程。
  }
  const releaseDelay = Math.max(0, safeDuration * 1000 + RELEASE_PADDING_MS);
  slot.freeAt = Date.now() + releaseDelay;
  slot.releaseTimer = setTimeout(function () {
    releaseSlot(slot, ctx);
  }, releaseDelay);
}

export function playSound(type) {
  switch (type) {
    case 'purchase':
      playTone(600, 0.08, 'sine', 0.15);
      setTimeout(function () { playTone(800, 0.10, 'sine', 0.12); }, 80);
      break;
    case 'click':
      playTone(400, 0.05, 'sine', 0.10);
      break;
    case 'error':
      playTone(350, 0.12, 'sawtooth', 0.08);
      setTimeout(function () { playTone(250, 0.15, 'sawtooth', 0.06); }, 120);
      break;
    case 'event':
      playTone(500, 0.06, 'sine', 0.12);
      setTimeout(function () { playTone(700, 0.06, 'sine', 0.12); }, 60);
      setTimeout(function () { playTone(900, 0.10, 'sine', 0.15); }, 120);
      break;
    case 'combo':
      playTone(523, 0.12, 'triangle', 0.16);
      setTimeout(function () { playTone(659, 0.12, 'triangle', 0.16); }, 70);
      setTimeout(function () { playTone(784, 0.18, 'triangle', 0.18); }, 140);
      break;
    case 'mastery':
      playTone(392, 0.12, 'sine', 0.14);
      setTimeout(function () { playTone(523, 0.12, 'sine', 0.14); }, 90);
      setTimeout(function () { playTone(659, 0.20, 'sine', 0.16); }, 180);
      break;
    case 'freeze':
      playTone(220, 0.45, 'sine', 0.12);
      setTimeout(function () { playTone(110, 0.40, 'sine', 0.08); }, 90);
      break;
    case 'revive':
      playTone(440, 0.10, 'sine', 0.12);
      setTimeout(function () { playTone(550, 0.10, 'sine', 0.12); }, 100);
      setTimeout(function () { playTone(660, 0.15, 'sine', 0.15); }, 200);
      break;
    default:
      playTone(500, 0.06, 'sine', 0.10);
  }
}
