// Module: lifetime.js —— 「我的人生清单」跨世收集页
// 设计基线：.workbuddy/artifacts/人生清单_设计方案.md
// 滚动/热区/触摸骨架复用 legal.js 的已验证模式。
import { trackEvent } from './analytics.js';
import { CATEGORY_META, UI_COLORS } from './config.js';
import { COLLECTION_MILESTONES, PRODUCT_DB, getProductById, getProductsByCategory } from './db.js';
import { GAME_STATE, UI_STATE, getGlobalStats, grantLifetimeLegacyGift } from './state.js';
import { getUnlockCategorySpent, getUnlockTotalSpent, drawRoundRectPath, drawText, getTT, splitTextToLines } from './utils.js';
import { exportCanvasAndShare } from './share.js';

const TOTAL_ITEMS = PRODUCT_DB.length; // 160

// 打码决策（方案拍板 #1）：rare/legend 未解锁隐藏名称，normal/advanced/consume 显名。
function shouldMask(product) {
  return product.gradeKey === 'rare' || product.gradeKey === 'legend';
}

function unlockedCountIn(owned, categoryId) {
  const items = getProductsByCategory(categoryId);
  let n = 0;
  for (let i = 0; i < items.length; i += 1) {
    if (owned[items[i].id]) {
      n += 1;
    }
  }
  return n;
}

// 未解锁条目排序：解锁进度最接近的放最前（钩子最大化）。
function unlockProgress(state, product) {
  if (!product.unlockThreshold || product.unlockThreshold <= 0) {
    return 1;
  }
  const spent = product.gradeKey === 'advanced'
    ? getUnlockTotalSpent(state)
    : getUnlockCategorySpent(state, product.category);
  return Math.min(1, spent / product.unlockThreshold);
}

// 行数据构建时**预计算所有展示字符串**（分类名/toLocaleString/拼接），
// 渲染循环只画缓存好的静态文本 —— 否则每帧生成新字符串会让 splitTextToLines
// 的宽度缓存永远 miss，160 行逐字符 measureText 就是滑动卡顿的主因。
function buildRowEntries(state, owned, product, isAchieved, rec) {
  const entry = {
    product: product,
    rec: rec || null,
    progress: isAchieved ? 1 : unlockProgress(state, product)
  };
  if (isAchieved) {
    entry.titleText = product.emoji + ' ' + product.name;
    entry.subText = rec.count > 1
      ? '重复走过 ×' + rec.count + ' · 有些习惯，死了都改不掉'
      : (product.desc || '');
    entry.lifeText = '第' + (rec.firstLife || 1) + '世';
    entry.badgeText = rec.count > 1 ? '×' + rec.count : '✓';
  } else {
    const mask = shouldMask(product);
    entry.masked = mask;
    entry.titleText = mask ? '██████████' : product.emoji + ' ' + product.name;
    let condText = '';
    if (product.gradeKey === 'legend' || product.gradeKey === 'rare') {
      const catName = (CATEGORY_META.find(function (m) { return m.id === product.category; }) || {}).name || product.category;
      const spentNow = getUnlockCategorySpent(state, product.category);
      condText = catName + '线消费 ' + Math.floor(spentNow).toLocaleString() + '/' + (product.unlockThreshold || 0).toLocaleString() + ' 天';
    } else if (product.gradeKey === 'advanced') {
      const spentNow = getUnlockTotalSpent(state);
      condText = '累计消费 ' + Math.floor(spentNow).toLocaleString() + '/' + (product.unlockThreshold || 0).toLocaleString() + ' 天';
    } else {
      condText = product.unlockDesc || '这一世就可以去买';
    }
    entry.condText = '🔒 ' + condText;
    entry.pctText = Math.round(Math.min(1, Math.max(0, entry.progress)) * 100) + '%';
  }
  return entry;
}

// 签名 = 影响行集合/文案的所有输入。局内消费只增不减，和值可完全覆盖变化。
function rowsSignature(state, owned, tabId) {
  let catSum = 0;
  if (state && state.categorySpentOriginal) {
    Object.keys(state.categorySpentOriginal).forEach(function (k) { catSum += state.categorySpentOriginal[k] || 0; });
  }
  let vCatSum = 0;
  if (state && state.categoryVirtualSpent) {
    Object.keys(state.categoryVirtualSpent).forEach(function (k) { vCatSum += state.categoryVirtualSpent[k] || 0; });
  }
  return tabId + '|' + Object.keys(owned).length + '|'
    + Math.floor(((state && state.totalSpentOriginal) || 0) + ((state && state.virtualTotalSpent) || 0)) + '|'
    + Math.floor(catSum + vCatSum);
}

let _rowsCache = null; // { signature, achieved, locked, achievedCount, lockedCount }

