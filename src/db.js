// Module: db.js
// Split from the original game.js during module refactor.
import { GRADE_META } from './config.js';

export const RANDOM_EVENT_POOL = [
  // ===== 正面事件：与负面总权重保持 1:1 =====
  {
    id: 'bonus-raise',
    name: '业绩达标，拿到奖金',
    emoji: '💰',
    currencyChange: 200,
    weight: 12,
    desc: '老板兑现承诺，200天奖金到账，可以买点一直想要的东西了。'
  },
  {
    id: 'investment-return',
    name: '小投资意外回本',
    emoji: '📈',
    currencyChange: 120,
    weight: 10,
    desc: '几年前投的小项目突然分红，120天像捡来的一样。'
  },
  {
    id: 'side-hustle',
    name: '副业接到大单',
    emoji: '💻',
    currencyChange: 60,
    weight: 14,
    desc: '业余爱好突然变现，60天收入够犒劳自己一顿好的。'
  },
  {
    id: 'found-old-book',
    name: '旧书里翻出压岁钱',
    emoji: '📖',
    currencyChange: 30,
    weight: 16,
    desc: '整理书架时发现儿时的红包，30天失而复得。'
  },
  {
    id: 'tax-refund',
    name: '退税到账',
    emoji: '🧾',
    currencyChange: 10,
    weight: 18,
    desc: '国家发的红包，10天虽然不多，但刚好够喝一杯好咖啡。'
  },
  {
    id: 'lottery-win',
    name: '彩票中了小奖',
    emoji: '🎫',
    currencyChange: 50,
    weight: 10,
    desc: '顺手买的彩票中了小奖，50天像白捡的快乐。'
  },
  {
    id: 'friend-payback',
    name: '老朋友归还借款',
    emoji: '🤝',
    currencyChange: 80,
    weight: 10,
    desc: '多年前借出去的钱突然到账，80天失而复得。'
  },
  {
    id: 'free-sample',
    name: '免费获得心仪服务',
    emoji: '🎁',
    currencyChange: 20,
    weight: 10,
    desc: '意外获得一次免费体验，省下20天开销。'
  },
  // ===== 负面事件：核心事件改为二选一 =====
  {
    id: 'major-illness',
    name: '生一场大病',
    emoji: '🤒',
    currencyChange: -300,
    weight: 18,
    desc: '身体突然亮红灯，300天直接花在医院和休养里。'
  },
  {
    id: 'family-hospital',
    name: '家人临时住院陪护',
    emoji: '🏥',
    currencyChange: -200,
    weight: 15,
    desc: '放下所有计划陪护一周，200天换成家人安心的夜晚。'
  },
  {
    id: 'job-loss',
    name: '突然被裁员',
    emoji: '📉',
    weight: 12,
    desc: '没有预告的裁员通知，你要决定如何接住这次冲击。',
    options: [
      {
        id: 'job-loss-severance',
        name: '接受赔偿',
        emoji: '📋',
        desc: '接受裁员赔偿，安静损失180天。',
        currencyChange: -180
      },
      {
        id: 'job-loss-apply',
        name: '立即求职',
        emoji: '💼',
        desc: '马上投简历，损失100天，下件商品9折。',
        currencyChange: -100,
        nextPurchaseDiscount: 0.9
      }
    ]
  },
  {
    id: 'impulse-buy',
    name: '一次冲动消费',
    emoji: '🛒',
    weight: 12,
    desc: '半夜下单的快乐只持续一天，现在要决定怎么收场。',
    options: [
      {
        id: 'impulse-accept',
        name: '承认冲动',
        emoji: '😅',
        desc: '承认这次冲动，损失120天。',
        currencyChange: -120
      },
      {
        id: 'impulse-return',
        name: '强行退货',
        emoji: '📦',
        desc: '损失60天，信誉受损但无额外惩罚。',
        currencyChange: -60
      }
    ]
  },
  {
    id: 'car-repair',
    name: '车子突然大修',
    emoji: '🚗',
    weight: 10,
    desc: '开到半路亮起故障灯，是修还是换？',
    options: [
      {
        id: 'car-repair-pay',
        name: '彻底修好',
        emoji: '🔧',
        desc: '花100天彻底修好，车子继续陪你上路。',
        currencyChange: -100
      },
      {
        id: 'car-repair-scrap',
        name: '报废车辆',
        emoji: '♻️',
        desc: '报废车辆，拿回30天残值。',
        currencyChange: 30
      }
    ]
  },
  {
    id: 'pipe-burst',
    name: '家中水管爆裂',
    emoji: '🚿',
    currencyChange: -80,
    weight: 13,
    desc: '凌晨被漏水声吵醒，修水管、换地板，80天蒸发。'
  },
  {
    id: 'lost-documents',
    name: '重要证件遗失',
    emoji: '🪪',
    currencyChange: -60,
    weight: 11,
    desc: '补办证件跑遍窗口，60天消失在排队与填表中。'
  },
  {
    id: 'power-outage',
    name: '城市突发停水停电',
    emoji: '⚡',
    currencyChange: -40,
    weight: 9,
    desc: '计划全被打乱，40天在等待恢复中悄悄流走。'
  }
];

