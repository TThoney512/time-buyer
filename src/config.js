// Module: config.js
// Split from the original game.js during module refactor.

export const GAME_CONFIG = {
  initialDays: 30000,
  roundSeconds: 15 * 60,
  priceStepPerPurchase: 2,
  dayFlowPerSecond: 10,
  randomEventIntervalSeconds: 100,
  randomEventFirstTriggerSeconds: 45,
  reviveBonusDays: 500,
  reviveBonusSeconds: 60
};

export const CATEGORY_MASTERY_THRESHOLD = 10;
export const CATEGORY_MASTERY_DISCOUNT = 0.95;

export const DAILY_SPECIAL_COUNT = 3;
export const DAILY_SPECIAL_DISCOUNT = 0.8;
export const dailySpecial = [];
export const ENABLE_REMOTE_LEADERBOARD = false;
export const SHOP_ITEMS = [
  { id: 'buffTicket', icon: '🎲', name: 'Buff 自选券', price: 200, desc: '下局开局可自选 1 个 Buff', type: 'consumable' },
  { id: 'deathShield', icon: '🛡️', name: '免死金牌', price: 150, desc: '单局内自动抵消首次负面事件', type: 'consumable' },
  { id: 'skin', icon: '✨', name: '金色主题皮肤', price: 100, desc: '结算卡片永久金色边框', type: 'permanent' },
  { id: 'timeSand', icon: '⏳', name: '时光沙漏', price: 120, desc: '下局开局额外 +500 天', type: 'consumable' },
  { id: 'doubleAdventure', icon: '🔮', name: '双倍奇遇卡', price: 180, desc: '本次奇遇所有数值效果翻倍（道具除外）', type: 'consumable' },
  { id: 'timeFreeze', icon: '⏸️', name: '时间静止', price: 160, desc: '剩余天数和倒计时暂停 15 秒', type: 'consumable' }
];

export const POUCH_ITEMS = [
  { id: 'doubleAdventure', name: '双倍奇遇', emoji: '🔮', desc: '本次奇遇数值效果翻倍（道具除外）', free: true, price: 0 },
  { id: 'deathShield', name: '购买保险', emoji: '🛡️', desc: '抵消下一次负面事件', free: true, price: 0 },
  { id: 'timeRewind', name: '时光回流', emoji: '⏪', desc: '立即恢复100天', free: true, price: 0 },
  { id: 'discountCoupon', name: '折扣券', emoji: '🎫', desc: '下次购买半价', free: true, price: 0 },
  { id: 'timeSand', name: '时间沙漏', emoji: '⏳', desc: '立即获得200天', free: true, price: 0 },
  { id: 'cashBack', name: '财富倍增', emoji: '💰', desc: '下次购买返还一半天数', free: true, price: 0 },
  { id: 'timeFreeze', name: '时间静止', emoji: '⏸️', desc: '暂停时间15秒', free: false, price: 50 },
  { id: 'refreshTicket', name: '刷新券', emoji: '🔄', desc: '免费刷新一次锦囊', free: false, price: 100 },
  { id: 'luckyBuff', name: '幸运Buff', emoji: '🍀', desc: '随机获得一个Buff', free: false, price: 120 },
  { id: 'veteranDiscount', name: '资深玩家', emoji: '🧑‍💼', desc: '本局所有商品9折', free: false, price: 120 }
];

export const POUCH_FREE_COUNT = 2;
export const POUCH_PAID_COUNT = 1;

