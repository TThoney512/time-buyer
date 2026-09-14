// Module: share.js
// 通用离屏 canvas 导出 + 分享管线（结算卡与清单长图卡共用）。
// 从 settlement.js 迁出（2026-09-13）：它不依赖任何渲染函数，住在 settlement.js 会让
// lifetime.js 为复用它而 import settlement，从而形成 ui→lifetime→settlement→ui 环。
// 本模块是叶子节点：只依赖 utils（getTT）与 analytics（trackEvent），不反向依赖任何渲染模块。
import { trackEvent } from './analytics.js';
import { getTT } from './utils.js';

export function showShareToast(title) {
  const ttApi = getTT();
  if (ttApi && ttApi.showToast) {
    ttApi.showToast({ title: title, icon: 'none' });
  } else if (typeof console !== 'undefined') {
    console.log(title);
  }
}

// options: { title, desc, trackType, onSuccess, onFail, silentFail }
export function exportCanvasAndShare(ttApi, canvas, options) {
  const failToast = function () {
    // silentFail：调用方还有降级路径（如清单文案版分享），不打扰玩家。
    if (!options.silentFail) {
      showShareToast('分享图片生成失败');
    }
  };
  const shareWithPath = function (imageUrl) {
    if (!imageUrl) {
      failToast();
      if (options.onFail) { options.onFail(); }
      return false;
    }
    if (ttApi && ttApi.shareAppMessage) {
      ttApi.shareAppMessage({
        title: options.title,
        desc: options.desc,
        imageUrl: imageUrl,
        success: function () {
          trackEvent('share_success', { type: options.trackType || 'card' });
          if (options.onSuccess) { options.onSuccess(); }
        },
        fail: function () {
          showShareToast('分享已取消');
        }
      });
      return true;
    }
    if (ttApi && ttApi.showShareMenu) {
      ttApi.showShareMenu({
        withShareTicket: true,
        success: function () {},
        fail: function () {
          showShareToast('分享已取消');
        }
      });
      return true;
    }
    showShareToast('当前环境暂不支持分享');
    return false;
  };

  const exportOptions = {
    x: 0,
    y: 0,
    width: canvas.width,
    height: canvas.height,
    destWidth: canvas.width,
    destHeight: canvas.height,
    fileType: 'png',
    quality: 1
  };

  const exportFail = function () {
    failToast();
    if (options.onFail) { options.onFail(); }
    return false;
  };

  const tryCanvasExport = function () {
    if (canvas.toTempFilePath) {
      canvas.toTempFilePath(Object.assign({}, exportOptions, {
        success: function (res) {
          shareWithPath(res && res.tempFilePath);
        },
        fail: exportFail
      }));
      return true;
    }
    if (canvas.toTempFilePathSync) {
      try {
        const path = canvas.toTempFilePathSync(exportOptions);
        shareWithPath(path);
        return true;
      } catch (error) {
        exportFail();
        return false;
      }
    }
    exportFail();
    return false;
  };

  if (ttApi && ttApi.canvasToTempFilePath) {
    ttApi.canvasToTempFilePath(Object.assign({}, exportOptions, {
      canvas: canvas,
      success: function (res) {
        shareWithPath(res && res.tempFilePath);
      },
      fail: tryCanvasExport
    }));
    return true;
  }

  return tryCanvasExport();
}
