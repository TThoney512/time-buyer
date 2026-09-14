// Module: state.js
// Split from the original game.js during module refactor.
import { trackEvent } from './analytics.js';
import { ENABLE_REMOTE_LEADERBOARD, GAME_CONFIG, SHOP_ITEMS } from './config.js';
import { ACHIEVEMENT_DEFS, COLLECTION_MILESTONES, getAchievementById, getRandomBuff } from './db.js';
import { formatTodayDate, getTT } from './utils.js';
import { t } from './i18n.js';
import { playSound } from './audio.js';
import { generatePouchItems } from './logic.js';

export let _fallbackGlobalStats = null;

const SAVE_DEBOUNCE_MS = 2000;
const STATS_STORAGE_KEY = 'timeBuyer_globalStats';
let _saveTimer = null;
let _pendingSaveStats = null;

// 内存单例：全局统计只在进程启动时读取一次，之后全部走内存。
// 这是性能关键路径 —— 此前 getGlobalStats() 每次调用都会触发一次
// getStorageSync + JSON.parse，而渲染层每帧会调用多次。
let _cachedStats = null;
// 跨日重置检查的时间戳（低频，不做每帧检查）。
let _lastDailyCheckAt = 0;
const DAILY_CHECK_INTERVAL_MS = 30000;

export function createDefaultShopItems() {
  return {
    buffTicket: 0,
    deathShield: 0,
    skin: null,
    timeSand: 0,
    doubleAdventure: 0,
    timeFreeze: 0
  };
}

export function createInviteCode() {
  return 'TB' + Math.random().toString(36).slice(2, 7).toUpperCase();
}

export function createDefaultGlobalStats() {
  return {
    totalPlayCount: 0,
    totalDaysSpent: 0,
    maxProductsInRound: 0,
    totalProductsBought: 0,
    unlockedAchievements: [],
    bestCategory: null,
    firstPlayDate: null,
    todayDate: null,
    todayRebirthCount: 0,
    reincarnationPoints: 0,
    lifetimeRP: 0,
    shopItems: createDefaultShopItems(),
    myBestScore: 0,
    leaderboard: [],
    leaderboardCacheTime: null,
    friendsLeaderboard: [],
    inviteCode: createInviteCode(),
    inviteCodeUsed: false,
    invitedByCode: null,
    giftLog: [],
    lifetimeOwned: {},
    lifetimeClaimed: [],
    lifetimeLegacyGifted: false,
    lastFreeReviveDate: null,
    pastLives: [],
    dailyMissions: {
      date: null,
      progress: {},
      completed: []
    }
  };
}

// 人生清单（lifetimeOwned）：{ productId: { count, firstLife } }
// 旧存档/损坏数据一律收敛成合法结构；只保留数值合法的记录。
function normalizeLifetimeOwned(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') {
    return out;
  }
  Object.keys(raw).forEach(function (id) {
    const rec = raw[id];
    if (rec && typeof rec === 'object') {
      const count = Math.max(1, Math.floor(Number(rec.count) || 1));
      const firstLife = Math.max(1, Math.floor(Number(rec.firstLife) || 1));
      out[id] = { count: count, firstLife: firstLife };
    } else {
      out[id] = { count: Math.max(1, Math.floor(Number(rec) || 1)), firstLife: 1 };
    }
  });
  return out;
}