export const DECISION_MILESTONES_V2 = [
  {
    id: 'milestone_1',
    threshold: 1500,
    title: '初窥门径',
    desc: '你已消费了1500天，是时候规划方向了。',
    choices: [
      {
        id: 'focus_strength',
        text: '深耕优势',
        emoji: '🎯',
        desc: '最高消费分类永久 95 折，最低消费分类价格 +5%',
        effect: { type: 'category_discount', discount: 0.95, target: 'highest', penaltyMultiplier: 1.05, penaltyTarget: 'lowest' }
      },
      {
        id: 'cover_weakness',
        text: '弥补短板',
        emoji: '🛠️',
        desc: '最低消费分类永久 95 折，最高消费分类价格 +5%',
        effect: { type: 'category_discount', discount: 0.95, target: 'lowest', penaltyMultiplier: 1.05, penaltyTarget: 'highest' }
      }
    ]
  },
  {
    id: 'milestone_2',
    threshold: 8000,
    title: '小有成就',
    desc: '你已积累了8000天，做出更具影响力的决策。',
    choices: [
      {
        id: 'strengthen_strength',
        text: '顺势而上',
        emoji: '🔥',
        desc: '最高消费分类 90 折并解锁该分类传奇，其余分类价格 +5%',
        effect: {
          type: 'strengthen_legend',
          discount: 0.9,
          penaltyMultiplier: 1.05
        }
      },
      {
        id: 'balance_all',
        text: '均衡发展',
        emoji: '⚖️',
        desc: '所有分类商品 95 折，不再解锁传奇商品',
        effect: { type: 'global_discount', discount: 0.95 }
      }
    ]
  },
  {
    id: 'milestone_3',
    threshold: 15000,
    title: '人生巅峰',
    desc: '你已走过大半人生，做出最终的选择。',
    choices: [
      {
        id: 'master_category',
        text: 'XX 大师',
        emoji: '👑',
        desc: '最高消费分类 85 折，其他分类不再享受任何折扣',
        effect: { type: 'category_discount', discount: 0.85, target: 'highest', blockOtherDiscounts: true }
      },
      {
        id: 'time_gift',
        text: '时间馈赠',
        emoji: '⌛',
        desc: '立即获得 2000 天，但扣除最高分类累计消费 1000 天',
        effect: { type: 'days_bonus', amount: 2000, spendPenalty: 1000 }
      },
      {
        id: 'legend_permission',
        text: '传奇权限',
        emoji: '🏛️',
        desc: '解锁所有传奇商品购买权限，本局不再获得任何折扣',
        effect: { type: 'unlock_all_legendary', lockDiscounts: true }
      }
    ]
  }
];

export const ADVENTURE_MISS_COMPENSATION_DAYS = 200;

export const ADVENTURE_EVENTS = [
  {
    id: 'adventure_mentor',
    threshold: 5000,
    title: '高人指点',
    emoji: '🧘',
    desc: '你在旅行中偶遇一位隐居的智者，他看出你心中的困惑，主动提出要给你一些人生建议。',
    choices: [
      {
        id: 'listen_advice',
        text: '认真聆听',
        emoji: '🧠',
        desc: '你花了三天时间，放下一切杂念，虚心求教。',
        effects: [
          { type: 'days', value: -30 },
          { type: 'random_item', grade: 'advanced', count: 1 },
          { type: 'flow', value: -0.5, duration: 120 },
          { type: 'category_spend', category: 'cognition', amount: 500 }
        ]
      },
      {
        id: 'ignore_advice',
        text: '匆匆告别',
        emoji: '🏃',
        desc: '你觉得这些道理太虚，不如脚踏实地赚钱实在。',
        effects: [
          { type: 'days', value: 150 },
          { type: 'prop', itemId: 'timeSand', count: 1 },
          { type: 'category_spend', category: 'career', amount: 200 }
        ]
      }
    ]
  },
  {
    id: 'adventure_trend',
    threshold: 10000,
    title: '踩上风口',
    emoji: '🌪️',
    desc: '你偶然发现一个新兴行业正在爆发，身边的朋友都开始尝试，你也动了心。',
    choices: [
      {
        id: 'go_all_in',
        text: '全力投入',
        emoji: '🚀',
        desc: '你抵押了部分资产，全身心扎进这个赛道。',
        effects: [
          { type: 'days', value: -300 },
          { type: 'random_item', grade: 'rare', count: 1 },
          { type: 'flow', value: 0.3, duration: 200 },
          { type: 'category_spend', category: 'career', amount: 800 }
        ]
      },
      {
        id: 'stay_steady',
        text: '保持观望',
        emoji: '⚖️',
        desc: '你决定先观察一段时间，等局面明朗再行动。',
        effects: [
          { type: 'days', value: 250 },
          { type: 'prop', itemId: 'buffTicket', count: 1 },
          { type: 'category_spend', category: 'experience', amount: 400 }
        ]
      }
    ]
  },
  {
    id: 'adventure_sponsor',
    threshold: 15000,
    title: '贵人相助',
    emoji: '🤝',
    desc: '一位赏识你才华的投资人主动联系你，愿意出资支持你的下一个项目，但条件是你必须做出取舍。',
    choices: [
      {
        id: 'accept_investment',
        text: '接受投资',
        emoji: '💼',
        desc: '你签下了协议，获得了资金，但也承担了更多的责任和压力。',
        effects: [
          { type: 'days', value: -300 },
          { type: 'random_item', grade: 'legend', chance: 0.5 },
          { type: 'flow', value: -0.2, duration: 150 },
          { type: 'category_spend', category: 'career', amount: 1000 }
        ]
      },
      {
        id: 'stay_independent',
        text: '坚持独立',
        emoji: '🛤️',
        desc: '你婉拒了投资，选择按自己的节奏慢慢发展。',
        effects: [
          { type: 'days', value: 600 },
          { type: 'prop', itemId: 'timeFreeze', count: 1 },
          { type: 'category_spend', category: 'family', amount: 200 }
        ]
      }
    ]
  }
];

