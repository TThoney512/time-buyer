// Module: main.js
// Split from the original game.js during module refactor.
import { flushGlobalStats, maybeRefreshDailyStats } from './state.js';
import { getTT } from './utils.js';
import { markMinorNoticeSeen, openLegalModal, shouldShowMinorNotice } from './legal.js';
import { initUI } from './ui.js';

const _launchStartTime = Date.now();
const ttApi = getTT();
if (ttApi && ttApi.createCanvas) {
  initUI();
  const tti = Date.now() - _launchStartTime;
  if (ttApi.reportPerformance) {
    try {
      ttApi.reportPerformance({
        firstRenderTime: tti
      });
    } catch (error) {
      // TTI 上报失败不影响启动。
    }
  }
}
if (ttApi && ttApi.onHide) {
  ttApi.onHide(flushGlobalStats);
}
// 从后台切回前台时：先落盘再强制做一次跨日检查，
// 覆盖"切到后台跨过零点"这种 updateRound 跑不到的场景。
if (ttApi && ttApi.onShow) {
  ttApi.onShow(function () {
    flushGlobalStats();
    maybeRefreshDailyStats(true);
  });
}
// 首次进入展示一次未成年人保护提示，之后可在欢迎页底部与天书内随时查阅。
if (shouldShowMinorNotice()) {
  markMinorNoticeSeen();
  openLegalModal('minor');
}