export function normalizeGlobalStats(raw) {
  const defaults = createDefaultGlobalStats();
  if (!raw || typeof raw !== 'object') {
    return defaults;
  }
  const rawShopItems = raw.shopItems && typeof raw.shopItems === 'object' ? raw.shopItems : {};
  return {
    totalPlayCount: Number(raw.totalPlayCount) || 0,
    totalDaysSpent: Number(raw.totalDaysSpent) || 0,
    maxProductsInRound: Number(raw.maxProductsInRound) || 0,
    totalProductsBought: Number(raw.totalProductsBought) || 0,
    unlockedAchievements: Array.isArray(raw.unlockedAchievements)
      ? raw.unlockedAchievements.slice()
      : [],
    bestCategory: typeof raw.bestCategory === 'string' ? raw.bestCategory : null,
    firstPlayDate: typeof raw.firstPlayDate === 'string' ? raw.firstPlayDate : null,
    todayDate: typeof raw.todayDate === 'string' ? raw.todayDate : null,
    lastFreeReviveDate: typeof raw.lastFreeReviveDate === 'string' ? raw.lastFreeReviveDate : null,
    todayRebirthCount: Math.max(0, Math.floor(Number(raw.todayRebirthCount) || 0)),
    reincarnationPoints: Math.max(0, Math.floor(Number(raw.reincarnationPoints) || 0)),
    lifetimeRP: Math.max(0, Math.floor(Number(raw.lifetimeRP) || 0)),
    myBestScore: Math.max(0, Math.floor(Number(raw.myBestScore) || 0)),
    leaderboard: Array.isArray(raw.leaderboard) ? raw.leaderboard.slice() : [],
    leaderboardCacheTime: typeof raw.leaderboardCacheTime === 'string' ? raw.leaderboardCacheTime : null,
    friendsLeaderboard: Array.isArray(raw.friendsLeaderboard) ? raw.friendsLeaderboard.slice() : [],
    inviteCode: typeof raw.inviteCode === 'string' && raw.inviteCode
      ? raw.inviteCode
      : ((_fallbackGlobalStats && _fallbackGlobalStats.inviteCode) || createInviteCode()),
    inviteCodeUsed: !!raw.inviteCodeUsed,
    invitedByCode: typeof raw.invitedByCode === 'string' ? raw.invitedByCode : null,
    giftLog: Array.isArray(raw.giftLog) ? raw.giftLog.slice() : [],
    lifetimeOwned: normalizeLifetimeOwned(raw.lifetimeOwned),
    lifetimeClaimed: Array.isArray(raw.lifetimeClaimed)
      ? raw.lifetimeClaimed.filter(function (id) { return typeof id === 'string'; })
      : [],
    lifetimeLegacyGifted: !!raw.lifetimeLegacyGifted,
    // N8 前世回响：每局结束存 {n, epitaph, ai}，只留最近 6 条；字符串截断防脏数据/超长
    pastLives: Array.isArray(raw.pastLives)
      ? raw.pastLives.slice(-6).filter(function (rec) {
          return rec && typeof rec === 'object' && typeof rec.epitaph === 'string' && rec.epitaph.trim();
        }).map(function (rec) {
          return {
            n: Math.max(1, Math.floor(Number(rec.n) || 1)),
            epitaph: String(rec.epitaph).trim().slice(0, 60),
            ai: !!rec.ai
          };
        })
      : [],
    dailyMissions: raw.dailyMissions && typeof raw.dailyMissions === 'object'
      ? {
          date: typeof raw.dailyMissions.date === 'string' ? raw.dailyMissions.date : null,
          progress: raw.dailyMissions.progress && typeof raw.dailyMissions.progress === 'object'
            ? Object.assign({}, raw.dailyMissions.progress)
            : {},
          completed: Array.isArray(raw.dailyMissions.completed) ? raw.dailyMissions.completed.slice() : []
        }
      : {
          date: null,
          progress: {},
          completed: []
        },
    shopItems: {
      buffTicket: Math.max(0, Math.floor(Number(rawShopItems.buffTicket) || 0)),
      deathShield: Math.max(0, Math.floor(Number(rawShopItems.deathShield) || 0)),
      skin: rawShopItems.skin === 'gold' ? 'gold' : null,
      timeSand: Math.max(0, Math.floor(Number(rawShopItems.timeSand) || 0)),
      doubleAdventure: Math.max(0, Math.floor(Number(rawShopItems.doubleAdventure) || 0)),
      timeFreeze: Math.max(0, Math.floor(Number(rawShopItems.timeFreeze) || 0))
    }
  };
}

function readStatsFromDisk() {
  const ttApi = getTT();
  if (!ttApi || !ttApi.getStorageSync) {
    return null;
  }
  let raw = null;
  try {
    raw = ttApi.getStorageSync(STATS_STORAGE_KEY);
  } catch (error) {
    return null;
  }
  if (!raw) {
    return null;
  }
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      parsed = null;
    }
  }
  return parsed && typeof parsed === 'object' ? parsed : null;
}

export function getGlobalStats() {
  // 命中内存缓存时零 IO 返回。
  if (_cachedStats) {
    return _cachedStats;
  }

  const parsed = readStatsFromDisk();
  if (parsed) {
    _cachedStats = normalizeGlobalStats(parsed);
  } else if (_fallbackGlobalStats) {
    _cachedStats = normalizeGlobalStats(_fallbackGlobalStats);
  } else {
    _cachedStats = createDefaultGlobalStats();
  }
  _fallbackGlobalStats = _cachedStats;
  return _cachedStats;
}

/**
 * 强制从磁盘重新载入（会丢弃内存中的未落盘改动）。
 * 仅用于跨日重置、账号切换等极低频场景，禁止在渲染循环中调用。
 */
export function reloadGlobalStatsFromDisk() {
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  _pendingSaveStats = null;
  const parsed = readStatsFromDisk();
  _cachedStats = normalizeGlobalStats(parsed || _fallbackGlobalStats || undefined);
  _fallbackGlobalStats = _cachedStats;
  return _cachedStats;
}

function writeGlobalStats(stats) {
  const safeStats = normalizeGlobalStats(stats);
  _fallbackGlobalStats = safeStats;
  const ttApi = getTT();
  if (ttApi && ttApi.setStorageSync) {
    try {
      ttApi.setStorageSync(STATS_STORAGE_KEY, JSON.stringify(safeStats));
    } catch (error) {
      // 存档失败时不阻塞游戏流程。
    }
  }
  return safeStats;
}

/**
 * 把 stats 的内容合并回内存单例，保持对象引用不变。
 * 这样所有已持有旧引用的调用点都能立即看到更新，且避免重复分配。
 */
function mergeIntoCachedStats(stats) {
  const safeStats = normalizeGlobalStats(stats);
  if (!_cachedStats) {
    _cachedStats = safeStats;
  } else {
    Object.keys(safeStats).forEach(function (key) {
      _cachedStats[key] = safeStats[key];
    });
  }
  _fallbackGlobalStats = _cachedStats;
  return _cachedStats;
}

export function saveGlobalStats(stats) {
  const cached = mergeIntoCachedStats(stats);
  _pendingSaveStats = cached;
  if (_saveTimer) {
    clearTimeout(_saveTimer);
  }
  _saveTimer = setTimeout(function () {
    _saveTimer = null;
    if (_pendingSaveStats) {
      writeGlobalStats(_pendingSaveStats);
      _pendingSaveStats = null;
    }
  }, SAVE_DEBOUNCE_MS);
  return cached;
}