// ===== Buff系统 =====
export const BUFF_POOL = [
  { id: 'rich', name: '豪门世家', emoji: '👑', desc: '消费分类9折', category: 'consume', discount: 0.9 },
  { id: 'scholar', name: '书香门第', emoji: '📚', desc: '认知分类9折', category: 'cognition', discount: 0.9 },
  { id: 'fitness', name: '健康达人', emoji: '💪', desc: '健康分类9折', category: 'health', discount: 0.9 },
  { id: 'socialite', name: '社交悍匪', emoji: '🥂', desc: '社交分类9折', category: 'social', discount: 0.9 },
  { id: 'artist', name: '艺术细胞', emoji: '🎨', desc: '娱乐分类9折', category: 'fun', discount: 0.9 },
  { id: 'business', name: '商业头脑', emoji: '🚀', desc: '事业分类9折', category: 'career', discount: 0.9 },
  { id: 'adventurer', name: '冒险基因', emoji: '🌍', desc: '体验分类9折', category: 'experience', discount: 0.9 },
  { id: 'family', name: '天伦之乐', emoji: '🏡', desc: '家庭分类9折', category: 'family', discount: 0.9 },
  { id: 'chosen', name: '天选之人', emoji: '⭐', desc: '全品类95折', category: 'all', discount: 0.95 },
  { id: 'underdog', name: '逆袭剧本', emoji: '🔥', desc: '开局时间货币+1000天', category: null, discount: null, bonusDays: 1000 }
];

export function getUpgradedBuff(baseBuff) {
  if (!baseBuff) {
    return null;
  }
  const upgraded = Object.assign({}, baseBuff, {
    id: baseBuff.id + '-top',
    name: '顶级' + baseBuff.name,
    upgradedFrom: baseBuff.id
  });
  if (baseBuff.discount) {
    const nextDiscount = baseBuff.discount === 0.95 ? 0.9 : 0.8;
    upgraded.discount = nextDiscount;
    upgraded.upgradeText = (baseBuff.discount * 10) + '折 → ' + (nextDiscount * 10) + '折';
  }
  if (baseBuff.bonusDays) {
    upgraded.bonusDays = 1500;
    upgraded.upgradeBonusDelta = 500;
    upgraded.upgradeText = '+1000天 → +1500天';
  }
  return upgraded;
}

export function getBaseBuffId(buffId) {
  if (typeof buffId !== 'string' || buffId.indexOf('-top') !== buffId.length - 4) {
    return buffId;
  }
  return buffId.slice(0, -4);
}

export function getBuffById(id) {
  const baseBuff = BUFF_POOL.find(function (buff) {
    return buff.id === id;
  });
  if (baseBuff) {
    return baseBuff;
  }
  const baseId = getBaseBuffId(id);
  if (baseId !== id) {
    const upgradedBase = BUFF_POOL.find(function (buff) {
      return buff.id === baseId;
    });
    if (upgradedBase) {
      return getUpgradedBuff(upgradedBase);
    }
  }
  return null;
}

export function getRandomBuff() {
  return BUFF_POOL[Math.floor(Math.random() * BUFF_POOL.length)];
}

export function pickRandomBuffs(count, excludeIds) {
  const safeCount = Math.max(1, Math.floor(count || 3));
  const excludeSet = new Set(excludeIds || []);
  const newBuffs = BUFF_POOL.filter(function (buff) {
    return !excludeSet.has(buff.id) && !excludeSet.has(buff.id + '-top');
  });
  const shuffledNew = newBuffs.slice().sort(function () {
    return Math.random() - 0.5;
  }).slice(0, safeCount).map(function (buff) {
    return Object.assign({}, buff, { type: 'new' });
  });
  const result = shuffledNew.slice();

  if (result.length < safeCount) {
    const upgradeCandidates = (excludeIds || []).filter(function (id) {
      return BUFF_POOL.some(function (buff) {
        return buff.id === id;
      }) && !excludeSet.has(id + '-top');
    });
    const shuffledUpgrades = upgradeCandidates.slice().sort(function () {
      return Math.random() - 0.5;
    }).slice(0, safeCount - result.length).map(function (id) {
      const upgraded = getUpgradedBuff(getBuffById(id));
      return Object.assign({}, upgraded, { type: 'upgrade', originalId: id });
    });
    shuffledUpgrades.forEach(function (buff) {
      result.push(buff);
    });
  }

  let rerollIndex = 0;
  while (result.length < safeCount) {
    rerollIndex += 1;
    result.push({
      id: 'reroll-' + rerollIndex,
      name: '重随天赋',
      emoji: '🎲',
      desc: '重新随机一个天赋；若已全拥有则补偿100天',
      type: 'reroll',
      reroll: true
    });
  }
  return result;
}

