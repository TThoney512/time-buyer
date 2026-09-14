// 浏览器实测驱动：真实 Chromium 内核浏览器 + vite dev + mock LLM，验证 N 系列三批的线上行为。
// 前置：vite 在 5173、mock_llm_server 在 8787；另需 npm i -D playwright-core。
// 运行：node scripts/e2e_browser_test.mjs
//   环境变量（均可不填）：
//     PW_CORE_PATH  playwright-core 的 index.mjs 绝对路径（默认从本地 node_modules 解析）
//     EDGE_PATH     浏览器可执行文件路径（默认按操作系统探测 Edge / Chrome / Chromium）
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const SHOTS = fileURLToPath(new URL('./e2e_shots/', import.meta.url));
fs.mkdirSync(SHOTS, { recursive: true });

// playwright-core 默认从本地 node_modules 解析；若装在隔离环境，用 PW_CORE_PATH 指过去。
const pwSpec = process.env.PW_CORE_PATH
  ? pathToFileURL(path.resolve(process.env.PW_CORE_PATH)).href
  : 'playwright-core';
const { chromium } = await import(pwSpec);

// 浏览器可执行文件：优先 EDGE_PATH，否则探测各平台常见安装位置。
function detectBrowser() {
  if (process.env.EDGE_PATH) return process.env.EDGE_PATH;
  const candidates = process.platform === 'win32'
    ? [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ]
    : process.platform === 'darwin'
      ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
      ]
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