export function flushGlobalStats() {
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  const pending = _pendingSaveStats || _cachedStats || _fallbackGlobalStats;
  _pendingSaveStats = null;
  if (pending) {
    const saved = writeGlobalStats(pending);
    _cachedStats = saved;
    _fallbackGlobalStats = saved;
    return saved;
  }
  return pending;
}

/**
 * 低频跨日重置检查。渲染循环每帧调用，但内部按 30 秒节流。
 * 跨天时重置今日重生次数与每日任务。
 */
export function maybeRefreshDailyStats(force) {
  const now = Date.now();
  if (!force && now - _lastDailyCheckAt < DAILY_CHECK_INTERVAL_MS) {
    return false;
  }
  _lastDailyCheckAt = now;
  const stats = getGlobalStats();
  const today = formatTodayDate();
  if (stats.todayDate === today) {
    return false;
  }
  stats.todayDate = today;
  stats.todayRebirthCount = 0;
  stats.dailyMissions = {
    date: today,
    progress: {},
    completed: []
  };
  saveGlobalStats(stats);
  return true;
}

/**
 * 好友排行榜专用上报 key。
 * 注意：不能把整个 globalStats 塞进去 —— 抖音托管 KVData 单条 value 有长度限制，
 * 超限会静默失败，这就是此前好友榜永远为空的原因之一。
 */
export const FRIEND_SCORE_KEY = 'tb_score';
// 旧版误用存档 key 做上报，保留在 keyList 中以便平滑读取历史数据。
const FRIEND_SCORE_KEYS = [FRIEND_SCORE_KEY, 'timeBuyer_globalStats'];

/** 上报当前最佳成绩到抖音托管数据，好友榜才有真实数据可展示。 */
export function reportScoreToFriendLeaderboard(score) {
  const ttApi = getTT();
  const safeScore = Math.max(0, Math.floor(Number(score) || 0));
  if (!ttApi || typeof ttApi.setUserCloudStorage !== 'function') {
    return false;
  }
  try {
    ttApi.setUserCloudStorage({
      KVDataList: [
        {
          key: FRIEND_SCORE_KEY,
          value: JSON.stringify({
            myBestScore: safeScore,
            ts: Date.now()
          })
        }
      ],
      success: function () {
        trackEvent('friend_score_report', { score: safeScore, ok: true });
      },
      fail: function (err) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('好友榜成绩上报失败', err);
        }
        trackEvent('friend_score_report', { score: safeScore, ok: false });
      }
    });
    return true;
  } catch (error) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('好友榜成绩上报异常', error);
    }
    return false;
  }
}

export function getLeaderboardData(tab) {
  const global = getGlobalStats();
  if (tab === 'friends') {
    const friends = (global.friendsLeaderboard || []).slice();
    return friends.sort(function (a, b) {
      return (b.bestScore || 0) - (a.bestScore || 0);
    });
  }
  const local = (global.leaderboard || []).slice();
  const combined = local.slice();
  if ((global.myBestScore || 0) > 0 && combined.every(function (entry) {
    return entry.openId !== 'local-player';
  })) {
    combined.push({
      openId: 'local-player',
      nickname: '我',
      avatar: '',
      bestScore: global.myBestScore,
      updatedAt: new Date().toISOString()
    });
  }
  // 此前这里会把硬编码的"张三/李四/王五"假数据混入真实总榜，属审核风险，已移除。
  return combined.sort(function (a, b) {
    return (b.bestScore || 0) - (a.bestScore || 0);
  }).slice(0, 100);
}

export function updateLeaderboard(data) {
  const global = getGlobalStats();
  const openId = (data && data.openId) || 'local-player';
  const score = Math.max(0, Math.floor(Number(data && data.score) || 0));
  const now = new Date().toISOString();
  const existingIndex = global.leaderboard.findIndex(function (entry) {
    return entry.openId === openId;
  });
  const entry = {
    openId: openId,
    nickname: (data && data.nickname) || '我',
    avatar: (data && data.avatar) || '',
    bestScore: score,
    bestScoreDetail: {
      productIds: (data && data.productIds) || [],
      totalValue: score
    },
    updatedAt: now
  };
  if (existingIndex >= 0) {
    if (score > (global.leaderboard[existingIndex].bestScore || 0)) {
      global.leaderboard[existingIndex] = entry;
    }
  } else {
    global.leaderboard.push(entry);
  }
  global.leaderboard.sort(function (a, b) {
    return (b.bestScore || 0) - (a.bestScore || 0);
  });
  global.leaderboard = global.leaderboard.slice(0, 100);
  global.leaderboardCacheTime = now;
  if (score > (global.myBestScore || 0)) {
    global.myBestScore = score;
  }
  saveGlobalStats(global);
  // 同步到抖音托管数据，好友排行榜依赖此上报。
  reportScoreToFriendLeaderboard(global.myBestScore);

  const ttApi = getTT();
  if (ENABLE_REMOTE_LEADERBOARD && ttApi && ttApi.request) {
    try {
      ttApi.request({
        url: 'https://your-api.com/leaderboard/update',
        method: 'POST',
        data: entry,
        fail: function () {}
      });
    } catch (error) {
      // 网络失败时本地缓存已保存。
    }
  }
  return entry;
}

