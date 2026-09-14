// Module: legal.js
// 开源版合规文书：隐私承诺 / 使用条款 / 健康游戏提示。
// 原则：文案与实际数据行为严格一致——本项目没有任何服务器，能说的只有"本地"。
import { UI_COLORS } from './config.js';
import { drawRoundRectPath, drawText, getTT } from './utils.js';
import { UI_STATE } from './state.js';
import { trackEvent } from './analytics.js';
import { getLang, t } from './i18n.js';

// 开源项目不存在"运营主体"。这里以仓库为联系入口。
export const PROJECT_NAME = 'time-buyer（开源项目，无运营主体）';
export const PROJECT_CONTACT = 'https://github.com/TThoney512/time-buyer/issues';

export const LEGAL_DOCS = {
  privacy: {
    id: 'privacy',
    title: '隐私承诺',
    emoji: '🔒',
    updatedAt: '2026-09-13',
    blocks: [
      { type: 'h', text: '一、这个项目收集什么' },
      { type: 'p', text: '什么都不收集。你的存档（游戏进度、收集记录、轮回积分）全部保存在你自己浏览器的本地存储（localStorage）里；清除浏览器数据即可彻底删除，删除后无法恢复。' },
      { type: 'p', text: '本项目没有任何服务器，没有遥测、没有埋点、没有统计上报。你在控制台看到的 [analytics] 日志只是本地 console.log，不会离开你的设备。' },
      { type: 'h', text: '二、接入 AI（BYOK）后的数据去向' },
      { type: 'p', text: '如果你自行配置了模型 API Key：游戏会把一份"人生档案摘要"（消费分类占比、代表商品、结局类型）发送到你所配置的服务商，用于生成评语。Key 只存在你本机，请求由你的浏览器直连服务商。' },
      { type: 'p', text: '发送给服务商的内容不包含你的姓名、设备标识或其他任何个人数据——游戏本身就不采集这些。服务商如何使用数据，请阅读对应服务商的隐私政策。' },
      { type: 'h', text: '三、你不配置 Key 会怎样' },
      { type: 'p', text: '完全不影响游玩。离线模式下所有内容由本地模板引擎生成，这是默认体验，不是功能残缺。' }
    ]
  },
  terms: {
    id: 'terms',
    title: '使用条款',
    emoji: '📄',
    updatedAt: '2026-09-13',
    blocks: [
      { type: 'h', text: '一、许可' },
      { type: 'p', text: '本项目的源代码遵循 MIT License 发布：你可以使用、复制、修改、合并、出版发行、再授权及/或销售软件的副本。简单说：随便用，注明出处更好。' },
      { type: 'h', text: '二、自担责任' },
      { type: 'p', text: '软件按"现状"提供，不含任何明示或暗示的担保。因使用本项目（包括你自行接入的 AI 服务所产生的费用与内容）导致的任何损失，作者不承担责任。' },
      { type: 'h', text: '三、AI 生成内容' },
      { type: 'p', text: '墓志铭等 AI 评语由你自行接入的模型生成，观点不代表项目作者；生成内容的合规使用责任由使用者自行承担。项目提供本地模板模式作为无 AI 的完整替代。' },
      { type: 'h', text: '四、虚拟数据' },
      { type: 'p', text: '游戏内的时间货币、轮回积分、道具均为纯虚拟数据，无现实价值，不存在任何充值入口，也不可交易。' }
    ]
  },
  minor: {
    id: 'minor',
    title: '健康游戏提示',
    emoji: '🧒',
    updatedAt: '2026-09-13',
    blocks: [
      { type: 'h', text: '适合谁玩' },
      { type: 'p', text: '本游戏的主题是对时间与人生的反思，包含"死亡""墓志铭"等叙事元素（均为温和的表达）。未满 18 周岁的玩家建议在监护人知情的情况下游玩。' },
      { type: 'h', text: '时长与消费' },
      { type: 'p', text: '单局限时 15 分钟，本身就是一个"该休息一下"的机制。游戏没有任何付费内容；接入 AI 的费用由使用者（或其监护人）的 API 账户承担，请在知情前提下配置。' },
      { type: 'h', text: '给监护人' },
      { type: 'p', text: '如果你与孩子在同一台设备上游玩，这或许是一个不错的对话起点——"你的 30000 天会怎么花"是一个可以聊一晚上的人生问题。' }
    ]
  }
};

const LEGAL_ORDER = ['privacy', 'terms', 'minor'];
const LEGAL_SEEN_KEY = 'timeBuyer_legalMinorNoticeSeen';

// 文本测量结果缓存：布局只随容器宽度变化，没必要每帧重新测量。
const _measureCache = { key: '', lines: [], height: 0 };