export const ACHIEVEMENT_DEFS = [
  {
    id: 'first_buy',
    name: '初次交易',
    desc: '完成人生第一笔消费',
    icon: '🛒',
    check: function (state, global) {
      return global.totalProductsBought >= 1;
    }
  },
  {
    id: 'spend_1000',
    name: '小试牛刀',
    desc: '累积消耗 1000 天',
    icon: '💸',
    check: function (state, global) {
      return global.totalDaysSpent >= 1000;
    }
  },
  {
    id: 'spend_10000',
    name: '人生赢家',
    desc: '累积消耗 10000 天',
    icon: '👑',
    check: function (state, global) {
      return global.totalDaysSpent >= 10000;
    }
  },
  {
    id: 'buy_10',
    name: '收藏家',
    desc: '单局购买 10 件商品',
    icon: '📦',
    check: function (state, global) {
      return (state.ownedProductIds || []).length >= 10;
    }
  },
  {
    id: 'buy_30',
    name: '购物狂',
    desc: '单局购买 30 件商品',
    icon: '🛍️',
    check: function (state, global) {
      return (state.ownedProductIds || []).length >= 30;
    }
  },
  {
    id: 'survive_full',
    name: '幸存者',
    desc: '坚持到时间自然结束（15分钟）',
    icon: '⏳',
    check: function (state, global) {
      return state.endReason === 'time-out';
    }
  },
  {
    id: 'category_fun',
    name: '快乐至上',
    desc: '娱乐分类累计消耗 5000 天',
    icon: '🎮',
    check: function (state, global) {
      return ((state.categorySpent || {}).fun || 0) >= 5000;
    }
  },
  {
    id: 'category_health',
    name: '健康第一',
    desc: '健康分类累计消耗 5000 天',
    icon: '💪',
    check: function (state, global) {
      return ((state.categorySpent || {}).health || 0) >= 5000;
    }
  },
  {
    id: 'play_5',
    name: '老玩家',
    desc: '游玩 5 局游戏',
    icon: '🎯',
    check: function (state, global) {
      return global.totalPlayCount >= 5;
    }
  },
  {
    id: 'play_20',
    name: '铁粉',
    desc: '游玩 20 局游戏',
    icon: '⭐',
    check: function (state, global) {
      return global.totalPlayCount >= 20;
    }
  }
];

export function getAchievementById(id) {
  return ACHIEVEMENT_DEFS.find(function (achievement) {
    return achievement.id === id;
  }) || null;
}

// 人生清单收集里程碑：按 lifetimeOwned 去重数量达成即自动发放 RP（无需玩家领取）。
export const COLLECTION_MILESTONES = [
  { id: 'col_10', need: 10, rewardRP: 100, title: '初涉人世' },
  { id: 'col_30', need: 30, rewardRP: 200, title: '有点经历' },
  { id: 'col_60', need: 60, rewardRP: 350, title: '七情六欲' },
  { id: 'col_100', need: 100, rewardRP: 600, title: '人间值得' },
  { id: 'col_160', need: 160, rewardRP: 1500, title: '完整的一生' }
];

export const DECISION_MILESTONES = [
  {
    id: 'decision-20',
    triggerDays: 6000,
    ageLabel: '20岁',
    title: '第一次人生岔路',
    choices: [
      {
        id: 'world-trip',
        productId: 'experience-15',
        name: '环球旅行',
        emoji: '🌍',
        desc: '离开熟悉的一切，用最自由的路线去看世界。'
      },
      {
        id: 'start-family',
        productId: 'family-15',
        name: '组建家庭',
        emoji: '🏡',
        desc: '把时间和爱投进一个真正属于你的家。'
      }
    ]
  },
  {
    id: 'decision-30',
    triggerDays: 9000,
    ageLabel: '30岁',
    title: '事业与家庭的选择',
    choices: [
      {
        id: 'promotion-manager',
        productId: 'career-11',
        name: '晋升主管',
        emoji: '📈',
        desc: '扛起团队和更大的责任，把事业推进到下一站。'
      },
      {
        id: 'raise-child',
        productId: 'family-12',
        name: '养育一个可爱的孩子',
        emoji: '👶',
        desc: '把一个新生命认真养大，成为他最早的人生记忆。'
      }
    ]
  },
  {
    id: 'decision-40',
    triggerDays: 12000,
    ageLabel: '40岁',
    title: '事业与孝心的选择',
    choices: [
      {
        id: 'own-studio',
        productId: 'career-12',
        name: '创立工作室',
        emoji: '🏢',
        desc: '把多年的经验变成自己的招牌，开始真正做主。'
      },
      {
        id: 'parents-care',
        productId: 'family-16',
        name: '陪父母安度晚年',
        emoji: '🏠',
        desc: '让父母住进舒适安稳的房子，把陪伴变成日常。'
      }
    ]
  },
  {
    id: 'decision-50',
    triggerDays: 15000,
    ageLabel: '50岁',
    title: '个人传承的选择',
    choices: [
      {
        id: 'master-craft',
        productId: 'cognition-13',
        name: '成为行业匠人',
        emoji: '🛠️',
        desc: '拜师与深耕，把手艺练到能被同行记住。'
      },
      {
        id: 'education-fund',
        productId: 'family-17',
        name: '给孩子留教育基金',
        emoji: '🎓',
        desc: '让孩子的选择不被学费绑架，拥有更长久的自由。'
      }
    ]
  },
];

