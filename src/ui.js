// Module: ui.js
// Split from the original game.js during module refactor.
import { trackEvent } from './analytics.js';
import { playSound } from './audio.js';
import { CATEGORY_MASTERY_THRESHOLD, CATEGORY_META, DECISION_MILESTONES_V2, GAME_CONFIG, GRADE_META, SHOP_ITEMS, UI_COLORS, dailySpecial } from './config.js';
import { ACHIEVEMENT_DEFS, BUFF_POOL, PRODUCT_DB, getBuffById, getProductById, getProductsByCategory } from './db.js';
import { GAME_STATE, UI_STATE, fetchFriendLeaderboard, fetchLeaderboard, getGlobalStats, getLeaderboardData, getLifetimeStats, giftItemToFriend, registerNewGameStart, resetGameState, saveGlobalStats, setToast, shareInviteCode, vibrateShort } from './state.js';
import { calculateRoundWealth, drawGlassPanel, drawRoundRectPath, drawText, getCurrentPrice, getCurrentTimeFlow, getTT, getTouchPoint, getUnlockCategorySpent, getUnlockTotalSpent, hexToRgba, isPointInRect, isProductUnlocked, splitTextToLines } from './utils.js';
import { activateTimeFreeze, closeAdventure, closeReviveModalAndEnd, dailyMissions, doFish, openAdventure, requestFreePouchRefresh, requestFreeRevive, purchaseProduct, purchaseShopItem, resolveAdventureChoiceV2, resolveBudgetExhausted, resolveBuffTicketChoice, resolveDecision, resolveEventChoice, updateRound, usePouchItem } from './logic.js';
import { drawSettlementScreen, generateShareCardAndShare, generateSettlementSummary, getSettlementButtonAtPoint, openFeedbackSurvey } from './settlement.js';
import { exportLifeReplay } from './replay.js';
import { openLLMSettingsPanel, getUsage, BUDGET_PRESETS, requestPastLifeEcho } from './llm.js';
import { fmtDays, getLang, t, toggleLang } from './i18n.js';
import { buildMilestoneDialogue, getDialogueSpeakerAt } from './dialogue.js';
import { drawLegalEntryRow, drawLegalFooterLinks, drawLegalModal, handleLegalTouchEnd, handleLegalTouchMove, handleLegalTouchStart, openLegalModal } from './legal.js';

export const GITHUB_URL = 'https://github.com/TThoney512/time-buyer';
import { drawLifetimeModal, handleLifetimeTouchEnd, handleLifetimeTouchMove, handleLifetimeTouchStart, openLifetime } from './lifetime.js';

let _bgCache = null;
let _tabsCache = null;
let _bottomCache = null;
const BOTTOM_CACHE_REFRESH_MS = 800;

export function setupCanvas() {
  const ttApi = getTT();
  const info = ttApi && ttApi.getSystemInfoSync
    ? ttApi.getSystemInfoSync()
    : { windowWidth: 375, windowHeight: 812, pixelRatio: 2 };
  const canvas = ttApi && ttApi.createCanvas ? ttApi.createCanvas() : null;
  if (!canvas) {
    return false;
  }

  UI_STATE.canvas = canvas;
  UI_STATE.screenWidth = info.windowWidth || 375;
  UI_STATE.screenHeight = info.windowHeight || 812;
  UI_STATE.dpr = Math.min(2, info.pixelRatio || 1);
  canvas.width = Math.floor(UI_STATE.screenWidth * UI_STATE.dpr);
  canvas.height = Math.floor(UI_STATE.screenHeight * UI_STATE.dpr);
  UI_STATE.ctx = canvas.getContext('2d');
  if (UI_STATE.ctx) {
    UI_STATE.ctx.scale(UI_STATE.dpr, UI_STATE.dpr);
  }
  _bgCache = null;
  _tabsCache = null;
  _bottomCache = null;
  UI_STATE._tabsCacheDirty = true;
  UI_STATE._tabsSignature = '';
  UI_STATE._bottomCacheDirty = true;
  UI_STATE._bottomCacheAt = 0;
  return true;
}

export function getLayout() {
  const w = UI_STATE.screenWidth;
  const h = UI_STATE.screenHeight;
  const gap = 8;
  const margin = 12;
  const safeTop = Math.max(20, Math.round(h * 0.028));
  const safeBottom = Math.max(10, Math.round(h * 0.018));
  const statusH = 98;
  const tabH = 76;
  const bottomH = 58;

  const status = { x: margin, y: safeTop, w: w - margin * 2, h: statusH };
  const tab = { x: margin, y: status.y + status.h + gap, w: w - margin * 2, h: tabH };
  const bottom = { x: margin, y: h - safeBottom - bottomH, w: w - margin * 2, h: bottomH };
  const listH = bottom.y - gap - (tab.y + tab.h);
  const list = { x: margin, y: tab.y + tab.h + gap, w: w - margin * 2, h: listH };

  const cardGap = 10;
  const cardW = Math.floor((list.w - 24 - cardGap) / 2);
  const cardH = 138;
  const tabCols = 4;
  const tabGap = 6;
  const tabCellW = (tab.w - 24 - (tabCols - 1) * tabGap) / tabCols;
  const tabCellH = 32;
  const rows = 10;
  const listUsableHeight = list.h - 24;
  const maxScroll = Math.max(0, rows * cardH + (rows - 1) * cardGap - listUsableHeight);

  return {
    status: status,
    tab: tab,
    list: list,
    bottom: bottom,
    cardW: cardW,
    cardH: cardH,
    cardGap: cardGap,
    maxScroll: maxScroll,
    tabCols: tabCols,
    tabCellW: tabCellW,
    tabCellH: tabCellH,
    tabOriginX: tab.x + 12,
    tabOriginY: tab.y + 4
  };
}

function createOffscreenCanvas(width, height) {
  const ttApi = getTT();
  let canvas = null;
  if (ttApi && ttApi.createCanvas) {
    try {
      canvas = ttApi.createCanvas();
    } catch (error) {
      canvas = null;
    }
  }
  if (!canvas && typeof document !== 'undefined' && document.createElement) {
    try {
      canvas = document.createElement('canvas');
    } catch (error) {
      canvas = null;
    }
  }
  if (!canvas) {
    return null;
  }
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function getCachePixelSize() {
  return {
    w: Math.floor(UI_STATE.screenWidth * UI_STATE.dpr),
    h: Math.floor(UI_STATE.screenHeight * UI_STATE.dpr)
  };
}

function getRegionPixelSize(rect) {
  return {
    w: Math.floor((rect.w || 0) * UI_STATE.dpr),
    h: Math.floor((rect.h || 0) * UI_STATE.dpr)
  };
}

function drawCache(canvas, drawFn) {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return false;
  }
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(UI_STATE.dpr, UI_STATE.dpr);
  drawFn(ctx);
  ctx.restore();
  return true;
}

function drawRegionCache(canvas, originX, originY, drawFn) {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return false;
  }
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(UI_STATE.dpr, UI_STATE.dpr);
  ctx.translate(-originX, -originY);
  drawFn(ctx);
  ctx.restore();
  return true;
}

function ensureBackgroundCache() {
  const size = getCachePixelSize();
  if (_bgCache && _bgCache.width === size.w && _bgCache.height === size.h) {
    return _bgCache;
  }
  const canvas = createOffscreenCanvas(size.w, size.h);
  if (!canvas || !drawCache(canvas, function (ctx) {
    drawBackground(ctx, 0);
  })) {
    _bgCache = null;
    return null;
  }
  _bgCache = canvas;
  return _bgCache;
}

function updateTabsSignature() {
  const counts = (GAME_STATE && GAME_STATE.categoryPurchaseCount) || {};
  let signature = UI_STATE.activeCategoryId;
  CATEGORY_META.forEach(function (meta) {
    signature += ':' + (counts[meta.id] || 0);
  });
  if (signature !== UI_STATE._tabsSignature) {
    UI_STATE._tabsSignature = signature;
    UI_STATE._tabsCacheDirty = true;
  }
}

function ensureTabsCache(layout) {
  updateTabsSignature();
  const panel = layout.tab;
  const size = getRegionPixelSize(panel);
  const sizeChanged = !_tabsCache || _tabsCache.width !== size.w || _tabsCache.height !== size.h;
  if (!sizeChanged && !UI_STATE._tabsCacheDirty) {
    return _tabsCache;
  }
  const canvas = createOffscreenCanvas(size.w, size.h);
  if (!canvas || !drawRegionCache(canvas, panel.x, panel.y, function (ctx) {
    drawCategoryTabs(ctx, layout);
  })) {
    _tabsCache = null;
    UI_STATE._tabsCacheDirty = false;
    return null;
  }
  _tabsCache = canvas;
  UI_STATE._tabsCacheDirty = false;
  return _tabsCache;
}

function ensureBottomCache(layout) {
  const now = Date.now();
  const stale = now - (UI_STATE._bottomCacheAt || 0) > BOTTOM_CACHE_REFRESH_MS;
  const panel = layout.bottom;
  const size = getRegionPixelSize(panel);
  const sizeChanged = !_bottomCache || _bottomCache.width !== size.w || _bottomCache.height !== size.h;
  if (!sizeChanged && !UI_STATE._bottomCacheDirty && !stale) {
    return _bottomCache;
  }
  const canvas = createOffscreenCanvas(size.w, size.h);
  if (!canvas || !drawRegionCache(canvas, panel.x, panel.y, function (ctx) {
    drawBottomPanel(ctx, layout);
  })) {
    _bottomCache = null;
    UI_STATE._bottomCacheDirty = false;
    return null;
  }
  _bottomCache = canvas;
  UI_STATE._bottomCacheDirty = false;
  UI_STATE._bottomCacheAt = now;
  return _bottomCache;
}

function drawBackgroundLayer(ctx) {
  const w = UI_STATE.screenWidth;
  const h = UI_STATE.screenHeight;
  const bg = ensureBackgroundCache();
  if (bg) {
    ctx.drawImage(bg, 0, 0, w, h);
  } else {
    drawBackground(ctx, Date.now());
  }
}

function drawTabsLayer(ctx, layout) {
  const panel = layout.tab;
  const tabs = ensureTabsCache(layout);
  if (tabs) {
    ctx.drawImage(tabs, panel.x, panel.y, panel.w, panel.h);
  } else {
    drawCategoryTabs(ctx, layout);
  }
}

function drawBottomLayer(ctx, layout) {
  const panel = layout.bottom;
  const bottom = ensureBottomCache(layout);
  if (bottom) {
    ctx.drawImage(bottom, panel.x, panel.y, panel.w, panel.h);
  } else {
    drawBottomPanel(ctx, layout);
  }
}

export function drawBackground(ctx, time) {
  const w = UI_STATE.screenWidth;
  const h = UI_STATE.screenHeight;
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, UI_COLORS.bgTop);
  gradient.addColorStop(0.55, '#101B3C');
  gradient.addColorStop(1, UI_COLORS.bgBottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 46; i += 1) {
    const x = (i * 79 + 17) % w;
    const y = (i * 137 + 31) % h;
    const pulse = 0.35 + 0.3 * Math.sin(time * 0.0007 + i * 0.7);
    ctx.fillStyle = 'rgba(220,230,255,' + pulse.toFixed(2) + ')';
    ctx.fillRect(x, y, i % 3 === 0 ? 1.4 : 1, i % 3 === 0 ? 1.4 : 1);
  }
}

function drawProgressRing(ctx, x, y, radius, progress, color, label) {
  const safeProgress = Math.min(1, Math.max(0, progress || 0));
  ctx.save();
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * safeProgress);
  ctx.stroke();
  drawText(ctx, Math.round(safeProgress * 100) + '%', x, y - 8, 'bold 11px sans-serif', color, 'center', radius * 2, 1);
  drawText(ctx, label, x, y + radius + 3, '9px sans-serif', UI_COLORS.muted, 'center', radius * 2 + 8, 1);
  ctx.restore();
}

function drawStrikethroughText(ctx, text, x, y, font, color) {
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const width = ctx.measureText(text).width;
  ctx.fillText(text, x, y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + 7);
  ctx.lineTo(x + width, y + 7);
  ctx.stroke();
  ctx.restore();
}

function drawOpaqueModalPanel(ctx, x, y, w, h, radius) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 32;
  ctx.fillStyle = '#101A38';
  drawRoundRectPath(ctx, x, y, w, h, radius);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(233,196,106,0.55)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

export function drawStatusPanel(ctx, layout) {
  const panel = layout.status;
  const remaining = GAME_STATE ? Math.max(0, GAME_STATE.remainingDays) : GAME_CONFIG.initialDays;
  const startDays = GAME_STATE && GAME_STATE.startingDays
    ? GAME_STATE.startingDays
    : GAME_CONFIG.initialDays;
  const consumed = Math.max(0, startDays - remaining);
  const secondsLeft = GAME_STATE ? Math.max(0, GAME_STATE.remainingSeconds) : GAME_CONFIG.roundSeconds;
  const currentFlow = getCurrentTimeFlow(GAME_STATE);
  const flowAtMax = currentFlow >= GAME_CONFIG.dayFlowPerSecond - 0.05;
  const flowLabel = '⏱️ x' + Math.round(currentFlow);
  const freezeActive = GAME_STATE && GAME_STATE.timeFreezeActive;
  const wealth = GAME_STATE ? calculateRoundWealth(GAME_STATE) : 0;
  const ownedCount = GAME_STATE ? (GAME_STATE.ownedProductIds || []).length : 0;
  const rightWidth = panel.w * 0.38;
  const padding = 12;
  const leftX = panel.x + padding;
  const rightX = panel.x + panel.w - padding - rightWidth;

  drawGlassPanel(ctx, panel.x, panel.y, panel.w, panel.h, 16, 'rgba(255,255,255,0.06)');

  let y = panel.y + 10;
  drawText(ctx, t('shop.title'), leftX, y, 'bold 17px sans-serif', '#F7E2A0');
  y += 24;
  drawText(ctx, t('shop.wealth'), leftX, y, '11px sans-serif', '#A7B4D8');
  drawText(ctx, '?', leftX + 72, y - 2, 'bold 13px sans-serif', '#7D9CFF', 'center', 18, 1);
  UI_STATE._wealthHelpBtn = { x: leftX + 62, y: y - 5, w: 22, h: 22 };
  drawText(ctx, t('day.val', { n: wealth.toLocaleString() }), leftX + 92, y, 'bold 14px sans-serif', '#E9C46A');
  y += 22;
  drawText(ctx, t('shop.owned', { n: ownedCount }), leftX, y, '10px sans-serif', '#A7B4D8');
  drawText(ctx, '🎁 Buff', leftX + 84, y - 1, 'bold 10px sans-serif', '#E9C46A', 'center', 52, 1);
  UI_STATE._headerBuffBtn = { x: leftX + 74, y: y - 5, w: 62, h: 22 };
  y += 20;
  drawText(ctx, t('shop.passed', { n: Math.floor(consumed).toLocaleString() }), leftX, y, '10px sans-serif', '#A7B4D8');
  drawText(ctx, t('hud.missions'), leftX + 104, y - 2, 'bold 10px sans-serif', '#A7C4FF', 'center', 56, 1);
  UI_STATE._dailyMissionsBtn = { x: leftX + 94, y: y - 5, w: 66, h: 22 };
  const fishCooling = GAME_STATE && GAME_STATE.fishCooldown > 0;
  drawText(ctx, t('hud.fish'), leftX + 164, y - 2, 'bold 10px sans-serif', fishCooling ? UI_COLORS.muted : '#A7C4FF', 'left', 70, 1);
  UI_STATE._fishBtn = { x: leftX + 156, y: y - 8, w: 78, h: 24 };

  const lowDays = remaining < 100;
  const lowTime = secondsLeft < 60;
  const dayPulse = 0.6 + 0.4 * Math.sin(Date.now() / 500);
  const timePulse = 0.6 + 0.4 * Math.sin(Date.now() / 400);
  const dayColor = lowDays ? 'rgba(255,107,107,' + dayPulse.toFixed(2) + ')' : '#F7E2A0';
  const timeColor = freezeActive
    ? 'rgba(125,156,255,' + (0.55 + 0.45 * Math.sin(Date.now() / 260)).toFixed(2) + ')'
    : (lowTime ? 'rgba(255,143,163,' + timePulse.toFixed(2) + ')' : '#E9C46A');

  const ringY = panel.y + 34;
  const ringRadius = 22;
  const dayProgress = startDays > 0 ? Math.min(1, Math.max(0, remaining / startDays)) : 0;
  const timeProgress = GAME_CONFIG.roundSeconds > 0
    ? Math.min(1, Math.max(0, secondsLeft / GAME_CONFIG.roundSeconds))
    : 0;
  drawProgressRing(ctx, rightX + ringRadius + 4, ringY, ringRadius, dayProgress, dayColor, t('ring.days'));
  drawProgressRing(ctx, rightX + rightWidth - ringRadius - 4, ringY, ringRadius, timeProgress, timeColor, t('ring.time'));
  drawText(
    ctx,
    flowLabel,
    rightX + rightWidth / 2,
    y - 2,
    'bold 10px sans-serif',
    flowAtMax ? UI_COLORS.gold : UI_COLORS.muted,
    'center',
    rightWidth,
    1
  );

  UI_STATE._gameHelpBtn = null;
}

export function drawWealthHelpModal(ctx) {
  const w = UI_STATE.screenWidth;
  const h = UI_STATE.screenHeight;
  const modalW = Math.min(w - 48, 300);
  const modalH = 156;
  const modalX = (w - modalW) / 2;
  const modalY = (h - modalH) / 2;
  ctx.fillStyle = 'rgba(4,8,20,0.5)';
  ctx.fillRect(0, 0, w, h);
  drawOpaqueModalPanel(ctx, modalX, modalY, modalW, modalH, 20);
  drawText(ctx, t('wealth.helpTitle'), modalX + 16, modalY + 14, 'bold 15px sans-serif', UI_COLORS.goldLight);
  drawText(
    ctx,
    t('wealth.helpBody'),
    modalX + 16,
    modalY + 48,
    '12px sans-serif',
    UI_COLORS.text,
    'left',
    modalW - 32,
    3
  );
  drawText(ctx, '✕', modalX + modalW - 30, modalY + 10, '18px sans-serif', UI_COLORS.muted, 'center', 24, 1);
  UI_STATE._wealthHelpCloseBtn = { x: modalX + modalW - 42, y: modalY + 6, w: 36, h: 36 };
}

export function drawBuffInfoModal(ctx) {
  const w = UI_STATE.screenWidth;
  const h = UI_STATE.screenHeight;
  const modalW = Math.min(w - 40, 320);
  const buffIds = (GAME_STATE && GAME_STATE.ownedBuffs) || [];
  const buffs = buffIds.map(function (buffId) {
    return getBuffById(buffId);
  }).filter(Boolean);
  const headerH = 46;
  const rowH = 66;
  const modalH = headerH + Math.max(1, buffs.length) * rowH + 16;
  const modalX = (w - modalW) / 2;
  const modalY = Math.max(80, (h - modalH) / 2);
  ctx.fillStyle = 'rgba(4,8,20,0.55)';
  ctx.fillRect(0, 0, w, h);
  drawOpaqueModalPanel(ctx, modalX, modalY, modalW, modalH, 20);
  drawText(ctx, t('buff.activeTitle'), modalX + 16, modalY + 12, 'bold 16px sans-serif', UI_COLORS.goldLight);
  drawText(ctx, '✕', modalX + modalW - 30, modalY + 8, '18px sans-serif', UI_COLORS.muted, 'center', 24, 1);
  UI_STATE._buffInfoCloseBtn = { x: modalX + modalW - 42, y: modalY + 4, w: 36, h: 36 };
  if (!buffs.length) {
    drawText(ctx, t('buff.none'), modalX + 16, modalY + headerH + 12, '12px sans-serif', UI_COLORS.muted);
    return;
  }
  buffs.forEach(function (buff, index) {
    const rowY = modalY + headerH + index * rowH;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    drawRoundRectPath(ctx, modalX + 12, rowY, modalW - 24, rowH - 8, 12);
    ctx.fill();
    drawText(ctx, buff.emoji + ' ' + buff.name, modalX + 24, rowY + 8, 'bold 13px sans-serif', UI_COLORS.text);
    let effect = buff.desc || '';
    if (buff.discount) {
      const discountValue = Math.round(buff.discount * 10);
      if (buff.category === 'all') {
        effect = t('buff.discAll', { v: discountValue, o: (10 - discountValue) * 10 });
      } else {
        const categoryMeta = CATEGORY_META.find(function (category) {
          return category.id === buff.category;
        });
        effect = t('buff.discCat', { cat: t('cat.' + buff.category), v: discountValue, o: (10 - discountValue) * 10 });
      }
    }
    if (buff.bonusDays) {
      effect += t('buff.startPlus', { n: buff.bonusDays });
    }
    drawText(ctx, effect, modalX + 24, rowY + 30, '10px sans-serif', UI_COLORS.muted, 'left', modalW - 48, 2);
  });
}