export function openLegalModal(docId) {
  const id = LEGAL_DOCS[docId] ? docId : 'privacy';
  UI_STATE.showLegal = id;
  UI_STATE.legalScroll = 0;
  _measureCache.key = '';
  trackEvent('legal_open', { doc: id });
}

export function closeLegalModal() {
  UI_STATE.showLegal = null;
  UI_STATE.legalScroll = 0;
  UI_STATE.legalTouchStartY = 0;
  UI_STATE.legalTouchStartScroll = 0;
  UI_STATE._legalCloseBtn = null;
  UI_STATE._legalTabBtns = null;
}

export function isLegalModalOpen() {
  return !!UI_STATE.showLegal;
}

/** 首次进入时展示一次未成年人保护提示。 */
export function shouldShowMinorNotice() {
  const ttApi = getTT();
  if (!ttApi || !ttApi.getStorageSync) {
    return false;
  }
  try {
    return ttApi.getStorageSync(LEGAL_SEEN_KEY) !== '1';
  } catch (error) {
    return false;
  }
}

export function markMinorNoticeSeen() {
  const ttApi = getTT();
  if (!ttApi || !ttApi.setStorageSync) {
    return;
  }
  try {
    ttApi.setStorageSync(LEGAL_SEEN_KEY, '1');
  } catch (error) {
    // 落盘失败最多导致下次重复提示，不阻塞流程。
  }
}

function wrapText(ctx, text, maxWidth) {
  const lines = [];
  const paragraphs = String(text || '').split('\n');
  paragraphs.forEach(function (paragraph) {
    let current = '';
    for (let i = 0; i < paragraph.length; i += 1) {
      const next = current + paragraph[i];
      if (ctx.measureText(next).width > maxWidth && current.length > 0) {
        lines.push(current);
        current = paragraph[i];
      } else {
        current = next;
      }
    }
    lines.push(current);
  });
  return lines;
}

/** 按当前容器宽度把文档摊平成渲染行，并缓存结果。 */
function getLayoutLines(ctx, doc, contentW) {
  const cacheKey = doc.id + '|' + Math.round(contentW);
  if (_measureCache.key === cacheKey) {
    return _measureCache;
  }
  const lines = [];
  doc.blocks.forEach(function (block) {
    if (block.type === 'h') {
      lines.push({ text: block.text, font: 'bold 13px sans-serif', lh: 22, gap: 6, color: UI_COLORS.goldLight });
      return;
    }
    wrapText(ctx, block.text, contentW).forEach(function (line) {
      lines.push({ text: line, font: '12px sans-serif', lh: 19, gap: 0, color: 'rgba(226,232,240,0.88)' });
    });
    lines.push({ text: '', font: '12px sans-serif', lh: 8, gap: 0, color: 'transparent' });
  });

  let height = 0;
  lines.forEach(function (line) {
    height += line.lh + line.gap;
  });
  _measureCache.key = cacheKey;
  _measureCache.lines = lines;
  _measureCache.height = height;
  return _measureCache;
}

/**
 * 底部协议入口。整行按书名号拆成两个独立热区，
 * 点《用户协议》进协议、点《隐私政策》进政策，不做整行兜底。
 */
export function drawLegalFooterLinks(ctx, centerX, y, panelW) {
  const seg1 = 'MIT 开源 · 请阅读';
  const seg2 = '《用户协议》';
  const seg3 = '和';
  const seg4 = '《隐私政策》';

  ctx.font = '11px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const w1 = ctx.measureText(seg1).width;
  const w2 = ctx.measureText(seg2).width;
  const w3 = ctx.measureText(seg3).width;
  const w4 = ctx.measureText(seg4).width;
  const totalW = w1 + w2 + w3 + w4;

  // 超宽屏时整行可能超出面板，按比例收敛字号保证可点区域不越界。
  const maxW = Math.max(120, panelW - 24);
  const scale = totalW > maxW ? maxW / totalW : 1;
  ctx.font = (11 * scale).toFixed(1) + 'px sans-serif';
  const drawW1 = w1 * scale;
  const drawW2 = w2 * scale;
  const drawW3 = w3 * scale;
  const drawW4 = w4 * scale;

  let x = centerX - (drawW1 + drawW2 + drawW3 + drawW4) / 2;
  ctx.fillStyle = 'rgba(167,196,255,0.75)';
  ctx.fillText(seg1, x, y);
  x += drawW1;
  ctx.fillStyle = UI_COLORS.goldLight;
  ctx.fillText(seg2, x, y);
  UI_STATE._legalTermsBtn = { x: x - 3, y: y - 13, w: drawW2 + 6, h: 26 };
  x += drawW2;
  ctx.fillStyle = 'rgba(167,196,255,0.75)';
  ctx.fillText(seg3, x, y);
  x += drawW3;
  ctx.fillStyle = UI_COLORS.goldLight;
  ctx.fillText(seg4, x, y);
  UI_STATE._legalPrivacyBtn = { x: x - 3, y: y - 13, w: drawW4 + 6, h: 26 };

  // 未成年人保护提示入口（帮助页等场景使用）。
  UI_STATE._legalFooterBtn = null;
}