export function fetchLeaderboard() {
  const global = getGlobalStats();
  const ttApi = getTT();
  if (ENABLE_REMOTE_LEADERBOARD && ttApi && ttApi.request) {
    try {
      ttApi.request({
        url: 'https://your-api.com/leaderboard/top?limit=100',
        success: function (res) {
          if (res && Array.isArray(res.data)) {
            global.leaderboard = res.data.slice(0, 100);
            global.leaderboardCacheTime = new Date().toISOString();
            saveGlobalStats(global);
          }
        },
        fail: function () {}
      });
    } catch (error) {
      // 降级到本地缓存。
    }
  }
  if (!global.leaderboardCacheTime) {
    global.leaderboardCacheTime = new Date().toISOString();
    saveGlobalStats(global);
  }
  return getLeaderboardData('global');
}

export function fetchFriendLeaderboard() {
  const global = getGlobalStats();
  const ttApi = getTT();
  if (!ttApi || !ttApi.getFriendCloudStorage) {
    return getLeaderboardData('friends');
  }
  // 先上报一次自己的成绩，保证好友能看到当前进度（即便本次拉取失败）。
  reportScoreToFriendLeaderboard(global.myBestScore);
  try {
    ttApi.getFriendCloudStorage({
      keyList: FRIEND_SCORE_KEYS,
      success: function (res) {
        const rawList = res && res.data ? res.data : [];
        const friends = rawList.map(function (item) {
          let bestScore = 0;
          const kvList = (item && item.KVDataList) || [];
          // 优先读新版 key，兼容旧版误用存档 key 写入的数据。
          let kv = kvList.find(function (candidate) {
            return candidate && candidate.key === FRIEND_SCORE_KEY && candidate.value;
          });
          if (!kv) {
            kv = kvList.find(function (candidate) {
              return candidate && candidate.value;
            });
          }
          if (kv && kv.value) {
            try {
              const parsed = JSON.parse(kv.value);
              bestScore = Math.max(0, Math.floor(Number(parsed && parsed.myBestScore) || 0));
            } catch (error) {
              bestScore = 0;
            }
          }
          return {
            openId: item.openId || ('friend-' + Math.random().toString(36).slice(2, 8)),
            nickname: (item.nickname || '好友').slice(0, 12),
            avatar: item.avatar || '',
            bestScore: bestScore,
            updatedAt: new Date().toISOString()
          };
        }).filter(function (friend) {
          // 过滤掉从未上报过成绩的好友，避免出现一屏 0 分占位。
          return (friend.bestScore || 0) > 0;
        }).sort(function (a, b) {
          return (b.bestScore || 0) - (a.bestScore || 0);
        });
        global.friendsLeaderboard = friends;
        saveGlobalStats(global);
      },
      fail: function () {}
    });
  } catch (error) {
    // 好友数据拉取失败时保留本地缓存。
  }
  return getLeaderboardData('friends');
}

export function giftItemToFriend(openId, nickname, itemId) {
  const item = SHOP_ITEMS.find(function (shopItem) {
    return shopItem.id === itemId;
  });
  if (!item) {
    return { ok: false, error: '道具不存在' };
  }
  const global = getGlobalStats();
  if ((global.reincarnationPoints || 0) < item.price) {
    return { ok: false, error: '轮回积分不足' };
  }
  global.reincarnationPoints -= item.price;
  if (!Array.isArray(global.giftLog)) {
    global.giftLog = [];
  }
  global.giftLog.push({
    itemId: item.id,
    itemName: item.name,
    toOpenId: openId || '',
    toNickname: nickname || '好友',
    at: new Date().toISOString()
  });
  saveGlobalStats(global);
  flushGlobalStats();
  const ttApi = getTT();
  if (ttApi && ttApi.shareAppMessage) {
    try {
      ttApi.shareAppMessage({
        title: '送你一个「' + item.name + '」',
        desc: '我在《时间买手》里送你一个道具，快来领取！',
        success: function () {
          trackEvent('share_success', { type: 'gift' });
        }
      });
    } catch (error) {
      // 分享失败不阻塞赠送流程。
    }
  } else if (typeof console !== 'undefined') {
    console.log('gift:', item.name, '->', nickname || openId);
  }
  return { ok: true, itemId: item.id, itemName: item.name, price: item.price };
}

export function shareInviteCode() {
  const global = getGlobalStats();
  const code = global.inviteCode || '';
  const ttApi = getTT();
  if (ttApi && ttApi.shareAppMessage) {
    try {
      ttApi.shareAppMessage({
        title: '我的轮回邀请码：' + code,
        desc: '输入邀请码，首局完成后双方各得 +500 天！',
        success: function () {
          trackEvent('share_success', { type: 'invite' });
        }
      });
    } catch (error) {
      // 分享失败不阻塞。
    }
  }
  return code;
}

export function redeemInviteCode(code) {
  const global = getGlobalStats();
  const safeCode = String(code || '').trim().toUpperCase();
  if (!safeCode) {
    return { ok: false, error: '邀请码不能为空' };
  }
  if (global.inviteCodeUsed) {
    return { ok: false, error: '邀请码已使用' };
  }
  global.inviteCodeUsed = true;
  global.invitedByCode = safeCode;
  if (GAME_STATE && GAME_STATE.phase === 'playing') {
    GAME_STATE.remainingDays += 500;
    GAME_STATE.startingDays = (GAME_STATE.startingDays || GAME_CONFIG.initialDays) + 500;
  }
  saveGlobalStats(global);
  return { ok: true, rewardDays: 500, inviteCode: safeCode };
}