export function drawDailyMissionsModal(ctx) {
  const w = UI_STATE.screenWidth;
  const h = UI_STATE.screenHeight;
  const global = getGlobalStats();
  const state = global.dailyMissions || { progress: {}, completed: [] };
  const modalW = Math.min(w - 40, 330);
  const headerH = 46;
  const rowH = 58;
  const modalH = headerH + dailyMissions.length * rowH + 16;
  const modalX = (w - modalW) / 2;
  const modalY = Math.max(80, (h - modalH) / 2);
  ctx.fillStyle = 'rgba(4,8,20,0.55)';
  ctx.fillRect(0, 0, w, h);
  drawOpaqueModalPanel(ctx, modalX, modalY, modalW, modalH, 20);
  drawText(ctx, t('missions.title'), modalX + 16, modalY + 12, 'bold 16px sans-serif', UI_COLORS.goldLight);
  drawText(ctx, '✕', modalX + modalW - 30, modalY + 8, '18px sans-serif', UI_COLORS.muted, 'center', 24, 1);
  UI_STATE._dailyMissionsCloseBtn = { x: modalX + modalW - 42, y: modalY + 4, w: 36, h: 36 };
  dailyMissions.forEach(function (mission, index) {
    const progress = state.progress[mission.id] || 0;
    const completed = state.completed.indexOf(mission.id) >= 0;
    const ratio = Math.min(1, progress / mission.target);
    const rowY = modalY + headerH + index * rowH;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    drawRoundRectPath(ctx, modalX + 12, rowY, modalW - 24, rowH - 8, 12);
    ctx.fill();
    drawText(ctx, (completed ? '✅ ' : '📌 ') + mission.name, modalX + 24, rowY + 7, 'bold 13px sans-serif', UI_COLORS.text);
    drawText(
      ctx,
      t('missions.progress', { c: progress, t: mission.target, r: mission.reward }),
      modalX + modalW - 24,
      rowY + 9,
      '10px sans-serif',
      completed ? UI_COLORS.goldLight : UI_COLORS.muted,
      'right',
      96,
      1
    );
    const barX = modalX + 24;
    const barY = rowY + 30;
    const barW = modalW - 48;
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    drawRoundRectPath(ctx, barX, barY, barW, 5, 2.5);
    ctx.fill();
    ctx.fillStyle = completed ? '#7BC67E' : UI_COLORS.gold;
    drawRoundRectPath(ctx, barX, barY, Math.max(5, barW * ratio), 5, 2.5);
    ctx.fill();
  });
}

export function drawCategoryTabs(ctx, layout) {
  const panel = layout.tab;
  drawGlassPanel(ctx, panel.x, panel.y, panel.w, panel.h, 16, 'rgba(255,255,255,0.06)');

  CATEGORY_META.forEach(function (category, index) {
    const col = index % layout.tabCols;
    const row = Math.floor(index / layout.tabCols);
    const x = layout.tabOriginX + col * (layout.tabCellW + 6);
    const y = layout.tabOriginY + row * (layout.tabCellH + 6);
    const active = category.id === UI_STATE.activeCategoryId;
    const purchased = GAME_STATE ? (GAME_STATE.categoryPurchaseCount[category.id] || 0) : 0;
    ctx.save();
    if (active) {
      ctx.fillStyle = 'rgba(233,196,106,0.20)';
      ctx.strokeStyle = UI_COLORS.gold;
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    }
    drawRoundRectPath(ctx, x, y, layout.tabCellW, layout.tabCellH, 20);
    ctx.fill();
    ctx.lineWidth = active ? 1.2 : 1;
    ctx.stroke();
    ctx.restore();

    drawText(
      ctx,
      category.emoji + ' ' + category.name +
        (purchased >= CATEGORY_MASTERY_THRESHOLD ? ' ⭐' : ' ' + purchased),
      x + layout.tabCellW / 2,
      y + (layout.tabCellH - 16) / 2,
      active ? 'bold 11px sans-serif' : '11px sans-serif',
      active ? UI_COLORS.goldLight : UI_COLORS.muted,
      'center',
      layout.tabCellW - 10,
      1
    );
  });
}

export function drawProductCard(ctx, x, y, w, h, product, pressed) {
  const grade = GRADE_META.find(function (meta) {
    return meta.key === product.gradeKey;
  });
  const categoryCount = GAME_STATE ? (GAME_STATE.categoryPurchaseCount[product.category] || 0) : 0;
  const price = getCurrentPrice(product.id, categoryCount);
  const state = GAME_STATE || { totalSpent: 0, categorySpent: {}, ownedProductIds: [] };
  const unlocked = isProductUnlocked(product, state);
  const owned = GAME_STATE && GAME_STATE.ownedProductIds.indexOf(product.id) >= 0;
  const isDailySpecial = dailySpecial.indexOf(product.id) >= 0;

  ctx.save();
  const centerX = x + w / 2;
  const centerY = y + h / 2;
  const scale = (pressed ? 0.94 : 1) * getBounceScale(product.id);
  ctx.translate(centerX, centerY);
  ctx.scale(scale, scale);
  ctx.translate(-centerX, -centerY);
  ctx.save();
  if (pressed) {
    ctx.globalAlpha = 0.2;
  }
  drawGlassPanel(
    ctx,
    x,
    y,
    w,
    h,
    18,
    pressed ? '#FFFFFF' : UI_COLORS.glass,
    pressed ? 20 : 22
  );
  ctx.restore();

  ctx.font = '26px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(product.emoji, x + 14, y + 14);
  if (isDailySpecial) {
    ctx.fillStyle = 'rgba(255,143,163,0.18)';
    drawRoundRectPath(ctx, x + 44, y + 14, 38, 18, 9);
    ctx.fill();
    drawText(ctx, t('shop.special'), x + 63, y + 16, 'bold 9px sans-serif', '#FF8FA3', 'center', 34, 1);
  }

  const badgeW = 48;
  const badgeH = 20;
  const badgeX = x + w - badgeW - 10;
  const badgeY = y + 10;
  ctx.fillStyle = hexToRgba(grade.color, 0.24);
  drawRoundRectPath(ctx, badgeX, badgeY, badgeW, badgeH, 10);
  ctx.fill();
  ctx.strokeStyle = grade.color;
  ctx.lineWidth = 1;
  ctx.stroke();
  drawText(ctx, grade.name, badgeX + badgeW / 2, badgeY + 3, '10px sans-serif', UI_COLORS.text, 'center', badgeW - 6, 1);

  drawText(ctx, product.name, x + 12, y + 50, 'bold 13px sans-serif', UI_COLORS.text, 'left', w - 24, 2);

  const buttonW = 62;
  const buttonH = 26;
  const buttonX = x + w - buttonW - 10;
  const buttonY = y + h - buttonH - 10;
  let buttonText = t('btn.buy');
  let buttonColor = 'rgba(233,196,106,0.20)';
  let buttonTextColor = UI_COLORS.goldLight;
  if (owned) {
    buttonText = t('btn.owned');
    buttonColor = 'rgba(255,255,255,0.08)';
    buttonTextColor = UI_COLORS.muted;
  } else if (!unlocked) {
    buttonText = t('btn.locked');
    buttonColor = 'rgba(255,255,255,0.08)';
    buttonTextColor = UI_COLORS.muted;
  }
  ctx.fillStyle = buttonColor;
  drawRoundRectPath(ctx, buttonX, buttonY, buttonW, buttonH, 16);
  ctx.fill();
  ctx.strokeStyle = owned || !unlocked ? 'rgba(255,255,255,0.14)' : UI_COLORS.gold;
  ctx.lineWidth = 1;
  ctx.stroke();
  drawText(ctx, buttonText, buttonX + buttonW / 2, buttonY + 6, 'bold 11px sans-serif', buttonTextColor, 'center', buttonW - 6, 1);

  const progressTextWidth = w - buttonW - 28;
  if (unlocked) {
    const originalPrice = product.baseCost;
    const currentPrice = Math.floor(price);
    const discountRatio = originalPrice > 0 ? Math.max(0, 1 - currentPrice / originalPrice) : 0;
    const hasDiscount = discountRatio > 0.01;
    if (hasDiscount) {
      const tags = [];
      if (isDailySpecial) {
        tags.push(t('shop.special'));
      }
      const discountText = (tags.length ? tags.join('+') + ' ' : '') + '-' + Math.round(discountRatio * 100) + '%';
      drawStrikethroughText(ctx, t('btn.sellDays', { n: originalPrice.toLocaleString() }), x + 12, y + h - 36, '10px sans-serif', UI_COLORS.muted);
      drawText(
        ctx,
        discountText,
        x + w - buttonW - 16,
        y + h - 36,
        'bold 9px sans-serif',
        '#FF8FA3',
        'right',
        56,
        1
      );
      drawText(
        ctx,
        t('btn.sellDays', { n: currentPrice.toLocaleString() }),
        x + 12,
        y + h - 20,
        'bold 15px sans-serif',
        UI_COLORS.gold,
        'left',
        progressTextWidth,
        1
      );
    } else {
      drawText(
        ctx,
        t('btn.sellDays', { n: currentPrice.toLocaleString() }),
        x + 12,
        y + h - 26,
        'bold 15px sans-serif',
        UI_COLORS.gold,
        'left',
        progressTextWidth,
        1
      );
    }
  } else {
    const progressValue = product.gradeKey === 'advanced'
      ? getUnlockTotalSpent(state)
      : getUnlockCategorySpent(state, product.category);
    const threshold = product.unlockThreshold || 0;
    const progress = threshold > 0 ? Math.min(1, Math.max(0, progressValue / threshold)) : 0;
    drawText(ctx, t('unlock.total'), x + 12, y + h - 52, '9px sans-serif', UI_COLORS.muted, 'left', progressTextWidth, 1);
    drawText(
      ctx,
      Math.floor(progressValue).toLocaleString() + ' / ' + threshold.toLocaleString(),
      x + 12,
      y + h - 42,
      'bold 10px sans-serif',
      UI_COLORS.goldLight,
      'left',
      progressTextWidth,
      1
    );
    const barX = x + 12;
    const barY = y + h - 30;
    const barW = progressTextWidth;
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    drawRoundRectPath(ctx, barX, barY, barW, 5, 2.5);
    ctx.fill();
    ctx.fillStyle = UI_COLORS.gold;
    drawRoundRectPath(ctx, barX, barY, Math.max(5, barW * progress), 5, 2.5);
    ctx.fill();
  }

  const glowStart = UI_STATE.cardGlow[product.id] || 0;
  const glowElapsed = Date.now() - glowStart;
  if (glowElapsed > 0 && glowElapsed < 800) {
    const alpha = 1 - (glowElapsed / 800);
    let red = 233;
    let green = 196;
    let blue = 106;
    if (glowElapsed >= 400) {
      const whiteProgress = (glowElapsed - 400) / 400;
      red = Math.round(233 + (245 - 233) * whiteProgress);
      green = Math.round(196 + (248 - 196) * whiteProgress);
      blue = Math.round(106 + (255 - 106) * whiteProgress);
    }
    ctx.save();
    ctx.shadowColor = glowElapsed < 400 ? UI_COLORS.gold : '#F5F8FF';
    ctx.shadowBlur = Math.min(16, 30 * alpha);
    ctx.strokeStyle = 'rgba(' + red + ', ' + green + ', ' + blue + ', ' + (0.8 * alpha) + ')';
    ctx.lineWidth = 3;
    drawRoundRectPath(ctx, x - 2, y - 2, w + 4, h + 4, 20);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

export function drawProductList(ctx, layout) {
  const panel = layout.list;
  drawGlassPanel(ctx, panel.x, panel.y, panel.w, panel.h, 20);

  const items = getProductsByCategory(UI_STATE.activeCategoryId);
  const innerX = panel.x + 12;
  const innerY = panel.y + 12;
  const usableHeight = panel.h - 24;
  const rows = Math.ceil(items.length / 2);
  const totalHeight = rows * layout.cardH + (rows - 1) * layout.cardGap;
  UI_STATE.scrollOffset = Math.min(Math.max(0, UI_STATE.scrollOffset), layout.maxScroll);

  ctx.save();
  ctx.beginPath();
  ctx.rect(panel.x, panel.y, panel.w, panel.h);
  ctx.clip();

  const step = layout.cardH + layout.cardGap;
  const firstRow = Math.max(0, Math.floor((UI_STATE.scrollOffset - 12) / step) - 1);
  const visibleRows = Math.ceil((usableHeight + 12) / step) + 2;
  const lastRow = Math.min(rows - 1, firstRow + visibleRows);
  const startIndex = firstRow * 2;
  const endIndex = Math.min(items.length, (lastRow + 1) * 2);
  for (let index = startIndex; index < endIndex; index += 1) {
    const product = items[index];
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = innerX + col * (layout.cardW + layout.cardGap);
    const y = innerY + row * (layout.cardH + layout.cardGap) - UI_STATE.scrollOffset;
    if (y + layout.cardH < panel.y || y > panel.y + panel.h) {
      continue;
    }
    drawProductCard(ctx, x, y, layout.cardW, layout.cardH, product, product.id === UI_STATE.pressedProductId);
  }

  if (totalHeight > usableHeight) {
    const trackX = panel.x + panel.w - 4;
    const trackY = panel.y + 16;
    const trackH = panel.h - 28;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    drawRoundRectPath(ctx, trackX, trackY, 2, trackH, 1);
    ctx.fill();
    const thumbH = Math.max(18, trackH * usableHeight / totalHeight);
    const thumbY = trackY + (trackH - thumbH) * (UI_STATE.scrollOffset / Math.max(1, layout.maxScroll));
    ctx.fillStyle = UI_COLORS.gold;
    drawRoundRectPath(ctx, trackX, thumbY, 2, thumbH, 1);
    ctx.fill();
  }

  ctx.restore();
}

export function drawBottomPanel(ctx, layout) {
  const panel = layout.bottom;
  drawGlassPanel(ctx, panel.x, panel.y, panel.w, panel.h, 20);

  const adventureTriggeredCount = GAME_STATE && GAME_STATE.adventureTriggered
    ? GAME_STATE.adventureTriggered.length
    : 0;
  const adventureProgress = t('progress.adventure', { c: adventureTriggeredCount });

  const triggeredCount = GAME_STATE && GAME_STATE.decisionMilestoneTriggered
    ? GAME_STATE.decisionMilestoneTriggered.length
    : 0;
  const nextText = t('progress.decision', { c: triggeredCount, t: DECISION_MILESTONES_V2.length });

  const btnGap = 6;
  const btnW = (panel.w - 12 - btnGap * 3) / 4;
  const btnH = panel.h - 12;
  const btnY = panel.y + 6;

  const drawToolButton = function (x, w, label, sub, pressed, color) {
    ctx.save();
    if (pressed) {
      ctx.translate(x + w / 2, btnY + btnH / 2);
      ctx.scale(0.96, 0.96);
      ctx.translate(-x - w / 2, -btnY - btnH / 2);
    }
    ctx.fillStyle = pressed ? 'rgba(233,196,106,0.22)' : 'rgba(255,255,255,0.06)';
    drawRoundRectPath(ctx, x, btnY, w, btnH, 14);
    ctx.fill();
    ctx.strokeStyle = color || 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    drawText(ctx, label, x + w / 2, btnY + 8, 'bold 12px sans-serif', UI_COLORS.text, 'center', w - 8, 1);
    drawText(ctx, sub, x + w / 2, btnY + 25, '9px sans-serif', UI_COLORS.muted, 'center', w - 8, 1);
  };

  const rulesX = panel.x + 6;
  const freezeX = rulesX + btnW + btnGap;
  const adventureX = freezeX + btnW + btnGap;
  const nextX = adventureX + btnW + btnGap;

  drawToolButton(
    rulesX,
    btnW,
    t('tab.help'),
    t('tab.rules'),
    UI_STATE.pressedBottomRules,
    UI_COLORS.gold
  );
  UI_STATE._bottomRulesBtn = { x: rulesX, y: btnY, w: btnW, h: btnH };

  const global = getGlobalStats();
  const freezeStock = global.shopItems && (global.shopItems.timeFreeze || 0);
  const freezeAvailable = !!freezeStock && !GAME_STATE.timeFreezeActive && !GAME_STATE.timeFreezeUsedThisRound;
  drawToolButton(
    freezeX,
    btnW,
    t('tab.pouch'),
    freezeStock > 0 ? t('tab.kitX', { n: freezeStock }) : t('tab.kit'),
    UI_STATE.pressedFreeze,
    freezeStock > 0 ? '#5B8CFF' : 'rgba(255,255,255,0.14)'
  );
  UI_STATE._freezeBtn = { x: freezeX, y: btnY, w: btnW, h: btnH };
  UI_STATE._bagBtn = { x: freezeX, y: btnY, w: btnW, h: btnH };

  drawToolButton(
    adventureX,
    btnW,
    t('tab.fate'),
    adventureProgress,
    UI_STATE.pressedAdventure,
    adventureTriggeredCount < 3 ? UI_COLORS.gold : 'rgba(255,255,255,0.14)'
  );
  UI_STATE._adventureBtn = { x: adventureX, y: btnY, w: btnW, h: btnH };

  drawToolButton(
    nextX,
    btnW,
    t('tab.choice'),
    nextText,
    UI_STATE.pressedBottomNext,
    '#5B8CFF'
  );
  UI_STATE._bottomNextBtn = { x: nextX, y: btnY, w: btnW, h: btnH };
}

export function drawPouchPanel(ctx) {
  if (!UI_STATE.showPouch) {
    return;
  }
  const w = UI_STATE.screenWidth;
  const h = UI_STATE.screenHeight;
  const modalW = Math.min(w - 40, 340);
  const modalH = 330;
  const modalX = (w - modalW) / 2;
  const modalY = Math.max(80, (h - modalH) / 2);
  ctx.fillStyle = 'rgba(4,8,20,0.55)';
  ctx.fillRect(0, 0, w, h);
  drawOpaqueModalPanel(ctx, modalX, modalY, modalW, modalH, 20);
  drawText(ctx, t('pouch.title'), modalX + 16, modalY + 12, 'bold 16px sans-serif', UI_COLORS.goldLight);
  drawText(ctx, '✕', modalX + modalW - 30, modalY + 8, '18px sans-serif', UI_COLORS.muted, 'center', 24, 1);
  UI_STATE._pouchCloseBtn = { x: modalX + modalW - 42, y: modalY + 4, w: 36, h: 36 };

  const items = (GAME_STATE && GAME_STATE.pouchItems) || [];
  const cardGap = 10;
  const cardW = (modalW - 32 - cardGap * 2) / 3;
  const cardH = 180;
  const cardY = modalY + 52;
  items.forEach(function (item, index) {
    const x = modalX + 16 + index * (cardW + cardGap);
    const used = !!item.used;
    ctx.save();
    ctx.globalAlpha = used ? 0.45 : 1;
    ctx.fillStyle = used ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.08)';
    drawRoundRectPath(ctx, x, cardY, cardW, cardH, 14);
    ctx.fill();
    ctx.strokeStyle = item.free ? 'rgba(233,196,106,0.55)' : 'rgba(91,140,255,0.55)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    drawText(ctx, item.emoji, x + cardW / 2, cardY + 10, '26px sans-serif', UI_COLORS.text, 'center', cardW - 8, 1);
    drawText(ctx, item.name, x + cardW / 2, cardY + 48, 'bold 12px sans-serif', UI_COLORS.text, 'center', cardW - 10, 1);
    drawText(ctx, item.desc, x + cardW / 2, cardY + 70, '10px sans-serif', UI_COLORS.muted, 'center', cardW - 16, 3);
    drawText(
      ctx,
      used ? t('pouch.used') : (item.free ? t('pouch.free') : item.price + ' RP'),
      x + cardW / 2,
      cardY + 152,
      'bold 11px sans-serif',
      item.free ? '#7BC67E' : '#A7C4FF',
      'center',
      cardW - 8,
      1
    );
    ctx.restore();
    UI_STATE['_pouchItemBtn_' + item.id] = { x: x, y: cardY, w: cardW, h: cardH };
  });

  const refreshY = modalY + modalH - 52;
  ctx.fillStyle = 'rgba(91,140,255,0.18)';
  drawRoundRectPath(ctx, modalX + 30, refreshY, modalW - 60, 38, 19);
  ctx.fill();
  ctx.strokeStyle = '#5B8CFF';
  ctx.stroke();
  drawText(ctx, t('pouch.refresh'), modalX + modalW / 2, refreshY + 11, 'bold 13px sans-serif', '#A7C4FF', 'center', modalW - 80, 1);
  UI_STATE._pouchRefreshBtn = { x: modalX + 30, y: refreshY, w: modalW - 60, h: 38 };
}

export function getDecisionModalLayout() {
  const w = UI_STATE.screenWidth;
  const h = UI_STATE.screenHeight;
  const modalW = Math.min(w - 40, 330);
  const modalH = 400;
  const choiceW = modalW - 32;
  const choiceH = 76;
  const choiceGap = 12;
  return {
    modalX: (w - modalW) / 2,
    modalY: (h - modalH) / 2,
    modalW: modalW,
    modalH: modalH,
    choiceX: (w - modalW) / 2 + 16,
    choiceW: choiceW,
    choiceH: choiceH,
    choiceGap: choiceGap,
    choiceStartY: (h - modalH) / 2 + 118
  };
}

function getChoiceEffectSummary(choice) {
  const effect = choice && choice.effect;
  if (!effect) {
    return '';
  }
  switch (effect.type) {
    case 'category_discount':
      const v1 = Math.round(effect.discount * 10); return t('choice.disc', { who: effect.target === 'highest' ? t('choice.highest') : t('choice.lowest'), v: v1, o: (10 - v1) * 10 });
    case 'global_discount':
      const v2 = Math.round(effect.discount * 10); return t('choice.allDisc', { v: v2, o: (10 - v2) * 10 });
    case 'strengthen_legend':
      const v3 = Math.round(effect.discount * 10); return t('choice.discLegend', { v: v3, o: (10 - v3) * 10 });
    case 'days_bonus':
      return t('choice.daysPlus', { n: effect.amount });
    case 'unlock_all_legendary':
      return t('choice.unlockAll');
    default:
      return '';
  }
}

// ============ v0.3 抉择前对话（里程碑人格化） ============
// 层级：画在抉择面板之上。begin = 人物出场卡（tap 进入）；watching = 台词气泡。
// 台词永远存在（本地固定台词），AI 就绪后原位替换 —— 与墓志铭同款降级哲学。
const DIALOGUE_AVATARS = { father: '👨‍🦳', friend: '🧔', mirror: '🪞' };

export function drawMilestoneDialogue(ctx) {
  const dlg = GAME_STATE && GAME_STATE.milestoneDialogue;
  if (!dlg) {
    return;
  }
  const w = UI_STATE.screenWidth;
  const h = UI_STATE.screenHeight;
  const modalW = Math.min(w - 36, 330);
  const modalH = dlg.phase === 'begin' ? 230 : 268;
  const modalX = (w - modalW) / 2;
  const modalY = Math.max(70, (h - modalH) / 2 - 40);
  ctx.fillStyle = 'rgba(4,8,20,0.72)';
  ctx.fillRect(0, 0, w, h);
  drawGlassPanel(ctx, modalX, modalY, modalW, modalH, 22, 'rgba(17,25,51,0.97)');

  const avatar = DIALOGUE_AVATARS[dlg.speaker] || '👤';
  const speakerName = t('dlg.speaker.' + dlg.speaker);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = '40px sans-serif';
  ctx.fillText(avatar, modalX + modalW / 2, modalY + 26);
  ctx.font = 'bold 16px sans-serif';
  ctx.fillStyle = UI_COLORS.goldLight;
  ctx.fillText(speakerName, modalX + modalW / 2, modalY + 78);
  ctx.restore();

  if (dlg.phase === 'begin') {
    const btnW = 130;
    const btnH = 40;
    const btnX = modalX + (modalW - btnW) / 2;
    const btnY = modalY + modalH - 66;
    ctx.fillStyle = 'rgba(233,196,106,0.18)';
    drawRoundRectPath(ctx, btnX, btnY, btnW, btnH, 20);
    ctx.fill();
    ctx.strokeStyle = UI_COLORS.gold;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    drawText(ctx, t('dlg.begin'), btnX + btnW / 2, btnY + 11, 'bold 14px sans-serif', UI_COLORS.goldLight, 'center', btnW - 16, 1);
    return; // begin 阶段全屏可点，无需热区
  }

  // watching：台词 + 底部"跳过"与"继续"
  const line = String((dlg.lines && dlg.lines[dlg.lineIndex]) || '');
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  const bubbleY = modalY + 112;
  const bubbleH = 84;
  drawRoundRectPath(ctx, modalX + 16, bubbleY, modalW - 32, bubbleH, 16);
  ctx.fill();
  ctx.restore();
  drawText(ctx, line, modalX + modalW / 2, bubbleY + 12, '13px sans-serif', UI_COLORS.text, 'center', modalW - 52, 4);

  if (!dlg.ai) {
    drawText(ctx, t('dlg.offlineTip'), modalX + modalW / 2, bubbleY + bubbleH + 8, '9px sans-serif', UI_COLORS.muted, 'center', modalW - 32, 1);
  }

  drawText(ctx, t('dlg.next'), modalX + modalW / 2, modalY + modalH - 30, 'bold 13px sans-serif', UI_COLORS.goldLight, 'center', 120, 1);
  // 跳过按钮（右上角 ✕ 之外再给一个明示热区）
  const skipW = 64;
  const skipH = 26;
  const skipX = modalX + modalW - skipW - 12;
  const skipY = modalY + modalH - skipH - 10;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  drawRoundRectPath(ctx, skipX, skipY, skipW, skipH, 13);
  ctx.fill();
  ctx.restore();
  drawText(ctx, t('dlg.skip'), skipX + skipW / 2, skipY + 6, '11px sans-serif', UI_COLORS.muted, 'center', skipW - 8, 1);
  UI_STATE._dlgSkipBtn = { x: skipX, y: skipY, w: skipW, h: skipH };
}

export function drawDecisionModal(ctx) {
  const milestone = GAME_STATE && GAME_STATE.pendingDecisionMilestone;
  if (!milestone) {
    return;
  }
  const modal = getDecisionModalLayout();
  ctx.save();
  ctx.fillStyle = 'rgba(4,8,20,0.64)';
  ctx.fillRect(0, 0, UI_STATE.screenWidth, UI_STATE.screenHeight);
  drawGlassPanel(ctx, modal.modalX, modal.modalY, modal.modalW, modal.modalH, 24, 'rgba(17,25,51,0.92)');
  drawText(ctx, t('decision.title'), modal.modalX + 18, modal.modalY + 18, 'bold 13px sans-serif', UI_COLORS.gold);
  drawText(ctx, milestone.title, modal.modalX + 18, modal.modalY + 44, 'bold 18px sans-serif', UI_COLORS.text, 'left', modal.modalW - 36, 1);
  if (milestone.desc) {
    drawText(ctx, milestone.desc, modal.modalX + 18, modal.modalY + 70, '11px sans-serif', UI_COLORS.muted, 'left', modal.modalW - 36, 1);
  }

  milestone.choices.forEach(function (choice, index) {
    const x = modal.choiceX;
    const y = modal.choiceStartY + index * (modal.choiceH + modal.choiceGap);
    const pressed = choice.id === UI_STATE.pressedChoiceId;
    ctx.save();
    ctx.fillStyle = pressed ? 'rgba(233,196,106,0.24)' : 'rgba(255,255,255,0.10)';
    drawRoundRectPath(ctx, x, y, modal.choiceW, modal.choiceH, 18);
    ctx.fill();
    ctx.strokeStyle = pressed ? UI_COLORS.gold : UI_COLORS.glassBorder;
    ctx.lineWidth = pressed ? 1.4 : 1;
    ctx.stroke();
    ctx.restore();

    const isEffectChoice = !!choice.effect;
    const product = isEffectChoice ? null : getProductById(choice.productId);
    const price = product ? getCurrentPrice(choice.productId, 0, true) : 0;
    drawText(ctx, choice.emoji + ' ' + (isEffectChoice ? choice.text : choice.name), x + 14, y + 10, 'bold 15px sans-serif', UI_COLORS.text, 'left', modal.choiceW - 28, 1);
    drawText(ctx, choice.desc, x + 14, y + 34, '11px sans-serif', UI_COLORS.muted, 'left', modal.choiceW - 28, 2);
    if (!isEffectChoice) {
      drawText(ctx, t('btn.sellDays', { n: Math.floor(price).toLocaleString() }), x + modal.choiceW - 14, y + 10, 'bold 14px sans-serif', UI_COLORS.goldLight, 'right');
    }
  });
  ctx.restore();
}

export function drawEventModal(ctx) {
  const pending = GAME_STATE && GAME_STATE.pendingEvent;
  if (!pending) {
    return;
  }
  const event = pending.event || {};
  const options = event.options || [];
  const modal = getDecisionModalLayout();
  ctx.save();
  ctx.fillStyle = 'rgba(4,8,20,0.64)';
  ctx.fillRect(0, 0, UI_STATE.screenWidth, UI_STATE.screenHeight);
  drawGlassPanel(ctx, modal.modalX, modal.modalY, modal.modalW, modal.modalH, 24, 'rgba(17,25,51,0.92)');
  drawText(ctx, t('event.title'), modal.modalX + 18, modal.modalY + 18, 'bold 13px sans-serif', UI_COLORS.gold);
  drawText(
    ctx,
    event.emoji + ' ' + event.name,
    modal.modalX + 18,
    modal.modalY + 44,
    'bold 18px sans-serif',
    UI_COLORS.text,
    'left',
    modal.modalW - 36,
    2
  );

  options.forEach(function (option, index) {
    const x = modal.choiceX;
    const y = modal.choiceStartY + index * (modal.choiceH + modal.choiceGap);
    const pressed = option.id === UI_STATE.pressedEventChoiceId;
    ctx.save();
    ctx.fillStyle = pressed ? 'rgba(233,196,106,0.24)' : 'rgba(255,255,255,0.10)';
    drawRoundRectPath(ctx, x, y, modal.choiceW, modal.choiceH, 18);
    ctx.fill();
    ctx.strokeStyle = pressed ? UI_COLORS.gold : UI_COLORS.glassBorder;
    ctx.lineWidth = pressed ? 1.4 : 1;
    ctx.stroke();
    ctx.restore();

    drawText(ctx, option.emoji + ' ' + option.name, x + 14, y + 10, 'bold 15px sans-serif', UI_COLORS.text, 'left', modal.choiceW - 78, 1);
    drawText(ctx, option.desc, x + 14, y + 34, '11px sans-serif', UI_COLORS.muted, 'left', modal.choiceW - 28, 2);
    const sign = option.currencyChange >= 0 ? '+' : '';
    drawText(
      ctx,
      t('day.val', { n: sign + option.currencyChange }),
      x + modal.choiceW - 14,
      y + 10,
      'bold 13px sans-serif',
      option.currencyChange >= 0 ? '#7BC67E' : UI_COLORS.danger,
      'right'
    );
    UI_STATE['_eventChoice_' + index] = { x: x, y: y, w: modal.choiceW, h: modal.choiceH };
  });
  ctx.restore();
}

export function drawToast(ctx) {
  const toast = GAME_STATE && GAME_STATE.uiToast;
  if (!toast || Date.now() > toast.expiresAt) {
    return;
  }
  const toastW = Math.min(UI_STATE.screenWidth - 44, 320);
  const toastH = 62;
  const x = (UI_STATE.screenWidth - toastW) / 2;
  const y = getLayout().bottom.y - toastH - 10;
  const negative = toast.kind === 'negative' || toast.kind === 'error';
  drawGlassPanel(ctx, x, y, toastW, toastH, 20, negative ? 'rgba(120,30,50,0.68)' : 'rgba(30,45,90,0.72)');
  drawText(ctx, toast.title, x + 14, y + 10, 'bold 14px sans-serif', negative ? UI_COLORS.danger : UI_COLORS.goldLight);
  drawText(ctx, toast.desc || '', x + 14, y + 33, '11px sans-serif', UI_COLORS.muted, 'left', toastW - 28, 2);
}

export function drawAdventureModalV2(ctx) {
  const pending = GAME_STATE && GAME_STATE.pendingAdventure;
  if (!pending) {
    return;
  }
  const w = UI_STATE.screenWidth;
  const h = UI_STATE.screenHeight;
  const modalW = Math.min(w - 40, 340);
  const modalH = 520;
  const modalX = (w - modalW) / 2;
  const modalY = Math.max(60, (h - modalH) / 2 - 10);
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, w, h);
  drawOpaqueModalPanel(ctx, modalX, modalY, modalW, modalH, 24);
  // P0-2：右上角关闭按钮，避免玩家不选选项时 _adventurePaused 永久停住时间。
  const closeX = modalX + modalW - 26;
  const closeY = modalY + 10;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '22px sans-serif';
  ctx.fillStyle = UI_COLORS.muted;
  ctx.fillText('✕', closeX, closeY + 8);
  UI_STATE._adventureCloseBtn = { x: closeX - 16, y: closeY - 4, w: 40, h: 40 };
  drawText(ctx, pending.emoji + ' ' + pending.title, modalX + modalW / 2, modalY + 16, 'bold 20px sans-serif', UI_COLORS.goldLight, 'center', modalW - 80, 1);
  let offsetY = 52;
  if (pending._doubleActive) {
    drawText(ctx, t('fate.double'), modalX + modalW / 2, modalY + 46, 'bold 13px sans-serif', '#FFD700', 'center', modalW - 40, 1);
    offsetY = 72;
  }
  drawText(ctx, pending.desc, modalX + 20, modalY + offsetY, '12px sans-serif', UI_COLORS.muted, 'left', modalW - 40, 4);
  offsetY += 72;

  const choices = pending.choices || [];
  const btnH = 104;
  const gap = 12;
  const startY = modalY + offsetY;
  choices.forEach(function (choice, index) {
    const y = startY + index * (btnH + gap);
    const pressed = UI_STATE.pressedAdventureChoice === choice.id;
    ctx.save();
    ctx.fillStyle = pressed ? 'rgba(233,196,106,0.20)' : 'rgba(255,255,255,0.08)';
    drawRoundRectPath(ctx, modalX + 20, y, modalW - 40, btnH, 16);
    ctx.fill();
    ctx.strokeStyle = pressed ? UI_COLORS.gold : 'rgba(255,255,255,0.18)';
    ctx.lineWidth = pressed ? 1.5 : 1;
    ctx.stroke();
    ctx.restore();
    drawText(ctx, choice.emoji, modalX + 32, y + 8, '18px sans-serif', UI_COLORS.text);
    drawText(ctx, choice.text, modalX + 58, y + 8, 'bold 15px sans-serif', UI_COLORS.text, 'left', modalW - 96, 1);
    drawText(ctx, choice.desc || '', modalX + 24, y + 34, '11px sans-serif', UI_COLORS.muted, 'left', modalW - 56, 2);
    const gradeName = { normal: t('grade.normal'), advanced: t('grade.advanced'), rare: t('grade.rare'), legend: t('grade.legend') };
    const effectDesc = (choice.effects || []).map(function (effect) {
      switch (effect.type) {
        case 'days':
          return t('fx.days', { sign: effect.value > 0 ? '+' : '', v: effect.value });
        case 'random_item':
          return effect.chance ? t('fx.chanceGain', { p: Math.round(effect.chance * 100), g: gradeName[effect.grade] || effect.grade }) : t('fx.gainItem', { g: gradeName[effect.grade] || effect.grade });
        case 'prop':
          return t('fx.item');
        case 'flow':
          return t('fx.flow', { sign: effect.value > 0 ? '+' : '', v: effect.value.toFixed(1) });
        case 'category_spend': {
          const categoryMeta = CATEGORY_META.find(function (category) {
            return category.id === effect.category;
          });
          return t('fx.spend', { cat: t('cat.' + effect.category), v: effect.amount });
        }
        case 'boost_positive_events':
          return t('fx.positive', { v: effect.duration });
        default:
          return '';
      }
    }).filter(Boolean).join('；');
    drawText(ctx, effectDesc, modalX + 24, y + 74, '10px sans-serif', '#A7C4FF', 'left', modalW - 56, 2);
    UI_STATE['_adventureChoice_' + choice.id] = { x: modalX + 20, y: y, w: modalW - 40, h: btnH };
  });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.font = '11px sans-serif';
  ctx.fillStyle = UI_COLORS.muted;
  ctx.fillText(t('fate.giveup'), modalX + modalW / 2, modalY + modalH - 12);
}

