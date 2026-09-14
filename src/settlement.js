// Module: settlement.js
// Split from the original game.js during module refactor.
import { CATEGORY_META, FEEDBACK_URL, GAME_CONFIG, UI_COLORS } from './config.js';
import { getProductById } from './db.js';
import { GAME_STATE, UI_STATE, getGlobalStats } from './state.js';
import { calculateRoundWealth, drawGlassPanel, drawRoundRectPath, drawText, getTT, hexToRgba, isPointInRect, splitTextToLines } from './utils.js';
import { t } from './i18n.js';
import { drawBackground, drawLeaderboardModal, drawShopModal } from './ui.js';
// 分享管线已迁至 share.js（叶子模块）。此处再导出以保持既有调用方（含测试）零改动。
export { exportCanvasAndShare, showShareToast } from './share.js';

export function getSettlementLayout() {
  const w = UI_STATE.screenWidth;
  const h = UI_STATE.screenHeight;
  const margin = 12;
  const gap = 10;
  const summaryH = 132;
  const titleY = 28;
  const buttonsH = 50;
  const rowGap = 10;

  const row1W = (w - margin * 2 - gap) / 2;
  const shareX = margin;
  const shareW = row1W;
  const replayX = margin + row1W + gap;
  const replayW = row1W;
  const threeW = (w - margin * 2 - gap * 2) / 3;

  const totalButtonsH = buttonsH * 2 + rowGap;
  const buttonsY = h - totalButtonsH - 28;

  // 人生清单横幅：仅当本局有新达成时占位（情感峰值时刻的收集钩子）。
  const newLifeCount = GAME_STATE && Array.isArray(GAME_STATE.newLifeIds)
    ? GAME_STATE.newLifeIds.length
    : 0;
  const bannerH = newLifeCount > 0 ? 46 : 0;

  const summary = { x: margin, y: titleY + 34, w: w - margin * 2, h: summaryH };
  const rp = { x: margin, y: summary.y + summary.h + gap, w: w - margin * 2, h: 64 };
  const bannerY = rp.y + rp.h + gap;
  const banner = { x: margin, y: bannerY, w: w - margin * 2, h: Math.max(0, bannerH - gap) };
  const barsY = bannerY + bannerH;
  const bars = { x: margin, y: barsY, w: w - margin * 2, h: buttonsY - gap - barsY };

  return {
    summary: summary,
    rp: rp,
    banner: banner,
    bannerActive: newLifeCount > 0,
    bars: bars,
    shareX: shareX,
    shareY: buttonsY,
    shareW: shareW,
    replayX: replayX,
    replayY: buttonsY,
    replayW: replayW,
    restartX: margin,
    restartY: buttonsY + buttonsH + rowGap,
    restartW: threeW,
    leaderboardX: margin + threeW + gap,
    leaderboardY: buttonsY + buttonsH + rowGap,
    leaderboardW: threeW,
    feedbackX: margin + (threeW + gap) * 2,
    feedbackY: buttonsY + buttonsH + rowGap,
    feedbackW: threeW,
    buttonH: buttonsH,
    buttonsY: buttonsY
  };
}

export function openFeedbackSurvey() {
  const ttApi = getTT();
  if (ttApi && ttApi.openUrl) {
    ttApi.openUrl({
      url: FEEDBACK_URL,
      fail: function () {
        if (ttApi.showToast) {
          ttApi.showToast({ title: t('settle.surveyFail'), icon: 'none' });
        }
      }
    });
  } else if (typeof console !== 'undefined') {
    console.log('feedback:' + FEEDBACK_URL);
  }
}