export function registerNewGameStart() {
  const stats = getGlobalStats();
  const today = formatTodayDate();
  if (stats.todayDate !== today) {
    stats.todayDate = today;
    stats.todayRebirthCount = 0;
  }
  stats.todayRebirthCount = (stats.todayRebirthCount || 0) + 1;
  saveGlobalStats(stats);
  flushGlobalStats();
  return {
    count: stats.todayRebirthCount,
    startFlow: Math.min(2 + (stats.todayRebirthCount || 0), GAME_CONFIG.dayFlowPerSecond)
  };
}

export function unlockAchievement(achievementId) {
  const achievement = getAchievementById(achievementId);
  if (!achievement) {
    return false;
  }
  const stats = getGlobalStats();
  if (stats.unlockedAchievements.indexOf(achievementId) === -1) {
    stats.unlockedAchievements.push(achievementId);
    saveGlobalStats(stats);
    setToast(t('toast.achUnlock'), achievement.name, 'success');
    vibrateShort();
    return true;
  }
  return false;
}

export function checkAllAchievements(state, global) {
  const newlyUnlocked = [];
  ACHIEVEMENT_DEFS.forEach(function (achievement) {
    if (achievement.check(state, global) && unlockAchievement(achievement.id)) {
      newlyUnlocked.push(achievement.id);
    }
  });
  return newlyUnlocked;
}

// ==================== 人生清单（跨世收集） ====================
// 核心原则：商品发放瞬间同步写入，不依赖 endRound —— 中途退出/杀进程不丢收集进度。
// 首次解锁才强制落盘（flush），重复获得走 2s 防抖，兼顾安全与 IO 成本。

export function recordLifetimeCollection(productId) {
  const global = getGlobalStats();
  if (!global.lifetimeOwned || typeof global.lifetimeOwned !== 'object') {
    global.lifetimeOwned = {};
  }
  if (!Array.isArray(global.lifetimeClaimed)) {
    global.lifetimeClaimed = [];
  }
  // 局内 totalPlayCount 尚未含本局，故当前世序 = 已完成局数 + 1
  const currentLife = Math.max(1, (global.totalPlayCount || 0) + 1);
  const rec = global.lifetimeOwned[productId];
  let firstTime = false;
  if (rec) {
    rec.count = (rec.count || 1) + 1;
  } else {
    global.lifetimeOwned[productId] = { count: 1, firstLife: currentLife };
    firstTime = true;
    if (GAME_STATE) {
      if (!Array.isArray(GAME_STATE.newLifeIds)) {
        GAME_STATE.newLifeIds = [];
      }
      GAME_STATE.newLifeIds.push(productId);
    }
  }

  if (firstTime) {
    const collected = Object.keys(global.lifetimeOwned).length;
    // 里程碑自动发放（无需玩家领取），以 lifetimeClaimed 防重复
    COLLECTION_MILESTONES.forEach(function (ms) {
      if (collected >= ms.need && global.lifetimeClaimed.indexOf(ms.id) === -1) {
        global.lifetimeClaimed.push(ms.id);
        global.reincarnationPoints = (global.reincarnationPoints || 0) + ms.rewardRP;
        global.lifetimeRP = (global.lifetimeRP || 0) + ms.rewardRP;
        setToast('🏅 ' + ms.title, '人生清单收集 ' + ms.need + '/160 · 轮回积分 +' + ms.rewardRP, 'success');
        trackEvent('lifetime_milestone', { id: ms.id, collected: collected });
      }
    });
    trackEvent('lifetime_collect', { productId: productId, collected: collected });
    saveGlobalStats(global);
    flushGlobalStats();
  } else {
    saveGlobalStats(global);
  }
  return firstTime;
}

// V2-3 老玩家「前世遗产」：清单功能上线前的老玩家没有历史收集数据（无法回溯旧局），
// 首次打开清单页时补发 50 RP，把数据缺失变成一次惊喜。只发一次，以标记位防重复。
export const LIFETIME_LEGACY_REWARD_RP = 50;

export function grantLifetimeLegacyGift() {
  const global = getGlobalStats();
  if (global.lifetimeLegacyGifted) {
    return null;
  }
  if ((global.totalPlayCount || 0) <= 0) {
    // 新玩家没有"前世"，不发（也不置标记位，留到他们成为老玩家后再发）。
    return null;
  }
  global.lifetimeLegacyGifted = true;
  global.reincarnationPoints = (global.reincarnationPoints || 0) + LIFETIME_LEGACY_REWARD_RP;
  global.lifetimeRP = (global.lifetimeRP || 0) + LIFETIME_LEGACY_REWARD_RP;
  setToast(t('toast.legacy'), '清单上线前的岁月无法追溯，这份心意补给你 · 轮回积分 +' + LIFETIME_LEGACY_REWARD_RP, 'success');
  trackEvent('lifetime_legacy_gift', { rewardRP: LIFETIME_LEGACY_REWARD_RP });
  saveGlobalStats(global);
  flushGlobalStats();
  return LIFETIME_LEGACY_REWARD_RP;
}