export function drawAdventureModal(ctx) {
  if (!GAME_STATE) {
    return;
  }
  const unlocked = GAME_STATE.adventureUnlocked || {};
  const used = GAME_STATE.adventureUsed || {};
  let activeKey = null;
  ['at5000', 'at10000', 'at15000'].forEach(function (key) {
    if (unlocked[key] && !used[key]) {
      activeKey = key;
    }
  });
  if (!activeKey) {
    return;
  }

  const choices = GAME_STATE.adventureChoices || [];
  if (choices.length === 0) {
    return;
  }

  Object.keys(UI_STATE).forEach(function (key) {
    if (key.indexOf('_adventureChoice_') === 0) {
      delete UI_STATE[key];
    }
  });

  const w = UI_STATE.screenWidth;
  const h = UI_STATE.screenHeight;

  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, w, h);

  const modalW = Math.min(w - 40, 340);
  const modalH = choices.length >= 5 ? 500 : 400;
  const modalX = (w - modalW) / 2;
  const modalY = (h - modalH) / 2 - 20;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 40;
  ctx.fillStyle = 'rgba(15,25,55,0.94)';
  drawRoundRectPath(ctx, modalX, modalY, modalW, modalH, 28);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = UI_COLORS.gold;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillStyle = UI_COLORS.goldLight;
  ctx.fillText(t('fate.title'), modalX + modalW / 2, modalY + 18);

  const thresholdMap = { at5000: t('day.val', { n: '5000' }), at10000: t('day.val', { n: '10000' }), at15000: t('day.val', { n: '15000' }) };
  ctx.font = '13px sans-serif';
  ctx.fillStyle = UI_COLORS.muted;
  ctx.fillText(t('fate.at', { t: thresholdMap[activeKey] || '' }), modalX + modalW / 2, modalY + 52);
  ctx.fillText(t('fate.pickBuff'), modalX + modalW / 2, modalY + 74);

  const btnW = modalW - 40;
  const btnH = choices.length >= 5 ? 52 : 58;
  const gap = choices.length >= 5 ? 8 : 10;
  const startY = modalY + 98;

  choices.forEach(function (buff, index) {
    const y = startY + index * (btnH + gap);
    const pressed = UI_STATE.pressedAdventureChoice === buff.id;
    const isUpgrade = buff.type === 'upgrade';
    const isReroll = buff.type === 'reroll';
    const isNew = !isUpgrade && !isReroll;
    const tagText = isUpgrade ? t('fate.upgrade') : (isReroll ? t('fate.reroll') : t('fate.newTalent'));
    const tagColor = isUpgrade ? '#A78BFA' : (isReroll ? UI_COLORS.gold : '#5B8CFF');
    const borderColor = isUpgrade ? '#A78BFA' : (isReroll ? UI_COLORS.gold : '#5B8CFF');
    const fillColor = pressed
      ? 'rgba(233,196,106,0.20)'
      : (isUpgrade ? 'rgba(167,139,250,0.10)' : (isReroll ? 'rgba(233,196,106,0.12)' : 'rgba(91,140,255,0.10)'));
    const descText = isUpgrade && buff.upgradeText ? buff.upgradeText : buff.desc;

    ctx.save();
    if (pressed) {
      ctx.translate(modalX + 20 + btnW / 2, y + btnH / 2);
      ctx.scale(0.97, 0.97);
      ctx.translate(-modalX - 20 - btnW / 2, -y - btnH / 2);
    }
    ctx.fillStyle = fillColor;
    drawRoundRectPath(ctx, modalX + 20, y, btnW, btnH, 16);
    ctx.fill();
    ctx.strokeStyle = pressed ? UI_COLORS.gold : borderColor;
    ctx.lineWidth = pressed ? 1.5 : 1;
    ctx.stroke();
    ctx.restore();

    drawText(ctx, buff.emoji, modalX + 34, y + 18, '22px sans-serif', UI_COLORS.text);
    drawText(ctx, buff.name, modalX + 68, y + 16, 'bold 15px sans-serif', UI_COLORS.text, 'left', btnW - 130, 1);
    drawText(ctx, tagText, modalX + 20 + btnW - 8, y + 7, 'bold 10px sans-serif', tagColor, 'right', 70, 1);
    drawText(ctx, descText, modalX + 68, y + 40, '11px sans-serif', UI_COLORS.muted, 'left', btnW - 24, 1);

    UI_STATE['_adventureChoice_' + buff.id] = { x: modalX + 20, y: y, w: btnW, h: btnH };
  });

  const closeX = modalX + modalW - 32;
  const closeY = modalY + 10;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '22px sans-serif';
  ctx.fillStyle = UI_COLORS.muted;
  ctx.fillText('✕', closeX, closeY + 8);
  UI_STATE._adventureCloseBtn = { x: closeX - 16, y: closeY - 8, w: 32, h: 32 };

  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.font = '11px sans-serif';
  ctx.fillStyle = UI_COLORS.muted;
  ctx.fillText(t('fate.closeHint'), modalX + modalW / 2, modalY + modalH - 12);
}