function getRows(state, owned, tabId) {
  const signature = rowsSignature(state, owned, tabId);
  if (_rowsCache && _rowsCache.signature === signature) {
    return _rowsCache;
  }
  const source = tabId === 'all' ? PRODUCT_DB : getProductsByCategory(tabId);
  const achieved = [];
  const locked = [];
  source.forEach(function (product) {
    const rec = owned[product.id];
    if (rec) {
      achieved.push(buildRowEntries(state, owned, product, true, rec));
    } else {
      locked.push(buildRowEntries(state, owned, product, false, null));
    }
  });
  // 达成：首次世序倒序（最近的经历在最上面，回忆录语感）
  achieved.sort(function (a, b) {
    return ((b.rec && b.rec.firstLife) || 0) - ((a.rec && a.rec.firstLife) || 0);
  });
  // 未达成：进度接近的优先，其次按价格低的优先（易达成感）
  locked.sort(function (a, b) {
    return b.progress - a.progress || a.product.baseCost - b.product.baseCost;
  });
  _rowsCache = { signature: signature, achieved: achieved, locked: locked };
  return _rowsCache;
}

// ---- 行高（固定，虚拟滚动用） ----
// 渲染循环与 computeContentHeight 必须共用同一套间距公式，否则 maxScroll 有漂移。
const HEADER_H = 92;        // 生涯进度卡
const TAB_H2 = 30;          // 单个页签高
const TAB_ROW_GAP = 5;      // 页签行间距
const TAB_BLOCK_H = TAB_H2 * 2 + TAB_ROW_GAP; // 页签两行总高（65）
const TAB_GAP_AFTER = 16;   // 页签区与里程碑条的间距
const ROW_DONE_H = 64;      // 达成条目 stride（卡片画 58 高，含 6px 行距）
const ROW_LOCK_H = 56;      // 未解锁条目 stride（卡片画 50 高，含 6px 行距）
const MILE_H = 46;          // 里程碑摘要条（卡片画 38 高）
const SECTION_HEAD_H = 26;  // 分组标题（已/未经历）占位高
const CONTENT_PAD_B = 10;   // 列表底部留白

// 列表区之前的固定前缀高：进度卡 + 页签区 + 间距 + 里程碑条 + 间距
function prefixHeight() {
  return HEADER_H + TAB_BLOCK_H + TAB_GAP_AFTER + MILE_H + 6;
}

// 滚动惯性：拖动时采样速度（EMA），抬手后按指数衰减推进 scroll，模拟原生列表手感。
const _drag = { lastY: 0, lastT: 0, v: 0 };
const _fling = { v: 0, lastT: 0 };
const FLING_DECAY = 0.93;      // 每 16ms 速度衰减系数
const FLING_MIN_V = 40;        // 低于此速度直接停

// 由渲染循环每帧调用（ui.js renderGame 内），推进惯性滚动。
export function updateLifetimeFling() {
  if (!UI_STATE.showLifetime || Math.abs(_fling.v) < FLING_MIN_V) {
    _fling.v = 0;
    return;
  }
  const now = Date.now();
  const dt = Math.min(50, now - (_fling.lastT || now)) / 1000;
  _fling.lastT = now;
  const maxScroll = UI_STATE._ltMaxScroll || 0;
  let next = (UI_STATE.lifetimeScroll || 0) - _fling.v * dt;
  // 负值方向（顶部回拉）直接停，不做回弹动画
  if (next <= 0) { next = 0; _fling.v = 0; }
  else if (next >= maxScroll) { next = maxScroll; _fling.v = 0; }
  UI_STATE.lifetimeScroll = next;
  _fling.v *= Math.pow(FLING_DECAY, dt * 60);
}

export function openLifetime(tab) {
  UI_STATE.showLifetime = true;
  UI_STATE.lifetimeTab = tab || 'all';
  UI_STATE.lifetimeScroll = 0;
  _fling.v = 0;
  _drag.v = 0;
  // 老玩家「前世遗产」补偿：首次打开清单页时触发，只发一次（state 内部判定）。
  grantLifetimeLegacyGift();
  trackEvent('lifetime_open', { from: GAME_STATE ? GAME_STATE.phase : 'unknown' });
}

export function closeLifetime() {
  UI_STATE.showLifetime = false;
  UI_STATE.lifetimeScroll = 0;
  UI_STATE.touchMode = 'none';
  _fling.v = 0;
}

function layout(ctx) {
  const w = UI_STATE.screenWidth;
  const h = UI_STATE.screenHeight;
  const modalW = Math.min(w - 32, 352);
  const modalH = Math.min(h - 60, 660);
  const modalX = (w - modalW) / 2;
  const modalY = Math.max(24, (h - modalH) / 2);
  return { w: w, h: h, modalW: modalW, modalH: modalH, modalX: modalX, modalY: modalY };
}

// 与实际渲染共享同一套间距公式（prefixHeight + 分组标题 + stride×行数），保证 maxScroll 精确。
function computeContentHeight(ctx, l, tabId) {
  const global = getGlobalStats();
  const owned = global.lifetimeOwned || {};
  const rows = getRows(GAME_STATE || {}, owned, tabId);
  let height = prefixHeight();
  if (rows.achieved.length > 0) {
    height += SECTION_HEAD_H + rows.achieved.length * ROW_DONE_H;
  }
  if (rows.locked.length > 0) {
    height += SECTION_HEAD_H + rows.locked.length * ROW_LOCK_H;
  }
  return height + CONTENT_PAD_B;
}