/** 单独一行的大号入口，用于帮助页等有纵向空间的位置。 */
export function drawLegalEntryRow(ctx, centerX, y, docId, label) {
  const text = label || ('🧒 ' + (LEGAL_DOCS[docId] || LEGAL_DOCS.minor).title);
  const btnW = 200;
  const btnH = 34;
  const btnX = centerX - btnW / 2;
  const btnY = y - btnH / 2;
  ctx.save();
  ctx.fillStyle = 'rgba(91,140,255,0.16)';
  drawRoundRectPath(ctx, btnX, btnY, btnW, btnH, 17);
  ctx.fill();
  ctx.strokeStyle = '#5B8CFF';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  drawText(ctx, text, centerX, y - 7, 'bold 12px sans-serif', '#A7C4FF', 'center', btnW - 12, 1);
  UI_STATE['_legalEntryBtn_' + docId] = { x: btnX, y: btnY, w: btnW, h: btnH };
  return { x: btnX, y: btnY, w: btnW, h: btnH };
}

export function drawLegalModal(ctx) {
  if (!UI_STATE.showLegal) {
    return;
  }
  const doc = LEGAL_DOCS[UI_STATE.showLegal] || LEGAL_DOCS.privacy;
  const w = UI_STATE.screenWidth;
  const h = UI_STATE.screenHeight;
  const modalW = Math.min(w - 32, 352);
  const modalH = Math.min(h - 80, 600);
  const modalX = (w - modalW) / 2;
  const modalY = Math.max(30, (h - modalH) / 2);

  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 40;
  ctx.fillStyle = 'rgba(10,16,40,0.97)';
  drawRoundRectPath(ctx, modalX, modalY, modalW, modalH, 22);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = UI_COLORS.gold;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  drawText(ctx, doc.emoji + ' ' + doc.title, modalX + 18, modalY + 14, 'bold 17px sans-serif', UI_COLORS.goldLight);

  const closeSize = 30;
  const closeX = modalX + modalW - closeSize - 12;
  const closeY = modalY + 12;
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
  UI_STATE._legalCloseBtn = { x: closeX - 6, y: closeY - 6, w: closeSize + 12, h: closeSize + 12 };

  drawText(ctx, '更新于 ' + doc.updatedAt, modalX + 18, modalY + 38, '10px sans-serif', 'rgba(167,196,255,0.7)');

  // 顶部三档切换
  const tabY = modalY + 56;
  const tabH = 30;
  const tabGap = 6;
  const tabW = (modalW - 36 - tabGap * (LEGAL_ORDER.length - 1)) / LEGAL_ORDER.length;
  const tabBtns = {};
  LEGAL_ORDER.forEach(function (id, index) {
    const item = LEGAL_DOCS[id];
    const tabX = modalX + 18 + index * (tabW + tabGap);
    const active = UI_STATE.showLegal === id;
    ctx.save();
    ctx.fillStyle = active ? 'rgba(233,196,106,0.20)' : 'rgba(255,255,255,0.06)';
    drawRoundRectPath(ctx, tabX, tabY, tabW, tabH, 10);
    ctx.fill();
    ctx.strokeStyle = active ? UI_COLORS.gold : 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    drawText(ctx, (getLang() === 'en' ? t('legal.tabMinorShort') : item.title.replace('未成年人保护提示', '未成年保护')), tabX + tabW / 2, tabY + 8,
      active ? 'bold 11px sans-serif' : '11px sans-serif',
      active ? UI_COLORS.goldLight : UI_COLORS.muted, 'center', tabW - 6, 1);
    tabBtns[id] = { x: tabX, y: tabY, w: tabW, h: tabH };
  });
  UI_STATE._legalTabBtns = tabBtns;

  // 正文可滚动区域
  const contentX = modalX + 18;
  const contentY = tabY + tabH + 12;
  const contentW = modalW - 36;
  const contentH = modalH - (contentY - modalY) - 54;

  const layout = getLayoutLines(ctx, doc, contentW);
  const maxScroll = Math.max(0, layout.height - contentH);
  UI_STATE.legalScroll = Math.min(Math.max(0, UI_STATE.legalScroll || 0), maxScroll);
  UI_STATE._legalContentRect = { x: contentX, y: contentY, w: contentW, h: contentH };
  UI_STATE._legalMaxScroll = maxScroll;

  ctx.save();
  ctx.beginPath();
  ctx.rect(contentX, contentY, contentW, contentH);
  ctx.clip();
  let cursorY = contentY - (UI_STATE.legalScroll || 0);
  for (let i = 0; i < layout.lines.length; i += 1) {
    const line = layout.lines[i];
    if (cursorY + line.lh < contentY - 20 || cursorY > contentY + contentH + 20) {
      cursorY += line.lh + line.gap;
      continue;
    }
    if (line.text) {
      drawText(ctx, line.text, contentX, cursorY, line.font, line.color, 'left', contentW, 1);
    }
    cursorY += line.lh + line.gap;
  }
  ctx.restore();

  // 滚动条
  if (maxScroll > 0) {
    const trackX = modalX + modalW - 8;
    const trackH = contentH;
    const thumbH = Math.max(28, trackH * (contentH / layout.height));
    const thumbY = contentY + (trackH - thumbH) * ((UI_STATE.legalScroll || 0) / maxScroll);
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    drawRoundRectPath(ctx, trackX, contentY, 3, trackH, 1.5);
    ctx.fill();
    ctx.fillStyle = 'rgba(233,196,106,0.55)';
    drawRoundRectPath(ctx, trackX, thumbY, 3, thumbH, 1.5);
    ctx.fill();
    ctx.restore();
  }

  drawText(ctx, PROJECT_NAME + t('legal.feedbackTail'),
    modalX + modalW / 2, modalY + modalH - 30, '10px sans-serif', 'rgba(167,196,255,0.6)', 'center', contentW, 1);
  drawText(ctx, maxScroll > 0 ? t('legal.tipScroll') : t('legal.tipDone'),
    modalX + modalW / 2, modalY + modalH - 16, '10px sans-serif', 'rgba(167,196,255,0.45)', 'center', contentW, 1);
}