export function drawSettlementScreen(ctx) {
  const layout = getSettlementLayout();
  drawBackground(ctx, Date.now());
  drawText(ctx, t('settle.title'), 12, 28, 'bold 22px sans-serif', UI_COLORS.goldLight);

  const settlement = generateSettlementSummary(GAME_STATE);
  drawGlassPanel(ctx, layout.summary.x, layout.summary.y, layout.summary.w, layout.summary.h, 24);
  drawText(ctx, t('settle.summary'), layout.summary.x + 16, layout.summary.y + 12, 'bold 12px sans-serif', UI_COLORS.gold);
  if (settlement.aiGenerated) {
    drawText(ctx, t('settle.aiTag'), layout.summary.x + layout.summary.w - 16, layout.summary.y + 12, '10px sans-serif', '#7D9CFF', 'right');
  } else if (settlement.aiLoading) {
    drawText(ctx, t('settle.aiPending'), layout.summary.x + layout.summary.w - 16, layout.summary.y + 12, '10px sans-serif', UI_COLORS.muted, 'right');
  } else {
    drawText(ctx, t('settle.tplTag'), layout.summary.x + layout.summary.w - 16, layout.summary.y + 12, '10px sans-serif', UI_COLORS.muted, 'right');
  }
  drawText(
    ctx,
    '“' + settlement.summaryText + '”',
    layout.summary.x + 16,
    layout.summary.y + 38,
    'bold 16px sans-serif',
    settlement.aiGenerated ? '#A7C4FF' : UI_COLORS.text,
    'left',
    layout.summary.w - 32,
    4
  );
  drawText(
    ctx,
    t('settle.aiNote'),
    layout.summary.x + layout.summary.w / 2,
    layout.summary.y + layout.summary.h - 16,
    '9px sans-serif',
    UI_COLORS.muted,
    'center',
    layout.summary.w - 20,
    1
  );

  const global = getGlobalStats();
  const goldSkin = global.shopItems && global.shopItems.skin === 'gold';
  if (goldSkin) {
    ctx.save();
    ctx.shadowColor = 'rgba(233,196,106,0.55)';
    ctx.shadowBlur = 26;
    ctx.strokeStyle = UI_COLORS.gold;
    ctx.lineWidth = 2.5;
    drawRoundRectPath(ctx, layout.summary.x, layout.summary.y, layout.summary.w, layout.summary.h, 24);
    ctx.stroke();
    ctx.restore();
  }

  const roundRP = GAME_STATE.roundRP || { baseRP: 100, achievementRP: 0, totalRP: 100 };
  drawGlassPanel(ctx, layout.rp.x, layout.rp.y, layout.rp.w, layout.rp.h, 20);
  drawText(ctx, t('settle.rp'), layout.rp.x + 14, layout.rp.y + 10, 'bold 13px sans-serif', UI_COLORS.gold);
  drawText(
    ctx,
    t('settle.rpLine', { a: roundRP.achievementRP, t: roundRP.totalRP }),
    layout.rp.x + 14,
    layout.rp.y + 32,
    '10px sans-serif',
    UI_COLORS.text,
    'left',
    layout.rp.w - 110,
    2
  );
  drawText(
    ctx,
    t('settle.rpTotal', { n: (global.reincarnationPoints || 0).toLocaleString() }),
    layout.rp.x + 14,
    layout.rp.y + 48,
    '10px sans-serif',
    UI_COLORS.goldLight
  );
  const shopBtnX = layout.rp.x + layout.rp.w - 92;
  const shopBtnY = layout.rp.y + 16;
  drawText(ctx, t('settle.goShop'), shopBtnX + 42, shopBtnY + 10, 'bold 11px sans-serif', UI_COLORS.goldLight, 'center', 80, 1);
  UI_STATE._settlementShopBtn = { x: shopBtnX, y: shopBtnY, w: 84, h: 32 };

  // ---- 人生清单横幅：本局有新达成才出现，点击进入清单页 ----
  if (layout.bannerActive) {
    const ownedCount = Object.keys((getGlobalStats().lifetimeOwned) || {}).length;
    const b = layout.banner;
    ctx.save();
    ctx.fillStyle = 'rgba(159,225,203,0.12)';
    drawRoundRectPath(ctx, b.x, b.y, b.w, b.h, 14);
    ctx.fill();
    ctx.strokeStyle = '#5DCAA5';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    drawText(
      ctx,
      t('settle.newLives', { n: GAME_STATE.newLifeIds.length, c: ownedCount }),
      b.x + 14,
      b.y + 8,
      'bold 13px sans-serif',
      '#9FE1CB',
      'left',
      b.w - 90,
      1
    );
    drawText(ctx, t('settle.viewList'), b.x + b.w - 14, b.y + 8, 'bold 12px sans-serif', UI_COLORS.goldLight, 'right', 80, 1);
    UI_STATE._settlementBannerBtn = { x: b.x, y: b.y, w: b.w, h: b.h };
  } else {
    UI_STATE._settlementBannerBtn = null;
  }

  drawGlassPanel(ctx, layout.bars.x, layout.bars.y, layout.bars.w, layout.bars.h, 20);
  const totalWealth = settlement.totalWealth || GAME_STATE.totalWealth || 0;
  ctx.save();
  ctx.shadowColor = 'rgba(233,196,106,0.55)';
  ctx.shadowBlur = 12;
  drawText(
    ctx,
    t('settle.wealthLine', { n: totalWealth.toLocaleString() }),
    layout.bars.x + 16,
    layout.bars.y + 10,
    'bold 15px sans-serif',
    UI_COLORS.gold,
    'left',
    layout.bars.w - 32,
    1
  );
  ctx.restore();
  drawText(ctx, t('settle.bars'), layout.bars.x + 16, layout.bars.y + 34, 'bold 13px sans-serif', UI_COLORS.text);
  drawText(
    ctx,
    settlement.topCategory ? t('settle.topLabel', { n: settlement.topCategory.name }) : t('settle.none'),
    layout.bars.x + layout.bars.w - 16,
    layout.bars.y + 35,
    '11px sans-serif',
    UI_COLORS.goldLight,
    'right'
  );

  const rowTop = layout.bars.y + 58;
  const rowH = (layout.bars.h - 70) / 8;
  settlement.categoryBars.forEach(function (bar, index) {
    const y = rowTop + index * rowH;
    const labelW = 64;
    drawText(ctx, bar.emoji + ' ' + bar.name, layout.bars.x + 14, y, '11px sans-serif', UI_COLORS.text, 'left', labelW, 1);
    const barX = layout.bars.x + 88;
    const barW = layout.bars.w - 100;
    const trackH = 12;
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    drawRoundRectPath(ctx, barX, y + 2, barW, trackH, trackH / 2);
    ctx.fill();
    if (bar.spent > 0) {
      ctx.fillStyle = hexToRgba(bar.color, 0.95);
      drawRoundRectPath(ctx, barX, y + 2, Math.max(6, barW * bar.ratio), trackH, trackH / 2);
      ctx.fill();
    }
    drawText(
      ctx,
      t('btn.sellDays', { n: Math.floor(bar.spent).toLocaleString() }),
      layout.bars.x + layout.bars.w - 16,
      y,
      'bold 11px sans-serif',
      bar.spent > 0 ? UI_COLORS.goldLight : UI_COLORS.muted,
      'right',
      80,
      1
    );
  });

  const restartPressed = UI_STATE.pressedRestart;
  const sharePressed = UI_STATE.pressedShare;
  const feedbackPressed = UI_STATE.pressedFeedback;

  drawSettlementButton(
    ctx,
    layout.shareX,
    layout.shareY,
    layout.shareW,
    layout.buttonH,
    t('settle.share'),
    sharePressed,
    '#5B8CFF'
  );

  drawSettlementButton(
    ctx,
    layout.replayX,
    layout.replayY,
    layout.replayW,
    layout.buttonH,
    t('settle.replay'),
    UI_STATE.pressedReplay,
    '#5DCAA5'
  );

  drawSettlementButton(
    ctx,
    layout.restartX,
    layout.restartY,
    layout.restartW,
    layout.buttonH,
    t('settle.rebirth'),
    restartPressed,
    UI_COLORS.gold
  );

  drawSettlementButton(
    ctx,
    layout.leaderboardX,
    layout.leaderboardY,
    layout.leaderboardW,
    layout.buttonH,
    t('settle.board'),
    UI_STATE.pressedLeaderboard,
    '#B8860B'
  );

  drawSettlementButton(
    ctx,
    layout.feedbackX,
    layout.feedbackY,
    layout.feedbackW,
    layout.buttonH,
    t('settle.suggest'),
    feedbackPressed,
    '#6A7B8D'
  );

  if (UI_STATE.showShop) {
    drawShopModal(ctx);
  } else if (UI_STATE.showLeaderboard) {
    drawLeaderboardModal(ctx);
  }
}

