// 本地 mock LLM 服务（e2e 实测专用，勿提交依赖）：OpenAI 兼容 /chat/completions。
// 按 system prompt 特征路由不同"人格"回复，usage 恒回 total_tokens=300 供预算回填校验。
import http from 'http';

const REPLY = {
  epitaph: '他买下三万天，只为再看一次那年的海。',
  creed: '我要把每一次选择都当作最后一张船票',
  roast: '你办的健身卡，正在替未来的你上坟。',
  echo: '三世轮回，你总把勇气留给下辈子。',
  rewriteTitle: '改写标题',
  rewriteDesc: '云游老者看你面相：三旬未到，已买下半生。数值与选择照旧，只是这次是为你而说。',
  dialogue: '孩子，钱花在哪儿，人就是哪儿。'
};

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch (e) { /* ignore */ }
    const sys = (body.messages || []).map((m) => m.content).join('\n');
    let content = REPLY.dialogue;
    // 路由顺序敏感：echo 的 prompt 里含"墓志铭"字样，必须先于 epitaph 判断
    if (sys.indexOf('前世回响') >= 0) content = REPLY.echo;
    else if (sys.indexOf('墓志铭') >= 0) content = REPLY.epitaph;
    else if (sys.indexOf('人生信条') >= 0) content = REPLY.creed;
    else if (sys.indexOf('摸鱼被抓') >= 0) content = REPLY.roast;
    else if (sys.indexOf('场景旁白') >= 0) {
      content = JSON.stringify({ title: REPLY.rewriteTitle, desc: REPLY.rewriteDesc });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'mock',
      choices: [{ message: { content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 }
    }));
  });
});

server.listen(8787, '127.0.0.1', () => console.log('mock llm on http://127.0.0.1:8787/v1'));