const EDGE = detectBrowser();
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch({
  executablePath: EDGE,
  args: ['--allow-file-access-from-files']
});
const page = await browser.newPage({ viewport: { width: 420, height: 860 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

// ---- 预置 localStorage：BYOK 指向 mock、跳过未保弹窗、2 条前世供 N8 ----
await page.addInitScript(() => {
  localStorage.setItem('timeBuyer_legalMinorNoticeSeen', '1');
  localStorage.setItem('tb_llm_config', JSON.stringify({
    baseUrl: 'http://127.0.0.1:8787/v1', apiKey: 'sk-e2e', model: 'mock-model', tokenBudget: 200000
  }));
  localStorage.setItem('tb_llm_usage', JSON.stringify({ used: 0 }));
  localStorage.setItem('timeBuyer_globalStats', JSON.stringify({
    totalPlayCount: 3,
    pastLives: [
      { n: 1, epitaph: '他死于挥霍，账上连灰都没有', ai: false },
      { n: 2, epitaph: '她犹豫了一辈子，最后连墓志铭也是模板', ai: false }
    ]
  }));
});
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(1200);

// ---- 0. 启动与模块单例可达 ----
const boot = await page.evaluate(async () => {
  const state = await import('/src/state.js');
  const ui = await import('/src/ui.js');
  const llm = await import('/src/llm.js');
  return {
    phase: state.GAME_STATE.phase,
    hasBtn: !!state.UI_STATE._welcomeBtn,
    usage: llm.getUsage(),
    hasModules: !!(state.GAME_STATE && ui && llm)
  };
});
ok('游戏启动进入欢迎页', boot.phase === 'welcome' && boot.hasBtn, JSON.stringify(boot.usage));
ok('模块单例共享（dev 控制台可达）', boot.hasModules);

// ---- 1. N8 前世回响：本地版先显示，AI 版原位替换 ----
await page.waitForTimeout(2500);
const echo = await page.evaluate(async () => {
  const state = await import('/src/state.js');
  return { echo: state.UI_STATE.pastLifeEcho, requested: state.UI_STATE.echoRequestedFor };
});
ok('N8 回响 AI 原位替换', echo.echo === '三世轮回，你总把勇气留给下辈子。', JSON.stringify(echo));
ok('N8 仅按前世数请求一次', echo.requested === 2, String(echo.requested));
await page.screenshot({ path: SHOTS + '01_welcome_echo.png' });

// ---- 2. 点击开始（走真实触摸链路）----
const startClick = await page.evaluate(async () => {
  const state = await import('/src/state.js');
  const b = state.UI_STATE._welcomeBtn;
  const canvas = document.querySelector('canvas');
  const r = canvas.getBoundingClientRect();
  return { x: r.left + b.x + b.w / 2, y: r.top + b.y + b.h / 2 };
});
await page.mouse.click(startClick.x, startClick.y);
await page.waitForTimeout(400);
const playing = await page.evaluate(async () => {
  const state = await import('/src/state.js');
  return state.GAME_STATE.phase;
});
ok('触摸开始 → 进入对局', playing === 'playing', playing);

// ---- 3. N6 摸鱼 AI 补刀 ----
await page.evaluate(async () => {
  const logic = await import('/src/logic.js');
  logic.doFish();
});
await page.waitForTimeout(1500);
const fish = await page.evaluate(async () => {
  const state = await import('/src/state.js');
  return { title: state.GAME_STATE.uiToast && state.GAME_STATE.uiToast.title, desc: state.GAME_STATE.uiToast && state.GAME_STATE.uiToast.desc };
});
ok('N6 AI 补刀到账（本地先行+AI第二击）', fish.title === '🤖 AI 补了一刀' && fish.desc === '你办的健身卡，正在替未来的你上坟。', fish.title + ' | ' + fish.desc);
await page.screenshot({ path: SHOTS + '02_fish_roast.png' });

// ---- 4. N3 人生信条：抉择后 AI 凝练并原位替换 ----
const creed = await page.evaluate(async () => {
  const state = await import('/src/state.js');
  const logic = await import('/src/logic.js');
  const cfg = await import('/src/config.js');
  state.GAME_STATE.pendingDecisionMilestone = cfg.DECISION_MILESTONES_V2[0];
  state.GAME_STATE.completedDecisionIds = [];
  state.GAME_STATE.decisionLog = [];
  const res = logic.resolveDecision('focus_strength');
  return { ok: res.ok, localCreed: state.GAME_STATE.decisionLog[0].creed, creedAI: state.GAME_STATE.decisionLog[0].creedAI };
});
ok('N3 本地信条即时兜底', creed.ok === true && creed.localCreed === '我要把最擅长的事做到极致' && creed.creedAI === false);
await page.waitForTimeout(1600);
const creedAI = await page.evaluate(async () => {
  const state = await import('/src/state.js');
  const replay = await import('/src/replay.js');
  const e = state.GAME_STATE.decisionLog[0];
  const md = replay.buildLifeReplayMarkdown(state.GAME_STATE, e.creed);
  return { creed: e.creed, ai: e.creedAI, inReplay: md.includes('我要把每一次选择都当作最后一张船票') };
});
ok('N3 AI 信条原位替换', creedAI.ai === true && creedAI.creed === '我要把每一次选择都当作最后一张船票', creedAI.creed);
ok('N3 信条进回放', creedAI.inReplay === true);

// ---- 5. N5 奇遇场景改写（与 N4 共享路径）+ 原池不污染 ----
await page.evaluate(async () => {
  const state = await import('/src/state.js');
  const logic = await import('/src/logic.js');
  state.GAME_STATE.totalSpent = 6000;
  state.GAME_STATE.adventureTriggered = [];
  logic.openAdventure();
});
await page.waitForTimeout(1800);
const adv = await page.evaluate(async () => {
  const state = await import('/src/state.js');
  const db = await import('/src/config.js');
  const p = state.GAME_STATE.pendingAdventure;
  const orig = db.ADVENTURE_EVENTS[0];
  return {
    title: p && p.title, aiRewritten: p && p.aiRewritten,
    origClean: orig.title === '高人指点' && !orig.aiRewritten,
    cnt: state.GAME_STATE.adventureRewriteCount
  };
});
ok('N5 奇遇文案被 AI 改写', adv.title === '改写标题' && adv.aiRewritten === true, adv.title);
ok('N5 原池对象未被污染', adv.origClean === true);
await page.screenshot({ path: SHOTS + '03_adventure_rewrite.png' });

// ---- 6. 结算：额度耗尽 → 弹窗 → 点"换固定模板" ----
await page.evaluate(async () => {
  const state = await import('/src/state.js');
  const logic = await import('/src/logic.js');
  state.GAME_STATE.pendingAdventure = null;
  state.GAME_STATE._adventurePaused = false;
  localStorage.setItem('tb_llm_usage', JSON.stringify({ used: 999999 }));
  const cfg = JSON.parse(localStorage.getItem('tb_llm_config'));
  cfg.tokenBudget = 1000;
  localStorage.setItem('tb_llm_config', JSON.stringify(cfg));
  logic.finalizeRound('days-exhausted');
});
await page.waitForTimeout(1200);
const budgetModal = await page.evaluate(async () => {
  const state = await import('/src/state.js');
  return {
    exhausted: state.GAME_STATE.budgetExhausted,
    hasTpl: !!state.UI_STATE._budgetTemplateBtn,
    comment: state.GAME_STATE.aiComment && state.GAME_STATE.aiComment.slice(0, 12)
  };
});
ok('额度耗尽弹出双出口', budgetModal.exhausted === true && budgetModal.hasTpl === true, JSON.stringify(budgetModal));
await page.screenshot({ path: SHOTS + '04_budget_modal.png' });
const tplClick = await page.evaluate(async () => {
  const state = await import('/src/state.js');
  const b = state.UI_STATE._budgetTemplateBtn;
  const canvas = document.querySelector('canvas');
  const r = canvas.getBoundingClientRect();
  return { x: r.left + b.x + b.w / 2, y: r.top + b.y + b.h / 2 };
});
await page.mouse.click(tplClick.x, tplClick.y);
await page.waitForTimeout(400);
const tplDone = await page.evaluate(async () => {
  const state = await import('/src/state.js');
  return {
    exhausted: state.GAME_STATE.budgetExhausted,
    toast: state.GAME_STATE.uiToast && state.GAME_STATE.uiToast.title,
    aiGen: state.GAME_STATE.aiGenerated
  };
});
ok('点"换固定模板"→ 免费收场', tplDone.exhausted === false && tplDone.toast === '已切换到固定模板' && tplDone.aiGen === false, JSON.stringify(tplDone));

// ---- 7. 重置预算 → "继续使用 AI"重试路径：墓志铭成功 + 去重语义 ----
await page.evaluate(async () => {
  localStorage.setItem('tb_llm_usage', JSON.stringify({ used: 0 }));
  const cfg = JSON.parse(localStorage.getItem('tb_llm_config'));
  cfg.tokenBudget = 200000;
  localStorage.setItem('tb_llm_config', JSON.stringify(cfg));
});
const retryGuard = await page.evaluate(async () => {
  const state = await import('/src/state.js');
  const logic = await import('/src/logic.js');
  // 先验证防御：非耗尽态调用应被 guard 拒绝
  const refused = logic.resolveBudgetExhausted(true, 50000) === false;
  // 再走真实耗尽→续额度路径
  state.GAME_STATE.budgetExhausted = true;
  state.GAME_STATE.aiLoading = false;
  logic.resolveBudgetExhausted(true, 50000);
  return { refused, pastLen: (state.getGlobalStats().pastLives || []).length };
});
ok('非耗尽态拒绝重复触发', retryGuard.refused === true);
await page.waitForTimeout(1600);
const epitaph = await page.evaluate(async () => {
  const state = await import('/src/state.js');
  const llm = await import('/src/llm.js');
  const g = state.getGlobalStats();
  return {
    comment: state.GAME_STATE.aiComment,
    aiGen: state.GAME_STATE.aiGenerated,
    pastLen: (g.pastLives || []).length,
    usage: llm.getUsage().used
  };
});
ok('额度追加后 AI 墓志铭落笔', epitaph.aiGen === true && epitaph.comment === '他买下三万天，只为再看一次那年的海。', epitaph.comment);
ok('重试不重复记前世（去重）', epitaph.pastLen === retryGuard.pastLen, `${retryGuard.pastLen}→${epitaph.pastLen}`);
ok('真实 usage 回填（150 而非估算）', epitaph.usage === 150, String(epitaph.usage));
await page.screenshot({ path: SHOTS + '05_settlement_epitaph.png' });

// ---- 8. 回放导出：真实浏览器下载链路 + 文件内容校验 ----
const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
const exp = await page.evaluate(async () => {
  const state = await import('/src/state.js');
  const replay = await import('/src/replay.js');
  return replay.exportLifeReplay(state.GAME_STATE, state.GAME_STATE.aiComment);
});
const download = await downloadPromise;
ok('回放文件真实下载成功', exp.ok === true && exp.downloaded === true && !!download,
  (download && download.suggestedFilename()) || JSON.stringify(exp));
if (download) {
  const file = SHOTS + download.suggestedFilename();
  await download.saveAs(file);
  const md = fs.readFileSync(file, 'utf8');
  ok('回放正文含大事记与信条', md.includes('一生大事记') && md.includes('我要把每一次选择都当作最后一张船票'), md.slice(0, 40).replace(/\n/g, ' '));
}
ok('剪贴板写入被浏览器接受', exp.copied === true, String(exp.copied));

// ---- 9. 页面零报错 ----
ok('无未捕获页面异常', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(52)}\ne2e：${results.length - failed.length}/${results.length} 通过${failed.length ? ' ❌' : ' ✅'}`);
process.exit(failed.length ? 1 : 0);