export function drawSettlementButton(ctx, x, y, w, h, label, pressed, color) {
  ctx.save();
  if (pressed) {
    const centerX = x + w / 2;
    const centerY = y + h / 2;
    ctx.translate(centerX, centerY);
    ctx.scale(0.97, 0.97);
    ctx.translate(-centerX, -centerY);
  }
  ctx.fillStyle = pressed ? hexToRgba(color, 0.30) : hexToRgba(color, 0.16);
  drawRoundRectPath(ctx, x, y, w, h, 18);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  drawText(ctx, label, x + w / 2, y + (h - 16) / 2, 'bold 14px sans-serif', UI_COLORS.text, 'center', w - 12, 1);
  ctx.restore();
}

export function drawShareCardText(ctx, text, x, y, fontSize, color, maxWidth, lineHeight, maxLines) {
  ctx.save();
  ctx.font = 'bold ' + fontSize + 'px sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const lines = splitTextToLines(ctx, String(text), maxWidth);
  const limit = maxLines || lines.length;
  const visible = lines.slice(0, limit);
  if (lines.length > limit && visible.length > 0) {
    visible[visible.length - 1] = visible[visible.length - 1].slice(0, -1) + '…';
  }
  visible.forEach(function (line, index) {
    ctx.fillText(line, x, y + index * lineHeight);
  });
  ctx.restore();
}

