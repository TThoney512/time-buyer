// Module: platform-web.js
// 浏览器平台 shim —— 开源版的核心"剥离层"。
// 在浏览器里构造一个与抖音 tt API 同形状的全局对象，src/ 下所有游戏模块零改动运行。
// 设计原则：只实现游戏用到的最小面；未实现的能力（云、广告、好友榜）保持"缺失"，
// 依赖游戏代码原有的 null 兜底走降级路径 —— 这正是离线模式的真实链路。

let _mainCanvas = null;
let _canvasCalls = 0;
const _touchHandlers = { start: [], move: [], end: [] };
const _lifecycle = { show: [], hide: [] };

function ensureMainCanvas() {
  if (_mainCanvas) {
    return _mainCanvas;
  }
  _mainCanvas = document.createElement('canvas');
  _mainCanvas.style.position = 'fixed';
  _mainCanvas.style.left = '0';
  _mainCanvas.style.top = '0';
  _mainCanvas.style.display = 'block';
  _mainCanvas.style.touchAction = 'none';
  document.body.appendChild(_mainCanvas);
  // 抖音主画布自动按 dpr 铺满屏幕；浏览器里要自己把 CSS 尺寸同步为 像素/dpr。
  let _w = 0;
  let _h = 0;
  Object.defineProperty(_mainCanvas, 'width', {
    get: function () { return _w; },
    set: function (value) {
      _w = value;
      _mainCanvas.setAttribute('width', String(value));
      _mainCanvas.style.width = Math.round(value / (window.devicePixelRatio || 1)) + 'px';
    }
  });
  Object.defineProperty(_mainCanvas, 'height', {
    get: function () { return _h; },
    set: function (value) {
      _h = value;
      _mainCanvas.setAttribute('height', String(value));
      _mainCanvas.style.height = Math.round(value / (window.devicePixelRatio || 1)) + 'px';
    }
  });
  return _mainCanvas;
}

function toTouchEventLike(e) {
  const canvas = ensureMainCanvas();
  const rect = canvas.getBoundingClientRect();
  const point = { clientX: e.clientX - rect.left, clientY: e.clientY - rect.top };
  return { touches: [point], changedTouches: [point] };
}

function bindPointerEvents() {
  const canvas = ensureMainCanvas();
  // Pointer Events 统一鼠标/触摸：down→move→up 映射到 onTouchStart/Move/End。
  canvas.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) { return; }
    _touchHandlers.start.forEach(function (cb) { cb(toTouchEventLike(e)); });
  });
  canvas.addEventListener('pointermove', function (e) {
    _touchHandlers.move.forEach(function (cb) { cb(toTouchEventLike(e)); });
  });
  const endHandler = function (e) {
    _touchHandlers.end.forEach(function (cb) { cb(toTouchEventLike(e)); });
  };
  canvas.addEventListener('pointerup', endHandler);
  canvas.addEventListener('pointercancel', endHandler);
}

function bindLifecycle() {
  document.addEventListener('visibilitychange', function () {
    const list = document.hidden ? _lifecycle.hide : _lifecycle.show;
    list.forEach(function (cb) { cb({}); });
  });
  window.addEventListener('pagehide', function () {
    _lifecycle.hide.forEach(function (cb) { cb({}); });
  });
}

let _toastEl = null;
let _toastTimer = null;
function showDomToast(title) {
  if (!_toastEl) {
    _toastEl = document.createElement('div');
    _toastEl.style.cssText = 'position:fixed;left:50%;top:18%;transform:translateX(-50%);' +
      'background:rgba(10,16,40,0.92);color:#F5F8FF;padding:10px 18px;border-radius:14px;' +
      'font:14px sans-serif;border:1px solid rgba(233,196,106,0.5);z-index:99;max-width:80vw;text-align:center';
    document.body.appendChild(_toastEl);
  }
  _toastEl.textContent = title;
  _toastEl.style.display = 'block';
  if (_toastTimer) { clearTimeout(_toastTimer); }
  _toastTimer = setTimeout(function () { _toastEl.style.display = 'none'; }, 2200);
}

function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function installWebPlatform() {
  if (typeof document === 'undefined') {
    return false; // 非浏览器环境（Node 冒烟测试自带 mock），不安装
  }
  const tt = {
    // 抖音约定：首次 createCanvas 返回上屏主画布，之后返回离屏画布。
    createCanvas: function () {
      _canvasCalls += 1;
      if (_canvasCalls === 1) {
        const main = ensureMainCanvas();
        bindPointerEvents();
        bindLifecycle();
        return main;
      }
      return document.createElement('canvas');
    },
    getSystemInfoSync: function () {
      return {
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
        pixelRatio: window.devicePixelRatio || 1,
        platform: 'web',
        SDKVersion: 'web-1.0'
      };
    },
    onTouchStart: function (cb) { _touchHandlers.start.push(cb); },
    onTouchMove: function (cb) { _touchHandlers.move.push(cb); },
    onTouchEnd: function (cb) { _touchHandlers.end.push(cb); },
    onShow: function (cb) { _lifecycle.show.push(cb); },
    onHide: function (cb) { _lifecycle.hide.push(cb); },
    getStorageSync: function (key) {
      try { return localStorage.getItem(key) || ''; } catch (error) { return ''; }
    },
    setStorageSync: function (key, value) {
      try { localStorage.setItem(key, String(value)); } catch (error) { /* 隐私模式兜底 */ }
    },
    showToast: function (options) { showDomToast((options && options.title) || ''); },
    vibrateShort: function () {
      if (navigator.vibrate) { try { navigator.vibrate(10); } catch (error) {} }
    },
    // 分享 = 下载 PNG（web 无平台分享；navigator.share 在 v0.4 回放导出里再做）
    shareAppMessage: function (options) {
      if (options && options.imageUrl && String(options.imageUrl).indexOf('data:') === 0) {
        downloadDataUrl(options.imageUrl, 'time-buyer.png');
      }
      options && options.success && options.success({});
    },
    showShareMenu: function (options) {
      options && options.success && options.success({});
    },
    canvasToTempFilePath: function (options) {
      try {
        const url = options.canvas.toDataURL('image/png');
        options.success && options.success({ tempFilePath: url });
      } catch (error) {
        options.fail && options.fail(error);
      }
    },
    openUrl: function (options) {
      if (options && options.url) {
        window.open(options.url, '_blank');
      }
    },
    // 网络请求（AI 结算的降级 HTTP 通道用；v0.1 无 Key 时不会被调用）
    request: function (options) {
      const method = (options && options.method) || 'GET';
      const init = {
        method: method,
        headers: Object.assign({ 'Content-Type': 'application/json' }, (options && options.header) || {})
      };
      if (method !== 'GET' && options && options.data) {
        init.body = JSON.stringify(options.data);
      }
      fetch(options.url, init)
        .then(function (res) { return res.json(); })
        .then(function (data) { options.success && options.success({ data: data, statusCode: 200 }); })
        .catch(function (error) { options.fail && options.fail(error); });
    },
    // 平台埋点在 web 上静默为 console（analytics.js 的第三级兜底本来就走 console）
    reportPerformance: function () {},
    reportAnalytics: function (name, data) { console.log('[analytics]', name, data); },
    reportMonitor: function () {},
    // 有意不实现：cloud / createRewardedVideoAd / setUserCloudStorage / getFriendCloudStorage
    // —— 游戏代码对缺失能力均有 null 兜底：AI 走本地模板、无广告位、好友榜为空。
  };

  globalThis.tt = tt;
  return true;
}
