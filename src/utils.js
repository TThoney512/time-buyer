// Module: utils.js
// Split from the original game.js during module refactor.
import { CATEGORY_MASTERY_DISCOUNT, CATEGORY_MASTERY_THRESHOLD, CATEGORY_META, DAILY_SPECIAL_DISCOUNT, GAME_CONFIG, GRADE_META, UI_COLORS, dailySpecial } from './config.js';
import { DECISION_MILESTONES, RANDOM_EVENT_POOL, getBuffById, getProductById } from './db.js';
import { GAME_STATE } from './state.js';

// P1-1：ownedProductIds 只会被 push（全项目无删除、无重置后的复用），
// 用「数组引用 + 长度」做缓存键：新对局 resetGameState 生成全新数组 → 引用不等自动失效；
// 局内购买 push → 长度变化自动重算。两个条件同时满足才命中，安全且零每帧开销。
const _wealthCache = { ref: null, count: -1, total: 0 };

export function calculateRoundWealth(state) {
  const safeState = state || GAME_STATE;
  const owned = safeState.ownedProductIds || [];
  if (owned === _wealthCache.ref && owned.length === _wealthCache.count) {
    return _wealthCache.total;
  }
  let total = 0;
  owned.forEach(function (productId) {
    const product = getProductById(productId);
    if (product) {
      total += product.baseCost;
    }
  });
  _wealthCache.ref = owned;
  _wealthCache.count = owned.length;
  _wealthCache.total = total;
  return total;
}

export function formatTodayDate(date) {
  const d = date || new Date();
  const year = d.getFullYear();
  const month = ('0' + (d.getMonth() + 1)).slice(-2);
  const day = ('0' + d.getDate()).slice(-2);
  return year + '-' + month + '-' + day;
}

export function getTouchPoint(event) {
  const source = event && (event.touches && event.touches[0] || event.changedTouches && event.changedTouches[0]);
  if (!source) {
    return null;
  }
  return {
    x: source.clientX || source.pageX || 0,
    y: source.clientY || source.pageY || 0
  };
}

export function isPointInRect(point, rect) {
  return !!point && !!rect &&
    point.x >= rect.x && point.x <= rect.x + rect.w &&
    point.y >= rect.y && point.y <= rect.y + rect.h;
}

export function drawRoundRectPath(ctx, x, y, w, h, radius) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

export function drawGlassPanel(ctx, x, y, w, h, radius, fill, shadowBlur) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.18)';
  ctx.shadowBlur = shadowBlur || 22;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = fill || UI_COLORS.glass;
  drawRoundRectPath(ctx, x, y, w, h, radius);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = UI_COLORS.glassBorder;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