export function drawShareCard(ctx, summary, state) {
  const w = 600;
  const h = 900;
  const stats = (summary && summary.stats) || {};

  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, UI_COLORS.bgTop);
  gradient.addColorStop(0.55, '#101B3C');
  gradient.addColorStop(1, UI_COLORS.bgBottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 46; i += 1) {
    const x = (i * 79 + 17) % w;
    const y = (i * 137 + 31) % h;
    const pulse = 0.35 + 0.3 * Math.sin(i * 0.7);
    ctx.fillStyle = 'rgba(220,230,255,' + pulse.toFixed(2) + ')';
    ctx.fillRect(x, y, i % 3 === 0 ? 2 : 1.4, i % 3 === 0 ? 2 : 1.4);
  }

  const goldSkin = getGlobalStats().shopItems && getGlobalStats().shopItems.skin === 'gold';
  ctx.save();
  ctx.strokeStyle = goldSkin ? 'rgba(233,196,106,0.95)' : 'rgba(233,196,106,0.55)';
  ctx.lineWidth = goldSkin ? 5 : 3;
  if (goldSkin) {
    ctx.shadowColor = 'rgba(233,196,106,0.65)';
    ctx.shadowBlur = 34;
  }
  drawRoundRectPath(ctx, 24, 24, w - 48, h - 48, 30);
  ctx.stroke();
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 44px sans-serif';
  ctx.fillStyle = UI_COLORS.goldLight;
  ctx.fillText(t('card.brand'), w / 2, 64);
  ctx.font = '22px sans-serif';
  ctx.fillStyle = UI_COLORS.muted;
  ctx.fillText(t('card.sub'), w / 2, 128);

  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(70, 176);
  ctx.lineTo(530, 176);
  ctx.stroke();

  const summaryPanel = { x: 48, y: 202, w: 504, h: 212 };
  ctx.save();
  ctx.fillStyle = 'rgba(10,16,40,0.72)';
  drawRoundRectPath(ctx, summaryPanel.x, summaryPanel.y, summaryPanel.w, summaryPanel.h, 22);
  ctx.fill();
  ctx.strokeStyle = 'rgba(233,196,106,0.25)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillStyle = UI_COLORS.gold;
  ctx.fillText(t('card.epitaph'), summaryPanel.x + 22, summaryPanel.y + 18);
  drawShareCardText(
    ctx,
    '“' + ((summary && summary.summaryText) || t('card.epitaphDefault')) + '”',
    summaryPanel.x + 22,
    summaryPanel.y + 52,
    28,
    UI_COLORS.text,
    summaryPanel.w - 44,
    38,
    4
  );

  const statBoxes = [
    {
      label: t('card.totalSpent'),
      value: t('day.val', { n: Math.floor(stats.consumedDays || 0).toLocaleString() })
    },
    {
      label: t('card.remaining'),
      value: t('day.val', { n: Math.floor(stats.remainingDays || 0).toLocaleString() })
    },
    {
      label: t('card.owned'),
      value: t('card.ownedVal', { n: state && Array.isArray(state.ownedProductIds) ? state.ownedProductIds.length : 0 })
    }
  ];
  const statBoxW = 150;
  const statBoxH = 96;
  const statBoxGap = 17;
  const statBoxTop = 450;
  statBoxes.forEach(function (box, index) {
    const x = 58 + index * (statBoxW + statBoxGap);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    drawRoundRectPath(ctx, x, statBoxTop, statBoxW, statBoxH, 18);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = UI_COLORS.muted;
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(box.label, x + statBoxW / 2, statBoxTop + 14);
    ctx.fillStyle = UI_COLORS.goldLight;
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText(box.value, x + statBoxW / 2, statBoxTop + 48);
  });

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = UI_COLORS.gold;
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText(t('settle.bars'), 48, 580);

  const bars = (summary && summary.categoryBars) || [];
  const barTop = 628;
  const barH = 16;
  const barGap = 10;
  bars.forEach(function (bar, index) {
    const y = barTop + index * (barH + barGap);
    ctx.fillStyle = UI_COLORS.text;
    ctx.font = '16px sans-serif';
    ctx.fillText(bar.emoji + ' ' + bar.name, 48, y - 2);

    const trackX = 156;
    const trackW = 292;
    const trackH = 12;
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    drawRoundRectPath(ctx, trackX, y, trackW, trackH, trackH / 2);
    ctx.fill();
    if (bar.spent > 0) {
      ctx.fillStyle = hexToRgba(bar.color, 0.95);
      drawRoundRectPath(ctx, trackX, y, Math.max(6, trackW * bar.ratio), trackH, trackH / 2);
      ctx.fill();
    }

    ctx.textAlign = 'right';
    ctx.fillStyle = UI_COLORS.goldLight;
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(t('btn.sellDays', { n: Math.floor(bar.spent).toLocaleString() }), 552, y - 2);
  });

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = UI_COLORS.goldLight;
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(t('card.motto'), w / 2, 852);
  ctx.fillStyle = UI_COLORS.muted;
  ctx.font = '15px sans-serif';
  ctx.fillText(t('card.footer'), w / 2, 874);
}

export function getOrCreateShareCanvas(ttApi, state) {
  let canvas = UI_STATE._shareCanvas;
  if (!canvas && ttApi && ttApi.createCanvas) {
    canvas = ttApi.createCanvas();
  }
  if (!canvas) {
    return null;
  }
  canvas.width = 600;
  canvas.height = 900;
  const ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  const target = state || GAME_STATE;
  drawShareCard(ctx, generateSettlementSummary(target), target);
  UI_STATE._shareCanvas = canvas;
  return canvas;
}

