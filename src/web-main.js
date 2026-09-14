// Module: web-main.js
// 开源版（浏览器）入口：先安装平台 shim，再启动与抖音版完全相同的游戏代码。
// 同一套 src/，两个入口 —— 这就是"平台剥离"的全部含义。
import { installWebPlatform } from './platform-web.js';

if (installWebPlatform()) {
  await import('./main.js');
} else {
  throw new Error('time-buyer web entry must run in a browser environment');
}