// 每个分类固定20个：前5个普通、次5个进阶、再5个难得、末5个传奇。
export const PRODUCT_TEMPLATES = [
  {
    category: 'cognition',
    items: [
      { name: '读完《思考，快与慢》', emoji: '📚', desc: '让系统2接管重大决定，从此不再被一个冲动念头骗走半天。' },
      { name: '看懂一本哲学入门', emoji: '🧠', desc: '用一晚想清楚“我到底在焦虑什么”，比刷十小时短视频更回本。' },
      { name: '学会三分钟结构表达', emoji: '🗣️', desc: '把说不清的委屈和想法，整理成对方愿意听的三句话。' },
      { name: '记一本手写思考日记', emoji: '✍️', desc: '每天写三条真实想法，三个月后你会看见自己思维升级的轨迹。' },
      { name: '看完一部烧脑纪录片', emoji: '🌍', desc: '用一部纪录片换一个全新的世界观，比转发一百条观点更值。' },
      { name: '完成21天专注训练', emoji: '⏳', desc: '把碎片化注意力重新焊起来，让你在工作里少加班两小时。' },
      { name: '学会用数据做决策', emoji: '📊', desc: '不再凭感觉赌人生，让每次选择都有可回看的依据。' },
      { name: '跟行业前辈深度对谈', emoji: '☕', desc: '一次两小时的请教，帮你少走别人用五年才绕过的弯路。' },
      { name: '学完一门实用心理学', emoji: '🧩', desc: '看懂自己和老板的情绪按钮，很多冲突在发生前就被按停。' },
      { name: '掌握一门第二外语', emoji: '🈶', desc: '当你用另一种语言理解世界，许多原来的死结会自动松开。' },
      { name: '完成一次独立研究项目', emoji: '🔬', desc: '把一个没人替你回答的问题，亲手查到能写进简历的答案。' },
      { name: '把十年经历写成系统方法论', emoji: '📗', desc: '让踩过的坑变成可复制的判断力，而不是只能在酒局里讲的故事。' },
      { name: '拜师一位真正的匠人', emoji: '🛠️', desc: '跟着老师傅从零做出一件作品，你会重新相信耐心有复利。' },
      { name: '参加顶级行业闭门会', emoji: '🎫', desc: '坐到真正掌握资源的人中间，听他们怎么定义下一个机会。' },
      { name: '设计一套自己的成长算法', emoji: '🧮', desc: '把天赋、精力、风险写进决策表，让每一年都朝明确方向增值。' },
      { name: '出版一本真正影响人的书', emoji: '📖', desc: '把你验证过的观点装进书里，让陌生人在多年后仍能读到你的答案。' },
      { name: '完成跨学科博士级研究', emoji: '🎓', desc: '把认知边界推到学术前沿，从此你不再只是行业里的熟练工。' },
      { name: '建立一所小型学校', emoji: '🏫', desc: '让一群人因为你的课程而改变，这是知识能留下的最大复利。' },
      { name: '成为行业公认的思想领袖', emoji: '🌟', desc: '让“某某领域先问谁”的答案里，出现你的名字。' },
      { name: '创造一种新的思维框架', emoji: '🧠', desc: '给后人一套比“努力”更准确的语言，让他们少绕三十年弯路。' }
    ]
  },
  {
    category: 'experience',
    items: [
      { name: '看一场山顶日出', emoji: '🌄', desc: '在天没亮时登上山顶，让第一缕阳光把上一周的疲惫清空。' },
      { name: '泡一次雪地温泉', emoji: '♨️', desc: '把身体沉进热水，抬头看雪落下来，整个人重新变轻。' },
      { name: '在雨林里徒步一天', emoji: '🌿', desc: '让树根和鸟叫盖过工作消息，找回毛孔都在呼吸的感觉。' },
      { name: '坐一次凌晨的渡轮', emoji: '🚢', desc: '在别人沉睡时看城市灯光漂过海面，获得一整夜的绝对自由。' },
      { name: '看一场livehouse演出', emoji: '🎸', desc: '站进人群里跟着鼓点跳，把积压的情绪一次性唱出去。' },
      { name: '住进森林木屋过周末', emoji: '🌲', desc: '在木屋里关掉所有提醒，只按太阳和鸟叫决定起床。' },
      { name: '参加一次即兴戏剧', emoji: '🎭', desc: '在没有剧本的舞台上胡说八道，你会发现自己比想象中敢表达。' },
      { name: '完成一次深潜看珊瑚', emoji: '🤿', desc: '下潜到蓝色深处，让海龟和鱼群教你什么叫真正的不慌。' },
      { name: '坐热气球看日出', emoji: '🎈', desc: '在安静漂浮的吊篮里看大地醒来，像给自己按了刷新键。' },
      { name: '骑摩托穿越海岸线', emoji: '🏍️', desc: '沿着风的方向骑一整天，把工作群和日程表都甩在身后。' },
      { name: '在无人沙滩露营一夜', emoji: '🏖️', desc: '睡在浪声里醒来，退潮后捡到属于自己的一枚贝壳。' },
      { name: '看一次极光大爆发', emoji: '💚', desc: '当绿色光带在天上流动，你会把那些小到不值得提的烦恼全部放下。' },
      { name: '登一次海拔5000米雪山', emoji: '🏔️', desc: '站在云海之上看日照金山，原来你比自己以为的更抗压。' },
      { name: '在异国小镇住满一个月', emoji: '🌍', desc: '把游客路线走成生活路线，学会像当地人一样认真买菜做饭。' },
      { name: '完成一次环球公路旅行', emoji: '🚗', desc: '用一个月把地图上的远方变成后视镜里的风景，人生版图从此不一样。' },
      { name: '在南极冰川上露营一夜', emoji: '🧊', desc: '在最安静的大陆醒来，听冰川呼吸，你会重新定义什么是孤独与自由。' },
      { name: '跳伞穿越云层', emoji: '🪂', desc: '从一万英尺跃出，在自由落体里把“我不敢”三个字摔碎。' },
      { name: '在撒哈拉星空下过夜', emoji: '🌌', desc: '躺在无光污染的沙丘上，让银河成为你这一夜唯一的屋顶。' },
      { name: '完成一次帆船环球航行', emoji: '⛵', desc: '靠风和海图穿越三大洋，回来后你会知道世界没有想象中远。' },
      { name: '完成一次8000米雪山挑战', emoji: '🏔️', desc: '把身体的极限和意志的边界同时推高，此后大多数困难都显得小一号。' }
    ]
  },
  {
    category: 'career',
    items: [
      { name: '完成一次高质量述职', emoji: '🎯', desc: '把这一年的成果讲成清晰战绩，让老板没法再用一句辛苦了打发你。' },
      { name: '更新一份杀手级简历', emoji: '📄', desc: '把经历写成能力证据，机会来临时你随时可以上桌。' },
      { name: '建立个人作品集', emoji: '💼', desc: '让作品替你说话，而不是靠自我介绍证明你做过什么。' },
      { name: '参加一次行业展会', emoji: '📍', desc: '一天看完全行业新品，回来你就知道下一步该往哪走。' },
      { name: '拿下一次主动加薪谈判', emoji: '💬', desc: '把你创造的价值明码标价，谈完后你会发现胆量也有复利。' },
      { name: '完成一个跨部门重点项目', emoji: '🧩', desc: '让关键人物看见你既能扛事，也能把复杂协作盘活。' },
      { name: '建立行业人脉档案', emoji: '📇', desc: '把认识的人按领域和信任度整理好，机会会更快找到你。' },
      { name: '成为团队内部讲师', emoji: '🎤', desc: '把一个方法讲明白，你的影响力和话语权会自动上升。' },
      { name: '做出一个百万营收的产品线', emoji: '📈', desc: '让市场为你的判断买单，这是最硬核的职场安全垫。' },
      { name: '完成一次成功的商业路演', emoji: '💡', desc: '在五分钟内让投资人记住你的项目，也记住你的名字。' },
      { name: '升职部门负责人', emoji: '👔', desc: '把“我能执行”升级成“我能负责”，让团队因你而更稳。' },
      { name: '创立一间小型工作室', emoji: '🏢', desc: '从第一单开始建立自己的招牌，不再只把时间卖给公司。' },
      { name: '拿下一个行业标杆客户', emoji: '🤝', desc: '用一页提案打动最难搞的客户，这个案例会成为你的活名片。' },
      { name: '完成一次公司级战略转型', emoji: '🧭', desc: '在关键转折点给出方向，让大家知道你不只是执行者。' },
      { name: '出版一本行业实战指南', emoji: '📕', desc: '把踩坑经验整理成工具书，让同行因为你的方法少走弯路。' },
      { name: '成为公司合伙人', emoji: '🧬', desc: '从打工者变成拥有者，让公司的增长和你的人生直接绑定。' },
      { name: '创办一家年营收千万的公司', emoji: '🏗️', desc: '从第一个客户做到稳定现金流，证明你能把想法变成现实。' },
      { name: '打造一个行业新品类', emoji: '🚀', desc: '让“以前没有，现在有了”成为你的商业注脚。' },
      { name: '完成一次成功IPO', emoji: '🏦', desc: '把团队、产品和资本拧成一股力量，让公司进入下一阶段。' },
      { name: '建立一家影响千万人的企业', emoji: '🌍', desc: '让产品成为千万人生活的一部分，这是事业能写下的最大名字。' }
    ]
  },
  {
    category: 'family',
    items: [
      { name: '给父母做一顿家常饭', emoji: '🍳', desc: '把“以后再说”换成今晚的一桌热菜，父母会记很久。' },
      { name: '陪孩子搭一次完整积木', emoji: '🧱', desc: '放下手机蹲下来，让孩子记住你认真陪他完成一件事的样子。' },
      { name: '给爱人写一张手写卡片', emoji: '💌', desc: '把不好意思说出口的感谢写下来，比转账更让对方心动。' },
      { name: '和家人看一场老照片展', emoji: '📷', desc: '一起翻旧照片，你会重新看见家庭里那些被时间藏起来的爱。' },
      { name: '带父母体检一次', emoji: '🩺', desc: '用半天听完医生的每句话，比任何补品都更让父母安心。' },
      { name: '组织一次家庭运动会', emoji: '🏅', desc: '把客厅变成赛场，让全家人的笑声成为这个周末的背景音。' },
      { name: '陪孩子完成一次科学实验', emoji: '🧪', desc: '和孩子一起见证实验成功，他会记住你眼里的骄傲。' },
      { name: '给父母补办一次结婚纪念日', emoji: '💍', desc: '让他们年轻时没来得及的仪式感，在今天一次补足。' },
      { name: '写一本给孩子的手写信集', emoji: '💌', desc: '把成长里说不出口的期待写下来，成为他以后最珍贵的底气。' },
      { name: '带全家做一次长途自驾', emoji: '🚙', desc: '把服务区和加油站变成故事现场，让全家拥有同一段记忆。' },
      { name: '陪父母完成一次年轻时的心愿', emoji: '🎁', desc: '问出他们一直想做却没做的事，然后陪他们一起去完成。' },
      { name: '给孩子办一场用心策划的生日会', emoji: '🎂', desc: '不是买礼物，而是让他的朋友和家人一起见证他长大一岁。' },
      { name: '为家族做一份完整家谱', emoji: '📜', desc: '把名字、故事和照片串起来，让后代知道他们从哪里来。' },
      { name: '全家一起去一次国外旅行', emoji: '✈️', desc: '在陌生城市里重新认识彼此，让家人不再只是饭桌前的熟悉。' },
      { name: '把老房子改造成全家人想回的家', emoji: '🏡', desc: '修好漏雨的角落和坏掉的灯，让“回家”成为最舒服的动词。' },
      { name: '让父母住进梦想中的房子', emoji: '🏠', desc: '把他们的名字写进房产证，也把晚年的安全感写进现实。' },
      { name: '给孩子准备一笔终身教育基金', emoji: '🎓', desc: '让他的选择不被学费绑架，这是你能给的最长久的自由。' },
      { name: '建立自己的家族信托', emoji: '🏦', desc: '把财富和爱按照你的方式传承，让家业不再只有一套糊涂账。' },
      { name: '陪父母环游世界', emoji: '🌍', desc: '在他们还能走得动的时候，把七大洲的日出都看一遍。' },
      { name: '打造一份传三代的家族记忆馆', emoji: '🏛️', desc: '把全家最重要的故事、物件和价值观永久保存，让家族有了根。' }
    ]
  },
  {
    category: 'social',
    items: [
      { name: '组一次久违的老友局', emoji: '🍻', desc: '把“下次一定”变成今晚，让老朋友重新走进你的真实生活。' },
      { name: '给一位朋友写封真诚的长信', emoji: '✉️', desc: '把感谢和想念写具体，收到的人会知道自己被真正在意。' },
      { name: '参加一次陌生人饭局', emoji: '🍜', desc: '和不同职业的人同桌吃饭，你会收到很多生活之外的活法。' },
      { name: '给多年未联系的朋友发条语音', emoji: '📲', desc: '先开口不一定输，可能只是让一段关系从“已读”重新活过来。' },
      { name: '请同事吃一顿感谢饭', emoji: '🍱', desc: '把心里记着的帮助说出口，职场关系会从此更结实。' },
      { name: '组织一场主题读书会', emoji: '📚', desc: '让一群认真的人聚在一起，你会被他们的表达重新点亮。' },
      { name: '认识一位跨行业新朋友', emoji: '🤝', desc: '约一次咖啡，交换两个行业的内幕，视野会立刻变宽。' },
      { name: '帮朋友完成一次重要搬家', emoji: '📦', desc: '在对方最需要的时候出现，比一万句“有事找我”更有分量。' },
      { name: '加入一个高质量兴趣社群', emoji: '🎨', desc: '找到一群和你有相同热爱的人，周末不再是刷手机度日。' },
      { name: '为朋友牵线一次事业合作', emoji: '🧩', desc: '把对的人介绍给对的人，你会成为圈子里真正的连接者。' },
      { name: '和20年没见的朋友和解', emoji: '🤗', desc: '先约那顿饭，把遗憾变成面对面说开的故事。' },
      { name: '结识一位忘年交', emoji: '☕', desc: '让比你多活几十年的人告诉你，哪些焦虑根本不值得带走。' },
      { name: '组建一个长期互助小组', emoji: '🛡️', desc: '让一群愿意托底的人定期见面，困难会变小，机会会变多。' },
      { name: '办一场让朋友记住的生日聚会', emoji: '🎉', desc: '把场景、音乐和惊喜都设计好，让每个人觉得自己被认真款待。' },
      { name: '成为城市里小有名气的组织者', emoji: '🗺️', desc: '当你能把陌生人聚在一起，你的人脉就不再只是通讯录。' },
      { name: '找到人生合伙人', emoji: '🧲', desc: '找一个愿意和你互相托底的人，让创业和人生都少走十年弯路。' },
      { name: '建立100人高质量人脉圈', emoji: '🌐', desc: '让每个领域都有人愿意为你说话，机会自然会优先找到你。' },
      { name: '发起一个城市级公益项目', emoji: '❤️', desc: '让一百个陌生人的善意汇聚成可见的改变，你的名字会和他们连在一起。' },
      { name: '举办一场千人行业聚会', emoji: '🎪', desc: '把最有价值的人请到同一个会场，你会成为连接他们的关键节点。' },
      { name: '创造一个影响一代人的社群', emoji: '🏛️', desc: '让无数人在其中找到归属和机会，这是社交能留下的最大遗产。' }
    ]
  },
  {
    category: 'health',
    items: [
      { name: '连续一周早睡一小时', emoji: '😴', desc: '先把晚睡扳回一局，你会发现白天清醒得像是换了个人。' },
      { name: '每天走满一万步', emoji: '👟', desc: '把通勤和饭后散步变成游戏，一周后腰背先给你反馈。' },
      { name: '完成一次晨间拉伸', emoji: '🧘', desc: '用十分钟把僵硬的肩颈唤醒，让一天从舒展开始。' },
      { name: '戒掉睡前三小时看手机', emoji: '📵', desc: '把屏幕留在客厅，你会重新拥有沾枕头就睡的能力。' },
      { name: '学会一份低糖健康餐', emoji: '🥗', desc: '把外卖换成自己会做的三菜一汤，身体会记住这份照顾。' },
      { name: '跑完人生第一个5公里', emoji: '🏃', desc: '从喘不过气到轻松跑完，你会重新相信坚持真有用。' },
      { name: '完成21天冥想打卡', emoji: '🧘‍♂️', desc: '每天留十分钟给大脑关机，焦虑会从后台程序变成小噪音。' },
      { name: '掌握一套无痛颈椎操', emoji: '🦴', desc: '每天三分钟，让僵硬和偏头痛不再是加班标配。' },
      { name: '完成一次全面深度体检', emoji: '🩺', desc: '把身体账单提前看清楚，比等出问题再后悔划算一百倍。' },
      { name: '学会自己做营养早餐', emoji: '🍳', desc: '用十分钟做一顿好看又顶饱的早餐，起床都会更有动力。' },
      { name: '跑完人生第一个半马', emoji: '🏅', desc: '用三个月把体能练到能跑21公里，完成时你会重新定义自己。' },
      { name: '减到理想体重并保持一年', emoji: '⚖️', desc: '不是为了照片，是为了穿衣服好看、爬楼不喘、体检单干净。' },
      { name: '完成一次7天轻断食实验', emoji: '🥦', desc: '在专业指导下感受身体的饥饿和满足，重新掌握食欲的主权。' },
      { name: '一年无痛颈椎', emoji: '✅', desc: '让低头族的职业病停在今天，抬头看世界的姿态会更轻松。' },
      { name: '练出稳定核心力量', emoji: '💪', desc: '让腰腹成为身体的稳定器，久坐、搬重物都不再是隐患。' },
      { name: '跑完人生第一个全程马拉松', emoji: '🏁', desc: '从42.195公里的崩溃和坚持里走出来，你会得到一套新的活法。' },
      { name: '完成一次铁人三项', emoji: '🏊', desc: '游泳、骑车、跑步全部通关，身体和意志会被一起升级。' },
      { name: '拥有运动员级别的体能', emoji: '🏋️', desc: '让体能测试不是负担，而是你随时拿得出手的硬实力。' },
      { name: '活到80岁还能爬五岳', emoji: '⛰️', desc: '把健康存成晚年自由，让六十岁后的你还有说走就走的体力。' },
      { name: '让全家族拥有健康生活方式', emoji: '🏡', desc: '你不仅自己健康，还让父母、伴侣和孩子都把运动当成日常。' }
    ]
  },
  {
    category: 'fun',
    items: [
      { name: '通关一款3A大作', emoji: '🎮', desc: '用三个周末当一次英雄，回到现实也会带一点主角感。' },
      { name: '看一场午夜首映', emoji: '🎬', desc: '和全场陌生人一起为同一个镜头屏住呼吸，快乐会被放大十倍。' },
      { name: '买一盒拼图慢慢拼完', emoji: '🧩', desc: '把周末还给一张桌子，拼完后你会获得久违的专注快感。' },
      { name: '唱一次通宵KTV', emoji: '🎤', desc: '把积压的歌单唱完，嗓子哑了但心会变轻。' },
      { name: '做一次超治愈甜品', emoji: '🍰', desc: '从称糖到出炉，让奶油香气把你从工作里完整救出来。' },
      { name: '参加一次桌游马拉松', emoji: '🎲', desc: '和一桌朋友从下午玩到深夜，笑到脸酸的那种快乐很难复制。' },
      { name: '包场看一场老电影', emoji: '🎞️', desc: '把最喜欢的片子放到大银幕，让经典第一次真正属于你。' },
      { name: '去迪士尼玩到闭园', emoji: '🏰', desc: '把排队和尖叫都变成回忆，回到现实后仍能甜三天。' },
      { name: '学打鼓并组一支乐队', emoji: '🥁', desc: '每周和队友合奏一次，让情绪有鼓点替你出口。' },
      { name: '完成一次游轮旅行', emoji: '🛳️', desc: '在甲板上看日落，把工作和网络一起留在岸上。' },
      { name: '在演唱会第一排合唱', emoji: '🎸', desc: '离偶像不到十米，和全场一起合唱，你会哭也会笑。' },
      { name: '包场KTV请朋友们嗨一晚', emoji: '🎉', desc: '让所有人都唱到最想唱的歌，你会成为他们心里会玩的记忆。' },
      { name: '环球影城所有项目全通', emoji: '🎢', desc: '从开园玩到闭园，把童年欠下的尖叫一次还清。' },
      { name: '看一次世界杯现场', emoji: '⚽', desc: '和几万人一起呐喊进球，你会理解体育为什么让人疯狂。' },
      { name: '自驾川西看贡嘎', emoji: '🚙', desc: '把工作群留在平原，让雪山和云海替你按一次人生暂停键。' },
      { name: '在顶级音乐节压轴夜前排', emoji: '🎵', desc: '在万人中央跟着节奏跳到天亮，年轻感会重新回到身体里。' },
      { name: '拥有一间私人游戏房', emoji: '🎮', desc: '把最好的屏幕、主机和椅子配齐，随时进入只属于自己的世界。' },
      { name: '包一艘游艇开海上派对', emoji: '🛥️', desc: '把音乐、好友和海风装进同一艘船，让朋友圈拍不到你百分之一的快乐。' },
      { name: '看一场总决赛现场夺冠战', emoji: '🏆', desc: '见证球队在最后一秒翻盘，那种热泪盈眶值得记一辈子。' },
      { name: '打造自己的主题乐园体验', emoji: '🎠', desc: '把你想玩的过山车、演出和餐厅都组合在一起，成为一次私人限定狂欢。' }
    ]
  },
  {
    category: 'consume',
    items: [
      { name: '买一杯精品手冲咖啡', emoji: '☕', desc: '让豆子的香气在早上叫醒你，比灌下一杯速溶更像生活。' },
      { name: '换一套舒服的睡衣', emoji: '🛏️', desc: '把一天最放松的时刻也照顾好，睡眠质量会悄悄提升。' },
      { name: '买一束鲜花放家里', emoji: '💐', desc: '让客厅有一处会凋谢但值得珍惜的美，心情会立刻换季。' },
      { name: '添一件百搭质感白衬衫', emoji: '👔', desc: '基础款也能穿出高级感，衣柜里终于有件不用想就好看的衣服。' },
      { name: '买一台降噪耳机', emoji: '🎧', desc: '把地铁、咖啡厅和办公室的噪音关掉，还你一整天的专注。' },
      { name: '换一台旗舰手机', emoji: '📱', desc: '让每天用八小时的工具配得上你的效率，流畅感会提升幸福感。' },
      { name: '买一张舒服的人体工学椅', emoji: '💺', desc: '每天坐八小时的椅子值得投资，腰背会感谢你。' },
      { name: '吃一次米其林一星', emoji: '🍽️', desc: '用一顿饭的价格买一段精致记忆，不是奢侈，是纪念。' },
      { name: '入手一只经典腕表', emoji: '⌚', desc: '抬手看见的不只是时间，还有你为自己赢来的质感。' },
      { name: '买一台高性能电脑', emoji: '💻', desc: '让剪辑、游戏和创作都不再卡顿，效率就是省下来的命。' },
      { name: '买一只轻奢包', emoji: '👛', desc: '它不定义你，但会提醒你：值得为喜欢的细节认真赚钱。' },
      { name: '升级一次头等舱旅行', emoji: '✈️', desc: '把赶路的疲惫换成一次从容，旅程从登机那一刻就开始。' },
      { name: '买一台顶级相机', emoji: '📷', desc: '让每次旅行都拍出能挂进相框的画面，记忆从此有高清版本。' },
      { name: '拥有一套高级香氛系列', emoji: '🕯️', desc: '让家里每个房间都有自己的味道，回到家的瞬间就开始放松。' },
      { name: '换一辆心仪的新车', emoji: '🚗', desc: '把通勤变成驾驶享受，上车那刻你会觉得努力都有回应。' },
      { name: '买下梦中公寓', emoji: '🏙️', desc: '给自己一个想加班就加班、想赖床就赖床的绝对主权。' },
      { name: '拥有一次私人定制旅行', emoji: '🗺️', desc: '路线、酒店和节奏都按你的想象安排，旅行从此没有将就。' },
      { name: '买下全套顶级家庭影院', emoji: '🎬', desc: '把电影院搬回家，每一个爆米花之夜都值得期待。' },
      { name: '拥有一只收藏级艺术品', emoji: '🖼️', desc: '把喜欢的美留在墙上，它会陪你和家人度过很多安静时刻。' },
      { name: '把全家账单一次清零', emoji: '🧾', desc: '放下悬在头顶的债，才能真正决定钱和时间往哪里去。' }
    ]
  }
];