export function generateShareCardAndShare(state) {
  const ttApi = getTT();
  const target = state || GAME_STATE;
  const canvas = getOrCreateShareCanvas(ttApi, target);
  if (!canvas) {
    showShareToast(t('card.shareFail'));
    return false;
  }

  const summary = generateSettlementSummary(target);
  const title = t('card.shareTitle');
  const desc = summary && summary.summaryText
    ? t('card.shareEpitaph', { t: summary.summaryText })
    : t('card.shareDesc');

  return exportCanvasAndShare(ttApi, canvas, {
    title: title,
    desc: desc,
    trackType: 'round_card'
  });
}

export function getSettlementButtonAtPoint(point) {
  const layout = getSettlementLayout();

  // 清单横幅优先于其它按钮（它盖在 bars 上方区域，但两者不重叠，顺序只为语义清晰）。
  const bannerBtn = UI_STATE._settlementBannerBtn;
  if (bannerBtn && isPointInRect(point, bannerBtn)) {
    return 'lifetime';
  }

  const shopBtn = UI_STATE._settlementShopBtn;
  if (shopBtn && isPointInRect(point, shopBtn)) {
    return 'shop';
  }

  if (point.x >= layout.shareX && point.x <= layout.shareX + layout.shareW &&
      point.y >= layout.shareY && point.y <= layout.shareY + layout.buttonH) {
    return 'share';
  }

  if (point.x >= layout.replayX && point.x <= layout.replayX + layout.replayW &&
      point.y >= layout.replayY && point.y <= layout.replayY + layout.buttonH) {
    return 'replay';
  }

  if (point.x >= layout.restartX && point.x <= layout.restartX + layout.restartW &&
      point.y >= layout.restartY && point.y <= layout.restartY + layout.buttonH) {
    return 'restart';
  }

  if (point.x >= layout.leaderboardX && point.x <= layout.leaderboardX + layout.leaderboardW &&
      point.y >= layout.leaderboardY && point.y <= layout.leaderboardY + layout.buttonH) {
    return 'leaderboard';
  }

  if (point.x >= layout.feedbackX && point.x <= layout.feedbackX + layout.feedbackW &&
      point.y >= layout.feedbackY && point.y <= layout.feedbackY + layout.buttonH) {
    return 'feedback';
  }

  return null;
}

export function buildSettlementSummary(state) {
  const safeState = state || GAME_STATE;
  const startDays = safeState.startingDays || GAME_CONFIG.initialDays;
  return {
    consumedDays: Math.max(0, startDays - Math.max(0, safeState.remainingDays)),
    totalSpent: safeState.totalSpent || 0,
    totalWealth: calculateRoundWealth(safeState),
    ownedProducts: (safeState.ownedProductIds || []).length,
    categorySpent: safeState.categorySpent || {},
    purchaseLedger: safeState.purchaseLedger || [],
    phase: safeState.phase || 'settled'
  };
}

const S_TEMPLATES = [
  { text: '你的一生，长在了家庭里。', category: ['family'], minShare: 0.40 },
  { text: '你的人生底盘，是事业。', category: ['career'], minShare: 0.40 },
  { text: '你用钱买了全世界。', category: ['experience', 'consume'], minShare: 0.40 },
  { text: '你把时间炼成了知识。', category: ['cognition'], minShare: 0.40 },
  { text: '你活着，就是为了体验。', category: ['experience'], minShare: 0.35 },
  { text: '你的身体，是你最贵的资产。', category: ['health'], minShare: 0.40 },
  { text: '你买了满屋子的快乐。', category: ['fun'], minShare: 0.40 },
  { text: '你这辈子，都在交朋友。', category: ['social'], minShare: 0.40 },
  { text: '钱流向了你爱的人。', category: ['family', 'social'], minShare: 0.35 },
  { text: '你买下了整个游乐场。', category: ['fun'], minShare: 0.45 }
];

const W_TEMPLATES = [
  { text: '你从未为自己的身体花过一天。', category: ['health'], maxShare: 0.03 },
  { text: '你的世界里，没有留给人。', category: ['family', 'social'], maxShare: 0.03 },
  { text: '你忘了给自己买一点快乐。', category: ['fun'], maxShare: 0.03 },
  { text: '这一生，你几乎没有休息过。', category: ['fun', 'health'], maxShare: 0.05 },
  { text: '你的灵魂，一直饿着。', category: ['cognition'], maxShare: 0.03 },
  { text: '你身边没有一个人。', category: ['social', 'family'], maxShare: 0.03 },
  { text: '你从未为自己活过。', category: ['any'], maxShare: 0.05 },
  { text: '你走得太快，没带感情。', category: ['family', 'social'], maxShare: 0.03 }
];

