// Module: logic.js
// Split from the original game.js during module refactor.
import { trackEvent } from './analytics.js';
import { ADVENTURE_EVENTS, ADVENTURE_MISS_COMPENSATION_DAYS, CATEGORY_MASTERY_THRESHOLD, CATEGORY_META, DAILY_SPECIAL_COUNT, DECISION_MILESTONES_V2, GAME_CONFIG, POUCH_FREE_COUNT, POUCH_ITEMS, POUCH_PAID_COUNT, SHOP_ITEMS, dailySpecial } from './config.js';
import { playSound } from './audio.js';
import { BUFF_POOL, PRODUCT_DB, getBuffById, getProductById } from './db.js';
import { GAME_STATE, UI_STATE, checkAllAchievements, flushGlobalStats, getGlobalStats, maybeRefreshDailyStats, recordLifetimeCollection, saveGlobalStats, setToast, updateLeaderboard, vibrateShort } from './state.js';
import { applyCurrencyChange, calculateRoundWealth, formatTodayDate, getConsumedDays, getCurrentPrice, getCurrentTimeFlow, getEventTriggerSeconds, getTT, isProductUnlocked, pickRandomEvent } from './utils.js';
import { t } from './i18n.js';
import { buildMilestoneDialogue, getDialogueSpeakerAt, localDialogueLines } from './dialogue.js';
import { buildSettlementSummary, generateSettlementSummary } from './settlement.js';
import { requestLLMEpitaph, extendBudget, requestLLMCreed, requestLLMRoast, requestSceneRewrite, requestPastLifeEcho } from './llm.js';
import { spawnFloatingText, spawnPurchaseParticles, triggerCardBounce } from './ui.js';

let _dailySpecialDate = '';

const FISH_COOLDOWN = 3;
const FISH_MESSAGES = [
  '你刷了 {days} 天短视频，眼睛都花了',
  '你发呆 {days} 天，啥也没干',
  '你睡了个懒觉，浪费了 {days} 天',
  '你逛了 {days} 天淘宝，啥也没买',
  '你和同事聊了 {days} 天八卦',
  '你打了 {days} 天游戏，手都麻了',
  '你追了 {days} 天剧，剧情全忘光了',
  '你翻了 {days} 天朋友圈，越翻越空虚',
  '你吃了 {days} 天零食，胖了三斤',
  '你听了 {days} 天播客，一个知识点没记住',
  '你修了 {days} 天电脑，其实只是重启了',
  '你整理了 {days} 天桌面，还是那么乱',
  '你做了 {days} 天计划，一个没执行',
  '你看了 {days} 天天气预报，然后忘了带伞',
  '你刷了 {days} 天搞笑视频，笑完就忘了'
];

function dailySpecialScore(product, dateKey) {
  const text = product.id + ':' + dateKey;
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 100000;
  }
  return hash;
}

export function refreshDailySpecial() {
  const dateKey = formatTodayDate();
  const sorted = PRODUCT_DB.slice().sort(function (a, b) {
    return dailySpecialScore(a, dateKey) - dailySpecialScore(b, dateKey);
  });
  dailySpecial.length = 0;
  for (let i = 0; i < DAILY_SPECIAL_COUNT && i < sorted.length; i += 1) {
    dailySpecial.push(sorted[i].id);
  }
  _dailySpecialDate = dateKey;
  return dailySpecial.slice();
}

refreshDailySpecial();

export const dailyMissions = [
  { id: 'buy_total', name: '购物达人', desc: '本日累计购买 10 件商品', type: 'buy', target: 10, reward: 25 },
  { id: 'buy_cognition', name: '认知进阶', desc: '本日购买认知分类 5 件商品', type: 'buy-category', category: 'cognition', target: 5, reward: 20 },
  { id: 'adventure', name: '奇遇探索', desc: '本日触发 1 次奇遇', type: 'adventure', target: 1, reward: 15 },
  { id: 'decision', name: '人生抉择', desc: '本日完成 1 次人生抉择', type: 'decision', target: 1, reward: 20 },
  { id: 'spend', name: '挥金如土', desc: '本日累计消费 5000 天', type: 'spend', target: 5000, reward: 30 }
];

export function getDailyMissionState() {
  const global = getGlobalStats();
  const today = formatTodayDate();
  let state = global.dailyMissions;
  if (
    !state ||
    state.date !== today ||
    !state.progress ||
    !state.completed
  ) {
    state = {
      date: today,
      progress: {},
      completed: []
    };
    global.dailyMissions = state;
    // 跨日时同时重置今日重生计数，避免挂机跨天后计数继续累加。
    global.todayDate = today;
    global.todayRebirthCount = 0;
    saveGlobalStats(global);
  }
  return { global: global, state: state };
}

export function recordMissionProgress(type, amount, category) {
  const missionContext = getDailyMissionState();
  const global = missionContext.global;
  const state = missionContext.state;
  let awarded = false;
  dailyMissions.forEach(function (mission) {
    if (state.completed.indexOf(mission.id) >= 0) {
      return;
    }
    if (mission.type !== type) {
      return;
    }
    if (mission.category && mission.category !== category) {
      return;
    }
    const current = (state.progress[mission.id] || 0) + Math.max(0, amount || 1);
    state.progress[mission.id] = Math.min(current, mission.target);
    if (state.progress[mission.id] >= mission.target) {
      state.completed.push(mission.id);
      global.reincarnationPoints = (global.reincarnationPoints || 0) + mission.reward;
      awarded = true;
      setToast(t('toast.missionDone'), t('toast.missionReward', { name: mission.name, n: mission.reward }), 'success');
    }
  });
  if (awarded) {
    saveGlobalStats(global);
    flushGlobalStats();
  }
}