export function hexToRgba(hex, alpha) {
  const value = hex.replace('#', '');
  const r = parseInt(value.substring(0, 2), 16);
  const g = parseInt(value.substring(2, 4), 16);
  const b = parseInt(value.substring(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

// P1-1：文本换行缓存。splitTextToLines 对每个字符调一次 measureText，
// 商品名等静态文本每帧重复测量，是渲染层最贵的开销。font+text+width 完全一致才命中，
// 结果是纯数据（字符串数组），缓存不会引入状态错误。超过上限直接清空重建，防内存膨胀。
const _wrapCache = Object.create(null);
let _wrapCacheSize = 0;
const WRAP_CACHE_LIMIT = 2000;

export function clearWrapCache() {
  Object.keys(_wrapCache).forEach(function (k) { delete _wrapCache[k]; });
  _wrapCacheSize = 0;
}

export function splitTextToLines(ctx, text, maxWidth) {
  const font = ctx.font || '';
  const key = font + '\u0001' + maxWidth + '\u0001' + text;
  const hit = _wrapCache[key];
  if (hit) {
    return hit;
  }
  const chars = String(text).split('');
  const lines = [];
  let line = '';
  chars.forEach(function (char) {
    const testLine = line + char;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      lines.push(line);
      line = char;
    } else {
      line = testLine;
    }
  });
  if (line) {
    lines.push(line);
  }
  if (_wrapCacheSize >= WRAP_CACHE_LIMIT) {
    Object.keys(_wrapCache).forEach(function (k) { delete _wrapCache[k]; });
    _wrapCacheSize = 0;
  }
  _wrapCache[key] = lines;
  _wrapCacheSize += 1;
  return lines;
}

export function drawText(ctx, text, x, y, font, color, align, maxWidth, maxLines) {
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align || 'left';
  ctx.textBaseline = 'top';
  const lines = maxWidth ? splitTextToLines(ctx, text, maxWidth) : [String(text)];
  const limit = maxLines || lines.length;
  const visible = lines.slice(0, limit);
  if (lines.length > limit && visible.length > 0) {
    visible[visible.length - 1] = visible[visible.length - 1].slice(0, -1) + '…';
  }
  visible.forEach(function (line, index) {
    ctx.fillText(line, x, y + index * 17);
  });
  ctx.restore();
}

export function formatTime(seconds) {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const mm = Math.floor(safe / 60);
  const ss = safe % 60;
  return (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
}

export function getCurrentTimeFlow(state) {
  const safeState = state || GAME_STATE;
  if (!safeState) {
    return GAME_CONFIG.dayFlowPerSecond;
  }
  const startFlow = typeof safeState.startFlow === 'number'
    ? Math.min(Math.max(1, safeState.startFlow), GAME_CONFIG.dayFlowPerSecond)
    : GAME_CONFIG.dayFlowPerSecond;
  const progress = Math.min(1, Math.max(0, (safeState.elapsedSeconds || 0) / GAME_CONFIG.roundSeconds));
  const rawFlow = startFlow + (GAME_CONFIG.dayFlowPerSecond - startFlow) * Math.pow(progress, 2);
  let flow = Math.round(rawFlow * 10) / 10;
  if (safeState.tempFlowModifier && Date.now() < safeState.tempFlowModifier.endTime) {
    flow += safeState.tempFlowModifier.value;
  }
  return Math.max(0.5, Math.round(flow * 10) / 10);
}

export function getCurrentPrice(productId, purchasedCountInCategory, forceBase) {
  const product = getProductById(productId);
  if (!product) {
    return 0;
  }
  let price = product.baseCost;
  const discountLocked = !!(GAME_STATE && GAME_STATE.discountLocked);
  const categoryBlocked = !!(GAME_STATE &&
    GAME_STATE.discountBlockedCategories &&
    GAME_STATE.discountBlockedCategories.indexOf(product.category) >= 0);
  const discountsAllowed = !discountLocked && !categoryBlocked;

  if (discountsAllowed) {
    if (dailySpecial.indexOf(product.id) >= 0) {
      price = price * DAILY_SPECIAL_DISCOUNT;
    }

    if (
      GAME_STATE &&
      (GAME_STATE.categoryPurchaseCount[product.category] || 0) >= CATEGORY_MASTERY_THRESHOLD
    ) {
      price = price * CATEGORY_MASTERY_DISCOUNT;
    }

    if (GAME_STATE && GAME_STATE.ownedBuffs) {
      GAME_STATE.ownedBuffs.forEach(function (buffId) {
        const buff = getBuffById(buffId);
        if (!buff || !buff.discount) {
          return;
        }
        if (buff.category === 'all' || buff.category === product.category) {
          price = price * buff.discount;
        }
      });
    }

    if (GAME_STATE && GAME_STATE.globalDiscount) {
      price = price * GAME_STATE.globalDiscount;
    }

    if (
      GAME_STATE &&
      GAME_STATE.categoryDiscounts &&
      GAME_STATE.categoryDiscounts[product.category]
    ) {
      price = price * GAME_STATE.categoryDiscounts[product.category];
    }

    if (GAME_STATE && GAME_STATE._nextPurchaseDiscount) {
      price = price * GAME_STATE._nextPurchaseDiscount;
    }
  }

  if (
    GAME_STATE &&
    GAME_STATE.categoryPricePenalties &&
    GAME_STATE.categoryPricePenalties[product.category] &&
    GAME_STATE.categoryPricePenalties[product.category] > 1
  ) {
    price = Math.ceil(price * GAME_STATE.categoryPricePenalties[product.category]);
  }
  return Math.max(1, Math.floor(price));
}

export function isProductUnlocked(product, state) {
  if (!product || !state) {
    return false;
  }
  if (product.gradeKey === 'normal') {
    return true;
  }
  if (product.gradeKey === 'advanced') {
    return getUnlockTotalSpent(state) >= product.unlockThreshold;
  }
  if (product.gradeKey === 'legend') {
    if (state.unlockedLegendary && state.unlockedLegendary.indexOf(product.id) >= 0) {
      return true;
    }
    return getUnlockCategorySpent(state, product.category) >= product.unlockThreshold;
  }
  if (product.gradeKey === 'rare') {
    return getUnlockCategorySpent(state, product.category) >= product.unlockThreshold;
  }
  return false;
}

export function getUnlockTotalSpent(state) {
  const realTotal = (state && typeof state.totalSpentOriginal === 'number'
    ? state.totalSpentOriginal
    : ((state && state.totalSpent) || 0)) || 0;
  return realTotal + ((state && state.virtualTotalSpent) || 0);
}

export function getUnlockCategorySpent(state, categoryId) {
  const realCategory = (state && state.categorySpentOriginal &&
    typeof state.categorySpentOriginal[categoryId] === 'number'
    ? state.categorySpentOriginal[categoryId]
    : ((state && state.categorySpent && state.categorySpent[categoryId]) || 0)) || 0;
  return realCategory + ((state && state.categoryVirtualSpent && state.categoryVirtualSpent[categoryId]) || 0);
}

export function pickRandomEvent() {
  let pool = RANDOM_EVENT_POOL;
  const boostActive = GAME_STATE && GAME_STATE.positiveEventBoost &&
    Date.now() < GAME_STATE.positiveEventBoost;
  if (boostActive) {
    pool = RANDOM_EVENT_POOL.map(function (event) {
      if (event.currencyChange > 0) {
        return Object.assign({}, event, { weight: event.weight * 2 });
      }
      return event;
    });
  }
  const totalWeight = pool.reduce(function (acc, event) {
    return acc + event.weight;
  }, 0);
  let roll = Math.random() * totalWeight;

  for (let i = 0; i < pool.length; i += 1) {
    const event = pool[i];
    if (roll < event.weight) {
      return event;
    }
    roll -= event.weight;
  }

  return pool[pool.length - 1];
}

export function getEventTriggerSeconds(totalSeconds) {
  const triggers = [];
  const firstTrigger = GAME_CONFIG.randomEventFirstTriggerSeconds;
  const interval = GAME_CONFIG.randomEventIntervalSeconds;
  for (let current = firstTrigger; current < totalSeconds; current += interval) {
    triggers.push(current);
  }
  return triggers;
}

export function getConsumedDays(remainingDays, startingDays) {
  const base = startingDays || GAME_CONFIG.initialDays;
  return Math.max(0, base - Math.max(0, remainingDays || 0));
}

export function getPendingDecisionMilestone(state) {
  if (!state) {
    return null;
  }
  const consumedDays = getConsumedDays(state.remainingDays, state.startingDays);
  const completedIds = state.completedDecisionIds || [];
  return DECISION_MILESTONES.find(function (milestone) {
    return consumedDays >= milestone.triggerDays && completedIds.indexOf(milestone.id) === -1;
  }) || null;
}

export function applyCurrencyChange(state, amount) {
  const current = Math.max(0, state.remainingDays || 0);
  const next = Math.max(0, current + (amount || 0));
  return {
    remainingDays: next,
    changed: next !== current,
    hitZero: next <= 0
  };
}

export function validateProductDB(db) {
  const issues = [];
  const ids = new Set();
  const categoryCount = {};
  const gradeCount = {};

  if (!Array.isArray(db) || db.length !== 160) {
    issues.push('商品总数应为160，当前为' + (Array.isArray(db) ? db.length : '非数组'));
  }

  db.forEach(function (product) {
    if (!product || !product.id || !product.category || !product.name || !product.desc) {
      issues.push('存在缺失字段的商品：' + JSON.stringify(product && product.id));
      return;
    }
    if (ids.has(product.id)) {
      issues.push('商品ID重复：' + product.id);
    }
    ids.add(product.id);

    categoryCount[product.category] = (categoryCount[product.category] || 0) + 1;
    gradeCount[product.gradeKey] = (gradeCount[product.gradeKey] || 0) + 1;

    const grade = GRADE_META.find(function (meta) {
      return meta.key === product.gradeKey;
    });

    if (!grade) {
      issues.push('未知等级：' + product.gradeKey + ' / ' + product.id);
      return;
    }
    if (!CATEGORY_META.some(function (meta) { return meta.id === product.category; })) {
      issues.push('未知分类：' + product.category + ' / ' + product.id);
    }
    if (!Number.isFinite(product.baseCost) || product.baseCost < grade.minPrice || product.baseCost > grade.maxPrice) {
      issues.push('baseCost超出等级区间：' + product.id + ' / ' + product.baseCost);
    }
    if (product.unlockType !== grade.unlockType || product.unlockThreshold !== grade.unlockThreshold) {
      issues.push('解锁规则与等级不符：' + product.id);
    }
  });

  Object.keys(categoryCount).forEach(function (key) {
    if (categoryCount[key] !== 20) {
      issues.push('分类数量错误：' + key + ' 应有20个，当前' + categoryCount[key]);
    }
  });

  ['normal', 'advanced', 'rare', 'legend'].forEach(function (key) {
    if ((gradeCount[key] || 0) !== 40) {
      issues.push('等级数量错误：' + key + ' 应有40个，当前' + (gradeCount[key] || 0));
    }
  });

  return {
    ok: issues.length === 0,
    issues: issues,
    total: db.length,
    categoryCount: categoryCount,
    gradeCount: gradeCount
  };
}

export function getTT() {
  if (typeof tt !== "undefined") {
    return tt;
  }
  if (typeof globalThis !== "undefined" && globalThis.tt) {
    return globalThis.tt;
  }
  return null;
}