const G_TEMPLATES = [
  { text: '你想当富豪，却养了一整个家。', from: ['career', 'business'], to: ['family'] },
  { text: '你说要自由，却买了一屋子物质。', from: ['experience'], to: ['consume'] },
  { text: '你想当学霸，却买了一堆快乐。', from: ['cognition'], to: ['fun'] },
  { text: '你说要健康，却买下了全世界。', from: ['health'], to: ['experience', 'consume'] },
  { text: '你想闯世界，却困在了一盏灯下。', from: ['experience'], to: ['family'] },
  { text: '你说要顾家，钱却都给了远方。', from: ['family'], to: ['career', 'experience'] },
  { text: '你想做自己，却活成了别人。', from: ['any'], to: ['any'] },
  { text: '你喊着要躺平，却买出了满身野心。', from: ['balanced'], to: ['career', 'consume'] }
];

const E_TEMPLATES = [
  { text: '你的账单，比你的嘴巴诚实。', style: '反思' },
  { text: '时间买得到一切，买不到如果。', style: '反思' },
  { text: '这一生，你活成了自己想要的样子。', style: '温暖' },
  { text: '人间值得，你也值得。', style: '温暖' },
  { text: '别再问时间去哪了，看账单。', style: '犀利' },
  { text: '你的人生，和你嘴上说的不一样。', style: '犀利' },
  { text: '下辈子还这么活？没人拦你。', style: '幽默' },
  { text: '专家说这样不好，但快乐是真的。', style: '幽默' },
  { text: '你买下了一座孤岛，风景不错。', style: '专属' },
  { text: '自由很贵，你付了全价。', style: '专属' }
];

export const SUMMARY_PATTERN_POOL = []
  .concat(S_TEMPLATES.map(function (t) {
    return { style: '洞察', template: t.text, layer: 'S' };
  }))
  .concat(W_TEMPLATES.map(function (t) {
    return { style: '反思', template: t.text, layer: 'W' };
  }))
  .concat(G_TEMPLATES.map(function (t) {
    return { style: '反差', template: t.text, layer: 'G' };
  }))
  .concat(E_TEMPLATES.map(function (t) {
    return { style: t.style, template: t.text, layer: 'E' };
  }))
  .concat([
    { style: '彩蛋', template: '你活过了，而且活得很全。', layer: 'Easter' },
    { style: '彩蛋', template: '你一分都没留给遗憾。', layer: 'Easter' },
    { style: '彩蛋', template: '你的人生，全是顶配。', layer: 'Easter' },
    { style: '彩蛋', template: '你买得起一切，却偏爱小东西。', layer: 'Easter' },
    { style: '彩蛋', template: '你这辈子，只干了一件事。', layer: 'Easter' },
    { style: '彩蛋', template: '你犹豫了很久，但下手够狠。', layer: 'Easter' },
    { style: '彩蛋', template: '第七次了，你还没活够。', layer: 'Easter' },
    { style: '彩蛋', template: '2026，你在这儿。', layer: 'Easter' }
  ]);

export function hashString(value) {
  const text = String(value || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 100000;
  }
  return hash;
}

export function fillSummaryPattern(template, data) {
  return template.replace(/\{(\w+)\}/g, function (match, key) {
    const value = data[key];
    return value === undefined ? match : String(value);
  });
}

export function getSettlementCategoryStats(state) {
  const categorySpent = state.categorySpent || {};
  const ledger = state.purchaseLedger || [];
  const categoryCount = {};
  ledger.forEach(function (entry) {
    categoryCount[entry.category] = (categoryCount[entry.category] || 0) + 1;
  });
  const bars = CATEGORY_META.map(function (meta) {
    return {
      id: meta.id,
      name: meta.name,
      emoji: meta.emoji,
      color: meta.color,
      spent: categorySpent[meta.id] || 0,
      count: categoryCount[meta.id] || 0
    };
  });
  bars.sort(function (a, b) {
    return b.spent - a.spent || b.count - a.count;
  });
  const maxSpent = Math.max(1, bars[0].spent);
  bars.forEach(function (bar) {
    bar.ratio = bar.spent / maxSpent;
  });
  return bars;
}

export function getTopCategoryProduct(state, categoryId) {
  const ledger = (state.purchaseLedger || []).filter(function (entry) {
    return entry.category === categoryId;
  });
  if (ledger.length === 0) {
    return null;
  }
  ledger.sort(function (a, b) {
    return b.price - a.price;
  });
  return getProductById(ledger[0].productId);
}

function getPlayerPositioning(state) {
  const buff = state && state.activeBuff;
  const map = {
    rich: 'consume',
    scholar: 'cognition',
    fitness: 'health',
    socialite: 'social',
    artist: 'fun',
    business: 'career',
    adventurer: 'experience',
    family: 'family',
    chosen: 'balanced',
    underdog: 'balanced'
  };
  return (buff && map[buff.id]) || 'balanced';
}