// 天书 V2：双栏（基础/进阶）条目卡片版式。
// 排版红线：render 与高度计算共用同一套间距常量（HELP_*），改动只许调常量。
const HELP_ROW_PAD = 10;
const HELP_TEXT_SIZE = 12;
const HELP_LINE_H = 17;
const HELP_SECTION_GAP = 16;
const HELP_ROW_GAP = 8;
const HELP_PAD_X = 20;
const HELP_SECTION_HEAD_H = 34;

// 统一测量：条目卡高度 = max(编号圆 22, 文本行数*17) + 上下内边距。
// splitTextToLines 带 font+width+text 缓存，每帧测量代价可忽略。
function measureHelpRowHeight(ctx, text, textW) {
  ctx.save();
  ctx.font = HELP_TEXT_SIZE + 'px sans-serif';
  const lines = splitTextToLines(ctx, text, textW).length;
  ctx.restore();
  return Math.max(22, lines * HELP_LINE_H) + HELP_ROW_PAD * 2;
}

function drawHelpSectionTitle(ctx, sec, x, y, w) {
  // 小节头：左侧竖色条 + 标题 + 底部分隔（比整宽胶囊更像"分节"而非"按钮"）。
  ctx.save();
  ctx.fillStyle = sec.color;
  drawRoundRectPath(ctx, x, y + 5, 3, 16, 1.5);
  ctx.fill();
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillStyle = sec.color;
  ctx.fillText(sec.title, x + 12, y + 13);
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + HELP_SECTION_HEAD_H - 6);
  ctx.lineTo(x + w, y + HELP_SECTION_HEAD_H - 6);
  ctx.stroke();
}

// 天书页内的窄版协议胶囊（legal.js 的 drawLegalEntryRow 固定 200px 宽，双列会重叠）。
// regY 传入滚动还原后的屏幕系 y，触摸命中不受滚动影响。
function drawHelpLegalPill(ctx, x, y, w, h, docId, label, regY) {
  ctx.save();
  ctx.fillStyle = 'rgba(91,140,255,0.16)';
  drawRoundRectPath(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.strokeStyle = '#5B8CFF';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  drawText(ctx, label, x + w / 2, y + h / 2 - 6, 'bold 11px sans-serif', '#A7C4FF', 'center', w - 12, 1);
  UI_STATE['_legalEntryBtn_' + docId] = { x: x, y: regY, w: w, h: h };
}

export function drawHelpModal(ctx) {
  const w = UI_STATE.screenWidth;
  const h = UI_STATE.screenHeight;

  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, w, h);

  const sections = [
    { title: t('help.basicTitle'), color: UI_COLORS.gold, bg: 'rgba(233,196,106,0.16)', items: [t('help.basic1'), t('help.basic2'), t('help.basic3')] },
    { title: t('help.advancedTitle'), color: UI_COLORS.blue, bg: 'rgba(125,156,255,0.16)', items: [t('help.adv1'), t('help.adv2'), t('help.adv3'), t('help.adv4'), t('help.adv5'), t('help.adv6')] }
  ];

  const modalW = Math.min(w - 32, 352);
  const modalX = (w - modalW) / 2;
  const innerX = modalX + HELP_PAD_X;
  const innerW = modalW - HELP_PAD_X * 2;

  // —— 测量：所有行高先算完，再定弹窗高度。渲染与高度共用同一常量，禁止分叉。
  let rowNo = 0;
  const sectionLayouts = sections.map(function (sec) {
    const rows = sec.items.map(function (text) {
      rowNo += 1;
      return { text: text, no: rowNo, h: measureHelpRowHeight(ctx, text, innerW - 52) };
    });
    const rowsH = rows.reduce(function (acc, r) { return acc + r.h + HELP_ROW_GAP; }, -HELP_ROW_GAP);
    return { sec: sec, rows: rows, blockH: HELP_SECTION_HEAD_H + rowsH };
  });
  const listBlockH = 44;
  const legalBlockH = 14 + 34 + 8 + 34 + 6; // 分隔 + 双列一行 + 未保一行
  const headerH = 54;
  const footerH = 24;
  const bottomPad = 10;
  const contentH = 8 + sectionLayouts[0].blockH + HELP_SECTION_GAP + sectionLayouts[1].blockH
    + HELP_SECTION_GAP + listBlockH + 6 + legalBlockH + bottomPad;

  const availH = h - 56;
  const needScroll = headerH + contentH + footerH > availH;
  const modalH = needScroll ? availH : Math.min(availH, headerH + contentH + footerH);
  const modalY = Math.max(28, (h - modalH) / 2);
  const viewportTop = modalY + headerH;
  const viewportH = modalH - headerH - footerH;
  const maxScroll = Math.max(0, contentH - viewportH);
  if (!needScroll) {
    UI_STATE.helpScroll = 0;
  }
  UI_STATE.helpScroll = Math.min(UI_STATE.helpScroll || 0, maxScroll);
  const scroll = UI_STATE.helpScroll || 0;
  UI_STATE._helpMaxScroll = maxScroll;
  UI_STATE._helpContentRect = { x: modalX, y: viewportTop, w: modalW, h: viewportH };

  drawOpaqueModalPanel(ctx, modalX, modalY, modalW, modalH, 26);

  // —— 页眉（固定不滚动）：居中金色标题 + 发丝分隔线 + ✕ 关闭。
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 21px sans-serif';
  ctx.fillStyle = UI_COLORS.goldLight;
  ctx.fillText(t('help.title'), modalX + modalW / 2, modalY + 24);
  ctx.strokeStyle = 'rgba(233,196,106,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(modalX + 24, modalY + headerH - 4);
  ctx.lineTo(modalX + modalW - 24, modalY + headerH - 4);
  ctx.stroke();

  const closeCx = modalX + modalW - 28;
  const closeCy = modalY + 24;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.arc(closeCx, closeCy, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.font = '13px sans-serif';
  ctx.fillStyle = UI_COLORS.muted;
  ctx.fillText('✕', closeCx, closeCy + 1);
  UI_STATE._helpCloseBtn = { x: closeCx - 16, y: closeCy - 16, w: 32, h: 32 };

  // —— 滚动区：clip + 平移绘制，热区按滚动后位置注册。
  ctx.save();
  ctx.beginPath();
  ctx.rect(modalX, viewportTop, modalW, viewportH);
  ctx.clip();
  ctx.translate(0, -scroll);
  let cy = viewportTop + 8;

  sectionLayouts.forEach(function (secLayout, si) {
    drawHelpSectionTitle(ctx, secLayout.sec, innerX, cy, innerW);
    let ry = cy + HELP_SECTION_HEAD_H;
    secLayout.rows.forEach(function (row) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      drawRoundRectPath(ctx, innerX, ry, innerW, row.h, 12);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
      // 编号圆点（金=基础 / 蓝=进阶），连续编号 1-9。
      const badgeR = 11;
      const badgeCx = innerX + 8 + badgeR;
      const badgeCy = ry + row.h / 2;
      ctx.save();
      ctx.fillStyle = si === 0 ? 'rgba(233,196,106,0.22)' : 'rgba(125,156,255,0.22)';
      ctx.beginPath();
      ctx.arc(badgeCx, badgeCy, badgeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = si === 0 ? UI_COLORS.goldLight : '#A7C4FF';
      ctx.fillText(String(row.no), badgeCx, badgeCy + 0.5);
      // 条目文本（多行，垂直居中）。注意：滚动区内注册的 rect 要还原到屏幕系（减 scroll），
      // 触摸点给的是屏幕坐标。
      const textX = innerX + 8 + badgeR * 2 + 10;
      ctx.save();
      ctx.font = HELP_TEXT_SIZE + 'px sans-serif';
      ctx.fillStyle = UI_COLORS.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const lines = splitTextToLines(ctx, row.text, innerW - (textX - innerX) - 12);
      const textY0 = ry + (row.h - lines.length * HELP_LINE_H) / 2;
      lines.forEach(function (ln, li) {
        ctx.fillText(ln, textX, textY0 + li * HELP_LINE_H);
      });
      ctx.restore();
      ry += row.h + HELP_ROW_GAP;
    });
    cy += secLayout.blockH + HELP_SECTION_GAP;
  });

  // 人生清单入口（金色胶囊）——游戏功能，视觉权重压在合规区之上。
  const ltBtnW = Math.min(250, innerW);
  const ltBtnH = 40;
  const ltBtnX = modalX + modalW / 2 - ltBtnW / 2;
  ctx.save();
  ctx.fillStyle = 'rgba(233,196,106,0.18)';
  drawRoundRectPath(ctx, ltBtnX, cy, ltBtnW, ltBtnH, 20);
  ctx.fill();
  ctx.strokeStyle = UI_COLORS.gold;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
  const ltCollected = Object.keys(getGlobalStats().lifetimeOwned || {}).length;
  drawText(ctx, t('help.listTitle', { c: ltCollected }), ltBtnX + ltBtnW / 2, cy + ltBtnH / 2 - 6, 'bold 13px sans-serif', UI_COLORS.goldLight, 'center', ltBtnW - 12, 1);
  UI_STATE._helpLifetimeBtn = { x: ltBtnX, y: cy - scroll, w: ltBtnW, h: ltBtnH };
  cy += listBlockH + 6;

  // 合规区：发丝分隔 + 隐私/协议双列 + 未保提示整行（旧版三枚同宽胶囊堆叠，视觉重心失衡）。
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(modalX + 24, cy + 1);
  ctx.lineTo(modalX + modalW - 24, cy + 1);
  ctx.stroke();
  cy += 14;
  const legalGap = 10;
  const legalColW = (innerW - legalGap) / 2;
  drawHelpLegalPill(ctx, innerX, cy, legalColW, 34, 'privacy', t('legal.tabPrivacy'), cy - scroll);
  drawHelpLegalPill(ctx, innerX + legalColW + legalGap, cy, legalColW, 34, 'terms', t('legal.tabTerms'), cy - scroll);
  cy += 34 + 8;
  drawHelpLegalPill(ctx, innerX, cy, innerW, 34, 'minor', t('legal.tabMinor'), cy - scroll);
  ctx.restore(); // 结束 clip

  // 滚动提示条（内容超高时才出现）。
  if (maxScroll > 0) {
    const trackH = Math.max(24, viewportH * (viewportH / contentH));
    const thumbY = viewportTop + (viewportH - trackH) * (scroll / maxScroll);
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    drawRoundRectPath(ctx, modalX + modalW - 6, thumbY, 3, trackH, 1.5);
    ctx.fill();
    ctx.restore();
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '11px sans-serif';
  ctx.fillStyle = UI_COLORS.muted;
  ctx.fillText(needScroll ? t('help.scrollHint') : t('help.tapClose'), modalX + modalW / 2, modalY + modalH - footerH / 2 - 1);
}

// 天书触摸：命中关闭/清单/协议按钮返回 true；内容区按下则开始滚动跟踪。
export function handleHelpTouchStart(point) {
  if (!UI_STATE.showHelp || !point) {
    return false;
  }
  const closeBtn = UI_STATE._helpCloseBtn;
  if (closeBtn && isPointInRect(point, closeBtn)) {
    UI_STATE.showHelp = false;
    UI_STATE.helpScroll = 0;
    return true;
  }
  const ltBtn = UI_STATE._helpLifetimeBtn;
  if (ltBtn && isPointInRect(point, ltBtn)) {
    openLifetime('all');
    return true;
  }
  const legalEntryIds = ['privacy', 'terms', 'minor'];
  for (let i = 0; i < legalEntryIds.length; i += 1) {
    const rect = UI_STATE['_legalEntryBtn_' + legalEntryIds[i]];
    if (rect && isPointInRect(point, rect)) {
      openLegalModal(legalEntryIds[i]);
      return true;
    }
  }
  const contentRect = UI_STATE._helpContentRect;
  if (contentRect && isPointInRect(point, contentRect)) {
    UI_STATE.helpTouchStartY = point.y;
    UI_STATE.helpTouchStartScroll = UI_STATE.helpScroll || 0;
    UI_STATE.helpTouchMoved = false;
    UI_STATE.touchMode = 'help-scroll';
    return true;
  }
  return false; // 弹窗外：交给"点击任意处关闭"
}

export function handleHelpTouchMove(point) {
  if (!UI_STATE.showHelp || UI_STATE.touchMode !== 'help-scroll' || !point) {
    return false;
  }
  const maxScroll = UI_STATE._helpMaxScroll || 0;
  const next = (UI_STATE.helpTouchStartScroll || 0) - (point.y - (UI_STATE.helpTouchStartY || 0));
  UI_STATE.helpScroll = Math.min(Math.max(0, next), maxScroll);
  if (Math.abs(point.y - (UI_STATE.helpTouchStartY || 0)) > 8) {
    UI_STATE.helpTouchMoved = true;
  }
  return true;
}

// 返回 true 表示事件已被消费。未移动 = 内容区点击（等同旧版"点任意处关闭"），移动 = 结束滚动。
export function handleHelpTouchEnd() {
  if (UI_STATE.touchMode !== 'help-scroll') {
    return false;
  }
  if (!UI_STATE.helpTouchMoved) {
    UI_STATE.showHelp = false;
    UI_STATE.helpScroll = 0;
  }
  UI_STATE.touchMode = 'none';
  return true;
}

export function drawReviveModal(ctx) {
  if (!GAME_STATE || !GAME_STATE.showReviveModal) {
    return;
  }

  const w = UI_STATE.screenWidth;
  const h = UI_STATE.screenHeight;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(0, 0, w, h);

  const modalW = Math.min(w - 48, 320);
  const modalH = 280;
  const modalX = (w - modalW) / 2;
  const modalY = (h - modalH) / 2 - 20;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 40;
  ctx.fillStyle = 'rgba(15, 25, 55, 0.92)';
  drawRoundRectPath(ctx, modalX, modalY, modalW, modalH, 28);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = UI_COLORS.gold;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = UI_COLORS.goldLight;
  ctx.font = '48px sans-serif';
  ctx.fillText('⏳', modalX + modalW / 2, modalY + 24);

  ctx.font = 'bold 22px sans-serif';
  ctx.fillStyle = UI_COLORS.goldLight;
  ctx.fillText(t('revive.warn'), modalX + modalW / 2, modalY + 88);

  ctx.font = '15px sans-serif';
  ctx.fillStyle = UI_COLORS.muted;
  const bonusDays = GAME_CONFIG.reviveBonusDays;
  const bonusSec = GAME_CONFIG.reviveBonusSeconds;
  ctx.fillText(
    t('revive.offer', { d: bonusDays, s: bonusSec }),
    modalX + modalW / 2,
    modalY + 126
  );
  ctx.fillText(t('revive.once'), modalX + modalW / 2, modalY + 152);

  const btnW = 120;
  const btnH = 46;
  const gap = 16;
  const totalW = btnW * 2 + gap;
  const btnY = modalY + modalH - btnH - 28;

  const leftX = modalX + (modalW - totalW) / 2;
  const rightX = leftX + btnW + gap;

  const isWatchPressed = UI_STATE.pressedReviveWatch;
  const isQuitPressed = UI_STATE.pressedReviveQuit;

  ctx.save();
  if (isWatchPressed) {
    ctx.translate(leftX + btnW / 2, btnY + btnH / 2);
    ctx.scale(0.96, 0.96);
    ctx.translate(-leftX - btnW / 2, -btnY - btnH / 2);
  }
  ctx.fillStyle = isWatchPressed ? 'rgba(233,196,106,0.3)' : 'rgba(233,196,106,0.18)';
  drawRoundRectPath(ctx, leftX, btnY, btnW, btnH, 24);
  ctx.fill();
  ctx.strokeStyle = UI_COLORS.gold;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillStyle = UI_COLORS.goldLight;
  ctx.fillText(t('revive.watch'), leftX + btnW / 2, btnY + btnH / 2);

  ctx.save();
  if (isQuitPressed) {
    ctx.translate(rightX + btnW / 2, btnY + btnH / 2);
    ctx.scale(0.96, 0.96);
    ctx.translate(-rightX - btnW / 2, -btnY - btnH / 2);
  }
  ctx.fillStyle = isQuitPressed ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)';
  drawRoundRectPath(ctx, rightX, btnY, btnW, btnH, 24);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = UI_COLORS.muted;
  ctx.fillText(t('revive.quit'), rightX + btnW / 2, btnY + btnH / 2);

  UI_STATE._reviveWatchBtn = { x: leftX, y: btnY, w: btnW, h: btnH };
  UI_STATE._reviveQuitBtn = { x: rightX, y: btnY, w: btnW, h: btnH };
}

/**
 * AI 额度耗尽弹窗：仅结算阶段、墓志铭请求已回落到模板且未重试时绘制。
 * 两个出口：追加额度继续用 AI / 固定模板（免费，本局不再请求）。
 */
export function drawBudgetModal(ctx) {
  if (!GAME_STATE || !GAME_STATE.budgetExhausted || GAME_STATE.aiLoading) {
    return;
  }
  const w = UI_STATE.screenWidth;
  const h = UI_STATE.screenHeight;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(0, 0, w, h);

  const modalW = Math.min(w - 48, 320);
  const modalH = 250;
  const modalX = (w - modalW) / 2;
  const modalY = (h - modalH) / 2 - 20;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 40;
  ctx.fillStyle = 'rgba(15, 25, 55, 0.94)';
  drawRoundRectPath(ctx, modalX, modalY, modalW, modalH, 28);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = UI_COLORS.gold;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  const usage = getUsage();
  const addAmount = BUDGET_PRESETS[0] || 50000;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = '44px sans-serif';
  ctx.fillText('🤖', modalX + modalW / 2, modalY + 20);

  ctx.font = 'bold 20px sans-serif';
  ctx.fillStyle = UI_COLORS.goldLight;
  ctx.fillText(t('budget.title'), modalX + modalW / 2, modalY + 78);

  ctx.font = '14px sans-serif';
  ctx.fillStyle = UI_COLORS.muted;
  const desc = t('budget.desc', { u: usage.used.toLocaleString(), b: usage.budget.toLocaleString() });
  splitTextToLines(ctx, desc, modalW - 44).forEach(function (line, i) {
    ctx.fillText(line, modalX + modalW / 2, modalY + 108 + i * 20);
  });

  const btnW = 124;
  const btnH = 44;
  const gap = 14;
  const totalW = btnW * 2 + gap;
  const btnY = modalY + modalH - btnH - 26;
  const leftX = modalX + (modalW - totalW) / 2;
  const rightX = leftX + btnW + gap;

  const isContPressed = UI_STATE.pressedBudgetContinue;
  ctx.save();
  if (isContPressed) {
    ctx.translate(leftX + btnW / 2, btnY + btnH / 2);
    ctx.scale(0.96, 0.96);
    ctx.translate(-leftX - btnW / 2, -btnY - btnH / 2);
  }
  ctx.fillStyle = isContPressed ? 'rgba(233,196,106,0.3)' : 'rgba(233,196,106,0.18)';
  drawRoundRectPath(ctx, leftX, btnY, btnW, btnH, 22);
  ctx.fill();
  ctx.strokeStyle = UI_COLORS.gold;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillStyle = UI_COLORS.goldLight;
  const addLabel = addAmount >= 10000 ? (addAmount / 10000) + '万' : String(addAmount);
  ctx.fillText(t('budget.continue', { n: addLabel }), leftX + btnW / 2, btnY + btnH / 2);

  const isTplPressed = UI_STATE.pressedBudgetTemplate;
  ctx.save();
  if (isTplPressed) {
    ctx.translate(rightX + btnW / 2, btnY + btnH / 2);
    ctx.scale(0.96, 0.96);
    ctx.translate(-rightX - btnW / 2, -btnY - btnH / 2);
  }
  ctx.fillStyle = isTplPressed ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)';
  drawRoundRectPath(ctx, rightX, btnY, btnW, btnH, 22);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = UI_COLORS.muted;
  ctx.fillText(t('budget.template'), rightX + btnW / 2, btnY + btnH / 2);

  UI_STATE._budgetContinueBtn = { x: leftX, y: btnY, w: btnW, h: btnH };
  UI_STATE._budgetTemplateBtn = { x: rightX, y: btnY, w: btnW, h: btnH };
}