export function getLifetimeStats() {
  const global = getGlobalStats();
  const owned = global.lifetimeOwned || {};
  const ids = Object.keys(owned);
  return {
    collected: ids.length,
    total: 160,
    owned: owned,
    currentLife: Math.max(1, (global.totalPlayCount || 0) + 1)
  };
}

export const UI_STATE = {
  canvas: null,
  ctx: null,
  screenWidth: 375,
  screenHeight: 812,
  dpr: 1,
  activeCategoryId: 'cognition',
  scrollOffset: 0,
  pressedProductId: null,
  lastTappedProductId: null,
  lastTapTime: 0,
  touchMode: 'none',
  scrollStartY: 0,
  scrollStartOffset: 0,
  loopStarted: false,
  lastFrameTime: 0,
  pressedChoiceId: null,
  pressedEventChoiceId: null,
  pressedRestart: false,
  pressedShare: false,
  pressedFeedback: false,
  pressedReplay: false,
  pressedReviveWatch: false,
  pressedReviveQuit: false,
  pressedBudgetContinue: false,
  pressedBudgetTemplate: false,
  pressedAdventure: false,
  pressedAdventureChoice: null,
  pressedAdventureClose: false,
  pressedHeaderBuff: false,
  pressedHeaderAchievement: false,
  pressedBottomRules: false,
  pressedBottomNext: false,
  pressedWelcomeBuff: false,
  welcomeBuffRevealed: false,
  pastLifeEcho: null,
  echoRequestedFor: -1,
  showHelp: false,
  showWealthHelp: false,
  showBuffInfo: false,
  showDailyMissions: false,
  showPlatformModal: false,
  showShop: false,
  showLeaderboard: false,
  showGiftModal: false,
  giftTarget: null,
  showPouch: false,
  showLegal: null,
  legalScroll: 0,
  legalTouchStartY: 0,
  legalTouchStartScroll: 0,
  helpScroll: 0,
  helpTouchStartY: 0,
  helpTouchStartScroll: 0,
  leaderboardTab: 'global',
  buffPickerOpen: false,
  pressedShop: false,
  pressedLeaderboard: false,
  pressedFreeze: false,
  pressedFish: false,
  particles: [],
  floatingTexts: [],
  ripples: [],
  cardBounce: {},
  cardGlow: {},
  fpsSamples: [],
  fpsFrameCount: 0,
  fpsLastTime: 0,
  lastDeltaSeconds: 0,
  _tabsCacheDirty: true,
  _tabsSignature: '',
  _bottomCacheDirty: true,
  _bottomCacheAt: 0,
  tutorialShownInSession: false,
  _welcomeBtn: null,
  _welcomeBuffBtn: null,
  _tutorialTarget: null,
  _shareCanvas: null,
  _reviveWatchBtn: null,
  _reviveQuitBtn: null,
  _adventureBtn: null,
  _adventureCloseBtn: null,
  _headerBuffBtn: null,
  _headerAchievementBtn: null,
  _bottomRulesBtn: null,
  _bottomNextBtn: null,
  _freezeBtn: null,
  _bagBtn: null,
  _welcomeShopBtn: null,
  _settlementShopBtn: null,
  _shopCloseBtn: null,
  _leaderboardCloseBtn: null,
  _leaderboardGlobalTab: null,
  _leaderboardFriendsTab: null,
  _leaderboardInviteBtn: null,
  _giftCloseBtn: null,
  _fishBtn: null,
  _buffPickCloseBtn: null,
  _helpCloseBtn: null,
  _welcomeHelpBtn: null,
  _gameHelpBtn: null,
  _wealthHelpBtn: null,
  _wealthHelpCloseBtn: null,
  _buffInfoCloseBtn: null,
  _dailyMissionsBtn: null,
  _dailyMissionsCloseBtn: null,
  _platformBtn: null,
  _platformCloseBtn: null,
  _addDesktopBtn: null,
  _sidebarBtn: null,
  _subscribeBtn: null,
  _legalCloseBtn: null,
  _legalTabBtns: null,
  _legalContentRect: null,
  _legalMaxScroll: 0,
  _legalFooterBtn: null,
  _legalTermsBtn: null,
  _legalPrivacyBtn: null,
  _welcomeLifetimeBtn: null,
  showLifetime: false,
  lifetimeTab: 'all',
  lifetimeScroll: 0,
  lifetimeTouchStartY: 0,
  lifetimeTouchStartScroll: 0,
  _settlementBannerBtn: null,
  _ltCloseBtn: null,
  _ltShareBtn: null,
  _ltShareCanvas: null,
  _ltCloseBottomBtn: null,
  _ltMaxScroll: 0
};

// ===== 音效系统（使用 Web Audio API 合成） =====
// 震动节流：滚动、连点等场景下调用极其密集，
// 不节流会让低端机马达持续抖动，反而变成噪音。
const VIBRATE_MIN_INTERVAL_MS = 60;
let _lastVibrateAt = 0;

export function vibrateShort(type) {
  // 此前这里只放行 'medium'，而全项目点击反馈传的都是 'light'，
  // 导致所有点击震动一次都没真正触发过。
  const safeType = (type === 'medium' || type === 'heavy') ? type : 'light';
  const now = Date.now();
  if (now - _lastVibrateAt < VIBRATE_MIN_INTERVAL_MS) {
    return false;
  }
  _lastVibrateAt = now;
  const ttApi = getTT();
  if (ttApi && ttApi.vibrateShort) {
    try {
      ttApi.vibrateShort({
        type: safeType,
        fail: function () {}
      });
      return true;
    } catch (error) {
      return false;
    }
  }
  return false;
}