export function buildProductDatabase(templates) {
  const db = [];
  templates.forEach(function (category) {
    category.items.forEach(function (item, index) {
      const gradeIndex = Math.floor(index / 5);
      const grade = GRADE_META[gradeIndex];
      const step = index % 5;
      const serial = index + 1 < 10 ? '0' + (index + 1) : String(index + 1);
      db.push({
        id: category.category + '-' + serial,
        category: category.category,
        name: item.name,
        emoji: item.emoji,
        baseCost: grade.prices[step],
        desc: item.desc,
        gradeKey: grade.key,
        grade: grade.name,
        unlockType: grade.unlockType,
        unlockThreshold: grade.unlockThreshold,
        unlockDesc: grade.unlockDesc
      });
    });
  });
  return db;
}

export const PRODUCT_DB = buildProductDatabase(PRODUCT_TEMPLATES);

// ==================== 2. UI渲染 ====================

// P1-1：id / 分类预建索引，避免每帧渲染对 160 件商品做 O(n) find/filter。
const _productById = Object.create(null);
const _productsByCategory = Object.create(null);
PRODUCT_DB.forEach(function (product) {
  _productById[product.id] = product;
  if (!_productsByCategory[product.category]) {
    _productsByCategory[product.category] = [];
  }
  _productsByCategory[product.category].push(product);
});

export function getProductById(id) {
  return _productById[id] || null;
}

export function getProductsByCategory(categoryId) {
  return _productsByCategory[categoryId] || [];
}