function shufflePouchPool(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

export function generatePouchItems() {
  const freePool = POUCH_ITEMS.filter(function (item) {
    return item.free;
  });
  const paidPool = POUCH_ITEMS.filter(function (item) {
    return !item.free;
  });
  const freeItems = shufflePouchPool(freePool).slice(0, POUCH_FREE_COUNT);
  const paidItems = shufflePouchPool(paidPool).slice(0, POUCH_PAID_COUNT);
  return shufflePouchPool(freeItems.concat(paidItems)).map(function (item) {
    return Object.assign({}, item, { used: false });
  });
}

export function refreshPouchItems(useAd) {
  if (!GAME_STATE) {
    return { ok: false, error: '游戏未初始化' };
  }
  GAME_STATE.pouchItems = generatePouchItems();
  if (!useAd) {
    setToast(t('toast.pouchRefreshed'), t('toast.pouchNew'), 'success');
  }
  return { ok: true, items: GAME_STATE.pouchItems.slice() };
}

export const FREE_POUCH_REFRESH_LIMIT = 1;

export function requestFreePouchRefresh() {
  if (!GAME_STATE) {
    return { ok: false, error: '游戏未初始化' };
  }
  if ((GAME_STATE.pouchRefreshCount || 0) >= FREE_POUCH_REFRESH_LIMIT) {
    setToast(t('toast.refreshUsed'), t('toast.refreshNextLife'), 'info');
    return { ok: false, error: t('toast.refreshUsed') };
  }
  GAME_STATE.pouchItems = generatePouchItems();
  GAME_STATE.pouchRefreshCount = (GAME_STATE.pouchRefreshCount || 0) + 1;
  setToast(t('toast.pouchRefreshed'), t('toast.pouchNew'), 'success');
  return { ok: true };
}

// 开源版无广告：续命改为每日一次免费，按日期门控。
export function requestFreeRevive() {
  if (!GAME_STATE) {
    return { ok: false, error: '游戏未初始化' };
  }
  const global = getGlobalStats();
  const today = formatTodayDate();
  if (global.lastFreeReviveDate === today) {
    setToast(t('toast.reviveUsed'), t('toast.reviveTomorrow'), 'info');
    return { ok: false, error: '今日续命已使用' };
  }
  global.lastFreeReviveDate = today;
  saveGlobalStats(global);
  executeRevive();
  return { ok: true };
}

export function usePouchItem(itemId) {
  if (!GAME_STATE) {
    return { ok: false, error: '游戏未初始化' };
  }
  const item = (GAME_STATE.pouchItems || []).find(function (candidate) {
    return candidate.id === itemId;
  });
  if (!item) {
    return { ok: false, error: '锦囊不存在' };
  }
  if (item.used) {
    return { ok: false, error: '该锦囊已使用' };
  }
  if (!item.free && item.price > 0) {
    const global = getGlobalStats();
    if ((global.reincarnationPoints || 0) < item.price) {
      setToast(t('toast.needRPTitle'), t('toast.needRPDesc', { n: item.price }), 'error');
      return { ok: false, error: '轮回积分不足' };
    }
    global.reincarnationPoints -= item.price;
    saveGlobalStats(global);
    flushGlobalStats();
  }

  let ok = true;
  let error = '';
  switch (item.id) {
    case 'doubleAdventure':
      GAME_STATE.doubleAdventureActive = true;
      break;
    case 'deathShield':
      GAME_STATE.deathShieldActive = true;
      break;
    case 'timeRewind':
      GAME_STATE.remainingDays = (GAME_STATE.remainingDays || 0) + 100;
      break;
    case 'discountCoupon':
      GAME_STATE._nextPurchaseDiscount = 0.5;
      break;
    case 'timeSand':
      GAME_STATE.remainingDays = (GAME_STATE.remainingDays || 0) + 200;
      break;
    case 'cashBack':
      GAME_STATE.nextPurchaseCashback = true;
      break;
    case 'timeFreeze': {
      const result = activateTimeFreeze(true);
      ok = result.ok;
      error = result.error || '';
      if (!ok) {
        return { ok: false, error: error };
      }
      break;
    }
    case 'refreshTicket':
      refreshPouchItems(false);
      break;
    case 'luckyBuff': {
      const buffPool = BUFF_POOL.filter(function (buff) {
        return buff.discount || buff.bonusDays;
      });
      const buff = buffPool.length
        ? buffPool[Math.floor(Math.random() * buffPool.length)]
        : BUFF_POOL[0];
      if (!GAME_STATE.ownedBuffs) {
        GAME_STATE.ownedBuffs = [];
      }
      if (GAME_STATE.ownedBuffs.indexOf(buff.id) === -1) {
        GAME_STATE.ownedBuffs.push(buff.id);
      }
      GAME_STATE.activeBuff = buff;
      break;
    }
    case 'veteranDiscount':
      GAME_STATE.globalDiscount = 0.9;
      GAME_STATE.pouchVeteranActive = true;
      break;
    default:
      ok = false;
      error = '未知锦囊';
  }
  if (!ok) {
    return { ok: false, error: error };
  }
  item.used = true;
  setToast(t('toast.itemUsed', { name: item.name }), item.desc, 'success');
  return { ok: true, itemId: item.id };
}

export function doFish() {
  if (!GAME_STATE || GAME_STATE.phase !== 'playing') {
    setToast(t('toast.fishFail'), t('toast.fishOver'), 'error');
    return { ok: false };
  }
  if (GAME_STATE.fishCooldown > 0) {
    setToast(t('toast.fishStop'), '', 'info');
    return { ok: false };
  }
  if (
    GAME_STATE.pendingDecisionMilestone ||
    GAME_STATE.pendingEvent ||
    GAME_STATE.pendingAdventure ||
    GAME_STATE.showReviveModal
  ) {
    setToast(t('toast.fishFail'), t('toast.fishBusy'), 'error');
    return { ok: false };
  }

  const lostDays = Math.floor(Math.random() * 91) + 10;
  GAME_STATE.remainingDays = Math.max(0, GAME_STATE.remainingDays - lostDays);
  GAME_STATE.fishCooldown = FISH_COOLDOWN;
  GAME_STATE.fishCount = (GAME_STATE.fishCount || 0) + 1;

  const message = FISH_MESSAGES[Math.floor(Math.random() * FISH_MESSAGES.length)]
    .replace('{days}', lostDays);
  setToast(t('toast.fishOk'), message, 'info');
  playSound('click');
  vibrateShort();

  // N6：AI 补刀——每局最多 3 次，带这局真实数据；本地吐槽先行，AI 到货后再来一条（明示 AI 身份）。
  // 无 BYOK/超额/超时 → 静默，不打扰（降级即无第二条，玩家视角只是"毒舌池运气不错"）。
  if ((GAME_STATE.fishRoastCount || 0) < 3) {
    GAME_STATE.fishRoastCount = (GAME_STATE.fishRoastCount || 0) + 1;
    const repeatCounts = {};
    (GAME_STATE.purchaseLedger || []).forEach(function (item) {
      repeatCounts[item.productId] = (repeatCounts[item.productId] || 0) + 1;
    });
    let focusProduct = null;
    Object.keys(repeatCounts).forEach(function (pid) {
      if (repeatCounts[pid] >= 3 && !focusProduct) {
        const p = getProductById(pid);
        if (p) {
          focusProduct = p.name + ' ×' + repeatCounts[pid];
        }
      }
    });
    const lowCategories = CATEGORY_META
      .filter(function (category) {
        return !(GAME_STATE.categorySpent || {})[category.id];
      })
      .map(function (category) { return category.name; });
    requestLLMRoast({
      totalSpent: Math.floor(GAME_STATE.totalSpent || 0),
      topCategory: getMostSpentCategory(),
      lowCategories: lowCategories.slice(0, 3),
      focusProduct: focusProduct,
      lostDays: lostDays
    }).then(function (r) {
      if (r.ok && r.text && GAME_STATE && GAME_STATE.phase === 'playing') {
        setToast(t('toast.fishAiTitle'), r.text, 'info');
      }
    });
  }

  if (GAME_STATE.remainingDays <= 0) {
    endRound('days-exhausted');
  }
  return { ok: true, lostDays: lostDays };
}

export function executeRevive() {
  if (!GAME_STATE) {
    return;
  }

  GAME_STATE.remainingDays += GAME_CONFIG.reviveBonusDays;
  GAME_STATE.remainingSeconds += GAME_CONFIG.reviveBonusSeconds;
  GAME_STATE.reviveUsed = true;
  GAME_STATE.showReviveModal = false;
  GAME_STATE._pendingEndReason = null;

  const ttApi = getTT();
  if (ttApi && ttApi.showToast) {
    ttApi.showToast({
      title: t('toast.reviveOk'),
      icon: 'success'
    });
  }
  setToast(t('toast.reviveOk'), t('toast.reviveOkDesc'), 'success');
  playSound('revive');
  vibrateShort();
}

export function closeReviveModalAndEnd() {
  if (!GAME_STATE) {
    return;
  }

  const reason = GAME_STATE._pendingEndReason || 'days-exhausted';
  GAME_STATE._pendingEndReason = null;
  finalizeRound(reason);
}

// N8 前世档案：每世结束存一条 ≤50 字墓志铭（AI 版或本地版都存，离线玩家也配拥有回响）。
// 同局去重：额度耗尽重试路径会让 runEpitaphRequest 再次回调，只记第一次。
function recordPastLife(state, epitaph, isAI) {
  if (!state || state._pastLifeRecorded) {
    return;
  }
  state._pastLifeRecorded = true;
  const global = getGlobalStats();
  const entry = {
    n: Math.max(1, global.totalPlayCount || 1),
    epitaph: String(epitaph || '').slice(0, 50),
    ai: !!isAI
  };
  global.pastLives = (global.pastLives || []).concat([entry]).slice(-6);
  saveGlobalStats(global);
}

function runEpitaphRequest(state, fallbackText) {
  state.aiLoading = true;
  requestLLMEpitaph(buildAIPromptData(state)).then(function (result) {
    state.aiLoading = false;
    if (result.ok && result.comment) {
      state.aiComment = result.comment;
      state.aiGenerated = true;
      state.budgetExhausted = false;
      recordPastLife(state, result.comment, true);
      setToast(t('toast.aiDone'), t('toast.aiDoneDesc'), 'info');
    } else {
      state.aiComment = fallbackText;
      state.aiGenerated = false;
      recordPastLife(state, fallbackText, false);
      if (result.error === 'over-budget') {
        // 额度用尽：结算页弹"继续用 AI / 换固定模板"，由玩家拍板
        state.budgetExhausted = true;
      }
    }
  }).catch(function () {
    state.aiLoading = false;
    state.aiComment = fallbackText;
    state.aiGenerated = false;
  });
}

/**
 * 额度耗尽弹窗的两条出路（由 ui.js 触摸接线调用）：
 * continueAI=true → 按 addAmount 追加额度并重试 AI；false → 留在模板文案，关闭弹窗。
 */
export function resolveBudgetExhausted(continueAI, addAmount) {
  if (!GAME_STATE || !GAME_STATE.budgetExhausted) {
    return false;
  }
  if (!continueAI) {
    GAME_STATE.budgetExhausted = false;
    setToast(t('budget.toTemplateTitle'), t('budget.toTemplateDesc'), 'info');
    return true;
  }
  extendBudget(addAmount);
  GAME_STATE.budgetExhausted = false;
  setToast(t('budget.continuedTitle'), t('budget.continuedDesc'), 'info');
  runEpitaphRequest(GAME_STATE, GAME_STATE.aiComment || t('card.epitaphDefault'));
  return true;
}

export function buildAIPromptData(state) {
  const safeState = state || GAME_STATE || {};
  const ledger = safeState.purchaseLedger || [];
  const categorySpent = safeState.categorySpent || {};
  const totalSpent = safeState.totalSpent || 0;
  const categoryRatio = {};
  Object.keys(categorySpent).forEach(function (categoryId) {
    categoryRatio[categoryId] = totalSpent > 0
      ? Math.round(categorySpent[categoryId] / totalSpent * 100)
      : 0;
  });
  const topProducts = ledger.slice(0, 5).map(function (entry) {
    const product = getProductById(entry.productId);
    return product ? product.name : '';
  }).filter(Boolean);
  const startDays = safeState.startingDays || GAME_CONFIG.initialDays;
  const consumedDays = Math.max(0, startDays - Math.max(0, safeState.remainingDays || 0));
  return {
    totalSpent: totalSpent,
    consumedDays: consumedDays,
    remainingDays: Math.floor(safeState.remainingDays || 0),
    ownedProducts: (safeState.ownedProductIds || []).length,
    totalWealth: calculateRoundWealth(safeState),
    categorySpent: categorySpent,
    categoryPurchaseCount: safeState.categoryPurchaseCount || {},
    purchaseLedger: ledger.slice(0, 50),
    roundRP: safeState.roundRP || null,
    endReason: safeState.endReason || null,
    topCategory: getMostSpentCategory() || '未知',
    categoryRatio: categoryRatio,
    decisionIds: (safeState.decisionLog || []).map(function (entry) {
      return entry.milestoneId;
    }),
    creeds: (safeState.decisionLog || []).filter(function (entry) {
      return entry.creed;
    }).map(function (entry) {
      return entry.creed;
    }),
    adventureIds: safeState.adventureTriggered || [],
    topProducts: topProducts,
    hasAdventure: (safeState.adventureTriggered || []).length > 0,
    completedDecisions: (safeState.completedDecisionIds || []).length,
    totalPlayCount: getGlobalStats().totalPlayCount || 0
  };
}

export function finalizeRound(reason) {
  if (!GAME_STATE || GAME_STATE.phase === 'settled') {
    return null;
  }

  GAME_STATE.phase = 'settled';
  GAME_STATE.endReason = reason;
  GAME_STATE.pendingDecisionMilestone = null;
  GAME_STATE.pendingEvent = null;
  GAME_STATE.showReviveModal = false;

  const summary = buildSettlementSummary(GAME_STATE);
  const fallbackSummary = generateSettlementSummary(GAME_STATE);
  const fallbackText = fallbackSummary.summaryText || '这一生值得被记住。';
  GAME_STATE.aiComment = fallbackText;
  GAME_STATE.aiLoading = true;
  GAME_STATE.aiGenerated = false;
  runEpitaphRequest(GAME_STATE, fallbackText);

  const global = getGlobalStats();
  const startDays = GAME_STATE.startingDays || GAME_CONFIG.initialDays;
  global.totalPlayCount += 1;
  global.totalDaysSpent += Math.max(0, Math.floor(startDays - GAME_STATE.remainingDays));
  global.totalProductsBought += GAME_STATE.ownedProductIds.length;

  if (GAME_STATE.ownedProductIds.length > global.maxProductsInRound) {
    global.maxProductsInRound = GAME_STATE.ownedProductIds.length;
  }

  let maxCategory = null;
  let maxSpent = 0;
  Object.keys(GAME_STATE.categorySpent || {}).forEach(function (categoryId) {
    const spent = GAME_STATE.categorySpent[categoryId];
    if (spent > maxSpent) {
      maxSpent = spent;
      maxCategory = categoryId;
    }
  });
  if (maxCategory) {
    global.bestCategory = maxCategory;
  }

  if (!global.firstPlayDate) {
    global.firstPlayDate = new Date().toISOString();
  }

  const totalWealth = summary.totalWealth || calculateRoundWealth(GAME_STATE);
  GAME_STATE.totalWealth = totalWealth;
  if (totalWealth > (global.myBestScore || 0)) {
    global.myBestScore = totalWealth;
    updateLeaderboard({
      openId: 'local-player',
      nickname: '我',
      avatar: '',
      score: totalWealth,
      productIds: GAME_STATE.ownedProductIds
    });
  }

  const newlyUnlocked = checkAllAchievements(GAME_STATE, global);
  const achievementRP = newlyUnlocked.length * 10;
  const totalRP = 100 + achievementRP;
  GAME_STATE.roundRP = {
    baseRP: 100,
    achievementRP: achievementRP,
    totalRP: totalRP
  };
  const firstRound = global.totalPlayCount === 1;
  global.reincarnationPoints = (global.reincarnationPoints || 0) + totalRP;
  global.lifetimeRP = (global.lifetimeRP || 0) + totalRP;
  trackEvent('round_end', {
    consumedDays: Math.floor(summary.consumedDays),
    totalWealth: totalWealth,
    achievementCount: newlyUnlocked.length,
    endReason: reason
  });
  saveGlobalStats(global);
  flushGlobalStats();
  setToast(
    reason === 'days-exhausted' ? '人生时间耗尽' : '15分钟结束',
    '本局共消耗 ' + Math.floor(summary.consumedDays).toLocaleString() + ' 天',
    'end'
  );
  if (firstRound) {
    setToast(t('toast.rpUnlocked'), t('toast.rpUnlockedDesc'), 'success');
  }
  return summary;
}

export function endRound(reason) {
  if (!GAME_STATE || GAME_STATE.phase !== 'playing') {
    return null;
  }

  if (!GAME_STATE.reviveUsed) {
    if (!GAME_STATE.showReviveModal) {
      GAME_STATE.showReviveModal = true;
      GAME_STATE._pendingEndReason = reason;
    }
    return null;
  }

  return finalizeRound(reason);
}

export function checkCategoryMasteryUnlock(categoryId, newCount) {
  if (newCount !== CATEGORY_MASTERY_THRESHOLD) {
    return false;
  }
  const meta = CATEGORY_META.find(function (category) {
    return category.id === categoryId;
  });
  setToast(t('toast.mastery', { cat: t('cat.' + categoryId) }), t('toast.masteryDesc'), 'success');
  playSound('mastery');
  vibrateShort();
  return true;
}

export function purchaseShopItem(itemId) {
  const item = SHOP_ITEMS.find(function (shopItem) {
    return shopItem.id === itemId;
  });
  if (!item) {
    return { ok: false, error: '商品不存在' };
  }
  const global = getGlobalStats();
  if ((global.reincarnationPoints || 0) < item.price) {
    setToast(t('toast.rpFail'), t('toast.rpFailDesc'), 'error');
    return { ok: false, error: '积分不足' };
  }
  global.reincarnationPoints -= item.price;
  if (item.id === 'skin') {
    global.shopItems.skin = 'gold';
  } else {
    global.shopItems[item.id] = (global.shopItems[item.id] || 0) + 1;
  }
  saveGlobalStats(global);
  flushGlobalStats();
  setToast(t('toast.bought'), t('toast.boughtDesc', { item: item.name }), 'success');
  playSound('purchase');
  vibrateShort('medium');
  return { ok: true, itemId: item.id, price: item.price };
}

export function resolveBuffTicketChoice(buffId) {
  const global = getGlobalStats();
  if ((global.shopItems.buffTicket || 0) <= 0) {
    return { ok: false, error: '没有自选券' };
  }
  const buff = getBuffById(buffId);
  if (!buff) {
    return { ok: false, error: 'Buff 不存在' };
  }
  global.shopItems.buffTicket -= 1;
  saveGlobalStats(global);
  flushGlobalStats();
  GAME_STATE.activeBuff = buff;
  GAME_STATE.ownedBuffs = [buff.id];
  UI_STATE.buffPickerOpen = false;
  if (buff.id === 'underdog') {
    GAME_STATE.remainingDays += 1000;
    GAME_STATE.startingDays = (GAME_STATE.startingDays || GAME_CONFIG.initialDays) + 1000;
  }
  setToast(t('toast.buffPickOk'), buff.emoji + ' ' + buff.name, 'success');
  playSound('purchase');
  return { ok: true, buffId: buff.id };
}

export function activateTimeFreeze(fromPouch) {
  if (!GAME_STATE || GAME_STATE.phase !== 'playing') {
    return { ok: false, error: '本局已结束' };
  }
  if (!fromPouch) {
    const global = getGlobalStats();
    if ((global.shopItems.timeFreeze || 0) <= 0) {
      setToast(t('toast.noFreeze'), t('toast.noFreezeDesc'), 'error');
      return { ok: false, error: '时间静止数量不足' };
    }
    global.shopItems.timeFreeze -= 1;
    saveGlobalStats(global);
    flushGlobalStats();
  }
  if (GAME_STATE.timeFreezeActive || GAME_STATE.timeFreezeUsedThisRound) {
    setToast(t('toast.freezeUsed'), t('toast.freezeUsedDesc'), 'info');
    return { ok: false, error: '本局已使用过时间静止' };
  }
  GAME_STATE.timeFreezeRemaining = 15;
  GAME_STATE.timeFreezeActive = true;
  GAME_STATE.timeFreezeUsedThisRound = true;
  setToast(t('toast.freezeOn'), t('toast.freezeOnDesc'), 'info');
  playSound('freeze');
  return { ok: true, remainingSeconds: GAME_STATE.timeFreezeRemaining };
}

export function purchaseProduct(productId) {
  if (!GAME_STATE) {
    return { ok: false, error: '游戏未初始化' };
  }
  if (GAME_STATE.phase !== 'playing') {
    return { ok: false, error: '本局已结束' };
  }
  if (GAME_STATE.showReviveModal) {
    return { ok: false, error: '请先处理续命' };
  }
  if (GAME_STATE.pendingDecisionMilestone || GAME_STATE.pendingEvent) {
    return { ok: false, error: GAME_STATE.pendingEvent ? '请先处理随机事件' : '请先完成人生抉择' };
  }

  const product = getProductById(productId);
  if (!product) {
    return { ok: false, error: '商品不存在' };
  }
  if (GAME_STATE.ownedProductIds.indexOf(productId) >= 0) {
    return { ok: false, error: '已拥有' };
  }
  if (!isProductUnlocked(product, GAME_STATE)) {
    return { ok: false, error: '未解锁' };
  }

  const now = Date.now();
  if (now - GAME_STATE.lastPurchaseAt < 80) {
    return { ok: false, error: '操作过快' };
  }

  const count = GAME_STATE.categoryPurchaseCount[product.category] || 0;
  const price = getCurrentPrice(productId, count);
  if (price > GAME_STATE.remainingDays) {
    return { ok: false, error: '天数不足' };
  }

  GAME_STATE.lastPurchaseAt = now;
  GAME_STATE._nextPurchaseDiscount = null;
  GAME_STATE.remainingDays = Math.max(0, GAME_STATE.remainingDays - price);
  if (GAME_STATE.nextPurchaseCashback) {
    GAME_STATE.remainingDays = Math.min(
      GAME_STATE.startingDays || GAME_CONFIG.initialDays,
      GAME_STATE.remainingDays + Math.floor(price / 2)
    );
    GAME_STATE.nextPurchaseCashback = false;
  }
  GAME_STATE.totalSpent += price;
  GAME_STATE.totalSpentOriginal += product.baseCost;
  GAME_STATE.categorySpent[product.category] = (GAME_STATE.categorySpent[product.category] || 0) + price;
  GAME_STATE.categorySpentOriginal[product.category] = (GAME_STATE.categorySpentOriginal[product.category] || 0) + product.baseCost;
  GAME_STATE.categoryPurchaseCount[product.category] = count + 1;
  GAME_STATE.ownedProductIds.push(product.id);
  recordLifetimeCollection(product.id);
  GAME_STATE.purchaseLedger.push({
    productId: product.id,
    category: product.category,
    price: price,
    source: 'purchase',
    elapsedSeconds: GAME_STATE.elapsedSeconds,
    consumedDays: getConsumedDays(GAME_STATE.remainingDays, GAME_STATE.startingDays)
  });
  GAME_STATE.lastPurchaseResult = {
    ok: true,
    productId: product.id,
    price: price,
    remainingDays: GAME_STATE.remainingDays
  };
  setToast(t('toast.bought'), t('toast.minusDays', { item: product.name, n: Math.floor(price) }), 'success');
  const purchaseNow = Date.now();
  if (purchaseNow - (GAME_STATE.lastBuyTimestamp || 0) < 2000) {
    GAME_STATE.consecutiveBuyCount = (GAME_STATE.consecutiveBuyCount || 0) + 1;
  } else {
    GAME_STATE.consecutiveBuyCount = 1;
  }
  GAME_STATE.lastBuyTimestamp = purchaseNow;
  if (GAME_STATE.consecutiveBuyCount >= 5) {
    GAME_STATE.consecutiveBuyCount = 0;
    GAME_STATE.comboActive = true;
    GAME_STATE.comboFlashTimer = 1.5;
    GAME_STATE.remainingDays += 50;
    setToast(t('toast.hotCombo'), t('toast.hotComboDesc'), 'success');
    playSound('combo');
  } else {
    playSound('purchase');
  }
  vibrateShort('medium');
  triggerCardBounce(product.id);
  spawnPurchaseParticles(product.id);
  spawnFloatingText(product.id, price);
  checkCategoryMasteryUnlock(product.category, count + 1);
  recordMissionProgress('buy', 1);
  recordMissionProgress('buy-category', 1, product.category);
  recordMissionProgress('spend', price);
  trackEvent('product_purchase', {
    productId: product.id,
    price: price,
    remainingDays: GAME_STATE.remainingDays
  });

  if (GAME_STATE.remainingDays <= 0) {
    endRound('days-exhausted');
  } else {
    checkDecisionMilestones();
  }
  return { ok: true, productId: product.id, price: price, remainingDays: GAME_STATE.remainingDays };
}

export function updateRound(deltaSeconds) {
  if (!GAME_STATE || GAME_STATE.phase !== 'playing') {
    return;
  }
  if (GAME_STATE._adventurePaused) {
    return;
  }
  if (GAME_STATE.pendingDecisionMilestone || GAME_STATE.pendingEvent || GAME_STATE.showReviveModal) {
    return;
  }

  const today = formatTodayDate();
  if (today !== _dailySpecialDate) {
    refreshDailySpecial();
  }
  // 低频跨日检查（内部 30 秒节流），挂机跨天时也能重置每日数据。
  maybeRefreshDailyStats();
  getDailyMissionState();

  const seconds = Math.max(0, deltaSeconds || 0);
  if (GAME_STATE.fishCooldown > 0) {
    GAME_STATE.fishCooldown = Math.max(0, GAME_STATE.fishCooldown - seconds);
  }
  if (GAME_STATE.timeFreezeActive) {
    GAME_STATE.timeFreezeRemaining = Math.max(0, GAME_STATE.timeFreezeRemaining - seconds);
    if (GAME_STATE.timeFreezeRemaining <= 0) {
      GAME_STATE.timeFreezeActive = false;
      setToast(t('toast.flowBack'), t('toast.flowBackDesc'), 'info');
    }
    return;
  }
  GAME_STATE.elapsedSeconds += seconds;
  // 局内自动存档：仅做防抖落盘（写操作在 setTimeout 回调里执行，不阻塞渲染帧）。
  // 此前这里是 flushGlobalStats()，会在渲染帧内做一次同步磁盘写入。
  if (GAME_STATE.elapsedSeconds - (GAME_STATE.lastAutoSaveElapsed || 0) >= 30) {
    GAME_STATE.lastAutoSaveElapsed = GAME_STATE.elapsedSeconds;
    saveGlobalStats(getGlobalStats());
  }
  GAME_STATE.remainingSeconds = Math.max(0, GAME_STATE.remainingSeconds - seconds);
  const currentFlow = getCurrentTimeFlow(GAME_STATE);
  GAME_STATE.currentFlow = currentFlow;
  GAME_STATE.remainingDays = Math.max(
    0,
    GAME_STATE.remainingDays - currentFlow * seconds
  );

  triggerScheduledRandomEvents();
  if (GAME_STATE.pendingEvent || GAME_STATE.showReviveModal) {
    return;
  }
  checkDecisionMilestones();
  if (GAME_STATE.pendingDecisionMilestone) {
    return;
  }

  if (GAME_STATE.remainingSeconds <= 0) {
    endRound('time-out');
  } else if (GAME_STATE.remainingDays <= 0) {
    endRound('days-exhausted');
  }
}

export function triggerScheduledRandomEvents() {
  if (GAME_STATE.pendingEvent) {
    return;
  }
  const triggers = getEventTriggerSeconds(GAME_CONFIG.roundSeconds);
  while (
    GAME_STATE.randomEventIndex < triggers.length &&
    GAME_STATE.elapsedSeconds >= triggers[GAME_STATE.randomEventIndex]
  ) {
    const event = pickRandomEvent();
    if (event.options && event.options.length > 0) {
      // N4：池对象不可污染，先浅拷贝再交给 AI 改写文案（触发/数值/选项效果永远归代码）。
      const eventCopy = Object.assign({}, event);
      GAME_STATE.pendingEvent = {
        event: eventCopy,
        elapsedSeconds: GAME_STATE.elapsedSeconds
      };
      GAME_STATE.randomEventIndex += 1;
      GAME_STATE.lastRandomEvent = eventCopy;
      setToast(eventCopy.name, t('toast.makeChoice'), 'decision');
      playSound('event');
      vibrateShort();
      requestSceneRewriteInPlace('event', eventCopy, GAME_STATE);
      return;
    }
    if (event.currencyChange < 0) {
      const global = getGlobalStats();
      let shieldUsed = false;
      if (GAME_STATE.deathShieldActive) {
        GAME_STATE.deathShieldActive = false;
        shieldUsed = true;
      } else if ((global.shopItems.deathShield || 0) > 0) {
        global.shopItems.deathShield -= 1;
        saveGlobalStats(global);
        flushGlobalStats();
        shieldUsed = true;
      }
      if (shieldUsed) {
        GAME_STATE.randomEventIndex += 1;
        GAME_STATE.randomEventLog.push({
          eventId: event.id,
          name: event.name,
          currencyChange: 0,
          shielded: true,
          elapsedSeconds: GAME_STATE.elapsedSeconds,
          remainingDays: GAME_STATE.remainingDays
        });
        GAME_STATE.lastRandomEvent = { id: event.id, name: event.name, emoji: event.emoji, shielded: true };
        setToast(t('toast.shieldOk'), t('toast.shieldDesc', { event: event.name }), 'success');
        playSound('event');
        vibrateShort();
        continue;
      }
    }
    const result = applyCurrencyChange(GAME_STATE, event.currencyChange);
    GAME_STATE.remainingDays = result.remainingDays;
    GAME_STATE.randomEventIndex += 1;
    GAME_STATE.randomEventLog.push({
      eventId: event.id,
      name: event.name,
      currencyChange: event.currencyChange,
      elapsedSeconds: GAME_STATE.elapsedSeconds,
      remainingDays: GAME_STATE.remainingDays
    });
    GAME_STATE.lastRandomEvent = event;
    setToast(
      event.name,
      event.desc + ' · ' + t('day.val', { n: event.currencyChange }),
      event.currencyChange > 0 ? 'success' : 'negative'
    );
    if (GAME_STATE.remainingDays <= 0) {
      endRound('days-exhausted');
      return;
    }
  }
}

export function resolveEventChoice(choiceId) {
  if (!GAME_STATE || GAME_STATE.phase !== 'playing') {
    return { ok: false, error: '本局已结束' };
  }
  const pending = GAME_STATE.pendingEvent;
  if (!pending) {
    return { ok: false, error: '没有待处理事件' };
  }
  const event = pending.event;
  const option = (event.options || []).find(function (item) {
    return item.id === choiceId;
  });
  if (!option) {
    return { ok: false, error: '选项不存在' };
  }

  const global = getGlobalStats();
  let shieldUsed = false;
  if (option.currencyChange < 0 && GAME_STATE.deathShieldActive) {
    GAME_STATE.deathShieldActive = false;
    shieldUsed = true;
  } else if (option.currencyChange < 0 && (global.shopItems.deathShield || 0) > 0) {
    global.shopItems.deathShield -= 1;
    saveGlobalStats(global);
    flushGlobalStats();
    shieldUsed = true;
  }
  if (shieldUsed) {
    GAME_STATE.randomEventLog.push({
      eventId: event.id,
      name: event.name,
      currencyChange: 0,
      chosenOption: option.id,
      shielded: true,
      elapsedSeconds: pending.elapsedSeconds,
      remainingDays: GAME_STATE.remainingDays
    });
    GAME_STATE.lastRandomEvent = {
      id: event.id,
      name: event.name,
      emoji: event.emoji,
      currencyChange: 0,
      chosenOption: option.id,
      shielded: true
    };
    GAME_STATE.pendingEvent = null;
    setToast(t('toast.shieldOk'), t('toast.shieldDesc', { event: event.name }), 'success');
    playSound('event');
    vibrateShort();
    return { ok: true, choiceId: option.id, currencyChange: 0, shielded: true };
  }

  const result = applyCurrencyChange(GAME_STATE, option.currencyChange);
  GAME_STATE.remainingDays = result.remainingDays;
  if (option.nextPurchaseDiscount) {
    GAME_STATE._nextPurchaseDiscount = option.nextPurchaseDiscount;
  }
  GAME_STATE.randomEventLog.push({
    eventId: event.id,
    name: event.name,
    currencyChange: option.currencyChange,
    chosenOption: option.id,
    elapsedSeconds: pending.elapsedSeconds,
    remainingDays: GAME_STATE.remainingDays
  });
  GAME_STATE.lastRandomEvent = {
    id: event.id,
    name: event.name,
    emoji: event.emoji,
    currencyChange: option.currencyChange,
    chosenOption: option.id,
    desc: option.desc
  };
  GAME_STATE.pendingEvent = null;
  const sign = option.currencyChange > 0 ? '+' : '';
  setToast(
    event.name,
    option.name + ' · ' + sign + option.currencyChange + '天',
    option.currencyChange > 0 ? 'success' : 'negative'
  );
  playSound(option.currencyChange > 0 ? 'purchase' : 'error');
  vibrateShort();

  if (GAME_STATE.remainingDays <= 0) {
    endRound('days-exhausted');
  } else {
    checkDecisionMilestones();
  }
  return {
    ok: true,
    choiceId: option.id,
    currencyChange: option.currencyChange,
    remainingDays: GAME_STATE.remainingDays
  };
}

function getMostSpentCategory() {
  let max = 0;
  let top = null;
  CATEGORY_META.forEach(function (category) {
    const spent = (GAME_STATE.categorySpent && GAME_STATE.categorySpent[category.id]) || 0;
    if (spent > max) {
      max = spent;
      top = category.id;
    }
  });
  return top || 'cognition';
}

function getLeastSpentCategory() {
  let min = Infinity;
  let low = null;
  CATEGORY_META.forEach(function (category) {
    const spent = (GAME_STATE.categorySpent && GAME_STATE.categorySpent[category.id]) || 0;
    if (spent < min) {
      min = spent;
      low = category.id;
    }
  });
  return low || 'cognition';
}

function unlockRandomLegendaryForCategory(categoryId) {
  const legends = PRODUCT_DB.filter(function (product) {
    return product.category === categoryId && product.gradeKey === 'legend';
  });
  const available = legends.filter(function (product) {
    return GAME_STATE.unlockedLegendary.indexOf(product.id) === -1 &&
      GAME_STATE.ownedProductIds.indexOf(product.id) === -1;
  });
  if (available.length === 0) {
    GAME_STATE.remainingDays += 100;
    setToast(t('toast.legendAll'), t('toast.comp100'), 'info');
    return;
  }
  const picked = available[Math.floor(Math.random() * available.length)];
  GAME_STATE.unlockedLegendary.push(picked.id);
  setToast(t('toast.legendNew'), t('toast.legendNewDesc', { item: picked.emoji + ' ' + picked.name }), 'success');
}

function applyChoiceEffect(choice) {
  const effect = choice && choice.effect;
  if (!effect) {
    return;
  }
  switch (effect.type) {
    case 'category_discount': {
      const targetCategory = effect.target === 'highest'
        ? getMostSpentCategory()
        : getLeastSpentCategory();
      GAME_STATE.categoryDiscounts[targetCategory] = Math.max(0.5, effect.discount);
      if (effect.penaltyMultiplier && effect.penaltyMultiplier > 1 && effect.penaltyTarget) {
        const penaltyCategory = effect.penaltyTarget === 'highest'
          ? getMostSpentCategory()
          : getLeastSpentCategory();
        if (penaltyCategory !== targetCategory) {
          GAME_STATE.categoryPricePenalties[penaltyCategory] = Math.max(1, effect.penaltyMultiplier);
        }
      }
      if (effect.blockOtherDiscounts) {
        GAME_STATE.discountBlockedCategories = CATEGORY_META
          .filter(function (category) {
            return category.id !== targetCategory;
          })
          .map(function (category) {
            return category.id;
          });
      }
      break;
    }
    case 'global_discount': {
      GAME_STATE.globalDiscount = Math.max(0.5, effect.discount);
      break;
    }
    case 'strengthen_legend': {
      const topCategory = getMostSpentCategory();
      GAME_STATE.categoryDiscounts[topCategory] = Math.max(0.5, effect.discount);
      if (effect.penaltyMultiplier && effect.penaltyMultiplier > 1) {
        CATEGORY_META.forEach(function (category) {
          if (category.id !== topCategory) {
            GAME_STATE.categoryPricePenalties[category.id] = Math.max(1, effect.penaltyMultiplier);
          }
        });
      }
      unlockRandomLegendaryForCategory(topCategory);
      break;
    }
    case 'days_bonus': {
      GAME_STATE.remainingDays += effect.amount;
      if (effect.spendPenalty && effect.spendPenalty > 0) {
        const topCategory = getMostSpentCategory();
        const currentSpent = GAME_STATE.categorySpent[topCategory] || 0;
        const penalty = Math.min(effect.spendPenalty, Math.max(0, currentSpent));
        if (penalty > 0) {
          GAME_STATE.categorySpent[topCategory] = Math.max(0, currentSpent - penalty);
          GAME_STATE.totalSpent = Math.max(0, (GAME_STATE.totalSpent || 0) - penalty);
          if (typeof GAME_STATE.categorySpentOriginal[topCategory] === 'number') {
            const originalPenalty = Math.min(penalty, GAME_STATE.categorySpentOriginal[topCategory]);
            GAME_STATE.categorySpentOriginal[topCategory] = Math.max(0, GAME_STATE.categorySpentOriginal[topCategory] - originalPenalty);
            GAME_STATE.totalSpentOriginal = Math.max(0, (GAME_STATE.totalSpentOriginal || 0) - originalPenalty);
          }
        }
      }
      break;
    }
    case 'unlock_all_legendary':
      PRODUCT_DB.forEach(function (product) {
        if (product.gradeKey === 'legend' && GAME_STATE.unlockedLegendary.indexOf(product.id) === -1) {
          GAME_STATE.unlockedLegendary.push(product.id);
        }
      });
      if (effect.lockDiscounts) {
        GAME_STATE.discountLocked = true;
        GAME_STATE.globalDiscount = 1;
        GAME_STATE.categoryDiscounts = {};
        GAME_STATE._nextPurchaseDiscount = null;
      }
      break;
    default:
      break;
  }
}

export function checkDecisionMilestones() {
  if (!GAME_STATE || GAME_STATE.phase !== 'playing') {
    return;
  }
  if (GAME_STATE.pendingDecisionMilestone || GAME_STATE.pendingEvent) {
    return;
  }
  const triggered = GAME_STATE.decisionMilestoneTriggered || [];
  for (let i = 0; i < DECISION_MILESTONES_V2.length; i += 1) {
    if (triggered.indexOf(i) >= 0) {
      continue;
    }
    const milestone = DECISION_MILESTONES_V2[i];
    if ((GAME_STATE.totalSpent || 0) >= milestone.threshold) {
      const pendingMilestone = Object.assign({}, milestone, {
        choices: milestone.choices.map(function (choice) {
          return Object.assign({}, choice);
        })
      });
      if (i === 2) {
        const topCategory = getMostSpentCategory();
        const categoryMeta = CATEGORY_META.find(function (category) {
          return category.id === topCategory;
        });
        const masterChoice = pendingMilestone.choices.find(function (choice) {
          return choice.id === 'master_category';
        });
        if (masterChoice) {
          masterChoice.text = (categoryMeta ? categoryMeta.emoji + ' ' + categoryMeta.name : '') + '大师';
        }
      }
      GAME_STATE.pendingDecisionMilestone = pendingMilestone;
      triggered.push(i);
      GAME_STATE.decisionMilestoneTriggered = triggered;
      playSound('event');
      vibrateShort();
      // v0.3 抉择前对话：本地台词立即可见（离线=默认体验）；
      // 若已接入 BYOK，AI 就绪后"原位替换"为更懂这局的版本，玩家无感。
      const dlgSpeaker = getDialogueSpeakerAt(i);
      GAME_STATE.milestoneDialogue = {
        speaker: dlgSpeaker,
        milestoneIndex: i,
        lines: localDialogueLines(dlgSpeaker, i),
        lineIndex: 0,
        phase: 'begin',
        ai: false
      };
      buildMilestoneDialogue(dlgSpeaker, i, buildAIPromptData(GAME_STATE)).then(function (r) {
        const cur = GAME_STATE && GAME_STATE.milestoneDialogue;
        if (cur && cur.milestoneIndex === i && r && r.ai && Array.isArray(r.lines) && r.lines.length) {
          cur.lines = r.lines.slice(0, 3);
          cur.ai = true;
        }
      });
      setToast(t('toast.milestoneChoice', { title: milestone.title }), milestone.desc, 'decision');
      return;
    }
  }
}

export function completeDecisionAsGiveUp(milestone) {
  if (!GAME_STATE || !milestone) {
    return;
  }
  const lostDays = Math.min(100, GAME_STATE.remainingDays || 0);
  GAME_STATE.remainingDays = Math.max(0, (GAME_STATE.remainingDays || 0) - lostDays);
  if (GAME_STATE.completedDecisionIds.indexOf(milestone.id) === -1) {
    GAME_STATE.completedDecisionIds.push(milestone.id);
  }
  GAME_STATE.decisionLog.push({
    milestoneId: milestone.id,
    choiceId: null,
    productId: null,
    price: lostDays,
    gaveUp: true,
    consumedDaysAt: getConsumedDays(GAME_STATE.remainingDays, GAME_STATE.startingDays)
  });
  GAME_STATE.pendingDecisionMilestone = null;
  GAME_STATE.milestoneDialogue = null;
  setToast(t('toast.giveUp'), t('toast.giveUpDesc'), 'negative');
  if (GAME_STATE.remainingDays <= 0) {
    endRound('days-exhausted');
  }
}

export function getAvailableAdventureCount() {
  if (!GAME_STATE || GAME_STATE.phase !== 'playing') {
    return 0;
  }
  const triggered = GAME_STATE.adventureTriggered || [];
  return ADVENTURE_EVENTS.filter(function (event) {
    return triggered.indexOf(event.id) === -1 && (GAME_STATE.totalSpent || 0) >= event.threshold;
  }).length;
}

export function getNextAdventure() {
  if (!GAME_STATE) {
    return null;
  }
  const triggered = GAME_STATE.adventureTriggered || [];
  return ADVENTURE_EVENTS.find(function (event) {
    return triggered.indexOf(event.id) === -1 && (GAME_STATE.totalSpent || 0) >= event.threshold;
  }) || null;
}

function consumeDoubleAdventure() {
  if (!GAME_STATE) {
    return false;
  }
  if (GAME_STATE.doubleAdventureActive) {
    GAME_STATE.doubleAdventureActive = false;
    return true;
  }
  const global = getGlobalStats();
  if ((global.shopItems && global.shopItems.doubleAdventure || 0) > 0) {
    global.shopItems.doubleAdventure -= 1;
    saveGlobalStats(global);
    flushGlobalStats();
    return true;
  }
  return false;
}

function applyAdventureEffects(choice) {
  if (!choice || !choice.effects) {
    return;
  }
  const doubleActive = !!(GAME_STATE.pendingAdventure && GAME_STATE.pendingAdventure._doubleActive);
  const multiplier = doubleActive ? 2 : 1;
  (choice.effects || []).forEach(function (effect) {
    switch (effect.type) {
      case 'days':
        GAME_STATE.remainingDays = Math.max(0, (GAME_STATE.remainingDays || 0) + effect.value * multiplier);
        break;
      case 'random_item': {
        const candidates = PRODUCT_DB.filter(function (product) {
          return product.gradeKey === effect.grade && GAME_STATE.ownedProductIds.indexOf(product.id) === -1;
        });
        const count = (effect.count || 1) * multiplier;
        if ((effect.chance && Math.random() > effect.chance) || candidates.length === 0) {
          const compensation = ADVENTURE_MISS_COMPENSATION_DAYS * multiplier;
          GAME_STATE.remainingDays += compensation;
          setToast(t('toast.compTitle', { n: compensation }), t('toast.compDesc'), 'info');
          break;
        }
        let gained = 0;
        for (let i = 0; i < count; i += 1) {
          if (candidates.length === 0) {
            break;
          }
          const pickedIndex = Math.floor(Math.random() * candidates.length);
          const picked = candidates.splice(pickedIndex, 1)[0];
          GAME_STATE.ownedProductIds.push(picked.id);
          recordLifetimeCollection(picked.id);
          GAME_STATE.virtualTotalSpent = (GAME_STATE.virtualTotalSpent || 0) + picked.baseCost;
          GAME_STATE.categoryVirtualSpent[picked.category] = (GAME_STATE.categoryVirtualSpent[picked.category] || 0) + picked.baseCost;
          gained += 1;
        }
        if (gained < count) {
          const compensation = ADVENTURE_MISS_COMPENSATION_DAYS * multiplier;
          GAME_STATE.remainingDays += compensation;
          setToast(t('toast.compTitle', { n: compensation }), t('toast.compDesc2'), 'info');
        }
        break;
      }
      case 'prop': {
        const global = getGlobalStats();
        global.shopItems[effect.itemId] = (global.shopItems[effect.itemId] || 0) + (effect.count || 1);
        saveGlobalStats(global);
        flushGlobalStats();
        break;
      }
      case 'flow':
        GAME_STATE.tempFlowModifier = {
          value: effect.value * multiplier,
          endTime: Date.now() + effect.duration * 1000
        };
        break;
      case 'category_spend':
        GAME_STATE.categoryVirtualSpent[effect.category] = (GAME_STATE.categoryVirtualSpent[effect.category] || 0) + effect.amount * multiplier;
        break;
      case 'boost_positive_events':
        GAME_STATE.positiveEventBoost = Date.now() + effect.duration * 1000 * multiplier;
        break;
      default:
        break;
    }
  });
  GAME_STATE.pendingAdventure = null;
  GAME_STATE._adventurePaused = false;
  clearAdventureHotspots();
  if ((GAME_STATE.remainingDays || 0) <= 0) {
    endRound('days-exhausted');
  }
}

/** 清理奇遇弹窗遗留的点击热区，避免弹窗关闭后热区仍然命中。 */
function clearAdventureHotspots() {
  Object.keys(UI_STATE).forEach(function (key) {
    if (key.indexOf('_adventureChoice_') === 0) {
      delete UI_STATE[key];
    }
  });
  UI_STATE._adventureCloseBtn = null;
  UI_STATE.pressedAdventureChoice = null;
}

// N4/N5 场景改写（共享）：AI 只重写"标题+描述"文案，原位替换；
// 触发时机、数值、选项及效果全部归代码，改写失败静默保留原文案。
// 每类每局 ≤2 次（eventRewriteCount / adventureRewriteCount）。
function requestSceneRewriteInPlace(kind, target, state) {
  const counterKey = kind === 'adventure' ? 'adventureRewriteCount' : 'eventRewriteCount';
  if (!target || (state[counterKey] || 0) >= 2) {
    return;
  }
  state[counterKey] = (state[counterKey] || 0) + 1;
  const promptData = buildAIPromptData(state);
  requestSceneRewrite({
    kind: kind === 'adventure' ? '奇遇' : '际遇',
    title: target.title || target.name || '',
    desc: target.desc || '',
    brief: lifeBriefFromPrompt(promptData)
  }).then(function (r) {
    // 原位替换前提：该场景还挂着、还没被玩家处理（防"已解决后异步回写"）
    if (!r.ok || !state || (kind === 'adventure' ? state.pendingAdventure !== target : (!state.pendingEvent || state.pendingEvent.event !== target))) {
      return;
    }
    target.name = r.title;
    target.title = r.title;
    target.desc = r.desc;
    target.aiRewritten = true;
  });
}

function lifeBriefFromPrompt(promptData) {
  const cats = promptData.categorySpent || {};
  const top = Object.keys(cats)
    .map(function (id) { return id + ':' + Math.floor(cats[id]); })
    .sort(function (a, b) { return Number(b.split(':')[1]) - Number(a.split(':')[1]); })
    .slice(0, 3)
    .join(', ');
  const items = (promptData.topProducts || []).slice(-4).join('、');
  const creeds = (promptData.creeds || []).join('；');
  return '已花' + (promptData.totalSpent || 0) + '天; 方向[' + (top || '无') + ']; 买过[' + (items || '无') + ']' +
    (creeds ? '; 信条[' + creeds + ']' : '');
}

export function openAdventure() {
  if (!GAME_STATE || GAME_STATE.phase !== 'playing') {
    return { ok: false, error: '游戏未开始' };
  }
  if (GAME_STATE.pendingAdventure || GAME_STATE.pendingEvent || GAME_STATE.pendingDecisionMilestone) {
    setToast(t('toast.busyEvent'), t('toast.busyEventDesc'), 'info');
    return { ok: false, error: t('toast.busyEvent') };
  }
  const event = getNextAdventure();
  if (!event) {
    setToast(t('toast.noFate'), t('toast.noFateDesc'), 'info');
    return { ok: false, error: '暂无奇遇' };
  }
  const eventCopy = JSON.parse(JSON.stringify(event));
  // 记录双倍卡的消耗来源，放弃奇遇时才能精确退还。
  const doubleFromStock = !GAME_STATE.doubleAdventureActive
    && (getGlobalStats().shopItems.doubleAdventure || 0) > 0;
  const doubleActive = consumeDoubleAdventure();
  eventCopy._doubleActive = doubleActive;
  eventCopy._doubleConsumedFromStock = doubleActive && doubleFromStock;
  GAME_STATE.pendingAdventure = eventCopy;
  GAME_STATE._adventurePaused = true;
  // N5：奇遇场景文案 AI 改写（深拷贝上改，原池与奖励结算不受影响）
  requestSceneRewriteInPlace('adventure', eventCopy, GAME_STATE);
  const triggered = GAME_STATE.adventureTriggered || [];
  triggered.push(event.id);
  GAME_STATE.adventureTriggered = triggered;
  recordMissionProgress('adventure', 1);
  playSound('event');
  vibrateShort();
  setToast(t('toast.fateAppear'), event.title + (eventCopy._doubleActive ? t('toast.doubleOn') : ''), 'info');
  return { ok: true, event: eventCopy };
}

/**
 * 放弃（关闭）当前奇遇弹窗。
 *
 * 此前 drawAdventureModalV2 没有任何关闭入口，而 openAdventure 会把
 * _adventurePaused 置为 true、updateRound 随即直接 return —— 玩家只要不选
 * 选项，时间就永远停住，主观上表现为"卡死"。这里补上退出路径。
 *
 * 放弃的代价：奇遇从队列中移除（不补发），不获得任何奖励；
 * 若本次消耗了双倍奇遇卡则原样退还，避免误触造成道具损失。
 */
export function closeAdventure() {
  if (!GAME_STATE || !GAME_STATE.pendingAdventure) {
    return { ok: false, error: '没有待处理奇遇' };
  }

  const pending = GAME_STATE.pendingAdventure;
  // 退还误消耗的双倍奇遇卡：优先还原激活态，否则退回库存。
  if (pending._doubleActive) {
    if (pending._doubleConsumedFromStock) {
      const global = getGlobalStats();
      global.shopItems.doubleAdventure = (global.shopItems.doubleAdventure || 0) + 1;
      saveGlobalStats(global);
    } else {
      GAME_STATE.doubleAdventureActive = true;
    }
  }

  const title = pending.title || t('toast.fateWord');
  GAME_STATE.pendingAdventure = null;
  GAME_STATE._adventurePaused = false;
  clearAdventureHotspots();

  playSound('click');
  setToast(t('toast.fateGone'), t('toast.fateGoneDesc', { title: title }), 'info');
  return { ok: true, title: title };
}

export function resolveAdventureChoiceV2(choiceId) {
  if (!GAME_STATE || !GAME_STATE.pendingAdventure) {
    return { ok: false, error: '没有待处理奇遇' };
  }
  const choice = GAME_STATE.pendingAdventure.choices.find(function (item) {
    return item.id === choiceId;
  });
  if (!choice) {
    return { ok: false, error: '选项不存在' };
  }
  applyAdventureEffects(choice);
  return { ok: true, choiceId: choice.id };
}

// N3 人生信条：本地兜底 = 按 choice.id 的确定性模板（无 BYOK 也有信条，离线=默认体验）；
// 有 BYOK 且额度允许时，AI 生成后"原位替换"该条 decisionLog 的 creed 字段（回放与墓志铭自动受益）。
const LOCAL_CREEDS = {
  focus_strength: '我要把最擅长的事做到极致',
  cover_weakness: '我不再逃避自己的短板',
  strengthen_strength: '我要顺着风口扶摇直上',
  balance_all: '我选择完整，而不是锋利',
  master_category: '我的一生只精通一件事',
  time_gift: '钱花完了，但时间拿回来了',
  legend_permission: '我全都要，哪怕一事无成',
  accept_investment: '我押上自由，赌一个更大的人生',
  stay_independent: '按自己的节奏，慢慢来'
};

function recordDecisionCreed(entry, choice) {
  const choiceText = choice.text || choice.name || '';
  const choiceDesc = choice.desc || '';
  entry.creed = LOCAL_CREEDS[choice.id] || ('我选择了' + choiceText);
  entry.creedAI = false;
  requestLLMCreed({
    choiceText: choiceText,
    choiceDesc: choiceDesc,
    consumedDays: entry.consumedDaysAt || 0,
    topCategory: getMostSpentCategory()
  }).then(function (r) {
    if (r.ok && r.creed) {
      entry.creed = r.creed;
      entry.creedAI = true;
    }
  });
}

export function resolveDecision(choiceId) {
  if (!GAME_STATE || GAME_STATE.phase !== 'playing') {
    return { ok: false, error: '本局已结束' };
  }
  const milestone = GAME_STATE.pendingDecisionMilestone;
  if (!milestone) {
    return { ok: false, error: '没有待决事件' };
  }
  const choice = milestone.choices.find(function (item) {
    return item.id === choiceId;
  });
  if (!choice) {
    completeDecisionAsGiveUp(milestone);
    return { ok: false, error: '选项不存在', gaveUp: true };
  }

  if (choice.effect) {
    applyChoiceEffect(choice);
    if (GAME_STATE.completedDecisionIds.indexOf(milestone.id) === -1) {
      GAME_STATE.completedDecisionIds.push(milestone.id);
    }
    const effectEntry = {
      milestoneId: milestone.id,
      choiceId: choice.id,
      productId: null,
      price: 0,
      consumedDaysAt: getConsumedDays(GAME_STATE.remainingDays, GAME_STATE.startingDays)
    };
    GAME_STATE.decisionLog.push(effectEntry);
    recordDecisionCreed(effectEntry, choice);
    GAME_STATE.pendingDecisionMilestone = null;
    GAME_STATE.milestoneDialogue = null;
    setToast(t('toast.decided'), choice.text + ' · ' + choice.desc, 'success');
    vibrateShort();
    recordMissionProgress('decision', 1);
    checkDecisionMilestones();
    return { ok: true, choiceId: choice.id };
  }

  const product = getProductById(choice.productId);
  if (!product) {
    completeDecisionAsGiveUp(milestone);
    return { ok: false, error: '商品不存在', gaveUp: true };
  }
  if (GAME_STATE.ownedProductIds.indexOf(product.id) >= 0) {
    completeDecisionAsGiveUp(milestone);
    return { ok: false, error: '该人生路线已选择', gaveUp: true };
  }

  const count = GAME_STATE.categoryPurchaseCount[product.category] || 0;
  const price = getCurrentPrice(product.id, 0, true);
  if (price > GAME_STATE.remainingDays) {
    completeDecisionAsGiveUp(milestone);
    return { ok: false, error: '剩余天数不足', gaveUp: true };
  }

  GAME_STATE.remainingDays = Math.max(0, GAME_STATE.remainingDays - price);
  GAME_STATE.totalSpent += price;
  GAME_STATE.totalSpentOriginal += product.baseCost;
  GAME_STATE.categorySpent[product.category] = (GAME_STATE.categorySpent[product.category] || 0) + price;
  GAME_STATE.categorySpentOriginal[product.category] = (GAME_STATE.categorySpentOriginal[product.category] || 0) + product.baseCost;
  GAME_STATE.categoryPurchaseCount[product.category] = count + 1;
  GAME_STATE.ownedProductIds.push(product.id);
  recordLifetimeCollection(product.id);
  GAME_STATE._nextPurchaseDiscount = null;
  GAME_STATE.purchaseLedger.push({
    productId: product.id,
    category: product.category,
    price: price,
    source: 'decision',
    elapsedSeconds: GAME_STATE.elapsedSeconds,
    consumedDays: getConsumedDays(GAME_STATE.remainingDays, GAME_STATE.startingDays)
  });
  GAME_STATE.completedDecisionIds.push(milestone.id);
  const routeEntry = {
    milestoneId: milestone.id,
    choiceId: choice.id,
    productId: product.id,
    price: price,
    consumedDaysAt: getConsumedDays(GAME_STATE.remainingDays, GAME_STATE.startingDays)
  };
  GAME_STATE.decisionLog.push(routeEntry);
  recordDecisionCreed(routeEntry, choice);
  GAME_STATE.pendingDecisionMilestone = null;
  GAME_STATE.milestoneDialogue = null;
  setToast(t('toast.decided'), choice.name + ' · ' + t('day.val', { n: -Math.floor(price) }), 'success');
  vibrateShort();
  triggerCardBounce(product.id);
  spawnPurchaseParticles(product.id);
  checkCategoryMasteryUnlock(product.category, count + 1);
  recordMissionProgress('decision', 1);

  if (GAME_STATE.remainingDays <= 0) {
    endRound('days-exhausted');
  } else {
    checkDecisionMilestones();
  }
  return { ok: true, choiceId: choice.id, productId: product.id, price: price };
}

// ==================== 4. 结算引擎 ====================