export function drawShopModal(ctx) {
  if (!UI_STATE.showShop) {
    return;
  }
  const w = UI_STATE.screenWidth;
  const h = UI_STATE.screenHeight;
  const modalW = Math.min(w - 40, 340);
  const modalH = 500;
  const modalX = (w - modalW) / 2;
  const modalY = (h - modalH) / 2 - 10;
  const global = getGlobalStats();

  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 40;
  ctx.fillStyle = 'rgba(15,25,55,0.96)';
  drawRoundRectPath(ctx, modalX, modalY, modalW, modalH, 28);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = UI_COLORS.gold;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  drawText(ctx, t('rpshop.title'), modalX + 18, modalY + 18, 'bold 18px sans-serif', UI_COLORS.goldLight);
  drawText(
    ctx,
    t('rpshop.points', { n: (global.reincarnationPoints || 0).toLocaleString() }),
    modalX + 18,
    modalY + 52,
    'bold 13px sans-serif',
    UI_COLORS.gold,
    'left',
    modalW - 70,
    1
  );

  const closeX = modalX + modalW - 34;
  const closeY = modalY + 12;
  drawText(ctx, '✕', closeX, closeY + 4, '22px sans-serif', UI_COLORS.muted, 'center', 30, 1);
  UI_STATE._shopCloseBtn = { x: closeX - 18, y: closeY - 10, w: 36, h: 36 };

  const cols = 2;
  const gap = 10;
  const cardGap = 10;
  const cardW = (modalW - 40 - cardGap) / 2;
  const cardH = 96;
  const startX = modalX + 20;
  const startY = modalY + 88;

  SHOP_ITEMS.forEach(function (item, index) {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = startX + col * (cardW + cardGap);
    const y = startY + row * (cardH + gap);
    const affordable = (global.reincarnationPoints || 0) >= item.price;

    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    drawRoundRectPath(ctx, x, y, cardW, cardH, 16);
    ctx.fill();
    ctx.strokeStyle = affordable ? UI_COLORS.gold : 'rgba(255,255,255,0.16)';
    ctx.lineWidth = affordable ? 1.2 : 1;
    ctx.stroke();

    drawText(ctx, item.icon, x + 10, y + 8, '22px sans-serif', UI_COLORS.text);
    drawText(ctx, item.name, x + 40, y + 12, 'bold 12px sans-serif', UI_COLORS.text, 'left', cardW - 46, 1);
    drawText(ctx, item.desc, x + 10, y + 38, '9px sans-serif', UI_COLORS.muted, 'left', cardW - 20, 2);
    drawText(ctx, item.price + ' RP', x + 10, y + cardH - 24, 'bold 12px sans-serif', UI_COLORS.goldLight);
    drawText(
      ctx,
      affordable ? t('btn.buy') : t('rpshop.notEnough'),
      x + cardW - 10,
      y + cardH - 24,
      'bold 10px sans-serif',
      affordable ? UI_COLORS.gold : UI_COLORS.muted,
      'right',
      50,
      1
    );
    UI_STATE['_shopItemBtn_' + item.id] = { x: x, y: y, w: cardW, h: cardH };
  });
}

export function openLeaderboard() {
  UI_STATE.showLeaderboard = true;
  UI_STATE.leaderboardTab = 'global';
  fetchLeaderboard();
  fetchFriendLeaderboard();
  return getLeaderboardData('global');
}