function findEasterEgg(state, global) {
  const ledger = state.purchaseLedger || [];
  const maxPrice = ledger.reduce(function (acc, entry) {
    return Math.max(acc, entry.price || 0);
  }, 0);
  const startDays = state.startingDays || GAME_CONFIG.initialDays;
  const consumed = Math.max(0, startDays - Math.max(0, state.remainingDays || 0));
  const totalSpent = state.totalSpent || 0;
  const naturalLost = Math.max(0, consumed - totalSpent);
  const naturalRatio = consumed > 0 ? naturalLost / consumed : 0;
  const counts = state.categoryPurchaseCount || {};
  const allFull = CATEGORY_META.every(function (category) {
    return (counts[category.id] || 0) >= 5;
  });
  const owned = (state.ownedProductIds || []).map(function (id) {
    return getProductById(id);
  }).filter(Boolean);
  const legendCount = owned.filter(function (product) {
    return product.gradeKey === 'legend';
  }).length;
  const normalCount = owned.filter(function (product) {
    return product.gradeKey === 'normal';
  }).length;
  const nonZeroCategories = Object.keys(counts).filter(function (key) {
    return counts[key] > 0;
  }).length;
  const eggs = [
    { text: '你活过了，而且活得很全。', check: allFull },
    { text: '你一分都没留给遗憾。', check: totalSpent >= 28000 },
    { text: '你的人生，全是顶配。', check: legendCount >= 3 },
    { text: '你买得起一切，却偏爱小东西。', check: normalCount >= 20 },
    { text: '你这辈子，只干了一件事。', check: nonZeroCategories === 1 },
    { text: '你犹豫了很久，但下手够狠。', check: maxPrice >= 2000 && naturalRatio >= 0.4 },
    { text: '第七次了，你还没活够。', check: (global.totalPlayCount || 0) === 7 },
    { text: '2026，你在这儿。', check: totalSpent === 2026 }
  ];
  for (let i = 0; i < eggs.length; i += 1) {
    if (eggs[i].check) {
      return eggs[i].text;
    }
  }
  return null;
}

function generateSmartComment(state, global, topCategory, lowCategory, topShare, lowShare) {
  const egg = findEasterEgg(state, global);
  if (egg) {
    return { text: egg, style: '彩蛋' };
  }

  const candidates = [];
  let bestS = null;
  let bestSScore = -1;
  S_TEMPLATES.forEach(function (template) {
    if (template.category.indexOf(topCategory.id) >= 0 && topShare >= template.minShare) {
      const base = topShare >= 0.40 ? 80 : 60;
      const coefficient = topShare >= 0.50 ? 1.2 : 1;
      const score = base * coefficient;
      if (score > bestSScore) {
        bestSScore = score;
        bestS = template;
      }
    }
  });
  if (bestS) {
    candidates.push({ score: bestSScore, template: bestS, layer: 'S', style: '洞察' });
  }

  let bestW = null;
  let bestWScore = -1;
  W_TEMPLATES.forEach(function (template) {
    const categoryMatched = template.category.indexOf('any') >= 0 ||
      template.category.indexOf(lowCategory.id) >= 0;
    if (categoryMatched && lowShare <= template.maxShare) {
      const base = lowShare <= 0.03 ? 80 : 60;
      const coefficient = lowShare === 0 ? 1.2 : 1;
      const score = base * coefficient;
      if (score > bestWScore) {
        bestWScore = score;
        bestW = template;
      }
    }
  });
  if (bestW) {
    candidates.push({ score: bestWScore, template: bestW, layer: 'W', style: '反思' });
  }

  const positioning = getPlayerPositioning(state);
  let gapScore = 60;
  if (positioning !== 'balanced') {
    if (positioning === lowCategory.id) {
      gapScore = 40;
    } else if (positioning !== topCategory.id && lowShare <= 0.08) {
      gapScore = 90;
    }
  }
  const gapCoefficient = (topShare >= 0.5 || lowShare === 0) ? 1.2 : 1;
  const gapFinal = gapScore * gapCoefficient;
  let gapTemplate = G_TEMPLATES.find(function (template) {
    return template.from.indexOf(positioning) >= 0 &&
      template.from.indexOf('any') < 0 &&
      template.from.indexOf('balanced') < 0 &&
      (template.to.indexOf(lowCategory.id) >= 0 || template.to.indexOf('any') >= 0);
  });
  if (!gapTemplate && positioning === 'balanced') {
    gapTemplate = G_TEMPLATES.find(function (template) {
      return template.from.indexOf('balanced') >= 0 &&
        (template.to.indexOf(lowCategory.id) >= 0 || template.to.indexOf('any') >= 0);
    });
  }
  if (!gapTemplate && gapScore === 90) {
    gapTemplate = G_TEMPLATES.find(function (template) {
      return template.from.indexOf('any') >= 0;
    });
  }
  if (gapTemplate) {
    candidates.push({ score: gapFinal, template: gapTemplate, layer: 'G', style: '反差' });
  }

  const eIndex = hashString(topCategory.id + ':' + lowCategory.id) % E_TEMPLATES.length;
  const eTemplate = E_TEMPLATES[eIndex];
  candidates.push({ score: 55, template: eTemplate, layer: 'E', style: eTemplate.style });

  const layerOrder = { S: 0, W: 1, G: 2, E: 3 };
  candidates.sort(function (a, b) {
    return b.score - a.score || layerOrder[a.layer] - layerOrder[b.layer];
  });
  const chosen = candidates[0];
  return { text: chosen.template.text, style: chosen.style };
}