export function clearParticles() {
  UI_STATE.particles.length = 0;
  UI_STATE.floatingTexts.length = 0;
  UI_STATE.ripples.length = 0;
  UI_STATE.cardBounce = {};
  UI_STATE.cardGlow = {};
}

export function createInitialGameState(options) {
  const global = getGlobalStats();
  const registerRebirth = !options || options.register !== false;
  const rebirth = registerRebirth ? registerNewGameStart() : null;
  trackEvent('game_start', { isFirst: global.totalPlayCount === 0 });
  let bonusDays = 0;
  const benefitParts = [];
  const buff = getRandomBuff();

  if (global.totalPlayCount >= 10) {
    bonusDays += 800;
    benefitParts.push('开局 +800 天');
  } else if (global.totalPlayCount >= 3) {
    bonusDays += 300;
    benefitParts.push('开局 +300 天');
  }

  const buffBonusDays = buff && buff.id === 'underdog'
    ? (buff.bonusDays || 1000)
    : 0;
  if (buffBonusDays > 0) {
    benefitParts.push('逆袭剧本 +1000 天');
  }

  let timeSandBonus = 0;
  if (registerRebirth && (global.shopItems.timeSand || 0) > 0) {
    global.shopItems.timeSand -= 1;
    timeSandBonus = 500;
    saveGlobalStats(global);
    flushGlobalStats();
    benefitParts.push('⏳ 时光沙漏 +500 天');
  }

  const startingDays = GAME_CONFIG.initialDays + bonusDays + buffBonusDays + timeSandBonus;
  const state = {
    remainingDays: startingDays,
    startingDays: startingDays,
    remainingSeconds: GAME_CONFIG.roundSeconds,
    elapsedSeconds: 0,
    lastAutoSaveElapsed: 0,
    randomEventIndex: 0,
    pendingDecisionMilestone: null,
    pendingEvent: null,
    // v0.3 抉择前对话：null | { speaker, milestoneIndex, lines[], ai, phase: 'begin'|'watching' }
    milestoneDialogue: null,
    _nextPurchaseDiscount: null,
    consecutiveBuyCount: 0,
    lastBuyTimestamp: 0,
    comboActive: false,
    comboFlashTimer: 0,
    timeFreezeRemaining: 0,
    timeFreezeActive: false,
    timeFreezeUsedThisRound: false,
    deathShieldActive: false,
    doubleAdventureActive: false,
    nextPurchaseCashback: false,
    globalDiscount: 1,
    pouchVeteranActive: false,
    decisionMilestoneTriggered: [],
    categoryDiscounts: {},
    categoryPricePenalties: {},
    discountBlockedCategories: [],
    discountLocked: false,
    unlockedLegendary: [],
    fishCooldown: 0,
    fishCount: 0,
    fishRoastCount: 0,
    eventRewriteCount: 0,
    adventureRewriteCount: 0,
    pouchItems: [],
    pouchRefreshCount: 0,
    _timeSandApplied: registerRebirth && timeSandBonus > 0,
    roundRP: null,
    startFlow: rebirth ? rebirth.startFlow : 1,
    _rebirthCounted: registerRebirth,
    totalSpent: 0,
    totalSpentOriginal: 0,
    virtualTotalSpent: 0,
    categorySpent: {},
    categorySpentOriginal: {},
    categoryVirtualSpent: {},
    categoryPurchaseCount: {},
    ownedProductIds: [],
    newLifeIds: [],
    purchaseLedger: [],
    completedDecisionIds: [],
    randomEventLog: [],
    decisionLog: [],
    lastRandomEvent: null,
    lastPurchaseResult: null,
    aiComment: null,
    aiLoading: false,
    aiGenerated: false,
    budgetExhausted: false,
    uiToast: null,
    lastPurchaseAt: 0,
    endReason: null,
    phase: 'welcome',
    reviveUsed: false,
    showReviveModal: false,
    _pendingEndReason: null,
    activeBuff: buff,
    ownedBuffs: buff ? [buff.id] : [],
    adventureTriggered: [],
    tempFlowModifier: null,
    positiveEventBoost: 0,
    pendingAdventure: null,
    _adventurePaused: false
  };

  if (benefitParts.length > 0) {
    state.uiToast = {
      title: t('toast.openBonus'),
      desc: benefitParts.join(' · '),
      kind: 'info',
      expiresAt: Date.now() + 2600
    };
  }

  UI_STATE.buffPickerOpen = (global.shopItems.buffTicket || 0) > 0;
  UI_STATE.showShop = false;
  state.pouchItems = generatePouchItems();
  return state;
}

export let GAME_STATE = createInitialGameState({ register: false });