/**
 * 触摸分发。返回 true 表示事件已被合规弹窗消费，调用方不再往下传。
 */
export function handleLegalTouchStart(point) {
  if (!UI_STATE.showLegal || !point) {
    return false;
  }
  const tabBtns = UI_STATE._legalTabBtns;
  if (tabBtns) {
    for (let i = 0; i < LEGAL_ORDER.length; i += 1) {
      const id = LEGAL_ORDER[i];
      const rect = tabBtns[id];
      if (rect && isInside(point, rect)) {
        if (UI_STATE.showLegal !== id) {
          UI_STATE.showLegal = id;
          UI_STATE.legalScroll = 0;
          _measureCache.key = '';
          trackEvent('legal_open', { doc: id, from: 'tab' });
        }
        UI_STATE.touchMode = 'legal-tab';
        return true;
      }
    }
  }
  const closeBtn = UI_STATE._legalCloseBtn;
  if (closeBtn && isInside(point, closeBtn)) {
    UI_STATE.touchMode = 'legal-close';
    return true;
  }
  const contentRect = UI_STATE._legalContentRect;
  if (contentRect && isInside(point, contentRect)) {
    UI_STATE.legalTouchStartY = point.y;
    UI_STATE.legalTouchStartScroll = UI_STATE.legalScroll || 0;
    UI_STATE.touchMode = 'legal-scroll';
    return true;
  }
  // 弹窗内的空白区域：吞掉点击，避免穿透到下层按钮。
  UI_STATE.touchMode = 'legal-blocked';
  return true;
}

export function handleLegalTouchMove(point) {
  if (!UI_STATE.showLegal || !point) {
    return false;
  }
  if (UI_STATE.touchMode !== 'legal-scroll') {
    return true;
  }
  const maxScroll = UI_STATE._legalMaxScroll || 0;
  const next = (UI_STATE.legalTouchStartScroll || 0) - (point.y - (UI_STATE.legalTouchStartY || 0));
  UI_STATE.legalScroll = Math.min(Math.max(0, next), maxScroll);
  return true;
}

export function handleLegalTouchEnd() {
  if (!UI_STATE.showLegal) {
    return false;
  }
  if (UI_STATE.touchMode === 'legal-close') {
    closeLegalModal();
  }
  UI_STATE.touchMode = 'none';
  return true;
}

function isInside(point, rect) {
  return !!rect
    && point.x >= rect.x
    && point.x <= rect.x + rect.w
    && point.y >= rect.y
    && point.y <= rect.y + rect.h;
}