// P1-1：结算页每帧全量重算摘要（模板引擎遍历 S/W/G/E 四层），且评语引擎为纯哈希确定性逻辑，
// 用状态签名做单槽缓存；AI 异步回填 aiComment/aiLoading 时签名变化自动重算。
const _summaryCache = { sig: null, ref: null, result: null };

function settlementSignature(state) {
  const ai = typeof state.aiComment === 'string' ? state.aiComment : '';
  return [
    state.startingDays || 0,
    Math.floor(state.remainingDays || 0),
    state.totalSpent || 0,
    (state.purchaseLedger || []).length,
    (state.ownedProductIds || []).length,
    ai.length,
    ai.slice(0, 12),
    state.aiGenerated ? 1 : 0,
    state.aiLoading ? 1 : 0
  ].join('|');
}

export function generateSettlementSummary(state) {
  const safeState = state || GAME_STATE;
  const sig = settlementSignature(safeState);
  if (safeState === _summaryCache.ref && sig === _summaryCache.sig) {
    return _summaryCache.result;
  }
  const result = computeSettlementSummary(safeState);
  _summaryCache.ref = safeState;
  _summaryCache.sig = sig;
  _summaryCache.result = result;
  return result;
}

function computeSettlementSummary(state) {
  const safeState = state || GAME_STATE;
  const startDays = safeState.startingDays || GAME_CONFIG.initialDays;
  const categoryBars = getSettlementCategoryStats(safeState);
  const topCategory = categoryBars[0];
  const lowCategory = categoryBars[categoryBars.length - 1];
  const topProduct = getTopCategoryProduct(safeState, topCategory.id);
  const consumedDays = Math.max(0, startDays - Math.max(0, safeState.remainingDays));
  const totalSpent = safeState.totalSpent || 0;
  const topPercent = totalSpent > 0 ? Math.round(topCategory.spent / totalSpent * 100) : 0;
  const aiComment = safeState.aiComment;
  if (typeof aiComment === 'string' && aiComment.trim()) {
    return {
      categoryBars: categoryBars,
      topCategory: topCategory,
      lowCategory: lowCategory,
      topProduct: topProduct,
      summaryText: aiComment.trim(),
      patternIndex: -1,
      patternStyle: 'AI',
      aiGenerated: safeState.aiGenerated || false,
      aiLoading: safeState.aiLoading || false,
      stats: {
        consumedDays: consumedDays,
        totalSpent: totalSpent,
        topPercent: topPercent,
        remainingDays: safeState.remainingDays
      }
    };
  }

  if (totalSpent <= 0) {
    return {
      categoryBars: categoryBars,
      topCategory: topCategory,
      lowCategory: lowCategory,
      topProduct: null,
      summaryText: '这一生，你什么都没买。',
      patternIndex: -1,
      patternStyle: null,
      aiGenerated: false,
      aiLoading: false,
      stats: {
        consumedDays: consumedDays,
        totalSpent: totalSpent,
        topPercent: topPercent,
        remainingDays: safeState.remainingDays
      }
    };
  }

  const smart = generateSmartComment(
    safeState,
    getGlobalStats(),
    topCategory,
    lowCategory,
    totalSpent > 0 ? topCategory.spent / totalSpent : 0,
    totalSpent > 0 ? lowCategory.spent / totalSpent : 0
  );
  const summaryText = smart.text;
  const patternIndex = SUMMARY_PATTERN_POOL.findIndex(function (pattern) {
    return pattern.template === summaryText;
  });
  const safePatternIndex = patternIndex >= 0 ? patternIndex : 0;

  return {
    categoryBars: categoryBars,
    topCategory: topCategory,
    lowCategory: lowCategory,
    topProduct: topProduct,
    summaryText: summaryText,
    patternIndex: safePatternIndex,
    patternStyle: smart.style,
    aiGenerated: false,
    aiLoading: false,
    stats: {
      consumedDays: consumedDays,
      totalSpent: totalSpent,
      topPercent: topPercent,
      remainingDays: safeState.remainingDays
    }
  };
}