export function resetGameState() {
  GAME_STATE = createInitialGameState({ register: true });
  UI_STATE.lastFrameTime = 0;
  UI_STATE.lastDeltaSeconds = 0;
  UI_STATE.fpsFrameCount = 0;
  UI_STATE.fpsLastTime = 0;
  UI_STATE.fpsSamples.length = 0;
  UI_STATE._tabsCacheDirty = true;
  UI_STATE._tabsSignature = '';
  UI_STATE._bottomCacheDirty = true;
  UI_STATE._bottomCacheAt = 0;
  clearParticles();
  UI_STATE.activeCategoryId = 'cognition';
  UI_STATE.scrollOffset = 0;
  UI_STATE.pressedProductId = null;
  UI_STATE.pressedChoiceId = null;
  UI_STATE.pressedEventChoiceId = null;
  UI_STATE.pressedRestart = false;
  UI_STATE.pressedShare = false;
  UI_STATE.pressedFeedback = false;
  UI_STATE.pressedReplay = false;
  UI_STATE.pressedReviveWatch = false;
  UI_STATE.pressedReviveQuit = false;
  UI_STATE.pressedBudgetContinue = false;
  UI_STATE.pressedBudgetTemplate = false;
  UI_STATE.pressedAdventure = false;
  UI_STATE.pressedAdventureChoice = null;
  UI_STATE.pressedAdventureClose = false;
  UI_STATE.pressedHeaderBuff = false;
  UI_STATE.pressedHeaderAchievement = false;
  UI_STATE.pressedBottomRules = false;
  UI_STATE.pressedBottomNext = false;
  UI_STATE.pressedWelcomeBuff = false;
  UI_STATE.welcomeBuffRevealed = false;
  UI_STATE.showHelp = false;
  UI_STATE.showWealthHelp = false;
  UI_STATE.showBuffInfo = false;
  UI_STATE.showDailyMissions = false;
  UI_STATE.showLegal = null;
  UI_STATE.legalScroll = 0;
  UI_STATE.showLifetime = false;
  UI_STATE.lifetimeTab = 'all';
  UI_STATE.lifetimeScroll = 0;
  UI_STATE.showPlatformModal = false;
  UI_STATE.showShop = false;
  UI_STATE.showLeaderboard = false;
  UI_STATE.showGiftModal = false;
  UI_STATE.giftTarget = null;
  UI_STATE.showPouch = false;
  UI_STATE.leaderboardTab = 'global';
  UI_STATE.pressedShop = false;
  UI_STATE.pressedLeaderboard = false;
  UI_STATE.pressedFreeze = false;
  UI_STATE.pressedFish = false;
  UI_STATE._reviveWatchBtn = null;
  UI_STATE._reviveQuitBtn = null;
  UI_STATE._adventureBtn = null;
  UI_STATE._adventureCloseBtn = null;
  UI_STATE._headerBuffBtn = null;
  UI_STATE._headerAchievementBtn = null;
  UI_STATE._bottomRulesBtn = null;
  UI_STATE._bottomNextBtn = null;
  UI_STATE._freezeBtn = null;
  UI_STATE._bagBtn = null;
  UI_STATE._welcomeShopBtn = null;
  UI_STATE._settlementShopBtn = null;
  UI_STATE._shopCloseBtn = null;
  UI_STATE._leaderboardCloseBtn = null;
  UI_STATE._leaderboardGlobalTab = null;
  UI_STATE._leaderboardFriendsTab = null;
  UI_STATE._leaderboardInviteBtn = null;
  UI_STATE._giftCloseBtn = null;
  UI_STATE._fishBtn = null;
  UI_STATE._buffPickCloseBtn = null;
  UI_STATE._helpCloseBtn = null;
  UI_STATE._welcomeHelpBtn = null;
  UI_STATE._gameHelpBtn = null;
  UI_STATE._wealthHelpBtn = null;
  UI_STATE._wealthHelpCloseBtn = null;
  UI_STATE._buffInfoCloseBtn = null;
  UI_STATE._dailyMissionsBtn = null;
  UI_STATE._dailyMissionsCloseBtn = null;
  UI_STATE._platformBtn = null;
  UI_STATE._platformCloseBtn = null;
  UI_STATE._addDesktopBtn = null;
  UI_STATE._sidebarBtn = null;
  UI_STATE._subscribeBtn = null;
  UI_STATE._welcomeBuffBtn = null;
  UI_STATE._welcomeLifetimeBtn = null;
  UI_STATE._settlementBannerBtn = null;
  UI_STATE._ltCloseBtn = null;
  UI_STATE._ltShareBtn = null;
  UI_STATE._ltCloseBottomBtn = null;
  UI_STATE._ltMaxScroll = 0;
  UI_STATE.lifetimeTouchStartY = 0;
  UI_STATE.lifetimeTouchStartScroll = 0;
  Object.keys(UI_STATE).forEach(function (key) {
    if (
      key.indexOf('_adventureChoice_') === 0 ||
      key.indexOf('_shopItemBtn_') === 0 ||
      key.indexOf('_buffPick_') === 0 ||
      key.indexOf('_ltTab_') === 0
    ) {
      delete UI_STATE[key];
    }
  });
  return GAME_STATE;
}

export function resetPlayingState() {
  resetGameState();
  GAME_STATE.phase = 'playing';
  GAME_STATE.reviveUsed = true;
  return GAME_STATE;
}

export function setToast(title, desc, kind) {
  if (!GAME_STATE) {
    return;
  }
  GAME_STATE.uiToast = {
    title: title,
    desc: desc || '',
    kind: kind || 'info',
    expiresAt: Date.now() + 2200
  };
  if (kind === 'error') {
    playSound('error');
    vibrateShort('light');
  }
}