// ===== 全局成就与存档管理 =====
export const FEEDBACK_URL = 'https://github.com/TThoney512/time-buyer/issues';

export const GRADE_META = [
  {
    key: 'normal',
    name: '普通',
    minPrice: 10,
    maxPrice: 100,
    prices: [10, 40, 70, 90, 100],
    color: '#A8B8C8',
    unlockType: 'none',
    unlockThreshold: 0,
    unlockDesc: '开局解锁'
  },
  {
    key: 'advanced',
    name: '进阶',
    minPrice: 101,
    maxPrice: 300,
    prices: [120, 200, 280, 300, 300],
    color: '#7FB5A8',
    unlockType: 'total',
    unlockThreshold: 1000,
    unlockDesc: '总消费达1000天自动解锁'
  },
  {
    key: 'rare',
    name: '难得',
    minPrice: 301,
    maxPrice: 1000,
    prices: [450, 600, 750, 900, 1000],
    color: '#C79B6E',
    unlockType: 'category',
    unlockThreshold: 1500,
    unlockDesc: '该分类消费达1500天解锁'
  },
  {
    key: 'legend',
    name: '传奇',
    minPrice: 1001,
    maxPrice: 3000,
    prices: [1100, 1500, 2000, 2500, 3000],
    color: '#E8C26A',
    unlockType: 'category',
    unlockThreshold: 5000,
    unlockDesc: '该分类消费达5000天解锁'
  }
];

export const CATEGORY_META = [
  { id: 'cognition', name: '认知', emoji: '🧠', color: '#6C8CFF' },
  { id: 'experience', name: '体验', emoji: '🌌', color: '#8E7CFF' },
  { id: 'career', name: '事业', emoji: '🚀', color: '#E6B65C' },
  { id: 'family', name: '家庭', emoji: '🏡', color: '#F29F86' },
  { id: 'social', name: '社交', emoji: '🥂', color: '#54C7C3' },
  { id: 'health', name: '健康', emoji: '💪', color: '#7BC67E' },
  { id: 'fun', name: '娱乐', emoji: '🎮', color: '#FF8FA3' },
  { id: 'consume', name: '消费', emoji: '🛍️', color: '#D7A9FF' }
];

export const UI_COLORS = {
  bgTop: '#0A1028',
  bgBottom: '#060B18',
  glass: 'rgba(255,255,255,0.15)',
  glassBorder: 'rgba(255,255,255,0.22)',
  gold: '#E9C46A',
  goldLight: '#F7E2A0',
  text: '#F5F8FF',
  muted: '#A7B4D8',
  blue: '#7D9CFF',
  danger: '#FF8FA3'
};