export function drawLifetimeModal(ctx) {
  if (!UI_STATE.showLifetime) {
    return;
  }
  updateLifetimeFling();
  const l = layout(ctx);
  const global = getGlobalStats();
  const owned = global.lifetimeOwned || {};
  const collected = Object.keys(owned).length;
  const tabId = UI_STATE.lifetimeTab || 'all';
  const state = GAME_STATE || {};

  // 背景遮罩 + 面板
  ctx.fillStyle = 'rgba(0,0,0,0.74)';
  ctx.fillRect(0, 0, l.w, l.h);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 40;
  ctx.fillStyle = 'rgba(10,16,40,0.97)';
  drawRoundRectPath(ctx, l.modalX, l.modalY, l.modalW, l.modalH, 22);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = UI_COLORS.gold;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  drawText(ctx, '📜 我的人生清单', l.modalX + 18, l.modalY + 14, 'bold 17px sans-serif', UI_COLORS.goldLight);

  const closeSize = 30;
  const closeX = l.modalX + l.modalW - closeSize - 12;
  const closeY = l.modalY + 12;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.beginPath();
  ctx.arc(closeX + closeSize / 2, closeY + closeSize / 2, closeSize / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  drawText(ctx, '✕', closeX + closeSize / 2, closeY + 5, '16px sans-serif', UI_COLORS.muted, 'center', closeSize, 1);
  UI_STATE._ltCloseBtn = { x: closeX - 6, y: closeY - 6, w: closeSize + 12, h: closeSize + 12 };

  // 内容区（可滚动）
  const contentX = l.modalX + 18;
  const contentY = l.modalY + 44;
  const contentW = l.modalW - 36;
  const bottomBarH = 56;
  const contentH = l.modalH - (contentY - l.modalY) - bottomBarH - 8;
  const fullHeight = computeContentHeight(ctx, l, tabId);
  const maxScroll = Math.max(0, fullHeight - contentH);
  UI_STATE.lifetimeScroll = Math.min(Math.max(0, UI_STATE.lifetimeScroll || 0), maxScroll);
  const scroll = UI_STATE.lifetimeScroll || 0;
  UI_STATE._ltMaxScroll = maxScroll;

  ctx.save();
  ctx.beginPath();
  ctx.rect(contentX - 8, contentY, contentW + 16, contentH);
  ctx.clip();

  let y = contentY - scroll;

  // ---- 生涯进度卡 ----
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  drawRoundRectPath(ctx, contentX, y, contentW, HEADER_H - 10, 14);
  ctx.fill();
  ctx.restore();
  const ratio = TOTAL_ITEMS > 0 ? collected / TOTAL_ITEMS : 0;
  drawText(ctx, '已度过的人生', contentX + 14, y + 10, '11px sans-serif', '#A7B4D8');
  drawText(ctx, collected + ' / ' + TOTAL_ITEMS, contentX + contentW - 14, y + 8, 'bold 15px sans-serif', '#E9C46A', 'right', 120, 1);
  // 进度条
  const barY = y + 34;
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  drawRoundRectPath(ctx, contentX + 14, barY, contentW - 28, 8, 4);
  ctx.fill();
  if (ratio > 0) {
    ctx.fillStyle = '#AFA9EC';
    drawRoundRectPath(ctx, contentX + 14, barY, Math.max(8, (contentW - 28) * ratio), 8, 4);
    ctx.fill();
  }
  const currentLife = Math.max(1, (global.totalPlayCount || 0) + 1);
  drawText(ctx, '第 ' + currentLife + ' 世 · 还有 ' + (TOTAL_ITEMS - collected) + ' 段人生等你经历',
    contentX + 14, barY + 16, '11px sans-serif', 'rgba(167,196,255,0.85)', 'left', contentW - 28, 1);
  y += HEADER_H;

  // ---- 页签（全部 + 8 分类，两行制：4+4） ----
  const tabs = [{ id: 'all', name: '全部', emoji: '✨' }].concat(CATEGORY_META.map(function (meta) {
    return { id: meta.id, name: meta.name, emoji: meta.emoji };
  }));
  const tabPerRow = 5;
  const tabGap = 6;
  const tabW = (contentW - tabGap * (tabPerRow - 1)) / tabPerRow;
  tabs.forEach(function (tabItem, index) {
    const row = Math.floor(index / tabPerRow);
    const col = index % tabPerRow;
    const tabX = contentX + col * (tabW + tabGap);
    const tabY2 = y + row * (TAB_H2 + TAB_ROW_GAP);
    const active = tabId === tabItem.id;
    ctx.save();
    ctx.fillStyle = active ? 'rgba(233,196,106,0.20)' : 'rgba(255,255,255,0.06)';
    drawRoundRectPath(ctx, tabX, tabY2, tabW, TAB_H2, 12);
    ctx.fill();
    if (active) {
      ctx.strokeStyle = UI_COLORS.gold;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
    const countText = tabItem.id === 'all'
      ? collected + '/' + TOTAL_ITEMS
      : unlockedCountIn(owned, tabItem.id) + '/20';
    drawText(ctx, tabItem.emoji + tabItem.name, tabX + tabW / 2, tabY2 + 4, active ? 'bold 10px sans-serif' : '10px sans-serif', active ? UI_COLORS.goldLight : UI_COLORS.text, 'center', tabW - 4, 1);
    drawText(ctx, countText, tabX + tabW / 2, tabY2 + 17, '9px sans-serif', active ? UI_COLORS.goldLight : UI_COLORS.muted, 'center', tabW - 4, 1);
    UI_STATE['_ltTab_' + tabItem.id] = { x: tabX, y: tabY2, w: tabW, h: TAB_H2 };
  });
  y += TAB_BLOCK_H + TAB_GAP_AFTER;

  // ---- 里程碑摘要条 ----
  let nextMile = null;
  for (let i = 0; i < COLLECTION_MILESTONES.length; i += 1) {
    if (collected < COLLECTION_MILESTONES[i].need) {
      nextMile = COLLECTION_MILESTONES[i];
      break;
    }
  }
  ctx.save();
  ctx.fillStyle = 'rgba(125,156,255,0.10)';
  drawRoundRectPath(ctx, contentX, y, contentW, MILE_H - 8, 12);
  ctx.fill();
  ctx.restore();
  if (nextMile) {
    drawText(ctx, '🏅 下一个里程碑「' + nextMile.title + '」 ' + collected + '/' + nextMile.need + ' · 奖 ' + nextMile.rewardRP + ' RP（达成自动发放）',
      contentX + 12, y + 8, '11px sans-serif', '#A7C4FF', 'left', contentW - 24, 2);
  } else {
    drawText(ctx, '👑 你已集齐完整的一生！全部 ' + COLLECTION_MILESTONES.length + ' 座里程碑达成',
      contentX + 12, y + 8, 'bold 11px sans-serif', '#FFD700', 'left', contentW - 24, 2);
  }
  y += MILE_H + 6;

  // ---- 收集墙列表（视口裁剪：绝对坐标定位，每帧只画进入可视区的行）----
  // 全量 160 行此前每帧全画 + 每帧重算文案（新字符串让宽度缓存永远 miss），是滑动卡顿主因。
  const rows = getRows(state, owned, tabId);
  const viewTop = contentY;
  const viewBottom = contentY + contentH;

  // 各段起点用公式推导（prefixHeight 与 computeContentHeight 共用），不再有 ±6px 漂移。
  const prefixH = prefixHeight();
  const achievedHeaderY = contentY - scroll + prefixH;
  const achievedRowY = function (i) { return achievedHeaderY + SECTION_HEAD_H + i * ROW_DONE_H; };
  const lockedHeaderY = achievedHeaderY + SECTION_HEAD_H
    + (rows.achieved.length > 0 ? rows.achieved.length * ROW_DONE_H : -SECTION_HEAD_H);
  const lockedRowY = function (j) { return lockedHeaderY + SECTION_HEAD_H + j * ROW_LOCK_H; };

  function sectionHeaderAt(headerY, title) {
    if (headerY + SECTION_HEAD_H >= viewTop && headerY <= viewBottom) {
      drawText(ctx, title, contentX + 4, headerY + 4, 'bold 12px sans-serif', 'rgba(167,180,216,0.9)');
    }
  }

  // 本局新达成高亮集合
  const newIds = {};
  ((GAME_STATE && GAME_STATE.newLifeIds) || []).forEach(function (id) { newIds[id] = true; });

  if (rows.achieved.length > 0) {
    sectionHeaderAt(achievedHeaderY, '✦ 已经历（' + rows.achieved.length + '）');
    for (let i = 0; i < rows.achieved.length; i += 1) {
      const rowY = achievedRowY(i);
      if (rowY > viewBottom) break;
      if (rowY + ROW_DONE_H < viewTop) continue;
      const row = rows.achieved[i];
      const rec = row.rec;
      const isNew = !!newIds[row.product.id];
      ctx.save();
      ctx.fillStyle = isNew ? 'rgba(159,225,203,0.14)' : 'rgba(255,255,255,0.05)';
      drawRoundRectPath(ctx, contentX, rowY, contentW, ROW_DONE_H - 6, 12);
      ctx.fill();
      if (isNew) {
        ctx.strokeStyle = '#5DCAA5';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
      ctx.save();
      ctx.fillStyle = rec.count > 1 ? 'rgba(233,196,106,0.18)' : 'rgba(99,153,34,0.18)';
      drawRoundRectPath(ctx, contentX + 10, rowY + 8, 30, 30, 9);
      ctx.fill();
      ctx.restore();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillStyle = rec.count > 1 ? '#E9C46A' : '#97C459';
      ctx.fillText(row.badgeText, contentX + 25, rowY + 23);
      drawText(ctx, row.titleText, contentX + 48, rowY + 7, 'bold 12px sans-serif', UI_COLORS.text, 'left', contentW - 60, 1);
      drawText(ctx, row.subText, contentX + 48, rowY + 26, '10px sans-serif', rec.count > 1 ? '#C9A85C' : UI_COLORS.muted, 'left', contentW - 120, 1);
      drawText(ctx, row.lifeText, contentX + contentW - 12, rowY + 7, '10px sans-serif', isNew ? '#5DCAA5' : 'rgba(167,180,216,0.7)', 'right', 52, 1);
    }
  }

  if (rows.locked.length > 0) {
    sectionHeaderAt(lockedHeaderY, '○ 尚未经历（' + rows.locked.length + '）');
    for (let j = 0; j < rows.locked.length; j += 1) {
      const rowY = lockedRowY(j);
      if (rowY > viewBottom) break;
      if (rowY + ROW_LOCK_H < viewTop) continue;
      const row = rows.locked[j];
      ctx.save();
      ctx.globalAlpha = 0.82;
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      drawRoundRectPath(ctx, contentX, rowY, contentW, ROW_LOCK_H - 6, 12);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      drawRoundRectPath(ctx, contentX + 10, rowY + 7, 30, 30, 9);
      ctx.fill();
      ctx.restore();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 13px sans-serif';
      ctx.fillStyle = 'rgba(167,180,216,0.55)';
      ctx.fillText('?', contentX + 25, rowY + 22);
      drawText(ctx, row.titleText, contentX + 48, rowY + 6, 'bold 12px sans-serif', row.masked ? 'rgba(167,180,216,0.6)' : UI_COLORS.text, 'left', contentW - 130, 1);
      drawText(ctx, row.condText, contentX + 48, rowY + 25, '10px sans-serif', UI_COLORS.muted, 'left', contentW - 60, 1);
      const miniW = 44;
      const p = Math.min(1, Math.max(0, row.progress));
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      drawRoundRectPath(ctx, contentX + contentW - miniW - 12, rowY + 12, miniW, 5, 2.5);
      ctx.fill();
      if (p > 0) {
        ctx.fillStyle = p > 0.8 ? '#E9C46A' : '#5B8CFF';
        drawRoundRectPath(ctx, contentX + contentW - miniW - 12, rowY + 12, Math.max(5, miniW * p), 5, 2.5);
        ctx.fill();
      }
      drawText(ctx, row.pctText, contentX + contentW - 12, rowY + 22, '9px sans-serif', 'rgba(167,196,255,0.75)', 'right', 44, 1);
    }
  }

  ctx.restore(); // 解除 clip

  // 滚动条
  if (maxScroll > 0) {
    const trackX = l.modalX + l.modalW - 6;
    const thumbH = Math.max(24, contentH * contentH / fullHeight);
    const thumbY = contentY + (contentH - thumbH) * (scroll / maxScroll);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    drawRoundRectPath(ctx, trackX, contentY, 3, contentH, 1.5);
    ctx.fill();
    ctx.fillStyle = UI_COLORS.gold;
    drawRoundRectPath(ctx, trackX, thumbY, 3, thumbH, 1.5);
    ctx.fill();
  }

  // ---- 底部操作条：晒人生 + 继续游戏 ----
  const barY2 = l.modalY + l.modalH - bottomBarH - 6;
  const btnGap = 10;
  const shareW = Math.floor((contentW - btnGap) / 2);
  ctx.save();
  ctx.fillStyle = 'rgba(91,140,255,0.16)';
  drawRoundRectPath(ctx, contentX, barY2, shareW, 40, 14);
  ctx.fill();
  ctx.strokeStyle = '#5B8CFF';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  drawText(ctx, '📤 晒我的人生', contentX + shareW / 2, barY2 + 12, 'bold 13px sans-serif', '#A7C4FF', 'center', shareW - 10, 1);
  UI_STATE._ltShareBtn = { x: contentX, y: barY2, w: shareW, h: 40 };

  const nextX2 = contentX + shareW + btnGap;
  const nextW = contentW - shareW - btnGap;
  ctx.save();
  ctx.fillStyle = 'rgba(233,196,106,0.20)';
  drawRoundRectPath(ctx, nextX2, barY2, nextW, 40, 14);
  ctx.fill();
  ctx.strokeStyle = UI_COLORS.gold;
  ctx.stroke();
  ctx.restore();
  drawText(ctx, '继续 ▶', nextX2 + nextW / 2, barY2 + 12, 'bold 13px sans-serif', UI_COLORS.goldLight, 'center', nextW - 10, 1);
  UI_STATE._ltCloseBottomBtn = { x: nextX2, y: barY2, w: nextW, h: 40 };
}

// ---- 触摸分发（骨架同 legal.js，命中即消费，防穿透） ----

export function handleLifetimeTouchStart(point) {
  if (!UI_STATE.showLifetime || !point) {
    return false;
  }
  _fling.v = 0; // 按下载止惯性
  const closeBtn = UI_STATE._ltCloseBtn;
  if (closeBtn && isInside(point, closeBtn)) {
    UI_STATE.touchMode = 'lt-close';
    return true;
  }
  const bottomClose = UI_STATE._ltCloseBottomBtn;
  if (bottomClose && isInside(point, bottomClose)) {
    UI_STATE.touchMode = 'lt-close';
    return true;
  }
  const shareBtn = UI_STATE._ltShareBtn;
  if (shareBtn && isInside(point, shareBtn)) {
    UI_STATE.touchMode = 'lt-share';
    return true;
  }
  let tabHit = false;
  Object.keys(UI_STATE).forEach(function (key) {
    if (tabHit || key.indexOf('_ltTab_') !== 0) {
      return;
    }
    const rect = UI_STATE[key];
    if (rect && isInside(point, rect)) {
      const id = key.slice('_ltTab_'.length);
      if (UI_STATE.lifetimeTab !== id) {
        UI_STATE.lifetimeTab = id;
        UI_STATE.lifetimeScroll = 0;
        trackEvent('lifetime_tab', { tab: id });
      }
      UI_STATE.touchMode = 'none';
      tabHit = true;
    }
  });
  if (tabHit) {
    return true; // 页签命中即消费，不落入拖动（防点页签时手指抖动带着列表跳一下）
  }
  // 除上述按钮/页签外，弹窗内任意位置（含标题栏、进度卡、遮罩边距）都可拖动滚动 —— 手机习惯的全屏滑。
  UI_STATE.lifetimeTouchStartY = point.y;
  UI_STATE.lifetimeTouchStartScroll = UI_STATE.lifetimeScroll || 0;
  _drag.lastY = point.y;
  _drag.lastT = Date.now();
  _drag.v = 0;
  UI_STATE.touchMode = 'lt-scroll';
  return true;
}

export function handleLifetimeTouchMove(point) {
  if (!UI_STATE.showLifetime || !point) {
    return false;
  }
  if (UI_STATE.touchMode !== 'lt-scroll') {
    return true;
  }
  const maxScroll = UI_STATE._ltMaxScroll || 0;
  const next = (UI_STATE.lifetimeTouchStartScroll || 0) - (point.y - (UI_STATE.lifetimeTouchStartY || 0));
  UI_STATE.lifetimeScroll = Math.min(Math.max(0, next), maxScroll);
  // 速度采样（EMA 平滑），抬手后作为惯性初速度
  const now = Date.now();
  const dt = (now - _drag.lastT) / 1000;
  if (dt > 0.004) {
    const instant = (_drag.lastY - point.y) / dt;
    _drag.v = _drag.v * 0.55 + instant * 0.45;
    _drag.lastY = point.y;
    _drag.lastT = now;
  }
  return true;
}

export function handleLifetimeTouchEnd(point) {
  if (!UI_STATE.showLifetime) {
    return false;
  }
  const mode = UI_STATE.touchMode;
  if (mode === 'lt-close') {
    closeLifetime();
  } else if (mode === 'lt-share') {
    const rect = UI_STATE._ltShareBtn;
    if (rect && point && isInside(point, rect)) {
      shareLifetimeCard();
    }
    UI_STATE.touchMode = 'none';
    return true;
  } else if (mode === 'lt-scroll') {
    // 抬手甩动：超过阈值才给惯性，避免慢速拖动结束时的"漂移"
    if (Math.abs(_drag.v) > 120) {
      _fling.v = Math.max(-4200, Math.min(4200, _drag.v));
      _fling.lastT = Date.now();
    }
    UI_STATE.touchMode = 'none';
    return true;
  } else {
    UI_STATE.touchMode = 'none';
  }
  return true;
}

// ---- 分享：文案版（MVP）+ 长图卡（V2）----
// V2 决策：长图优先；环境不支持导出时静默降级回文案版。

export function shareLifetimeCard() {
  if (shareLifetimeImage()) {
    return { ok: true, type: 'image' };
  }
  return shareLifetimeText();
}

// ---- 长图精选逻辑：白名单（情感优先）→ 分类去重 → 稀有度补齐 ----
// 白名单来自对 160 条文案的人工审读：挑"墓志铭级"的瞬间，而不是最贵的。
const SHARE_FEATURED_WHITELIST = [
  'family-19', 'family-09', 'family-11', 'family-16', 'family-13',
  'social-11', 'social-16', 'social-02', 'social-04',
  'health-16', 'health-06', 'health-09',
  'experience-18', 'experience-16', 'experience-19', 'experience-01', 'experience-04',
  'cognition-16', 'cognition-13', 'cognition-08',
  'career-16', 'career-19', 'career-09',
  'consume-08', 'consume-09', 'fun-08', 'fun-09'
];

const GRADE_RANK = { legend: 0, rare: 1, advanced: 2, normal: 3 };

export function pickFeaturedItems(owned, limit) {
  const entries = [];
  Object.keys(owned).forEach(function (id) {
    const product = getProductById(id);
    if (product) {
      entries.push({ product: product, rec: owned[id] });
    }
  });
  const picked = [];
  const usedId = {};
  const usedCat = {};
  const take = function (e) {
    if (picked.length >= limit || usedId[e.product.id]) {
      return;
    }
    picked.push(e);
    usedId[e.product.id] = true;
    usedCat[e.product.category] = true;
  };
  // 第一遍：白名单顺序，每分类最多 1 条（保证画面多样）
  SHARE_FEATURED_WHITELIST.forEach(function (id) {
    const e = entries.find(function (x) { return x.product.id === id; });
    if (e && !usedCat[e.product.category]) {
      take(e);
    }
  });
  // 第二遍：剩余按最近达成（第一世序最大）优先，仍分类去重
  entries.slice().sort(function (a, b) {
    return (b.rec.firstLife || 1) - (a.rec.firstLife || 1);
  }).forEach(function (e) {
    if (!usedCat[e.product.category]) {
      take(e);
    }
  });
  // 第三遍：还是凑不满（比如只买了同分类的 3 件），按稀有度高→低补齐，允许同分类
  entries.slice().sort(function (a, b) {
    return (GRADE_RANK[a.product.gradeKey] - GRADE_RANK[b.product.gradeKey])
      || ((b.rec.firstLife || 1) - (a.rec.firstLife || 1));
  }).forEach(take);
  return picked;
}

// 空清单预告位：随机 3 条未解锁的 rare/legend（拉新钩子），用世序+收集数做种子保持稳定。
function pickTeaserItems(global) {
  const owned = global.lifetimeOwned || {};
  const candidates = PRODUCT_DB.filter(function (p) {
    return (p.gradeKey === 'legend' || p.gradeKey === 'rare') && !owned[p.id];
  });
  const out = [];
  if (!candidates.length) {
    return out;
  }
  const seed = (global.totalPlayCount || 0) * 7 + Object.keys(owned).length * 13;
  const step = Math.max(1, Math.floor(candidates.length / 3));
  for (let i = 0; i < 3; i += 1) {
    const item = candidates[(seed + i * step) % candidates.length];
    if (out.indexOf(item) === -1) {
      out.push(item);
    }
  }
  return out;
}

// 750×1334 长图（与结算卡 600×900 同一星空语言，尺寸不同）
export function drawLifetimeShareCard(ctx, global) {
  const w = 750;
  const h = 1334;
  const owned = global.lifetimeOwned || {};
  const collected = Object.keys(owned).length;
  const currentLife = Math.max(1, (global.totalPlayCount || 0) + 1);

  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, UI_COLORS.bgTop);
  gradient.addColorStop(0.55, '#101B3C');
  gradient.addColorStop(1, UI_COLORS.bgBottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 60; i += 1) {
    const x = (i * 97 + 23) % w;
    const y = (i * 173 + 41) % h;
    const pulse = 0.3 + 0.3 * Math.sin(i * 0.7);
    ctx.fillStyle = 'rgba(220,230,255,' + pulse.toFixed(2) + ')';
    ctx.fillRect(x, y, i % 3 === 0 ? 2 : 1.4, i % 3 === 0 ? 2 : 1.4);
  }

  ctx.save();
  ctx.strokeStyle = 'rgba(233,196,106,0.6)';
  ctx.lineWidth = 4;
  drawRoundRectPath(ctx, 26, 26, w - 52, h - 52, 34);
  ctx.stroke();
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 30px sans-serif';
  ctx.fillStyle = UI_COLORS.gold;
  ctx.fillText('⏳ 时间买手 · 人生清单', w / 2, 74);
  ctx.font = 'bold 56px sans-serif';
  ctx.fillStyle = UI_COLORS.goldLight;
  ctx.fillText('这是我第 ' + currentLife + ' 世的人生', w / 2, 132);

  const ratio = collected / TOTAL_ITEMS;
  const barW = 520;
  const barX = (w - barW) / 2;
  const barY = 236;
  ctx.font = '26px sans-serif';
  ctx.fillStyle = UI_COLORS.muted;
  ctx.fillText('已度过 ' + collected + ' / ' + TOTAL_ITEMS + ' 段人生', w / 2, 214);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  drawRoundRectPath(ctx, barX, barY, barW, 14, 7);
  ctx.fill();
  if (ratio > 0) {
    ctx.fillStyle = UI_COLORS.gold;
    drawRoundRectPath(ctx, barX, barY, Math.max(14, barW * ratio), 14, 7);
    ctx.fill();
  }

  let y = 306;
  if (collected > 0) {
    ctx.textAlign = 'left';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillStyle = UI_COLORS.text;
    ctx.fillText('✦ 我认真活过的瞬间', 60, y);
    y += 52;
    const items = pickFeaturedItems(owned, 6);
    const rowH = 108;
    const rowW = w - 120;
    items.forEach(function (e) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      drawRoundRectPath(ctx, 60, y, rowW, rowH - 14, 20);
      ctx.fill();
      ctx.restore();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '40px sans-serif';
      ctx.fillText(e.product.emoji, 108, y + 47);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = 'bold 28px sans-serif';
      ctx.fillStyle = UI_COLORS.text;
      const lines = splitTextToLines(ctx, e.product.name, rowW - 200);
      ctx.fillText(lines[0] || e.product.name, 148, y + 14);
      ctx.font = '20px sans-serif';
      ctx.fillStyle = 'rgba(167,180,216,0.9)';
      const descLines = splitTextToLines(ctx, e.product.desc || '', rowW - 200);
      ctx.fillText(descLines[0] || '', 148, y + 54);
      ctx.textAlign = 'right';
      ctx.font = 'bold 22px sans-serif';
      ctx.fillStyle = UI_COLORS.goldLight;
      ctx.fillText('第' + (e.rec.firstLife || 1) + '世', 60 + rowW - 20, y + 24);
      if (e.rec.count > 1) {
        ctx.font = '18px sans-serif';
        ctx.fillStyle = 'rgba(233,196,106,0.75)';
        ctx.fillText('×' + e.rec.count, 60 + rowW - 20, y + 56);
      }
      y += rowH;
    });
    if (items.length < 6) {
      ctx.textAlign = 'center';
      ctx.font = '24px sans-serif';
      ctx.fillStyle = UI_COLORS.muted;
      ctx.fillText('还有 ' + (TOTAL_ITEMS - collected) + ' 段人生，等你亲自去经历', w / 2, y + 30);
      y += 96;
    }
  } else {
    // 空清单兜底版式：预告式拉新
    ctx.textAlign = 'center';
    ctx.font = '28px sans-serif';
    ctx.fillStyle = UI_COLORS.text;
    ctx.fillText('我还没开始我的人生。', w / 2, 330);
    ctx.font = '22px sans-serif';
    ctx.fillStyle = UI_COLORS.muted;
    ctx.fillText('据说第一世，有人买了这些——', w / 2, 380);
    const teasers = pickTeaserItems(global);
    y = 440;
    teasers.forEach(function (p) {
      ctx.textAlign = 'left';
      ctx.font = 'bold 26px sans-serif';
      ctx.fillStyle = 'rgba(233,196,106,0.85)';
      ctx.fillText(p.emoji + ' ' + p.name, 110, y);
      ctx.textAlign = 'center';
      ctx.font = '20px sans-serif';
      ctx.fillStyle = UI_COLORS.muted;
      ctx.fillText('「' + (p.desc || '') + '」', w / 2, y + 40);
      y += 96;
    });
  }

  // ---- 底部：邀请码 + slogan ----
  ctx.textAlign = 'center';
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(120, h - 190);
  ctx.lineTo(w - 120, h - 190);
  ctx.stroke();
  const code = global.inviteCode || '';
  if (code) {
    ctx.font = '22px sans-serif';
    ctx.fillStyle = UI_COLORS.muted;
    ctx.fillText('输入邀请码 ' + code + '，开局多 500 天', w / 2, h - 168);
  }
  ctx.font = 'bold 30px sans-serif';
  ctx.fillStyle = UI_COLORS.goldLight;
  ctx.fillText('我的时间，由我支配', w / 2, h - 124);
  ctx.font = '18px sans-serif';
  ctx.fillStyle = UI_COLORS.muted;
  ctx.fillText('抖音小游戏 · 人生三万天', w / 2, h - 76);
}

function getOrCreateLifetimeCanvas(ttApi) {
  let canvas = UI_STATE._ltShareCanvas;
  if (!canvas && ttApi && ttApi.createCanvas) {
    canvas = ttApi.createCanvas();
  }
  if (!canvas) {
    return null;
  }
  canvas.width = 750;
  canvas.height = 1334;
  const ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  drawLifetimeShareCard(ctx, getGlobalStats());
  UI_STATE._ltShareCanvas = canvas;
  return canvas;
}

// 长图版分享。环境不支持导出时返回 false，由调用方降级为文案版。
export function shareLifetimeImage() {
  const ttApi = getTT();
  const canvas = getOrCreateLifetimeCanvas(ttApi);
  if (!canvas) {
    return false;
  }
  const global = getGlobalStats();
  const collected = Object.keys(global.lifetimeOwned || {}).length;
  const currentLife = Math.max(1, (global.totalPlayCount || 0) + 1);
  const title = collected > 0
    ? ('这是我第 ' + currentLife + ' 世的人生，已度过 ' + collected + '/' + TOTAL_ITEMS + ' 段').slice(0, 40)
    : '我还没开始我的人生——第一世，你想先买点什么？';
  try {
    return exportCanvasAndShare(ttApi, canvas, {
      title: title,
      desc: '《时间买手》用时间货币买遍 160 种人生',
      trackType: 'lifetime_card',
      silentFail: true, // 导出失败不弹 toast —— 后面还有文案版兜底
      onSuccess: function () {
        trackEvent('lifetime_share', { result: 'image', collected: collected });
      }
    });
  } catch (error) {
    return false;
  }
}

// 文案版（原 MVP 实现，保留为降级路径）
function shareLifetimeText() {
  const global = getGlobalStats();
  const owned = global.lifetimeOwned || {};
  const ids = Object.keys(owned);
  const currentLife = Math.max(1, (global.totalPlayCount || 0) + 1);
  const ttApi = getTT();
  let topLines = '';
  if (ids.length > 0) {
    // 精选逻辑：每个分类取最近达成的一条，最多 3 条（按 firstLife 最新）
    const byCategory = {};
    ids.forEach(function (id) {
      const product = PRODUCT_DB.find(function (p) { return p.id === id; });
      if (!product) return;
      const rec = owned[id];
      if (!byCategory[product.category] || rec.firstLife > owned[byCategory[product.category]].firstLife) {
        byCategory[product.category] = id;
      }
    });
    topLines = Object.keys(byCategory)
      .map(function (cat) { return PRODUCT_DB.find(function (p) { return p.id === byCategory[cat]; }); })
      .sort(function (a, b) { return owned[b.id].firstLife - owned[a.id].firstLife; })
      .slice(0, 3)
      .map(function (p) { return p.emoji + p.name; })
      .join('、');
  }
  const title = ids.length > 0
    ? '这是我第 ' + currentLife + ' 世的人生，已度过 ' + ids.length + '/160 段：' + topLines
    : '我还没开始我的人生——第一世，你想先买点什么？';
  if (ttApi && ttApi.shareAppMessage) {
    try {
      ttApi.shareAppMessage({
        title: title.slice(0, 40),
        desc: '《时间买手》用时间货币买遍 160 种人生',
        success: function () {
          trackEvent('lifetime_share', { result: 'ok', collected: ids.length });
        }
      });
      return { ok: true, type: 'text' };
    } catch (error) {
      // 分享失败不阻塞
    }
  }
  return { ok: false };
}

function isInside(point, rect) {
  return !!rect
    && point.x >= rect.x
    && point.x <= rect.x + rect.w
    && point.y >= rect.y
    && point.y <= rect.y + rect.h;
}
