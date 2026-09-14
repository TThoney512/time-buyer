// Module: analytics.js
// Unified event reporting for tt.reportAnalytics / tt.reportMonitor.

import { getTT } from './utils.js';

export function trackEvent(eventName, params) {
  const safeName = String(eventName || 'unknown');
  const data = Object.assign({ event: safeName, ts: Date.now() }, params || {});
  const ttApi = getTT();
  if (ttApi && typeof ttApi.reportAnalytics === 'function') {
    try {
      ttApi.reportAnalytics(safeName, data);
      return;
    } catch (error) {
      // 继续尝试 reportMonitor。
    }
  }
  if (ttApi && typeof ttApi.reportMonitor === 'function') {
    try {
      ttApi.reportMonitor(safeName, JSON.stringify(data));
      return;
    } catch (error) {
      // 继续尝试自定义上报。
    }
  }
  if (typeof console !== 'undefined' && console.log) {
    console.log('[analytics]', safeName, data);
  }
}