export function renderLeaderboardList(ctx, entries, x, y, w, h, tab) {
  const list = entries || [];
  if (tab === 'friends' && list.length === 0) {
    drawText(ctx, t('board.emptyFriends'), x + w / 2, y + h / 2, 'bold 13px sans-serif', UI_COLORS.muted, 'center', w - 20, 2);
    return;
  }
  if (tab !== 'friends' && list.length === 0) {
    drawText(ctx, t('board.emptyGlobal'), x + w / 2, y + h / 2, 'bold 13px sans-serif', UI_COLORS.muted, 'center', w - 20, 2);
    return;
  }
  const visibleCount = Math.min(8, list.length);
  const rowH = 42;
  const ownIndex = list.findIndex(function (entry) {
    return entry.openId === 'local-player';
  });

  for (let i = 0; i < visibleCount; i += 1) {
    const entry = list[i];
    const rowY = y + i * rowH;
    const rank = i + 1;
    const isOwn = entry.openId === 'local-player';
    ctx.save();
    if (isOwn) {
      ctx.fillStyle = 'rgba(233,196,106,0.16)';
      drawRoundRectPath(ctx, x, rowY, w, rowH - 4, 10);
      ctx.fill();
      ctx.strokeStyle = UI_COLORS.gold;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.restore();
    const medal = rank === 1 ? '🥇' : (rank === 2 ? '🥈' : (rank === 3 ? '🥉' : ''));
    drawText(
      ctx,
      medal || String(rank),
      x + 20,
      rowY + 11,
      'bold 14px sans-serif',
      rank <= 3 ? UI_COLORS.goldLight : UI_COLORS.muted,
      'center',
      30,
      1
    );
    ctx.save();
    ctx.fillStyle = hexToRgba(entry.avatar ? '#7D9CFF' : '#4A5A80', 0.8);
    ctx.beginPath();
    ctx.arc(x + 52, rowY + 19, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = UI_COLORS.text;
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((entry.nickname || '?').slice(0, 1), x + 52, rowY + 20);
    ctx.restore();
    drawText(ctx, String(entry.nickname || t('board.player')).slice(0, 6), x + 74, rowY + 11, 'bold 12px sans-serif', UI_COLORS.text, 'left', w - 140, 1);
    drawText(
      ctx,
      t('day.val', { n: (entry.bestScore || 0).toLocaleString() }),
      x + w - 12,
      rowY + 11,
      'bold 12px sans-serif',
      isOwn ? UI_COLORS.goldLight : UI_COLORS.gold,
      'right',
      tab === 'friends' ? 70 : 90,
      1
    );
    if (tab === 'friends' && !isOwn) {
      const giftX = x + w - 118;
      const giftY = rowY + 8;
      ctx.fillStyle = 'rgba(91,140,255,0.18)';
      drawRoundRectPath(ctx, giftX, giftY, 34, 26, 13);
      ctx.fill();
      drawText(ctx, '🎁', giftX + 17, giftY + 6, '12px sans-serif', '#A7C4FF', 'center', 30, 1);
      UI_STATE['_friendGiftBtn_' + entry.openId] = { x: giftX, y: giftY, w: 34, h: 26 };
    }
    if (isOwn) {
      drawText(ctx, t('board.you'), x + w - 112, rowY + 11, 'bold 10px sans-serif', UI_COLORS.gold, 'right', 50, 1);
    }
  }

  if (ownIndex >= visibleCount && ownIndex >= 0) {
    const own = list[ownIndex];
    const sepY = y + visibleCount * rowH + 2;
    drawText(ctx, t('board.rankLine'), x + w / 2, sepY, '10px sans-serif', UI_COLORS.muted, 'center', w - 20, 1);
    const rowY = sepY + 20;
    drawText(ctx, '#' + (ownIndex + 1), x + 20, rowY, 'bold 14px sans-serif', UI_COLORS.goldLight, 'center', 30, 1);
    drawText(ctx, String(own.nickname || t('board.me')).slice(0, 6), x + 74, rowY, 'bold 12px sans-serif', UI_COLORS.text, 'left', w - 140, 1);
    drawText(ctx, t('day.val', { n: (own.bestScore || 0).toLocaleString() }), x + w - 12, rowY, 'bold 12px sans-serif', UI_COLORS.goldLight, 'right', 90, 1);
    drawText(ctx, t('board.you'), x + w - 112, rowY, 'bold 10px sans-serif', UI_COLORS.gold, 'right', 50, 1);
  }
}

export function drawLeaderboardModal(ctx) {
  if (!UI_STATE.showLeaderboard) {
    return;
  }
  const w = UI_STATE.screenWidth;
  const h = UI_STATE.screenHeight;
  const modalW = Math.min(w - 40, 340);
  const modalH = 520;
  const modalX = (w - modalW) / 2;
  const modalY = (h - modalH) / 2 - 10;
  const tab = UI_STATE.leaderboardTab || 'global';

  ctx.fillStyle = 'rgba(0,0,0,0.74)';
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 40;
  ctx.fillStyle = 'rgba(15,25,55,0.96)';
  drawRoundRectPath(ctx, modalX, modalY, modalW, modalH, 28);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = UI_COLORS.gold;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  drawText(ctx, t('board.title'), modalX + 18, modalY + 18, 'bold 18px sans-serif', UI_COLORS.goldLight);
  const closeX = modalX + modalW - 34;
  const closeY = modalY + 12;
  drawText(ctx, '✕', closeX, closeY + 4, '22px sans-serif', UI_COLORS.muted, 'center', 30, 1);
  UI_STATE._leaderboardCloseBtn = { x: closeX - 18, y: closeY - 10, w: 36, h: 36 };

  const tabGap = 8;
  const tabW = (modalW - 40 - tabGap) / 2;
  const tabH = 36;
  const tabY = modalY + 52;
  const globalTabX = modalX + 20;
  const friendsTabX = globalTabX + tabW + tabGap;
  ctx.fillStyle = tab === 'global' ? 'rgba(233,196,106,0.20)' : 'rgba(255,255,255,0.07)';
  drawRoundRectPath(ctx, globalTabX, tabY, tabW, tabH, 14);
  ctx.fill();
  ctx.strokeStyle = tab === 'global' ? UI_COLORS.gold : 'rgba(255,255,255,0.16)';
  ctx.stroke();
  drawText(ctx, t('board.global'), globalTabX + tabW / 2, tabY + 10, 'bold 13px sans-serif', tab === 'global' ? UI_COLORS.goldLight : UI_COLORS.muted, 'center', tabW - 8, 1);
  UI_STATE._leaderboardGlobalTab = { x: globalTabX, y: tabY, w: tabW, h: tabH };

  ctx.fillStyle = tab === 'friends' ? 'rgba(91,140,255,0.22)' : 'rgba(255,255,255,0.07)';
  drawRoundRectPath(ctx, friendsTabX, tabY, tabW, tabH, 14);
  ctx.fill();
  ctx.strokeStyle = tab === 'friends' ? '#5B8CFF' : 'rgba(255,255,255,0.16)';
  ctx.stroke();
  drawText(ctx, t('board.friends'), friendsTabX + tabW / 2, tabY + 10, 'bold 13px sans-serif', tab === 'friends' ? '#A7C4FF' : UI_COLORS.muted, 'center', tabW - 8, 1);
  UI_STATE._leaderboardFriendsTab = { x: friendsTabX, y: tabY, w: tabW, h: tabH };

  const entries = getLeaderboardData(tab);
  const listX = modalX + 16;
  const listY = tabY + tabH + 12;
  const listW = modalW - 32;
  const listH = 330;
  renderLeaderboardList(ctx, entries, listX, listY, listW, listH, tab);

  const inviteY = modalY + modalH - 58;
  ctx.fillStyle = 'rgba(91,140,255,0.18)';
  drawRoundRectPath(ctx, modalX + 30, inviteY, modalW - 60, 40, 20);
  ctx.fill();
  ctx.strokeStyle = '#5B8CFF';
  ctx.stroke();
  drawText(ctx, t('board.invite'), modalX + modalW / 2, inviteY + 12, 'bold 14px sans-serif', '#A7C4FF', 'center', modalW - 80, 1);
  UI_STATE._leaderboardInviteBtn = { x: modalX + 30, y: inviteY, w: modalW - 60, h: 40 };
}

export function getLeaderboardTabAtPoint(point) {
  if (UI_STATE._leaderboardGlobalTab && isPointInRect(point, UI_STATE._leaderboardGlobalTab)) {
    return 'global';
  }
  if (UI_STATE._leaderboardFriendsTab && isPointInRect(point, UI_STATE._leaderboardFriendsTab)) {
    return 'friends';
  }
  return null;
}

function getFriendGiftKeyAtPoint(point) {
  const entries = getLeaderboardData('friends');
  for (let i = 0; i < entries.length; i += 1) {
    const rect = UI_STATE['_friendGiftBtn_' + entries[i].openId];
    if (rect && isPointInRect(point, rect)) {
      return entries[i].openId;
    }
  }
  return null;
}

function getGiftItemAtPoint(point) {
  const items = SHOP_ITEMS.slice(0, 4);
  for (let i = 0; i < items.length; i += 1) {
    const rect = UI_STATE['_giftItemBtn_' + items[i].id];
    if (rect && isPointInRect(point, rect)) {
      return items[i].id;
    }
  }
  return null;
}

export function drawGiftModal(ctx) {
  if (!UI_STATE.showGiftModal) {
    return;
  }
  const w = UI_STATE.screenWidth;
  const h = UI_STATE.screenHeight;
  const target = UI_STATE.giftTarget || {};
  const global = getGlobalStats();
  const points = global.reincarnationPoints || 0;
  const items = SHOP_ITEMS.slice(0, 4);
  const modalW = Math.min(w - 40, 330);
  const rowH = 58;
  const modalH = 46 + 26 + items.length * rowH + 16;
  const modalX = (w - modalW) / 2;
  const modalY = Math.max(80, (h - modalH) / 2);
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(0, 0, w, h);
  drawOpaqueModalPanel(ctx, modalX, modalY, modalW, modalH, 20);
  drawText(ctx, t('gift.title'), modalX + 16, modalY + 12, 'bold 16px sans-serif', UI_COLORS.goldLight);
  drawText(ctx, t('gift.to', { n: target.nickname || t('toast.friend') }), modalX + 16, modalY + 38, '10px sans-serif', UI_COLORS.muted, 'left', modalW - 48, 1);
  drawText(ctx, '✕', modalX + modalW - 30, modalY + 8, '18px sans-serif', UI_COLORS.muted, 'center', 24, 1);
  UI_STATE._giftCloseBtn = { x: modalX + modalW - 42, y: modalY + 4, w: 36, h: 36 };
  items.forEach(function (item, index) {
    const rowY = modalY + 72 + index * rowH;
    const afford = points >= item.price;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    drawRoundRectPath(ctx, modalX + 12, rowY, modalW - 24, rowH - 8, 12);
    ctx.fill();
    drawText(ctx, item.icon + ' ' + item.name, modalX + 24, rowY + 9, 'bold 12px sans-serif', UI_COLORS.text);
    drawText(ctx, t('gift.cost', { n: item.price }), modalX + 24, rowY + 30, '10px sans-serif', afford ? UI_COLORS.goldLight : UI_COLORS.muted);
    drawText(
      ctx,
      afford ? t('gift.send') : t('rpshop.notEnough'),
      modalX + modalW - 28,
      rowY + 12,
      'bold 11px sans-serif',
      afford ? '#A7C4FF' : UI_COLORS.muted,
      'right',
      64,
      1
    );
    UI_STATE['_giftItemBtn_' + item.id] = { x: modalX + modalW - 92, y: rowY + 6, w: 64, h: 36 };
  });
}

export function drawBuffPickerModal(ctx) {
  if (!UI_STATE.buffPickerOpen) {
    return;
  }
  const w = UI_STATE.screenWidth;
  const h = UI_STATE.screenHeight;
  const modalW = Math.min(w - 40, 340);
  const modalH = 520;
  const modalX = (w - modalW) / 2;
  const modalY = (h - modalH) / 2 - 10;

  ctx.fillStyle = 'rgba(0,0,0,0.74)';
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 40;
  ctx.fillStyle = 'rgba(15,25,55,0.96)';
  drawRoundRectPath(ctx, modalX, modalY, modalW, modalH, 28);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#A78BFA';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  drawText(ctx, t('buffpick.title'), modalX + 18, modalY + 18, 'bold 18px sans-serif', UI_COLORS.goldLight);
  drawText(ctx, t('buffpick.hint'), modalX + 18, modalY + 50, '12px sans-serif', UI_COLORS.muted);

  const closeX = modalX + modalW - 34;
  const closeY = modalY + 12;
  drawText(ctx, '✕', closeX, closeY + 4, '22px sans-serif', UI_COLORS.muted, 'center', 30, 1);
  UI_STATE._buffPickCloseBtn = { x: closeX - 18, y: closeY - 10, w: 36, h: 36 };

  const cols = 2;
  const gap = 8;
  const cardGap = 8;
  const cardW = (modalW - 40 - cardGap) / 2;
  const cardH = 72;
  const startX = modalX + 20;
  const startY = modalY + 80;

  BUFF_POOL.forEach(function (buff, index) {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = startX + col * (cardW + cardGap);
    const y = startY + row * (cardH + gap);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    drawRoundRectPath(ctx, x, y, cardW, cardH, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(167,139,250,0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
    drawText(ctx, buff.emoji, x + 8, y + 8, '20px sans-serif', UI_COLORS.text);
    drawText(ctx, buff.name, x + 32, y + 8, 'bold 11px sans-serif', UI_COLORS.text, 'left', cardW - 36, 1);
    drawText(ctx, buff.desc, x + 8, y + 36, '9px sans-serif', UI_COLORS.muted, 'left', cardW - 16, 2);
    UI_STATE['_buffPick_' + buff.id] = { x: x, y: y, w: cardW, h: cardH };
  });
}

export function getShopItemAtPoint(point) {
  for (let i = 0; i < SHOP_ITEMS.length; i += 1) {
    const rect = UI_STATE['_shopItemBtn_' + SHOP_ITEMS[i].id];
    if (rect && isPointInRect(point, rect)) {
      return SHOP_ITEMS[i].id;
    }
  }
  return null;
}

export function getBuffPickAtPoint(point) {
  for (let i = 0; i < BUFF_POOL.length; i += 1) {
    const rect = UI_STATE['_buffPick_' + BUFF_POOL[i].id];
    if (rect && isPointInRect(point, rect)) {
      return BUFF_POOL[i].id;
    }
  }
  return null;
}

export function getDecisionChoiceAtPoint(point) {
  const milestone = GAME_STATE && GAME_STATE.pendingDecisionMilestone;
  if (!milestone) {
    return null;
  }
  const modal = getDecisionModalLayout();
  for (let i = 0; i < milestone.choices.length; i += 1) {
    const y = modal.choiceStartY + i * (modal.choiceH + modal.choiceGap);
    if (
      point.x >= modal.choiceX &&
      point.x <= modal.choiceX + modal.choiceW &&
      point.y >= y &&
      point.y <= y + modal.choiceH
    ) {
      return milestone.choices[i].id;
    }
  }
  return null;
}

export function getEventChoiceAtPoint(point) {
  const pending = GAME_STATE && GAME_STATE.pendingEvent;
  if (!pending) {
    return null;
  }
  const options = (pending.event && pending.event.options) || [];
  const modal = getDecisionModalLayout();
  for (let i = 0; i < options.length; i += 1) {
    const y = modal.choiceStartY + i * (modal.choiceH + modal.choiceGap);
    if (
      point.x >= modal.choiceX &&
      point.x <= modal.choiceX + modal.choiceW &&
      point.y >= y &&
      point.y <= y + modal.choiceH
    ) {
      return options[i].id;
    }
  }
  return null;
}

export function drawPlatformModal(ctx) {
  if (!UI_STATE.showPlatformModal) {
    return;
  }
  const w = UI_STATE.screenWidth;
  const h = UI_STATE.screenHeight;
  const modalW = Math.min(w - 40, 300);
  const modalH = 240;
  const modalX = (w - modalW) / 2;
  const modalY = Math.max(80, (h - modalH) / 2);
  ctx.fillStyle = 'rgba(4,8,20,0.55)';
  ctx.fillRect(0, 0, w, h);
  drawOpaqueModalPanel(ctx, modalX, modalY, modalW, modalH, 20);
  drawText(ctx, t('platform.title'), modalX + 16, modalY + 12, 'bold 16px sans-serif', UI_COLORS.goldLight);
  drawText(ctx, '✕', modalX + modalW - 30, modalY + 8, '18px sans-serif', UI_COLORS.muted, 'center', 24, 1);
  UI_STATE._platformCloseBtn = { x: modalX + modalW - 42, y: modalY + 4, w: 36, h: 36 };

  const rows = [
    { id: '_byokBtn', label: t('platform.byok') },
    { id: '_aboutBtn', label: t('platform.about') },
    { id: '_githubBtn', label: t('platform.github') },
    { id: '_langBtn', label: t('platform.lang') }
  ];
  rows.forEach(function (row, index) {
    const rowY = modalY + 56 + index * 54;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    drawRoundRectPath(ctx, modalX + 16, rowY, modalW - 32, 44, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(233,196,106,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
    drawText(ctx, row.label, modalX + modalW / 2, rowY + 13, 'bold 13px sans-serif', UI_COLORS.goldLight, 'center', modalW - 48, 1);
    UI_STATE[row.id] = { x: modalX + 16, y: rowY, w: modalW - 32, h: 44 };
  });
}

export function drawWelcomeScreen(ctx) {
  const w = UI_STATE.screenWidth;
  const h = UI_STATE.screenHeight;

  drawBackground(ctx, Date.now());

  const panelW = Math.min(w - 40, 340);
  const panelH = 512;
  const panelX = (w - panelW) / 2;
  const panelY = (h - panelH) / 2 - 20;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 40;
  ctx.fillStyle = 'rgba(10, 16, 40, 0.85)';
  drawRoundRectPath(ctx, panelX, panelY, panelW, panelH, 28);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(233, 196, 106, 0.3)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // 首页常驻语言开关（v0.3 后按用户反馈从平台弹窗里挪出来）：
  // 4 个胶囊按钮平分顶部一行。
  const cornerBtnH = 32;
  const cornerBtnY = panelY + 10;
  const cornerGap = 8;
  const cornerBtnW = (panelW - 40 - cornerGap * 3) / 4;
  const startX = panelX + 20;
  const platformX = startX;
  const shopX = startX + (cornerBtnW + cornerGap);
  const helpX = shopX + (cornerBtnW + cornerGap);
  const langX = helpX + (cornerBtnW + cornerGap);
  const drawCornerButton = function (x, label) {
    ctx.save();
    ctx.fillStyle = 'rgba(233,196,106,0.18)';
    drawRoundRectPath(ctx, x, cornerBtnY, cornerBtnW, cornerBtnH, 16);
    ctx.fill();
    ctx.strokeStyle = UI_COLORS.gold;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = UI_COLORS.goldLight;
    ctx.fillText(label, x + cornerBtnW / 2, cornerBtnY + cornerBtnH / 2);
    ctx.restore();
  };
  drawCornerButton(platformX, t('btn.openSource'));
  drawCornerButton(shopX, t('btn.shop'));
  drawCornerButton(helpX, t('btn.codex'));
  drawCornerButton(langX, t('home.lang.next'));
  UI_STATE._platformBtn = { x: platformX, y: cornerBtnY, w: cornerBtnW, h: cornerBtnH };
  UI_STATE._welcomeShopBtn = { x: shopX, y: cornerBtnY, w: cornerBtnW, h: cornerBtnH };
  UI_STATE._welcomeHelpBtn = { x: helpX, y: cornerBtnY, w: cornerBtnW, h: cornerBtnH };
  UI_STATE._welcomeLangBtn = { x: langX, y: cornerBtnY, w: cornerBtnW, h: cornerBtnH };

  let currentY = panelY + 70;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillStyle = UI_COLORS.goldLight;
  ctx.fillText(t('game.title'), panelX + panelW / 2, currentY);
  currentY += 50;

  // 重生语：第 2 世起，副标题直接换成"这是第 N 次重生"（原主按钮上方的重复文案并入此处）。
  const global = getGlobalStats();
  const rebirthCount = global.totalPlayCount || 0;
  ctx.font = '16px sans-serif';
  ctx.fillStyle = UI_COLORS.muted;
  ctx.fillText(
    rebirthCount > 0
      ? t('welcome.rebirth', { n: rebirthCount })
      : t('welcome.slogan'),
    panelX + panelW / 2, currentY
  );
  currentY += 26;

  // N8 前世回响：离线显示上一世墓志铭（本地模板也存，人人都有）；
  // 接入 BYOK 时 AI 把最近 3 世凝练成一句"回响"，原位替换。每见到新前世仅请求一次。
  const pastLives = global.pastLives || [];
  if (rebirthCount > 0 && pastLives.length) {
    const lastEpitaph = pastLives[pastLives.length - 1].epitaph;
    if (UI_STATE.echoRequestedFor !== pastLives.length) {
      UI_STATE.echoRequestedFor = pastLives.length;
      requestPastLifeEcho(pastLives.slice(-3).map(function (rec) { return rec.epitaph; })).then(function (r) {
        if (r.ok && r.echo) {
          UI_STATE.pastLifeEcho = r.echo;
        }
      });
    }
    ctx.font = '12px sans-serif';
    ctx.fillStyle = UI_COLORS.goldLight;
    drawText(
      ctx,
      UI_STATE.pastLifeEcho
        ? t('welcome.echoAI', { e: UI_STATE.pastLifeEcho })
        : t('welcome.echoLast', { e: lastEpitaph }),
      panelX + panelW / 2, currentY, '12px sans-serif', UI_COLORS.goldLight, 'center', panelW - 44, 2
    );
    currentY += 24;
  }
  currentY += 4;

  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(panelX + 30, currentY);
  ctx.lineTo(panelX + panelW - 30, currentY);
  ctx.stroke();
  currentY += 30;

  const rules = [
    t('welcome.rule1'),
    t('welcome.rule2'),
    t('welcome.rule3'),
    t('welcome.rule4')
  ];
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  rules.forEach(function (rule, index) {
    ctx.font = '14px sans-serif';
    ctx.fillStyle = UI_COLORS.text;
    ctx.fillText(rule, panelX + 30, currentY + index * 28);
  });
  // 行距 32→28、留白 30→20：为底部「继续我的人生」清单入口腾出空间。
  currentY += rules.length * 28 + 20;

  const buffBtnW = 220;
  const buffBtnH = 26;
  const buffBtnX = panelX + (panelW - buffBtnW) / 2;
  const buffBtnY = currentY + 4;
  const buff = GAME_STATE && GAME_STATE.activeBuff ? GAME_STATE.activeBuff : null;
  const buffLabel = UI_STATE.welcomeBuffRevealed && buff
    ? buff.emoji + ' ' + buff.name
    : t('welcome.buffBtn');
  const buffIsPressing = UI_STATE.pressedWelcomeBuff;

  ctx.save();
  if (buffIsPressing) {
    ctx.translate(buffBtnX + buffBtnW / 2, buffBtnY + buffBtnH / 2);
    ctx.scale(0.96, 0.96);
    ctx.translate(-buffBtnX - buffBtnW / 2, -buffBtnY - buffBtnH / 2);
  }
  ctx.fillStyle = buffIsPressing ? 'rgba(233,196,106,0.24)' : 'rgba(255,255,255,0.08)';
  drawRoundRectPath(ctx, buffBtnX, buffBtnY, buffBtnW, buffBtnH, 13);
  ctx.fill();
  ctx.strokeStyle = UI_STATE.welcomeBuffRevealed ? UI_COLORS.gold : 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = UI_STATE.welcomeBuffRevealed ? UI_COLORS.goldLight : UI_COLORS.text;
  ctx.fillText(buffLabel, buffBtnX + buffBtnW / 2, buffBtnY + buffBtnH / 2);
  UI_STATE._welcomeBuffBtn = { x: buffBtnX, y: buffBtnY, w: buffBtnW, h: buffBtnH };

  const btnW = 200;
  const btnH = 52;
  const btnX = panelX + (panelW - btnW) / 2;
  // 底部留出协议入口的空间，避免两个热区重叠导致误触。
  const btnY = panelY + panelH - btnH - 30;

  if (rebirthCount > 0) {
    // 第 2 世起：清单回访胶囊（V2-2）。只画热区，弹窗统一由
    // renderGame 外层绘制，与结算横幅入口同一渲染层级。
    const ltW = 230;
    const ltH = 34;
    const ltX = panelX + (panelW - ltW) / 2;
    const ltY = buffBtnY + buffBtnH + 8;

    ctx.save();
    ctx.fillStyle = 'rgba(91,140,255,0.14)';
    drawRoundRectPath(ctx, ltX, ltY, ltW, ltH, 17);
    ctx.fill();
    ctx.strokeStyle = 'rgba(125,156,255,0.55)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
    const ltStats = getLifetimeStats();
    drawText(
      ctx,
      t('welcome.continue', { c: ltStats.collected, t: ltStats.total }),
      ltX + ltW / 2, ltY + ltH / 2 - 6,
      'bold 13px sans-serif', '#A7C4FF', 'center', ltW - 16, 1
    );
    UI_STATE._welcomeLifetimeBtn = { x: ltX, y: ltY, w: ltW, h: ltH };
  } else {
    UI_STATE._welcomeLifetimeBtn = null;
  }

  const isPressing = UI_STATE.pressedRestart;
  ctx.save();
  if (isPressing) {
    ctx.translate(btnX + btnW / 2, btnY + btnH / 2);
    ctx.scale(0.96, 0.96);
    ctx.translate(-btnX - btnW / 2, -btnY - btnH / 2);
  }
  ctx.fillStyle = isPressing ? 'rgba(233,196,106,0.3)' : 'rgba(233,196,106,0.15)';
  drawRoundRectPath(ctx, btnX, btnY, btnW, btnH, 30);
  ctx.fill();
  ctx.strokeStyle = UI_COLORS.gold;
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillStyle = UI_COLORS.goldLight;
  ctx.fillText(t('welcome.start'), btnX + btnW / 2, btnY + btnH / 2);

  UI_STATE._welcomeBtn = { x: btnX, y: btnY, w: btnW, h: btnH };
  drawLegalFooterLinks(ctx, panelX + panelW / 2, panelY + panelH - 14, panelW);
  if (UI_STATE.buffPickerOpen) {
    drawBuffPickerModal(ctx);
  } else if (UI_STATE.showShop) {
    drawShopModal(ctx);
  }
}

export function drawTutorialOverlay(ctx) {
  const w = UI_STATE.screenWidth;
  const h = UI_STATE.screenHeight;

  const firstProduct = PRODUCT_DB.find(function (product) {
    return product.id === 'cognition-01';
  });
  if (!firstProduct) {
    return;
  }

  const rect = getProductCardRect('cognition-01');
  if (!rect) {
    return;
  }

  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
  ctx.fillRect(0, 0, w, rect.y);
  ctx.fillRect(0, rect.y + rect.h, w, h - rect.y - rect.h);
  ctx.fillRect(0, rect.y, rect.x, rect.h);
  ctx.fillRect(rect.x + rect.w, rect.y, w - rect.x - rect.w, rect.h);

  ctx.strokeStyle = UI_COLORS.gold;
  ctx.lineWidth = 3;
  ctx.shadowColor = UI_COLORS.gold;
  ctx.shadowBlur = 20;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.shadowBlur = 0;
  ctx.restore();

  const time = Date.now() / 500;
  const fingerX = rect.x + rect.w / 2;
  const fingerY = rect.y + rect.h + 30 + Math.sin(time) * 8;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '38px sans-serif';
  ctx.fillStyle = UI_COLORS.goldLight;
  ctx.translate(fingerX, fingerY);
  ctx.scale(1 + 0.05 * Math.sin(time), 1 + 0.05 * Math.sin(time));
  ctx.fillText('👆', 0, 0);
  ctx.restore();

  const bubbleW = Math.min(240, w - 24);
  const bubbleH = 52;
  const bubbleX = Math.max(12, Math.min(w - bubbleW - 12, rect.x + rect.w / 2 - bubbleW / 2));
  const bubbleY = rect.y - bubbleH - 20;

  ctx.save();
  ctx.fillStyle = 'rgba(233, 196, 106, 0.12)';
  drawRoundRectPath(ctx, bubbleX, bubbleY, bubbleW, bubbleH, 16);
  ctx.fill();
  ctx.strokeStyle = UI_COLORS.gold;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillStyle = UI_COLORS.text;
  ctx.fillText(t('welcome.listBubble'), bubbleX + bubbleW / 2, bubbleY + bubbleH / 2);
  ctx.restore();

  UI_STATE._tutorialTarget = rect;
}

export function getTutorialShown() {
  if (UI_STATE.tutorialShownInSession) {
    return true;
  }
  try {
    const ttApi = getTT();
    return !!(ttApi && ttApi.getStorageSync && ttApi.getStorageSync('hasShownTutorial'));
  } catch (error) {
    return false;
  }
}

export function markTutorialShown() {
  UI_STATE.tutorialShownInSession = true;
  try {
    const ttApi = getTT();
    if (ttApi && ttApi.setStorageSync) {
      ttApi.setStorageSync('hasShownTutorial', true);
    }
  } catch (error) {
    // 本地缓存失败时，本次会话仍按已完成处理。
  }
}

export function getProductCardRect(productId) {
  const layout = getLayout();
  const panel = layout.list;
  const items = getProductsByCategory(UI_STATE.activeCategoryId);
  const innerX = panel.x + 12;
  const innerY = panel.y + 12;
  for (let i = 0; i < items.length; i += 1) {
    if (items[i].id !== productId) {
      continue;
    }
    const col = i % 2;
    const row = Math.floor(i / 2);
    return {
      x: innerX + col * (layout.cardW + layout.cardGap),
      y: innerY + row * (layout.cardH + layout.cardGap) - UI_STATE.scrollOffset,
      w: layout.cardW,
      h: layout.cardH
    };
  }
  return null;
}

export function spawnTouchRipple(point) {
  if (!point) {
    return;
  }
  UI_STATE.ripples.push({
    x: point.x,
    y: point.y,
    age: 0,
    duration: 500,
    maxRadius: 34
  });
  if (UI_STATE.ripples.length > 12) {
    UI_STATE.ripples.splice(0, UI_STATE.ripples.length - 12);
  }
}

export function drawRipples(ctx) {
  UI_STATE.ripples.forEach(function (ripple) {
    const progress = Math.min(1, Math.max(0, ripple.age / ripple.duration));
    const radius = 6 + ripple.maxRadius * progress;
    const alpha = 0.5 * (1 - progress);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#E9C46A';
    ctx.lineWidth = 2.5 * (1 - progress) + 0.5;
    ctx.beginPath();
    ctx.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  });
}

export function spawnPurchaseParticles(productId) {
  const rect = getProductCardRect(productId);
  const cx = rect ? rect.x + rect.w / 2 : UI_STATE.screenWidth / 2;
  const cy = rect ? rect.y + rect.h / 2 : UI_STATE.screenHeight / 2;
  const count = 14;
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 45 + Math.random() * 95;
    const maxLife = 0.65 + Math.random() * 0.5;
    UI_STATE.particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 55,
      size: 2 + Math.random() * 3,
      life: maxLife,
      maxLife: maxLife
    });
  }
  if (UI_STATE.particles.length > 150) {
    UI_STATE.particles.splice(0, UI_STATE.particles.length - 150);
  }
}

export function spawnFloatingText(productId, price) {
  const rect = getProductCardRect(productId);
  const x = rect ? rect.x + rect.w / 2 : UI_STATE.screenWidth / 2;
  const y = rect ? rect.y + rect.h / 2 - 10 : UI_STATE.screenHeight / 2;
  UI_STATE.floatingTexts.push({
    x: x,
    y: y,
    text: t('day.val', { n: '-' + Math.floor(price) }),
    life: 1.0,
    vy: -80,
    scale: 0.6,
    color: '#FFD700',
    fontSize: 28
  });
  if (UI_STATE.floatingTexts.length > 20) {
    UI_STATE.floatingTexts.splice(0, UI_STATE.floatingTexts.length - 20);
  }
}

export function updateEffects(deltaSeconds) {
  const delta = Math.min(0.25, Math.max(0, deltaSeconds || 0));
  for (let i = UI_STATE.particles.length - 1; i >= 0; i -= 1) {
    const particle = UI_STATE.particles[i];
    particle.life -= delta * 1.6;
    if (particle.life <= 0) {
      UI_STATE.particles.splice(i, 1);
      continue;
    }
    particle.x += particle.vx * delta;
    particle.y += particle.vy * delta;
    particle.vy += 150 * delta;
    particle.vx *= Math.max(0, 1 - 1.4 * delta);
  }
  for (let i = UI_STATE.floatingTexts.length - 1; i >= 0; i -= 1) {
    const text = UI_STATE.floatingTexts[i];
    text.life -= 0.6 * delta;
    if (text.life <= 0) {
      UI_STATE.floatingTexts.splice(i, 1);
      continue;
    }
    text.y += text.vy * delta;
    text.scale = 0.6 + 0.6 * (1 - text.life);
  }
  for (let i = UI_STATE.ripples.length - 1; i >= 0; i -= 1) {
    const ripple = UI_STATE.ripples[i];
    ripple.age += delta * 1000;
    if (ripple.age >= ripple.duration) {
      UI_STATE.ripples.splice(i, 1);
    }
  }
  if (GAME_STATE && GAME_STATE.comboFlashTimer > 0) {
    GAME_STATE.comboFlashTimer = Math.max(0, GAME_STATE.comboFlashTimer - delta);
    if (GAME_STATE.comboFlashTimer <= 0) {
      GAME_STATE.comboActive = false;
    }
  }
}

export function updateParticles(deltaSeconds) {
  updateEffects(deltaSeconds);
}

export function drawParticles(ctx) {
  UI_STATE.particles.forEach(function (particle) {
    const alpha = Math.max(0, particle.life / particle.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = alpha > 0.5 ? UI_COLORS.goldLight : UI_COLORS.gold;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

export function drawFloatingTexts(ctx) {
  UI_STATE.floatingTexts.forEach(function (text) {
    const alpha = Math.max(0, Math.min(1, text.life));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(text.x, text.y);
    ctx.scale(text.scale, text.scale);
    ctx.font = 'bold ' + text.fontSize + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(text.text, 0, 0);
    ctx.shadowColor = text.color;
    ctx.shadowBlur = 14;
    ctx.fillStyle = text.color;
    ctx.fillText(text.text, 0, 0);
    ctx.restore();
  });
}

export function drawComboEffect(ctx) {
  if (!GAME_STATE || GAME_STATE.comboFlashTimer <= 0) {
    return;
  }
  const timer = GAME_STATE.comboFlashTimer;
  const pulse = 0.5 + 0.5 * Math.sin(timer * 20);
  const alpha = Math.max(0.25, Math.min(1, pulse * (timer / 1.5)));
  ctx.save();
  ctx.strokeStyle = 'rgba(233,196,106,' + alpha.toFixed(3) + ')';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, UI_STATE.screenWidth - 6, UI_STATE.screenHeight - 6);

  const textScale = 1 + 0.08 * Math.sin(timer * 14);
  ctx.translate(UI_STATE.screenWidth / 2, UI_STATE.screenHeight / 2);
  ctx.scale(textScale, textScale);
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.strokeText(t('combo.hit'), 0, 0);
  ctx.shadowColor = UI_COLORS.gold;
  ctx.shadowBlur = 22;
  ctx.fillStyle = UI_COLORS.goldLight;
  ctx.fillText(t('combo.hit'), 0, 0);
  ctx.restore();
}

export function drawFreezeOverlay(ctx) {
  if (!GAME_STATE || !GAME_STATE.timeFreezeActive) {
    return;
  }
  const seconds = Math.ceil(GAME_STATE.timeFreezeRemaining);
  const w = UI_STATE.screenWidth;
  const h = UI_STATE.screenHeight;
  const boxW = 260;
  const boxH = 58;
  const x = (w - boxW) / 2;
  const y = h / 2 - 30;
  ctx.save();
  ctx.fillStyle = 'rgba(10,20,45,0.88)';
  drawRoundRectPath(ctx, x, y, boxW, boxH, 16);
  ctx.fill();
  ctx.strokeStyle = '#7D9CFF';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.strokeText(t('freeze.on', { n: seconds }), w / 2, h / 2);
  ctx.shadowColor = '#7D9CFF';
  ctx.shadowBlur = 18;
  ctx.fillStyle = '#A7C4FF';
  ctx.fillText(t('freeze.on', { n: seconds }), w / 2, h / 2);
  ctx.restore();
}

export function triggerCardBounce(productId) {
  UI_STATE.cardBounce[productId] = Date.now();
  UI_STATE.cardGlow[productId] = Date.now();
}

export function getBounceScale(productId) {
  const start = UI_STATE.cardBounce[productId] || 0;
  const elapsed = Date.now() - start;
  if (elapsed < 0 || elapsed > 500) {
    return 1;
  }
  const progress = elapsed / 500;
  const bounce = 0.04 * Math.sin(progress * Math.PI * 2.5) * (1 - progress);
  return 1 + Math.max(0, bounce);
}

export function getPerformanceMetrics() {
  const samples = UI_STATE.fpsSamples || [];
  const sum = samples.reduce(function (acc, value) {
    return acc + value;
  }, 0);
  return {
    samples: samples.length,
    avg: samples.length ? Math.round(sum / samples.length) : 0,
    min: samples.length ? Math.round(Math.min.apply(null, samples)) : 0,
    max: samples.length ? Math.round(Math.max.apply(null, samples)) : 0,
    cache: {
      background: !!_bgCache,
      tabs: !!_tabsCache,
      bottom: !!_bottomCache
    }
  };
}

export function getCategoryTabAtPoint(point) {
  const layout = getLayout();
  for (let i = 0; i < CATEGORY_META.length; i += 1) {
    const col = i % layout.tabCols;
    const row = Math.floor(i / layout.tabCols);
    const x = layout.tabOriginX + col * (layout.tabCellW + 6);
    const y = layout.tabOriginY + row * (layout.tabCellH + 6);
    if (point.x >= x && point.x <= x + layout.tabCellW && point.y >= y && point.y <= y + layout.tabCellH) {
      return CATEGORY_META[i].id;
    }
  }
  return null;
}

export function getProductCardAtPoint(point) {
  const layout = getLayout();
  const panel = layout.list;
  if (point.x < panel.x || point.x > panel.x + panel.w || point.y < panel.y || point.y > panel.y + panel.h) {
    return null;
  }
  const items = getProductsByCategory(UI_STATE.activeCategoryId);
  const innerX = panel.x + 12;
  const innerY = panel.y + 12;
  for (let i = 0; i < items.length; i += 1) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = innerX + col * (layout.cardW + layout.cardGap);
    const y = innerY + row * (layout.cardH + layout.cardGap) - UI_STATE.scrollOffset;
    if (point.x >= x && point.x <= x + layout.cardW && point.y >= y && point.y <= y + layout.cardH) {
      return items[i].id;
    }
  }
  return null;
}

function getProductBuyButtonRect(productId) {
  const layout = getLayout();
  const panel = layout.list;
  const items = getProductsByCategory(UI_STATE.activeCategoryId);
  const innerX = panel.x + 12;
  const innerY = panel.y + 12;
  for (let i = 0; i < items.length; i += 1) {
    if (items[i].id !== productId) {
      continue;
    }
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = innerX + col * (layout.cardW + layout.cardGap);
    const y = innerY + row * (layout.cardH + layout.cardGap) - UI_STATE.scrollOffset;
    const buttonW = 62;
    const buttonH = 26;
    return {
      x: x + layout.cardW - buttonW - 10,
      y: y + layout.cardH - buttonH - 10,
      w: buttonW,
      h: buttonH
    };
  }
  return null;
}

export function bindTouchEvents() {
  const ttApi = getTT();
  if (!ttApi) {
    return;
  }
  let lastTouchPoint = null;
  ttApi.onTouchStart(function (event) {
    UI_STATE._bottomCacheDirty = true;
    const point = getTouchPoint(event);
    lastTouchPoint = point;
    if (!point) {
      return;
    }
    // 合规弹窗打开时优先消费全部触摸事件，避免穿透到下层按钮。
    if (handleLegalTouchStart(point)) {
      return;
    }
    // 人生清单页同样全屏拦截，层级仅次于合规。
    if (handleLifetimeTouchStart(point)) {
      return;
    }
    spawnTouchRipple(point);
    let touchFeedbackGiven = false;
    const touchFeedback = function () {
      if (!touchFeedbackGiven) {
        touchFeedbackGiven = true;
        vibrateShort('light');
      }
    };

    if (UI_STATE.showHelp) {
      // 天书内部接管全部触摸（✕关闭 / 清单 / 协议 / 内容区滚动），
      // 只有点到面板之外才走"点击任意处关闭"。
      if (handleHelpTouchStart(point)) {
        if (UI_STATE.touchMode !== 'help-scroll') {
          playSound('click'); touchFeedback();
        }
        return;
      }
      UI_STATE.showHelp = false;
      UI_STATE.helpScroll = 0;
      UI_STATE.touchMode = 'none';
      playSound('click'); touchFeedback();
      return;
    }

    if (GAME_STATE && GAME_STATE.showReviveModal) {
      const watchBtn = UI_STATE._reviveWatchBtn;
      const quitBtn = UI_STATE._reviveQuitBtn;
      if (watchBtn && isPointInRect(point, watchBtn)) {
        playSound('click'); touchFeedback();
        UI_STATE.pressedReviveWatch = true;
        UI_STATE.touchMode = 'revive-watch';
      } else if (quitBtn && isPointInRect(point, quitBtn)) {
        playSound('click'); touchFeedback();
        UI_STATE.pressedReviveQuit = true;
        UI_STATE.touchMode = 'revive-quit';
      }
      return;
    }

    if (GAME_STATE && GAME_STATE.phase === 'welcome') {
      if (UI_STATE.showPlatformModal) {
        const closeBtn = UI_STATE._platformCloseBtn;
        if (closeBtn && isPointInRect(point, closeBtn)) {
          playSound('click'); touchFeedback();
          UI_STATE.showPlatformModal = false;
          return;
        }
        if (UI_STATE._byokBtn && isPointInRect(point, UI_STATE._byokBtn)) {
          playSound('click'); touchFeedback();
          UI_STATE.showPlatformModal = false;
          if (!openLLMSettingsPanel()) {
            setToast(t('toast.unsupportedTitle'), t('toast.unsupportedDesc'), 'error');
          }
          return;
        }
        if (UI_STATE._aboutBtn && isPointInRect(point, UI_STATE._aboutBtn)) {
          playSound('click'); touchFeedback();
          UI_STATE.showPlatformModal = false;
          openLegalModal('privacy');
          return;
        }
        if (UI_STATE._githubBtn && isPointInRect(point, UI_STATE._githubBtn)) {
          playSound('click'); touchFeedback();
          UI_STATE.showPlatformModal = false;
          const ttApi2 = getTT();
          if (ttApi2 && ttApi2.openUrl) {
            ttApi2.openUrl({ url: GITHUB_URL });
          }
          return;
        }
        if (UI_STATE._langBtn && isPointInRect(point, UI_STATE._langBtn)) {
          playSound('click'); touchFeedback();
          const backToZh = getLang() === 'en';
          toggleLang();
          setToast(t('toast.langTitle'), backToZh ? t('toast.langBack') : t('toast.langNow'), 'info');
          return;
        }
        UI_STATE.showPlatformModal = false;
        UI_STATE.touchMode = 'none';
        return;
      }
      if (UI_STATE.buffPickerOpen) {
        const buffCloseBtn = UI_STATE._buffPickCloseBtn;
        if (buffCloseBtn && isPointInRect(point, buffCloseBtn)) {
          playSound('click'); touchFeedback();
          UI_STATE.buffPickerOpen = false;
          return;
        }
        const buffId = getBuffPickAtPoint(point);
        if (buffId) {
          playSound('click'); touchFeedback();
          resolveBuffTicketChoice(buffId);
        }
        return;
      }
      if (UI_STATE.showShop) {
        const shopCloseBtn = UI_STATE._shopCloseBtn;
        if (shopCloseBtn && isPointInRect(point, shopCloseBtn)) {
          playSound('click'); touchFeedback();
          UI_STATE.showShop = false;
          return;
        }
        const shopItemId = getShopItemAtPoint(point);
        if (shopItemId) {
          playSound('click'); touchFeedback();
          purchaseShopItem(shopItemId);
        }
        return;
      }
      // 首页语言开关：与平台弹窗内的入口同一套逻辑（切换+持久化+清测量缓存）。
      const homeLangBtn = UI_STATE._welcomeLangBtn;
      if (homeLangBtn && isPointInRect(point, homeLangBtn)) {
        playSound('click'); touchFeedback();
        const backToZh = getLang() === 'en';
        toggleLang();
        setToast(t('toast.langHome'), backToZh ? t('toast.langBack') : t('toast.langNow'), 'info');
        UI_STATE.touchMode = 'none';
        return;
      }
      const platformBtn = UI_STATE._platformBtn;
      if (platformBtn && isPointInRect(point, platformBtn)) {
        playSound('click'); touchFeedback();
        UI_STATE.showPlatformModal = true;
        UI_STATE.touchMode = 'none';
        return;
      }
      const helpBtn = UI_STATE._welcomeHelpBtn;
      if (helpBtn && isPointInRect(point, helpBtn)) {
        playSound('click'); touchFeedback();
        UI_STATE.showHelp = true;
        UI_STATE.touchMode = 'none';
        return;
      }
      const shopBtn = UI_STATE._welcomeShopBtn;
      if (shopBtn && isPointInRect(point, shopBtn)) {
        playSound('click'); touchFeedback();
        UI_STATE.showShop = true;
        UI_STATE.touchMode = 'none';
        return;
      }
      const buffBtn = UI_STATE._welcomeBuffBtn;
      if (buffBtn && isPointInRect(point, buffBtn)) {
        playSound('event');
        touchFeedback();
        UI_STATE.pressedWelcomeBuff = true;
        UI_STATE.touchMode = 'welcome-buff';
        return;
      }
      // V2-2 欢迎页「继续我的人生」：打开清单页（弹窗在 renderGame 外层绘制）。
      const welcomeLtBtn = UI_STATE._welcomeLifetimeBtn;
      if (welcomeLtBtn && isPointInRect(point, welcomeLtBtn)) {
        playSound('click'); touchFeedback();
        openLifetime('all');
        UI_STATE.touchMode = 'none';
        return;
      }
      // 协议入口必须在"开启你的人生"之前命中，否则会被主按钮热区吃掉。
      const termsBtn = UI_STATE._legalTermsBtn;
      if (termsBtn && isPointInRect(point, termsBtn)) {
        playSound('click'); touchFeedback();
        openLegalModal('terms');
        UI_STATE.touchMode = 'none';
        return;
      }
      const privacyBtn = UI_STATE._legalPrivacyBtn;
      if (privacyBtn && isPointInRect(point, privacyBtn)) {
        playSound('click'); touchFeedback();
        openLegalModal('privacy');
        UI_STATE.touchMode = 'none';
        return;
      }
      const btn = UI_STATE._welcomeBtn;
      if (btn && isPointInRect(point, btn)) {
        playSound('click'); touchFeedback();
        UI_STATE.pressedRestart = true;
        UI_STATE.touchMode = 'welcome';
      } else {
        UI_STATE.touchMode = 'blocked';
      }
      return;
    }

    if (GAME_STATE && GAME_STATE.phase === 'playing') {
      if (GAME_STATE.pendingAdventure) {
        const adventureCloseBtn = UI_STATE._adventureCloseBtn;
        if (adventureCloseBtn && isPointInRect(point, adventureCloseBtn)) {
          playSound('click'); touchFeedback();
          UI_STATE.pressedAdventureClose = true;
          UI_STATE.touchMode = 'adventure-close';
          return;
        }
        const adventureChoices = GAME_STATE.pendingAdventure.choices || [];
        for (let i = 0; i < adventureChoices.length; i += 1) {
          const adventureBtn = UI_STATE['_adventureChoice_' + adventureChoices[i].id];
          if (adventureBtn && isPointInRect(point, adventureBtn)) {
            playSound('click'); touchFeedback();
            UI_STATE.pressedAdventureChoice = adventureChoices[i].id;
            UI_STATE.touchMode = 'adventure-choice';
            return;
          }
        }
        return;
      }
      if (GAME_STATE.pendingEvent) {
        const eventChoiceId = getEventChoiceAtPoint(point);
        if (eventChoiceId) {
          playSound('click'); touchFeedback();
          UI_STATE.pressedEventChoiceId = eventChoiceId;
          UI_STATE.touchMode = 'event-choice';
        }
        return;
      }

      if (UI_STATE.showWealthHelp || UI_STATE.showBuffInfo || UI_STATE.showDailyMissions) {
        const closeBtn = UI_STATE.showWealthHelp
          ? UI_STATE._wealthHelpCloseBtn
          : (UI_STATE.showBuffInfo ? UI_STATE._buffInfoCloseBtn : UI_STATE._dailyMissionsCloseBtn);
        if (closeBtn && isPointInRect(point, closeBtn)) {
          playSound('click'); touchFeedback();
          UI_STATE.showWealthHelp = false;
          UI_STATE.showBuffInfo = false;
          UI_STATE.showDailyMissions = false;
          return;
        }
        UI_STATE.showWealthHelp = false;
        UI_STATE.showBuffInfo = false;
        UI_STATE.showDailyMissions = false;
        UI_STATE.touchMode = 'none';
        return;
      }

      const wealthHelpBtn = UI_STATE._wealthHelpBtn;
      if (wealthHelpBtn && isPointInRect(point, wealthHelpBtn)) {
        playSound('click'); touchFeedback();
        UI_STATE.showWealthHelp = true;
        UI_STATE.showBuffInfo = false;
        UI_STATE.touchMode = 'none';
        return;
      }

      const headerBuffBtn = UI_STATE._headerBuffBtn;
      if (headerBuffBtn && isPointInRect(point, headerBuffBtn)) {
        playSound('click'); touchFeedback();
        UI_STATE.showBuffInfo = true;
        UI_STATE.showWealthHelp = false;
        UI_STATE.showDailyMissions = false;
        UI_STATE.touchMode = 'none';
        return;
      }

      const dailyMissionsBtn = UI_STATE._dailyMissionsBtn;
      if (dailyMissionsBtn && isPointInRect(point, dailyMissionsBtn)) {
        playSound('click'); touchFeedback();
        UI_STATE.showDailyMissions = true;
        UI_STATE.showWealthHelp = false;
        UI_STATE.showBuffInfo = false;
        UI_STATE.touchMode = 'none';
        return;
      }

      if (UI_STATE.showPouch) {
        const closeBtn = UI_STATE._pouchCloseBtn;
        if (closeBtn && isPointInRect(point, closeBtn)) {
          playSound('click'); touchFeedback();
          UI_STATE.showPouch = false;
          return;
        }
        const pouchItems = (GAME_STATE && GAME_STATE.pouchItems) || [];
        for (let i = 0; i < pouchItems.length; i += 1) {
          const pouchBtn = UI_STATE['_pouchItemBtn_' + pouchItems[i].id];
          if (pouchBtn && isPointInRect(point, pouchBtn)) {
            playSound('click'); touchFeedback();
            const result = usePouchItem(pouchItems[i].id);
            if (!result.ok) {
              setToast(t('toast.pouchFail'), result.error, 'error');
            }
            return;
          }
        }
        const refreshBtn = UI_STATE._pouchRefreshBtn;
        if (refreshBtn && isPointInRect(point, refreshBtn)) {
          playSound('click'); touchFeedback();
          const result = requestFreePouchRefresh();
          if (!result.ok && result.error) {
            setToast(t('toast.refreshFail'), result.error, 'info');
          }
          return;
        }
        UI_STATE.showPouch = false;
        UI_STATE.touchMode = 'none';
        return;
      }

      const fishBtn = UI_STATE._fishBtn;
      if (fishBtn && isPointInRect(point, fishBtn)) {
        playSound('click'); touchFeedback();
        UI_STATE.pressedFish = true;
        UI_STATE.touchMode = 'fish';
        return;
      }

      const headerAchievementBtn = UI_STATE._headerAchievementBtn;
      if (headerAchievementBtn && isPointInRect(point, headerAchievementBtn)) {
        playSound('click'); touchFeedback();
        UI_STATE.pressedHeaderAchievement = true;
        UI_STATE.touchMode = 'header-achievement';
        return;
      }

      const freezeBtn = UI_STATE._freezeBtn;
      if (freezeBtn && isPointInRect(point, freezeBtn)) {
        playSound('click'); touchFeedback();
        UI_STATE.showPouch = true;
        return;
      }

      const bottomRulesBtn = UI_STATE._bottomRulesBtn;
      if (bottomRulesBtn && isPointInRect(point, bottomRulesBtn)) {
        playSound('click'); touchFeedback();
        UI_STATE.showHelp = true;
        UI_STATE.touchMode = 'none';
        return;
      }

      const bottomNextBtn = UI_STATE._bottomNextBtn;
      if (bottomNextBtn && isPointInRect(point, bottomNextBtn)) {
        playSound('click'); touchFeedback();
        UI_STATE.pressedBottomNext = true;
        UI_STATE.touchMode = 'bottom-next';
        return;
      }

      const adventureBtn = UI_STATE._adventureBtn;
      if (adventureBtn && isPointInRect(point, adventureBtn)) {
        playSound('click'); touchFeedback();
        const adventureResult = openAdventure();
        if (!adventureResult.ok && adventureResult.error) {
          setToast(t('toast.noFate'), adventureResult.error, 'info');
        }
        return;
      }

      const helpBtn = UI_STATE._gameHelpBtn;
      if (helpBtn && isPointInRect(point, helpBtn)) {
        playSound('click'); touchFeedback();
        UI_STATE.showHelp = true;
        UI_STATE.touchMode = 'none';
        return;
      }

      if (!GAME_STATE.pendingDecisionMilestone && !getTutorialShown()) {
        const target = UI_STATE._tutorialTarget || getProductCardRect('cognition-01');
        if (target && isPointInRect(point, target)) {
          const buyRect = getProductBuyButtonRect('cognition-01');
          if (buyRect && isPointInRect(point, buyRect)) {
            touchFeedback();
            UI_STATE.pressedProductId = 'cognition-01';
            UI_STATE.touchMode = 'press';
          } else {
            UI_STATE.touchMode = 'blocked';
            setToast(t('toast.tapBuyTitle'), t('toast.tapBuyDesc'), 'info');
          }
        } else {
          UI_STATE.touchMode = 'blocked';
          setToast(t('toast.buyFirstTitle'), t('toast.buyFirstDesc'), 'info');
        }
        return;
      }

      // v0.3 抉择前对话：全屏推进台词，"跳过"按钮直达抉择。
      if (GAME_STATE.milestoneDialogue) {
        const dlg = GAME_STATE.milestoneDialogue;
        playSound('click'); touchFeedback();
        if (dlg.phase === 'begin') {
          dlg.phase = 'watching';
          dlg.lineIndex = 0;
          return;
        }
        const skipBtn = UI_STATE._dlgSkipBtn;
        if (skipBtn && isPointInRect(point, skipBtn)) {
          GAME_STATE.milestoneDialogue = null;
          return;
        }
        if (dlg.lineIndex >= dlg.lines.length - 1) {
          GAME_STATE.milestoneDialogue = null;
        } else {
          dlg.lineIndex += 1;
        }
        return;
      }

      if (GAME_STATE.pendingDecisionMilestone) {
        const choiceId = getDecisionChoiceAtPoint(point);
        if (choiceId) {
          playSound('click'); touchFeedback();
          UI_STATE.pressedChoiceId = choiceId;
          UI_STATE.touchMode = 'decision';
        }
        return;
      }

      const categoryId = getCategoryTabAtPoint(point);
      if (categoryId) {
        playSound('click'); touchFeedback();
        UI_STATE.activeCategoryId = categoryId;
        UI_STATE.scrollOffset = 0;
        UI_STATE.touchMode = 'tab';
        return;
      }
      const productId = getProductCardAtPoint(point);
      if (productId) {
        const buyRect = getProductBuyButtonRect(productId);
        if (buyRect && isPointInRect(point, buyRect)) {
          touchFeedback();
          UI_STATE.pressedProductId = productId;
          UI_STATE.touchMode = 'press';
        } else {
          const listPanel = getLayout().list;
          if (isPointInRect(point, listPanel)) {
            UI_STATE.touchMode = 'scroll';
            UI_STATE.scrollStartY = point.y;
            UI_STATE.scrollStartOffset = UI_STATE.scrollOffset;
          } else {
            UI_STATE.touchMode = 'blocked';
          }
        }
      } else {
        const listPanel = getLayout().list;
        if (isPointInRect(point, listPanel)) {
          UI_STATE.touchMode = 'scroll';
          UI_STATE.scrollStartY = point.y;
          UI_STATE.scrollStartOffset = UI_STATE.scrollOffset;
        } else {
          UI_STATE.touchMode = 'blocked';
        }
      }
      return;
    }

    if (GAME_STATE && GAME_STATE.phase === 'settled') {
      if (GAME_STATE.budgetExhausted && GAME_STATE.aiLoading === false) {
        const budgetContinue = UI_STATE._budgetContinueBtn;
        const budgetTemplate = UI_STATE._budgetTemplateBtn;
        if (budgetContinue && isPointInRect(point, budgetContinue)) {
          playSound('click'); touchFeedback();
          UI_STATE.pressedBudgetContinue = true;
          UI_STATE.touchMode = 'budget-continue';
        } else if (budgetTemplate && isPointInRect(point, budgetTemplate)) {
          playSound('click'); touchFeedback();
          UI_STATE.pressedBudgetTemplate = true;
          UI_STATE.touchMode = 'budget-template';
        }
        return;
      }
      if (UI_STATE.showLeaderboard) {
        if (UI_STATE.showGiftModal) {
          const giftCloseBtn = UI_STATE._giftCloseBtn;
          if (giftCloseBtn && isPointInRect(point, giftCloseBtn)) {
            playSound('click'); touchFeedback();
            UI_STATE.showGiftModal = false;
            UI_STATE.giftTarget = null;
            return;
          }
          const giftItemId = getGiftItemAtPoint(point);
          if (giftItemId && UI_STATE.giftTarget) {
            playSound('click'); touchFeedback();
            const result = giftItemToFriend(
              UI_STATE.giftTarget.openId,
              UI_STATE.giftTarget.nickname,
              giftItemId
            );
            if (result.ok) {
              setToast(t('toast.giftOkTitle'), t('toast.giftOkDesc', { item: result.itemName }), 'success');
              UI_STATE.showGiftModal = false;
              UI_STATE.giftTarget = null;
            } else {
              setToast(t('toast.giftFail'), result.error, 'error');
            }
            return;
          }
          return;
        }
        const lbCloseBtn = UI_STATE._leaderboardCloseBtn;
        if (lbCloseBtn && isPointInRect(point, lbCloseBtn)) {
          playSound('click'); touchFeedback();
          UI_STATE.showLeaderboard = false;
          return;
        }
        const tabId = getLeaderboardTabAtPoint(point);
        if (tabId) {
          playSound('click'); touchFeedback();
          UI_STATE.leaderboardTab = tabId;
          if (tabId === 'friends') {
            fetchFriendLeaderboard();
          }
          return;
        }
        const friendGiftKey = getFriendGiftKeyAtPoint(point);
        if (friendGiftKey) {
          playSound('click'); touchFeedback();
          const friend = getLeaderboardData('friends').find(function (entry) {
            return entry.openId === friendGiftKey;
          });
          UI_STATE.giftTarget = {
            openId: friendGiftKey,
            nickname: friend ? friend.nickname : t('toast.friend')
          };
          UI_STATE.showGiftModal = true;
          return;
        }
        const inviteBtn = UI_STATE._leaderboardInviteBtn;
        if (inviteBtn && isPointInRect(point, inviteBtn)) {
          playSound('click'); touchFeedback();
          const code = shareInviteCode();
          setToast(t('toast.inviteTitle'), t('toast.inviteDesc', { code: code }), 'info');
          return;
        }
        return;
      }
      if (UI_STATE.showShop) {
        const shopCloseBtn = UI_STATE._shopCloseBtn;
        if (shopCloseBtn && isPointInRect(point, shopCloseBtn)) {
          playSound('click'); touchFeedback();
          UI_STATE.showShop = false;
          return;
        }
        const shopItemId = getShopItemAtPoint(point);
        if (shopItemId) {
          playSound('click'); touchFeedback();
          purchaseShopItem(shopItemId);
        }
        return;
      }
      const action = getSettlementButtonAtPoint(point);
      if (action === 'lifetime') {
        playSound('click'); touchFeedback();
        openLifetime('all');
        UI_STATE.touchMode = 'none';
      } else if (action === 'restart') {
        playSound('click'); touchFeedback();
        UI_STATE.pressedRestart = true;
        UI_STATE.touchMode = 'restart';
      } else if (action === 'share') {
        playSound('click'); touchFeedback();
        UI_STATE.pressedShare = true;
        UI_STATE.touchMode = 'share';
      } else if (action === 'replay') {
        playSound('click'); touchFeedback();
        UI_STATE.pressedReplay = true;
        UI_STATE.touchMode = 'replay';
      } else if (action === 'feedback') {
        playSound('click'); touchFeedback();
        UI_STATE.pressedFeedback = true;
        UI_STATE.touchMode = 'feedback';
      } else if (action === 'leaderboard') {
        playSound('click'); touchFeedback();
        openLeaderboard();
        UI_STATE.touchMode = 'none';
      } else if (action === 'shop') {
        playSound('click'); touchFeedback();
        UI_STATE.showShop = true;
        UI_STATE.touchMode = 'none';
      }
      return;
    }
  });

  ttApi.onTouchMove(function (event) {
    const point = getTouchPoint(event);
    if (!point) {
      return;
    }
    if (UI_STATE.showLegal) {
      handleLegalTouchMove(point);
      return;
    }
    // 天书内容区滚动（仅在 help-scroll 模式生效，其余触摸直接吞掉）。
    if (UI_STATE.showHelp) {
      handleHelpTouchMove(point);
      return;
    }
    if (UI_STATE.showLifetime) {
      handleLifetimeTouchMove(point);
      return;
    }
    if (UI_STATE.touchMode === 'press') {
      if (
        lastTouchPoint &&
        (Math.abs(point.x - lastTouchPoint.x) + Math.abs(point.y - lastTouchPoint.y) > 10)
      ) {
        UI_STATE.pressedProductId = null;
        UI_STATE.touchMode = 'scroll';
        UI_STATE.scrollStartY = point.y;
        UI_STATE.scrollStartOffset = UI_STATE.scrollOffset;
        return;
      }
      return;
    }
    if (UI_STATE.touchMode !== 'scroll') {
      return;
    }
    const layout = getLayout();
    const nextOffset = UI_STATE.scrollStartOffset + (UI_STATE.scrollStartY - point.y);
    UI_STATE.scrollOffset = Math.min(Math.max(0, nextOffset), layout.maxScroll);
  });

  ttApi.onTouchEnd(function (event) {
    UI_STATE._bottomCacheDirty = true;
    const point = getTouchPoint(event) || lastTouchPoint;
    lastTouchPoint = null;

    // 天书滚动/点按收尾（点内容区不移动 = 关闭，与旧版行为一致）。
    if (handleHelpTouchEnd()) {
      if (!UI_STATE.showHelp) {
        playSound('click');
        vibrateShort('light');
      }
      return;
    }

    if (UI_STATE.showLegal) {
      handleLegalTouchEnd();
      return;
    }
    if (UI_STATE.showLifetime) {
      handleLifetimeTouchEnd(point);
      return;
    }

    if (UI_STATE.touchMode === 'revive-watch') {
      UI_STATE.pressedReviveWatch = false;
      requestFreeRevive();
      UI_STATE.touchMode = 'none';
      return;
    }
    if (UI_STATE.touchMode === 'revive-quit') {
      UI_STATE.pressedReviveQuit = false;
      closeReviveModalAndEnd();
      UI_STATE.touchMode = 'none';
      return;
    }
    if (UI_STATE.touchMode === 'budget-continue') {
      UI_STATE.pressedBudgetContinue = false;
      const add = BUDGET_PRESETS[0] || 50000;
      resolveBudgetExhausted(true, add);
      UI_STATE.touchMode = 'none';
      return;
    }
    if (UI_STATE.touchMode === 'budget-template') {
      UI_STATE.pressedBudgetTemplate = false;
      resolveBudgetExhausted(false, 0);
      UI_STATE.touchMode = 'none';
      return;
    }

    if (UI_STATE.touchMode === 'welcome-buff') {
      UI_STATE.pressedWelcomeBuff = false;
      UI_STATE.welcomeBuffRevealed = true;
      UI_STATE.touchMode = 'none';
      return;
    }

    if (UI_STATE.touchMode === 'header-buff') {
      UI_STATE.pressedHeaderBuff = false;
      if (GAME_STATE) {
        const buffIds = GAME_STATE.ownedBuffs && GAME_STATE.ownedBuffs.length
          ? GAME_STATE.ownedBuffs
          : (GAME_STATE.activeBuff ? [GAME_STATE.activeBuff.id] : []);
        const buffs = buffIds.map(function (buffId) {
          return getBuffById(buffId);
        }).filter(Boolean);
        setToast(
          t('toast.activeBuffs'),
          buffs.length ? buffs.map(function (buff) {
            return buff.emoji + ' ' + buff.name;
          }).join(getLang() === 'en' ? ', ' : '、') : t('toast.none'),
          'info'
        );
      }
      UI_STATE.touchMode = 'none';
      return;
    }

    if (UI_STATE.touchMode === 'header-achievement') {
      UI_STATE.pressedHeaderAchievement = false;
      const global = getGlobalStats();
      setToast(
        t('toast.achTitle'),
        t('toast.achDesc', { c: global.unlockedAchievements.length, t: ACHIEVEMENT_DEFS.length }),
        'info'
      );
      UI_STATE.touchMode = 'none';
      return;
    }

    if (UI_STATE.touchMode === 'bottom-rules') {
      UI_STATE.pressedBottomRules = false;
      UI_STATE.showHelp = true;
      UI_STATE.touchMode = 'none';
      return;
    }

    if (UI_STATE.touchMode === 'bottom-next') {
      UI_STATE.pressedBottomNext = false;
      const triggeredCount = GAME_STATE && GAME_STATE.decisionMilestoneTriggered
        ? GAME_STATE.decisionMilestoneTriggered.length
        : 0;
      const nextMilestone = DECISION_MILESTONES_V2[triggeredCount];
      setToast(
        t('toast.nextChoice'),
        nextMilestone
          ? t('toast.nextChoiceDesc', { title: nextMilestone.title, n: nextMilestone.threshold.toLocaleString() })
          : t('toast.allDone'),
        'info'
      );
      UI_STATE.touchMode = 'none';
      return;
    }

    if (UI_STATE.touchMode === 'adventure-close') {
      const wasPressed = UI_STATE.pressedAdventureClose === true;
      const closeBtn = UI_STATE._adventureCloseBtn;
      // 抬手时仍需落在关闭热区内，避免手指滑出后误放弃奇遇。
      const stillInside = !!(point && closeBtn && isPointInRect(point, closeBtn));
      UI_STATE.pressedAdventureClose = false;
      UI_STATE.touchMode = 'none';
      if (wasPressed && stillInside) {
        closeAdventure();
      }
      return;
    }

    if (UI_STATE.touchMode === 'adventure-choice' && UI_STATE.pressedAdventureChoice) {
      const adventureResult = resolveAdventureChoiceV2(UI_STATE.pressedAdventureChoice);
      if (adventureResult.ok) {
        setToast(t('toast.fateOkTitle'), t('toast.fateOkDesc'), 'success');
      } else {
        setToast(t('toast.fateFail'), adventureResult.error, 'error');
      }
      UI_STATE.pressedAdventureChoice = null;
      UI_STATE.touchMode = 'none';
      Object.keys(UI_STATE).forEach(function (key) {
        if (key.indexOf('_adventureChoice_') === 0) {
          delete UI_STATE[key];
        }
      });
      return;
    }

    if (UI_STATE.touchMode === 'welcome') {
      const shouldStart = UI_STATE.pressedRestart;
      UI_STATE.pressedRestart = false;
      UI_STATE.touchMode = 'none';
      if (shouldStart && GAME_STATE && GAME_STATE.phase === 'welcome') {
        if (!GAME_STATE._rebirthCounted) {
          const rebirth = registerNewGameStart();
          GAME_STATE.startFlow = rebirth.startFlow;
          GAME_STATE._rebirthCounted = true;
        }
        if (!GAME_STATE._timeSandApplied) {
          const global = getGlobalStats();
          if ((global.shopItems.timeSand || 0) > 0) {
            global.shopItems.timeSand -= 1;
            saveGlobalStats(global);
            GAME_STATE.remainingDays += 500;
            GAME_STATE.startingDays += 500;
            GAME_STATE._timeSandApplied = true;
          }
        }
        GAME_STATE.phase = 'playing';
        UI_STATE._welcomeBtn = null;
        if (GAME_STATE.startFlow <= 3) {
          setToast(t('toast.firstRebirth'), t('toast.firstRebirthDesc'), 'info');
        } else {
          setToast(t('toast.welcomeTitle'), t('toast.welcomeDesc'), 'info');
        }
        if (GAME_STATE._timeSandApplied) {
          setToast(t('toast.hourglass'), t('toast.hourglassDesc'), 'info');
        }
      }
      return;
    }

    if (UI_STATE.touchMode === 'fish' && UI_STATE.pressedFish) {
      UI_STATE.pressedFish = false;
      doFish();
      UI_STATE.touchMode = 'none';
      return;
    }

    if (UI_STATE.touchMode === 'blocked') {
      UI_STATE.touchMode = 'none';
      return;
    }

    if (UI_STATE.touchMode === 'restart') {
      UI_STATE.pressedRestart = false;
      resetGameState();
      UI_STATE.touchMode = 'none';
      return;
    }
    if (UI_STATE.touchMode === 'share') {
      UI_STATE.pressedShare = false;
      generateShareCardAndShare(GAME_STATE);
      UI_STATE.touchMode = 'none';
      return;
    }
    if (UI_STATE.touchMode === 'replay') {
      UI_STATE.pressedReplay = false;
      const summary = generateSettlementSummary(GAME_STATE);
      exportLifeReplay(GAME_STATE, summary && summary.summaryText).then(function (res) {
        if (!res.downloaded && !res.copied) {
          setToast(t('toast.replayTitle'), t('toast.replayUnsupported'), 'error');
          return;
        }
        const parts = [];
        if (res.downloaded) { parts.push(t('toast.replayFile', { f: res.filename })); }
        if (res.copied) { parts.push(t('toast.replayCopied')); }
        else { parts.push(t('toast.replayManual')); }
        setToast(t('toast.replayTitle'), parts.join(' · '), 'success');
      });
      UI_STATE.touchMode = 'none';
      return;
    }
    if (UI_STATE.touchMode === 'feedback') {
      UI_STATE.pressedFeedback = false;
      openFeedbackSurvey();
      UI_STATE.touchMode = 'none';
      return;
    }
    if (UI_STATE.touchMode === 'event-choice' && UI_STATE.pressedEventChoiceId) {
      const eventResult = resolveEventChoice(UI_STATE.pressedEventChoiceId);
      if (!eventResult.ok) {
        setToast(t('toast.eventFail'), eventResult.error, 'error');
      }
      UI_STATE.pressedEventChoiceId = null;
      UI_STATE.touchMode = 'none';
      return;
    }
    if (UI_STATE.touchMode === 'decision' && UI_STATE.pressedChoiceId) {
      const result = resolveDecision(UI_STATE.pressedChoiceId);
      if (!result.ok) {
        if (!result.gaveUp) {
          setToast(t('toast.decideFail'), result.error, 'error');
        }
      }
      UI_STATE.pressedChoiceId = null;
      UI_STATE.touchMode = 'none';
      return;
    }
    if (UI_STATE.touchMode === 'press' && UI_STATE.pressedProductId) {
      if (GAME_STATE && GAME_STATE.phase === 'playing' && !GAME_STATE.pendingDecisionMilestone && !getTutorialShown()) {
        const target = UI_STATE._tutorialTarget || getProductCardRect('cognition-01');
        if (!target || !isPointInRect(point, target) || UI_STATE.pressedProductId !== 'cognition-01') {
          UI_STATE.pressedProductId = null;
          UI_STATE.touchMode = 'none';
          vibrateShort();
          setToast(t('toast.buyFirstTitle'), t('toast.buyFirstDesc'), 'info');
          return;
        }
      }
      const result = purchaseProduct(UI_STATE.pressedProductId);
      UI_STATE.lastTappedProductId = UI_STATE.pressedProductId;
      UI_STATE.lastTapTime = Date.now();
      if (!result.ok) {
        setToast(t('toast.purchaseFail'), result.error, 'error');
      } else if (GAME_STATE && GAME_STATE.phase === 'playing' && !getTutorialShown()) {
        markTutorialShown();
        UI_STATE._tutorialTarget = null;
      }
    }
    UI_STATE.pressedProductId = null;
    UI_STATE.touchMode = 'none';
  });
}

/**
 * 场景渲染。各阶段内部会提前 return，因此合规弹窗必须在外层统一绘制，
 * 否则结算页/欢迎页等分支下就打不开隐私政策，不满足审核要求。
 */
function renderScene(ctx, layout) {
  if (GAME_STATE && GAME_STATE.phase === 'welcome') {
    drawWelcomeScreen(ctx);
    if (UI_STATE.showHelp) {
      drawHelpModal(ctx);
    }
    if (UI_STATE.showPlatformModal) {
      drawPlatformModal(ctx);
    }
    return;
  }
  if (GAME_STATE && GAME_STATE.phase === 'settled') {
    drawSettlementScreen(ctx);
    if (UI_STATE.showGiftModal) {
      drawGiftModal(ctx);
    }
    if (UI_STATE.showHelp) {
      drawHelpModal(ctx);
    }
    drawBudgetModal(ctx);
    return;
  }
  ctx.clearRect(0, 0, UI_STATE.screenWidth, UI_STATE.screenHeight);
  drawBackgroundLayer(ctx);
  drawStatusPanel(ctx, layout);
  drawTabsLayer(ctx, layout);
  drawProductList(ctx, layout);
  drawBottomLayer(ctx, layout);
  if (UI_STATE.showWealthHelp) {
    drawWealthHelpModal(ctx);
  }
  if (UI_STATE.showBuffInfo) {
    drawBuffInfoModal(ctx);
  }
  if (UI_STATE.showDailyMissions) {
    drawDailyMissionsModal(ctx);
  }
  if (UI_STATE.showPouch) {
    drawPouchPanel(ctx);
  }
  if (GAME_STATE && GAME_STATE.phase === 'playing' && !GAME_STATE.pendingDecisionMilestone && !getTutorialShown()) {
    drawTutorialOverlay(ctx);
  }
  updateEffects(UI_STATE.lastDeltaSeconds);
  const now = Date.now();
  Object.keys(UI_STATE.cardGlow).forEach(function (key) {
    if (now - UI_STATE.cardGlow[key] > 800) {
      delete UI_STATE.cardGlow[key];
    }
  });
  drawParticles(ctx);
  drawFloatingTexts(ctx);
  drawRipples(ctx);
  drawComboEffect(ctx);
  drawFreezeOverlay(ctx);
  if (GAME_STATE && GAME_STATE.showReviveModal) {
    drawReviveModal(ctx);
    return;
  }
  if (GAME_STATE && GAME_STATE.pendingEvent) {
    drawEventModal(ctx);
    return;
  }

  if (GAME_STATE && GAME_STATE.pendingAdventure) {
    drawAdventureModalV2(ctx);
    return;
  }

  if (GAME_STATE && GAME_STATE.pendingDecisionMilestone) {
    drawDecisionModal(ctx, layout);
    if (GAME_STATE.milestoneDialogue) {
      drawMilestoneDialogue(ctx);
    } else {
      drawToast(ctx, layout);
    }
  } else {
    drawToast(ctx, layout);
  }
  if (UI_STATE.showHelp) {
    drawHelpModal(ctx);
  }
}

export function renderGame() {
  if (!UI_STATE.ctx) {
    return;
  }
  renderScene(UI_STATE.ctx, getLayout());
  // 清单页绘制在场景之上、合规之下（legal 是审核要求，层级最高）。
  drawLifetimeModal(UI_STATE.ctx);
  // 合规弹窗在最外层绘制，保证欢迎页 / 对局 / 结算页任意阶段都能打开。
  drawLegalModal(UI_STATE.ctx);
}

export function startRenderLoop() {
  if (UI_STATE.loopStarted) {
    return;
  }
  UI_STATE.loopStarted = true;
  const tick = function () {
    try {
      const now = Date.now();
      if (!UI_STATE.lastFrameTime) {
        UI_STATE.lastFrameTime = now;
      }
      const deltaSeconds = Math.min(0.25, Math.max(0, (now - UI_STATE.lastFrameTime) / 1000));
      UI_STATE.lastFrameTime = now;
      UI_STATE.lastDeltaSeconds = deltaSeconds;
      if (GAME_STATE && GAME_STATE.phase === 'playing') {
        updateRound(deltaSeconds);
      }
      UI_STATE.fpsFrameCount += 1;
      if (!UI_STATE.fpsLastTime) {
        UI_STATE.fpsLastTime = now;
      } else if (now - UI_STATE.fpsLastTime >= 1000) {
        const fps = UI_STATE.fpsFrameCount * 1000 / (now - UI_STATE.fpsLastTime);
        UI_STATE.fpsSamples.push(fps);
        if (UI_STATE.fpsSamples.length > 180) {
          UI_STATE.fpsSamples.shift();
        }
        UI_STATE.fpsFrameCount = 0;
        UI_STATE.fpsLastTime = now;
      }
      renderGame();
    } catch (error) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('render loop error', error);
      }
    }
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(tick);
    } else {
      setTimeout(tick, 16);
    }
  };
  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(tick);
  } else {
    setTimeout(tick, 16);
  }
}

export function initUI() {
  if (UI_STATE.canvas) {
    return;
  }
  if (!setupCanvas()) {
    return;
  }
  bindTouchEvents();
  startRenderLoop();
}

export function getUILayoutMetrics() {
  const layout = getLayout();
  const visibleRows = Math.max(1, Math.floor((layout.list.h - 52 + layout.cardGap) / (layout.cardH + layout.cardGap)));
  const nonOverlapping = (
    layout.status.y + layout.status.h <= layout.tab.y &&
    layout.tab.y + layout.tab.h <= layout.list.y &&
    layout.list.y + layout.list.h <= layout.bottom.y
  );
  return {
    screen: { width: UI_STATE.screenWidth, height: UI_STATE.screenHeight },
    status: layout.status,
    tab: layout.tab,
    list: layout.list,
    bottom: layout.bottom,
    card: { width: layout.cardW, height: layout.cardH },
    visibleRows: visibleRows,
    maxScroll: layout.maxScroll,
    nonOverlapping: nonOverlapping,
    buttonRadius: 16
  };
}

// ==================== 3. 核心逻辑 ====================
