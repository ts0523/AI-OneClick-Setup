#!/usr/bin/env node
/**
 * codex-deploy —— Codex API 一键接入
 *
 * 只给一个 key，自动完成：探测可用 base_url → 探测协议与模型 → 备份 →
 * 改写 config.toml / auth.json / model_catalog_json → 校验 → 实测。
 *
 * 命令:
 *   deploy (默认)  接入一个新 key
 *   status         诊断当前接入状态（只读）
 *   list           列出已配置的 provider
 *   models         列出中转可用模型，标出哪些 App 里能选到
 *   catalog        查看模型目录（App 选择器读的那份）
 *   catalog sync   把中转全部可对话模型写进目录，并用 codex debug models 验收
 *   use <name>     切换 provider
 *   test           只用 CLI 实测一次（不写文件）
 *   restore        回滚最近一次备份
 *
 * 关键选项:
 *   --key <sk-...> | --key-stdin | env CODEX_API_KEY / OPENAI_API_KEY
 *   --base-url <url>   可重复，按顺序作为候选地址自动探测
 *   --model <name>     省略则从 /v1/models 自动选
 *   --name <slug>      provider 名，默认 custom
 *   --codex-home <dir> 覆盖 CODEX_HOME（用于隔离测试）
 *   --dry-run / --json / --no-test / --no-catalog / --offline
 *   --allow-chat       通道只支持 chat 时仍强行写入（默认拒绝）
 *   --kill-launcher    结束会覆写 config.toml 的第三方启动器
 *   --env-key <NAME>   改写成从环境变量读 key，不写 auth.json
 *   --only <a,b>       目录同步只处理这几个模型
 *   --include-image    目录同步也写图像/语音模型（默认跳过）
 *   --no-probe         目录同步不逐个实测（默认实测，只写入真能应答的模型）
 *   --include-dead     目录同步连实测不通的模型也写进去（选了会报错，慎用）
 *   --prune            目录同步丢掉不在当前中转列表里的旧条目（默认保留）
 *   --builtin-instructions  采用官方内置条目里的提示词（默认用已验证的简短版）
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, execFileSync } = require('child_process');

// ---------------------------------------------------------------- 参数

const argv = process.argv.slice(2);
const opt = { baseUrl: [] };
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--dry-run') opt.dryRun = true;
  else if (a === '--json') opt.json = true;
  else if (a === '--no-test') opt.noTest = true;
  else if (a === '--no-catalog') opt.noCatalog = true;
  else if (a === '--all-models' || a === '--sync') opt.allModels = true;
  else if (a === '--only') opt.only = argv[++i];
  else if (a === '--include-image') opt.includeImage = true;
  else if (a === '--prune') opt.prune = true;
  else if (a === '--builtin-instructions') opt.builtinInstructions = true;
  else if (a === '--no-probe') opt.noProbe = true;
  else if (a === '--include-dead') opt.includeDead = true;
  else if (a === '--offline') opt.offline = true;
  else if (a === '--key-stdin') opt.keyStdin = true;
  else if (a === '--allow-chat') opt.allowChat = true;
  else if (a === '--kill-launcher') opt.killLauncher = true;
  else if (a === '--force') opt.force = true;
  else if (a === '--key') opt.key = argv[++i];
  else if (a === '--base-url') opt.baseUrl.push(argv[++i]);
  else if (a === '--model') opt.model = argv[++i];
  else if (a === '--name') opt.name = argv[++i];
  else if (a === '--codex-home') opt.home = argv[++i];
  else if (a === '--env-key') opt.envKey = argv[++i];
  else if (a === '--timeout') opt.timeout = parseInt(argv[++i], 10);
  else if (a.startsWith('--')) { console.error('未知参数: ' + a); process.exit(2); }
  else positional.push(a);
}

const cmd = positional[0] || 'deploy';
const DEFAULT_HOME = path.join(os.homedir(), '.codex');
const HOME = path.resolve(opt.home || process.env.CODEX_HOME || DEFAULT_HOME);
const CFG = path.join(HOME, 'config.toml');
const AUTH = path.join(HOME, 'auth.json');
const TIMEOUT = opt.timeout || 60000;   // 中转首次请求可能很慢（实测出现过 >25s），别把好通道误判
const DEFAULT_SLUG = 'custom';
const BAD_LOCAL = '127.0.0.1:<PORT>';

const log = s => { if (!opt.json) console.log(s); };
const out = { command: cmd, ok: false, steps: [], warnings: [], errors: [] };
const H = { ok: '[OK]  ', bad: '[BAD] ', warn: '[WARN]', info: '[--]  ' };

// ---------------------------------------------------------------- 工具

const mask = k => (!k ? '(无)' : k.length <= 12 ? k.slice(0, 3) + '***' : k.slice(0, 7) + '...' + k.slice(-4) + ` (${k.length}字符)`);
// 毫秒级时间戳：同一秒内连续两次操作也各留一份备份，不会互相覆盖
const stamp = () => new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 17);

function detectCliExe() {
  try {
    const cfg = fs.readFileSync(CFG, 'utf8');
    const m = cfg.match(/CODEX_CLI_PATH\s*=\s*'([^']+codex\.exe)'/i);
    if (m && fs.existsSync(m[1])) return m[1];
  } catch (_) {}
  const roots = [
    path.join(process.env.LOCALAPPDATA || '', 'OpenAI', 'Codex', 'bin'),
    path.join(os.homedir(), 'AppData', 'Local', 'OpenAI', 'Codex', 'bin'),
  ];
  for (const r of roots) {
    try {
      for (const d of fs.readdirSync(r)) {
        const p = path.join(r, d, 'codex.exe');
        if (fs.existsSync(p)) return p;
      }
    } catch (_) {}
  }
  return null;
}

function ps(cmdline) {
  const PS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  try {
    return execFileSync(PS, ['-NoProfile', '-NonInteractive', '-Command', cmdline + '; exit 0'],
      { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) { return ''; }
}

function portOpen(port, host = '127.0.0.1', ms = 1200) {
  return new Promise(res => {
    const s = net.connect({ host, port });
    const done = r => { try { s.destroy(); } catch (_) {} res(r); };
    s.setTimeout(ms);
    s.on('connect', () => done(true));
    s.on('timeout', () => done(false));
    s.on('error', () => done(false));
  });
}

// ------------------------------------------------- 启动器 & 宿主进程探测

async function environmentProbe() {
  const r = { launcherProcs: 0, proxyOpen: false, appRunning: 0 };
  const inSandbox = !!opt.home;                       // 隔离模式下不碰宿主机进程
  if (!inSandbox && process.platform === 'win32') {
    r.launcherProcs = parseInt(ps("(Get-Process -Name 'codex-plus-plus','codex-plus-plus-manager' -ErrorAction SilentlyContinue | Measure-Object).Count"), 10) || 0;
    r.appRunning = parseInt(ps("(Get-Process -Name 'ChatGPT' -ErrorAction SilentlyContinue | Measure-Object).Count"), 10) || 0;
  }
  r.proxyOpen = await portOpen(57321);
  return r;
}

function killLauncher() {
  const n = ps("(Get-Process -Name 'codex-plus-plus','codex-plus-plus-manager' -ErrorAction SilentlyContinue | ForEach-Object { $_.Kill(); 1 } | Measure-Object).Count");
  return parseInt(n, 10) || 0;
}

// ---------------------------------------------------------------- TOML

const lines = t => t.split(/\r?\n/);
const isHeader = l => /^\s*\[/.test(l) && !/^\s*[A-Za-z0-9_\-."']+\s*=/.test(l);

function sectionRange(arr, header) {
  let start = -1;
  for (let i = 0; i < arr.length; i++) if (arr[i].trim() === header) { start = i; break; }
  if (start < 0) return null;
  let end = arr.length;
  for (let i = start + 1; i < arr.length; i++) if (isHeader(arr[i])) { end = i; break; }
  return { start, end };
}

function readSection(text, header) {
  const r = sectionRange(lines(text), header);
  if (!r) return null;
  const obj = {};
  const body = lines(text).slice(r.start + 1, r.end);
  for (const l of body) {
    const m = l.match(/^\s*([A-Za-z0-9_\-]+)\s*=\s*(.*?)\s*$/);
    if (m) obj[m[1]] = m[2];
  }
  return obj;
}

function getTop(text, key) {
  const arr = lines(text);
  let inSec = false;
  for (const l of arr) {
    if (isHeader(l)) inSec = true;
    if (inSec) continue;
    const m = l.match(/^\s*([A-Za-z0-9_\-]+)\s*=\s*(.*?)\s*$/);
    if (m && m[1] === key) return m[2];
  }
  return null;
}

function setTop(text, key, valueLiteral) {
  const arr = lines(text);
  let inSec = false, hit = -1;
  for (let i = 0; i < arr.length; i++) {
    if (isHeader(arr[i])) inSec = true;
    if (inSec) continue;
    const m = arr[i].match(/^\s*([A-Za-z0-9_\-]+)\s*=/);
    if (m && m[1] === key) { hit = i; break; }
  }
  if (hit >= 0) { arr[hit] = `${key} = ${valueLiteral}`; return arr.join('\n'); }
  let at = arr.length;
  for (let i = 0; i < arr.length; i++) if (isHeader(arr[i])) { at = i; break; }
  const ins = [];
  if (valueLiteral !== null) ins.push(`${key} = ${valueLiteral}`);
  if (at > 0 && arr[at - 1].trim() !== '' && ins.length) ins.unshift('');
  arr.splice(at, 0, ...ins);
  return arr.join('\n');
}

/** 合并式 upsert：保留 section 里已有的未知字段；value 传 null 表示删除该键 */
function upsertSection(text, header, entries) {
  const arr = lines(text);
  const r = sectionRange(arr, header);
  const want = new Map(entries.filter(e => e[1] !== null));
  if (!r) {
    const a = arr.slice();
    while (a.length && a[a.length - 1].trim() === '') a.pop();
    a.push('', header);
    for (const [k, v] of want) a.push(`${k} = ${v}`);
    return a.join('\n');
  }
  const seen = new Set();
  const body = [];
  for (const l of arr.slice(r.start + 1, r.end)) {
    const m = l.match(/^\s*([A-Za-z0-9_\-]+)\s*=/);
    if (m && entries.some(e => e[0] === m[1])) {
      const v = entries.find(e => e[0] === m[1])[1];
      seen.add(m[1]);
      if (v !== null) body.push(`${m[1]} = ${v}`);
      continue;
    }
    body.push(l);
  }
  for (const [k, v] of want) if (!seen.has(k)) body.push(`${k} = ${v}`);
  return [...arr.slice(0, r.start + 1), ...body, ...arr.slice(r.end)].join('\n');
}

function listProviderHeaders(text) {
  return lines(text).filter(isHeader).map(l => l.trim()).filter(l => /^\[model_providers\./.test(l)).sort();
}

/** 结构体检：括号配对、section 头合法、无重复顶层键 */
function sanity(text) {
  const errs = [];
  const arr = lines(text);
  for (let i = 0; i < arr.length; i++) {
    const t = arr[i].trim();
    if (t.startsWith('[') && !/^\[[^\]\n]+\]$/.test(t)) errs.push(`第 ${i + 1} 行 section 头非法: ${t.slice(0, 60)}`);
    if (t && !t.startsWith('#') && !t.startsWith('[') && !/^[A-Za-z0-9_\-."']+\s*=/.test(t)) {
      errs.push(`第 ${i + 1} 行不是合法 key=value: ${t.slice(0, 60)}`);
    }
  }
  const seen = new Set();
  let inSec = false;
  for (const l of arr) {
    if (isHeader(l)) { inSec = true; continue; }
    if (inSec) continue;
    const m = l.match(/^\s*([A-Za-z0-9_\-]+)\s*=/);
    if (m) { if (seen.has(m[1])) errs.push(`顶层键重复: ${m[1]}`); seen.add(m[1]); }
  }
  return errs;
}

/** 指纹：剔除本次会动的部分后，其余内容必须逐字不变 */
function fingerprint(text, slug) {
  const arr = lines(text);
  const r = sectionRange(arr, `[model_providers.${slug}]`);
  const keep = [];
  for (let i = 0; i < arr.length; i++) {
    if (r && i >= r.start && i < r.end) continue;
    if (/^\s*(model_provider|model|review_model)\s*=/.test(arr[i])) continue;
    keep.push(arr[i]);
  }
  return keep.join('\n');
}

// ---------------------------------------------------------------- 网络探测

async function httpJson(url, { method = 'GET', key, body } = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      method,
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const txt = await r.text();
    let data = null;
    try { data = JSON.parse(txt); } catch (_) {}
    return { status: r.status, ms: Date.now() - t0, data, txt };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, err: e.name === 'TimeoutError' ? '超时' : e.message };
  }
}

async function getModels(base, key) {
  const r = await httpJson(base.replace(/\/+$/, '') + '/models', { key });
  if (r.status === 200 && r.data && Array.isArray(r.data.data)) {
    return { ok: true, ids: r.data.data.map(m => m.id || m.slug).filter(Boolean), ms: r.ms };
  }
  return { ok: false, status: r.status, err: r.err || (r.data && r.data.error && r.data.error.message) || (r.txt || '').slice(0, 160), ms: r.ms };
}

async function probeResponses(base, key, model) {
  const r = await httpJson(base.replace(/\/+$/, '') + '/responses', {
    method: 'POST', key,
    body: { model, input: [{ role: 'user', content: [{ type: 'input_text', text: 'reply with exactly: PONG' }] }], max_output_tokens: 64, stream: false },
  });
  // 原生 Responses 不一定带 output_text，需要从 output[] 里兜底取出文本
  const pick = d => {
    if (!d) return '';
    if (d.output_text) return d.output_text;
    if (Array.isArray(d.output)) return d.output.flatMap(o => (o.content || []).map(c => c.text || '')).join('');
    if (Array.isArray(d.choices)) return d.choices.map(c => (c.message && c.message.content) || '').join('');
    return '';
  };
  const text = pick(r.data);
  return { ok: r.status === 200, status: r.status, ms: r.ms, text, err: r.err || (r.data && r.data.error && r.data.error.message) || (r.txt || '').slice(0, 160) };
}

async function probeChat(base, key, model) {
  const r = await httpJson(base.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST', key,
    body: { model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 8 },
  });
  return { ok: r.status === 200, status: r.status, err: r.err || (r.data && r.data.error && r.data.error.message) };
}

/**
 * 批量实测每个模型在 /responses 上是否真能应答。
 *
 * 为什么非做不可：中转的 /v1/models 会「虚报」——本机这条通道列出 19 个模型，
 * 其中只有 4 个真能通过 Codex 用的 responses 协议应答，其余是
 *   500 not implemented（claude-* / deepseek-* 只实现了 chat 协议，而 CLI 已废弃 chat）、
 *   502 网关错误（gpt-5.4 / gpt-5.4-mini）、
 *   404 not supported by any configured account（gpt-5.6-luna）。
 * 不实测就把它们写进 App 选择器，等于埋 12 个坑：选一下就报错。
 */
async function probeMany(base, key, ids, { concurrency = 5, onEach = null } = {}) {
  const results = [];
  let i = 0;
  const worker = async () => {
    while (i < ids.length) {
      const id = ids[i++];
      const r = await probeResponses(base, key, id);
      r.model = id;
      results.push(r);
      if (onEach) onEach(r);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return results.sort((a, b) => ids.indexOf(a.model) - ids.indexOf(b.model));
}

/** 超时/网络错误重试一次：拿到明确 HTTP 状态码就不再重试 */
async function probeResponsesRetry(base, key, model, tries = 2) {
  let r;
  for (let i = 0; i < tries; i++) {
    r = await probeResponses(base, key, model);
    if (r.status !== 0) return r;
    if (i < tries - 1) await new Promise(s => setTimeout(s, 1500));
  }
  return r;
}

function pickModel(ids, cfgModel) {
  // 排除非对话模型：embedding / 语音 / 图像生成等，选了 Codex 也用不了
  const usable = ids.filter(i => !CHAT_SKIP.test(i));
  if (!usable.length) return ids[0] || null;
  if (cfgModel && usable.includes(cfgModel)) return cfgModel;
  const ranked = usable.find(i => /gpt-5/i.test(i)) || usable.find(i => /gpt-4\.1|^o[34]/i.test(i))
    || usable.find(i => /gpt-4|claude|deepseek|qwen|glm|kimi|gemini/i.test(i));
  return ranked || usable[0];
}

function candidates(currentBase) {
  const list = [];
  const push = u => { if (u && !/127\.0\.0\.1:57321|localhost:57321/.test(u)) { const n = u.replace(/\/+$/, ''); if (!list.includes(n)) list.push(n); } };
  opt.baseUrl.forEach(push);
  push(process.env.CODEX_BASE_URL);
  push(currentBase);
  push('https://apinexus.dpdns.org/v1');
  const k = opt.key || '';
  if (/^sk-(proj|svcacct|admin|None)/.test(k) || /^sk-[A-Za-z0-9_-]{40,}$/.test(k)) push('https://api.openai.com/v1');
  return list;
}

// ---------------------------------------------------------------- 备份

function backup(file) {
  if (!fs.existsSync(file)) return null;
  let b = `${file}.bak-api-${stamp()}`;
  let n = 1;
  while (fs.existsSync(b)) b = `${file}.bak-api-${stamp()}-${n++}`;   // 绝不覆盖已有备份
  fs.copyFileSync(file, b);
  return b;
}

function newestBackup(file) {
  const dir = path.dirname(file), base = path.basename(file);
  try {
    const all = fs.readdirSync(dir).filter(f => f.startsWith(base + '.bak-api-')).sort();
    return all.length ? path.join(dir, all[all.length - 1]) : null;
  } catch (_) { return null; }
}

function allBackups(file) {
  const dir = path.dirname(file), base = path.basename(file);
  try { return fs.readdirSync(dir).filter(f => f.startsWith(base + '.bak-api-')).sort().map(f => path.join(dir, f)); }
  catch (_) { return []; }
}

// ---------------------------------------------------------------- 模型目录
//
// 以下是本机实测出来的事实（Codex CLI 0.155.0-alpha.9.2 + App 26.915.4065.0），不是推测：
//
//   1) config.toml 里的 model_catalog_json 指向的文件「覆盖」内置目录，而不是合并。
//      判据：只写 1 条后跑 `codex debug models`，内置的 9 条一条都不剩。
//      ⇒ 想让 App 的模型选择器里能选到 N 个模型，就得在文件里写 N 条。
//   2) 条目 visibility 取值只有 "list"（进选择器）和 "hide"（不进）。
//   3) 条目必须带 model_messages.instructions_template（系统提示词），否则模型没有指令。
//   4) prefer_websockets / use_responses_lite / tool_mode 属官方通道专用，第三方中转不支持，
//      必须剥掉——否则整条通道可能直接不通。
//   5) `codex debug models` 渲染 app-server 实际解析出的目录，等同于 App 看到的东西。
//      ⇒ 不用重启 App 就能验证同步结果，这是本模块的验收手段。

const CHAT_SKIP = /embed|whisper|tts|dall|image|moderation|rerank|audio|video|sora/i;

// 从 codex.exe 里抽出内置模型目录：官方条目带真实显示名/上下文窗口/提示词模板，
// 拿来当模板比凭空编强。302MB 的 exe 全读一遍要 1-2s，按 mtime+size 缓存到 tmp。
function readBuiltinCatalog() {
  const exe = detectCliExe();
  if (!exe) return { ok: false, models: [], err: '找不到 codex.exe' };
  let tag = 'unknown';
  try { const st = fs.statSync(exe); tag = st.size + '-' + Math.round(st.mtimeMs); } catch (_) {}
  const cache = path.join(os.tmpdir(), `builtin-catalog-${tag}.json`);
  try { if (fs.existsSync(cache)) return { ok: true, models: JSON.parse(fs.readFileSync(cache, 'utf8')).models || [], exe, cached: true }; } catch (_) {}
  try {
    const s = fs.readFileSync(exe).toString('latin1');
    const anchor = s.indexOf('"models"');
    if (anchor < 0) return { ok: false, models: [], err: 'exe 内未找到内嵌目录', exe };
    const start = s.lastIndexOf('{', anchor);
    let depth = 0, end = -1;
    for (let j = start; j < s.length; j++) {
      const c = s[j];
      if (c === '{') depth++;
      else if (c === '}' && --depth === 0) { end = j + 1; break; }
    }
    const models = JSON.parse(s.slice(start, end)).models || [];
    try { fs.writeFileSync(cache, JSON.stringify({ models }), 'utf8'); } catch (_) {}
    return { ok: true, models, exe };
  } catch (e) { return { ok: false, models: [], err: e.message, exe }; }
}

// 显示宽度：中日韩字符占 2 列，用来对齐全角混排的表格
function padVis(s, n) {
  const w = [...String(s)].reduce((a, c) => a + (/[\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(c) ? 2 : 1), 0);
  return String(s) + ' '.repeat(Math.max(1, n - w));
}

const BRAND = { gpt: 'GPT', deepseek: 'DeepSeek', claude: 'Claude', glm: 'GLM', qwen: 'Qwen', kimi: 'Kimi', gemini: 'Gemini' };

// gpt-5.4-mini -> GPT-5.4-Mini ； claude-opus-4-6 -> Claude Opus 4.6 ； deepseek-v4-pro-max -> DeepSeek V4 Pro Max
function prettyName(slug) {
  const parts = slug.split('-');
  if (/^gpt/i.test(slug)) {
    return parts.map(p => /^[a-z]/i.test(p) && !/^\d/.test(p) ? p[0].toUpperCase() + p.slice(1) : p)
      .join('-').replace(/^Gpt/, 'GPT');
  }
  const head = parts.map(p => {
    if (/^\d/.test(p)) return p;
    const b = BRAND[p.toLowerCase()];
    return b || p[0].toUpperCase() + p.slice(1);
  });
  const tail = [];
  while (head.length > 1 && /^\d+$/.test(head[head.length - 1]) && /^\d+$/.test(head[head.length - 2])) tail.unshift(head.pop());
  return head.join(' ') + (tail.length ? '.' + tail.join('.') : '');
}

function catalogFile() {
  const cfg = fs.existsSync(CFG) ? fs.readFileSync(CFG, 'utf8') : '';
  const rel = (getTop(cfg, 'model_catalog_json') || '').replace(/^["']|["']$/g, '');
  if (!rel) return null;
  return path.isAbsolute(rel) ? rel : path.join(HOME, rel);
}

function readCatalog(file = catalogFile()) {
  if (!file || !fs.existsSync(file)) return null;
  try { const c = JSON.parse(fs.readFileSync(file, 'utf8')); c.models = c.models || []; return c; }
  catch (_) { return null; }
}

// app-server 实际解析出的目录 = App 看到的东西。
// 必须带上 CODEX_HOME，否则会去验「真实的家目录」而不是这次操作的目标目录——
// 用 --codex-home 隔离时就会验错对象，导致刚写好的目录被误判不一致而回滚。
function resolveEffectiveCatalog() {
  const exe = detectCliExe();
  if (!exe) return { ok: false, err: '找不到 codex.exe' };
  try {
    const t = execFileSync(exe, ['debug', 'models'],
      { encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CODEX_HOME: HOME } });
    const models = JSON.parse(t).models || [];
    return { ok: true, models, slugs: models.map(m => m.slug) };
  } catch (e) {
    const msg = String((e.stderr || '') + '').trim() || e.message || ('exit ' + e.status);
    return { ok: false, err: msg.split('\n')[0].slice(0, 200) };
  }
}

// 按「已验证可用」的条目形状克隆，只替换身份字段；能从内置目录拿到真实元信息的就用真的。
//
// 刻意不照抄内置条目的 model_messages：官方模板里带 available_in_plans 套餐门禁、
// guardian_v2 / tools / confirmation_policies 等 App 内部机制，还有没定义变量的
// {{connector_id}} 占位符——直接搬进第三方中转条目风险大于收益。要试就加 --builtin-instructions。
function makeEntry(slug, priority, { template, builtin, useBuiltinMessages = false }) {
  const e = normalizeEntry(JSON.parse(JSON.stringify(template)));
  e.slug = slug;
  e.display_name = (builtin && builtin.display_name) || prettyName(slug);
  e.description = (builtin && builtin.description) || `${e.display_name}（第三方中转接入）`;
  e.priority = priority;
  e.visibility = 'list';
  e.supported_in_api = true;
  if (builtin) {
    for (const k of ['context_window', 'max_context_window', 'supported_reasoning_levels', 'default_reasoning_level', 'minimal_client_version']) {
      if (builtin[k] !== undefined && builtin[k] !== null) e[k] = builtin[k];
    }
    if (useBuiltinMessages && builtin.model_messages) e.model_messages = builtin.model_messages;
    else if (useBuiltinMessages && builtin.base_instructions) e.base_instructions = builtin.base_instructions;
  }
  // 官方通道专用字段，第三方中转撑不住，剥掉
  delete e.prefer_websockets;
  delete e.tool_mode;
  delete e.multi_agent_version;
  delete e.available_in_plans;
  e.use_responses_lite = false;
  return e;
}

// 旧条目里 display_name / description 是自动填的（等于 slug）时，换成好看的名字
function tidyName(e, builtin) {
  const out = { ...normalizeEntry(e), priority: 0 };
  if (!out.display_name || out.display_name === out.slug || /^[a-z0-9.\-]+$/.test(out.display_name)) {
    out.display_name = (builtin && builtin.display_name) || prettyName(out.slug);
  }
  if (!out.description || out.description === out.slug) {
    out.description = (builtin && builtin.description) || `${out.display_name}（第三方中转接入）`;
  }
  return out;
}

function sortRank(id) {
  return /^gpt/i.test(id) ? 0 : /^claude-opus/i.test(id) ? 1 : /^claude/i.test(id) ? 2
    : /^deepseek/i.test(id) ? 3 : 4;
}

function buildCatalogEntries(ids, template, builtinList, { preserve = new Map(), keep = [], prune = false, builtinInstructions = false } = {}) {
  const ubm = !!builtinInstructions;
  const builtinMap = new Map(builtinList.map(m => [m.slug, m]));
  const entries = [];
  const known = ids.filter(id => builtinMap.has(id));
  const unknown = ids.filter(id => !builtinMap.has(id));
  // 未知模型按「厂商分组 + 名称降序」排，版本号大的在前
  unknown.sort((a, b) => sortRank(a) - sortRank(b) || b.localeCompare(a));
  const catBase = { 0: 17, 1: 20, 2: 25, 3: 30, 4: 40 };
  const used = {};

  for (const id of known) {
    const b = builtinMap.get(id);
    const p = preserve.get(id);
    if (p) { entries.push(tidyName(p, b)); continue; }  // 当前在用的条目原样保留，只修显示名并提到最前
    entries.push(makeEntry(id, typeof b.priority === 'number' ? b.priority : 50, { template, builtin: b, useBuiltinMessages: ubm }));
  }
  for (const id of unknown) {
    const p = preserve.get(id);
    if (p) { entries.push(tidyName(p, null)); continue; }
    const r = sortRank(id);
    used[r] = (used[r] || 0) + 1;
    entries.push(makeEntry(id, (catBase[r] || 40) + used[r] - 1, { template, builtin: null }));
  }
  // 目录文件是「覆盖」内置目录：不在中转列表里的旧条目，默认保留而不是悄悄丢掉
  if (!prune) keep.forEach((e, i) => entries.push({ ...tidyName(e, null), priority: 200 + i }));

  const seen = new Set();
  const uniq = entries.filter(e => { if (seen.has(e.slug)) return false; seen.add(e.slug); return true; });
  return uniq.sort((a, b) => a.priority - b.priority);
}

// 把模型写进目录，并用 `codex debug models` 验收；验收不过就自动回滚
async function syncCatalog({ ids, base, key, dryRun = false, only = null } = {}) {
  const file = catalogFile();
  if (!file) {
    log(`${H.info} config.toml 未设 model_catalog_json —— App 用内置目录，无需同步`);
    out.steps.push({ catalog: null, action: 'skipped', reason: '未配置 model_catalog_json' });
    return null;
  }
  if (!fs.existsSync(file)) {
    log(`${H.warn} 目录文件不存在：${file}（不凭空创建，跳过）`);
    out.steps.push({ catalog: file, action: 'skipped', reason: '文件不存在' });
    return null;
  }
  const cur = readCatalog(file);
  if (!cur) { log(`${H.bad} 目录文件不是合法 JSON，跳过同步: ${file}`); out.steps.push({ catalog: file, action: 'skipped', reason: 'JSON 非法' }); return null; }

  // 拉模型列表（没传就自己拉）
  if (!ids || !ids.length) {
    if (!base) { log(`${H.bad} 无法取得模型列表：没有可用 provider`); return null; }
    const m = await getModels(base, key);
    if (!m.ok) { log(`${H.bad} 拉取模型列表失败: ${m.status || ''} ${m.err}`); return null; }
    ids = m.ids;
  }

  const all = ids.slice();
  const chatOnly = opt.includeImage ? all.slice() : all.filter(i => !CHAT_SKIP.test(i));
  const skipped = opt.includeImage ? [] : all.filter(i => CHAT_SKIP.test(i));
  const candidates = only && only.length ? chatOnly.filter(i => only.includes(i)) : chatOnly;

  // 实测每个候选：/v1/models 会虚报，只有真能应答的才配写进 App 选择器
  let usable = candidates;
  let dead = [];
  if (!opt.noProbe && base && key) {
    log(`\n实测 ${candidates.length} 个候选模型能否走 /responses 应答（并发 5，慢的会到 30s+）…`);
    const rs = await probeMany(base, key, candidates, {
      concurrency: 5,
      onEach: r => log(`  ${r.ok ? H.ok : (r.status === 0 ? H.warn : H.bad)} ${r.model.padEnd(24)} ${r.status || '超时'} ${r.ms}ms ${r.ok ? '"' + (r.text || '').trim().slice(0, 20) + '"' : String(r.err || '').slice(0, 70)}`),
    });
    dead = rs.filter(r => !r.ok);
    usable = rs.filter(r => r.ok).map(r => r.model);
    log(`\n  可用 ${usable.length} / ${candidates.length}` + (dead.length ? `，不可用 ${dead.length} 个已排除（默认不写进目录）` : ''));
    out.steps.push({ probe: { total: candidates.length, ok: usable.length, dead: dead.map(d => ({ model: d.model, status: d.status })) } });
  } else if (!opt.noProbe) {
    log(`\n${H.warn} 没有可用 base_url/key，跳过实测，按 /models 列表直接写（可能写入用不了的模型）`);
  }

  const cfgModel = (getTop(fs.readFileSync(CFG, 'utf8'), 'model') || '').replace(/"/g, '');
  const template = cur.models.find(m => m.slug === cfgModel) || cur.models[0] || FALLBACK_ENTRY();
  const bi = readBuiltinCatalog();

  // 目录文件是「覆盖」内置目录。所以：实测失败的默认剔除（写进去就是个坑），
  // 不在中转声明里的旧条目默认保留（可能是别的 provider 留下的），--prune 可清掉。
  const deadSet = new Set(dead.map(d => d.model));
  const written = opt.includeDead ? candidates : usable;
  if (!written.length) {
    log(`\n${H.bad} 没有任何可用模型，拒绝写入空目录（CLI 会报 must contain at least one model）`);
    out.errors.push('同步后目录会为空，已中止');
    return null;
  }
  const advertised = new Set(all);
  const willEmit = new Set(written);
  const preserve = new Map();
  const curEntry = cur.models.find(m => m.slug === cfgModel);
  if (curEntry && written.includes(cfgModel)) preserve.set(cfgModel, curEntry);
  // 旧条目的去留：已经在写入列表里的不用管；中转声明过但实测不通过的剔除（写进去是坑）；
  // 其余（中转没声明的，含当前配置的模型）一律保留 —— 之前漏了这一条，
  // 会把「当前正在用、但不在中转列表里」的模型从选择器里抹掉。
  const keep = opt.prune ? [] : cur.models.filter(m => !willEmit.has(m.slug) && !advertised.has(m.slug));

  const entries = buildCatalogEntries(written, template, bi.models, { preserve, keep, prune: !!opt.prune, builtinInstructions: !!opt.builtinInstructions });

  log(`\n模型目录  : ${file}`);
  log(`中转声明  : ${all.length} 个` + (skipped.length ? `，非对话跳过 ${skipped.length} 个（${skipped.join(', ')}）` : ''));
  if (!opt.noProbe && base && key) {
    log(`实测可应答: ${usable.length} 个` + (dead.length ? `，${dead.length} 个不可用已排除${opt.includeDead ? '（--include-dead 生效，仍写入）' : '（要硬写加 --include-dead）'}` : ''));
  }
  log(`条目模板  : ${curEntry ? `沿用当前模型 ${cfgModel} 的条目形状` : '目录里第一条'}${bi.ok ? `；内置目录 ${bi.models.length} 条供元信息参考` : `（内置目录读取失败：${bi.err}）`}`);
  if (keep.length) log(`保留旧条目: ${keep.length} 个（不在当前中转列表里）${keep.map(m => m.slug).join(', ')}    要清掉加 --prune`);
  log('');
  log(padVis('  prio  模型', 32) + padVis('App 显示名', 22) + '状态');
  for (const e of entries) {
    const isKept = keep.some(k => k.slug === e.slug);
    const tag = e.slug === cfgModel ? '当前使用' : isKept ? '旧条目保留' : deadSet.has(e.slug) ? '中转不支持' : '可用';
    log('  ' + padVis(e.priority, 5) + padVis(e.slug, 26) + padVis(e.display_name, 22) + tag
      + (bi.models.some(m => m.slug === e.slug) ? '  内置有元信息' : ''));
  }

  if (dryRun) {
    log('\n--dry-run：未写文件。');
    out.ok = true; out.dry_run = true; out.catalog_plan = entries.map(e => e.slug);
    return entries;
  }

  if (JSON.stringify(cur.models) === JSON.stringify(entries)) {
    log(`\n${H.ok} 目录已是最新（${entries.length} 条），未改写`);
    out.steps.push({ catalog: file, action: 'unchanged', count: entries.length });
    out.catalog = { file, count: entries.length, models: entries.map(e => e.slug), unchanged: true };
    return entries;
  }

  const next = JSON.parse(JSON.stringify(cur));
  next.models = entries;
  const b = backup(file);
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n', 'utf8');
  log(`\n${H.ok} 已写入 ${file}` + (b ? `（备份 ${path.basename(b)}）` : ''));

  // 验收：app-server 解析结果必须与写入一致，否则回滚
  const v = resolveEffectiveCatalog();
  if (!v.ok) {
    if (b) fs.copyFileSync(b, file);
    log(`${H.bad} 验收失败（${v.err}），已回滚`);
    out.errors.push('模型目录验收失败: ' + v.err);
    return null;
  }
  const want = entries.map(e => e.slug);
  const missing = want.filter(s => !v.slugs.includes(s));
  const extra = v.slugs.filter(s => !want.includes(s));
  log(`  验收: codex debug models -> ${v.slugs.length} 条` + (missing.length ? `，缺 ${missing.join(', ')}` : '') + (extra.length ? `，多 ${extra.join(', ')}` : ''));
  if (missing.length || extra.length) {
    if (b) fs.copyFileSync(b, file);
    log(`${H.bad} 解析结果与写入不一致，已回滚`);
    out.errors.push('模型目录解析不一致，已回滚');
    return null;
  }
  log(`${H.ok} 验收通过：App 里将能看到这 ${v.slugs.length} 个模型（需完整重启 App）`);
  out.steps.push({ catalog: file, action: 'synced', count: entries.length, verified: true, backup: b ? path.basename(b) : null });
  out.catalog = { file, count: entries.length, models: want, skipped, kept: keep.map(m => m.slug) };
  return entries;
}

async function cmdCatalog(sub) {
  const cfg = fs.existsSync(CFG) ? fs.readFileSync(CFG, 'utf8') : '';
  const prov = (getTop(cfg, 'model_provider') || '').replace(/"/g, '');
  // --base-url / --key 可覆盖配置里的通道，便于「不动配置、只同步目录」或临时验证别的中转
  const base = (opt.baseUrl[0] || (prov ? ((readSection(cfg, `[model_providers.${prov}]`) || {}).base_url || '').replace(/"/g, '') : ''));
  // 显式传的 --key / --key-stdin 优先，其次环境变量，最后才是 auth.json 里存的
  let stored = '';
  try { stored = JSON.parse(fs.readFileSync(AUTH, 'utf8')).OPENAI_API_KEY || ''; } catch (_) {}
  const key = opt.key || (opt.keyStdin ? fs.readFileSync(0, 'utf8').trim() : '') || process.env.OPENAI_API_KEY || stored;

  if (sub === 'sync' || sub === 'all') {
    const e = await syncCatalog({ base, key, dryRun: opt.dryRun, only: opt.only ? opt.only.split(/[,\s]+/).filter(Boolean) : null });
    out.ok = !!e || out.ok;
    if (!e) process.exit(1);
    return;
  }
  // list
  const file = catalogFile();
  if (!file) { log('config.toml 未设 model_catalog_json —— App 使用内置目录'); out.ok = true; return; }
  const cat = readCatalog(file);
  if (!cat) { console.error(`目录文件不可用: ${file}`); process.exit(1); }
  const eff = resolveEffectiveCatalog();
  log(`模型目录 : ${file}`);
  log(`声明条目 : ${cat.models.length} 条`);
  log(`App 可见 : ${eff.ok ? eff.slugs.length + ' 条（codex debug models 实测）' : '未知（' + eff.err + '）'}`);
  log('');
  for (const m of cat.models)
    log(`  ${String(m.priority).padEnd(5)}${String(m.slug).padEnd(24)}${String(m.display_name).padEnd(20)}vis=${m.visibility}`);
  out.ok = true;
  out.catalog = { file, count: cat.models.length, models: cat.models.map(m => m.slug), effective: eff.ok ? eff.slugs : null };
}

// 目录条目形状（与实测可用条目一致）。
// 这些字段是硬要求：缺一个 CLI 就报 `failed to parse model_catalog_json ... missing field`，
// 而且报错会让整份配置解析失败——所以任何条目写出去之前都先跟这份兜底形状合并补齐。
let _fallbackEntry = null;
function FALLBACK_ENTRY() {
  if (_fallbackEntry) return JSON.parse(JSON.stringify(_fallbackEntry));
  const cand = path.join(__dirname, '..', 'templates', 'model-entry.json');
  try { _fallbackEntry = JSON.parse(fs.readFileSync(cand, 'utf8')); return JSON.parse(JSON.stringify(_fallbackEntry)); } catch (_) {}
  _fallbackEntry = {
    slug: 'placeholder', display_name: 'placeholder', description: 'placeholder',
    default_reasoning_level: 'medium',
    supported_reasoning_levels: [
      { effort: 'low', description: 'Fast responses with lighter reasoning' },
      { effort: 'medium', description: 'Balances speed and reasoning depth for everyday tasks' },
      { effort: 'high', description: 'Greater reasoning depth for complex problems' },
      { effort: 'xhigh', description: 'Extra high reasoning depth for complex problems' },
    ],
    shell_type: 'unified_exec', visibility: 'list', supported_in_api: true, priority: 1000,
    additional_speed_tiers: [], service_tiers: [], availability_nux: null, upgrade: null,
    model_messages: {
      instructions_template: 'You are Codex, a coding agent. You and the user share the same workspace and collaborate to achieve the user\'s goals.',
      instructions_variables: null, approvals: null, collaboration_modes: null,
      auto_review: null, permissions: null, multi_agent: null,
    },
    include_skills_usage_instructions: false, include_plugin_usage_instructions: false,
    include_apps_usage_instructions: true, default_reasoning_summary: 'none',
    support_verbosity: true, default_verbosity: 'low', apply_patch_tool_type: 'freeform',
    web_search_tool_type: 'text_and_image', truncation_policy: { mode: 'tokens', limit: 10000 },
    supports_image_detail_original: true, context_window: 1000000, max_context_window: 1000000,
    effective_context_window_percent: 95, experimental_supported_tools: [],
    input_modalities: ['text', 'image'], supports_search_tool: true,
    supports_experimental_context: false, use_responses_lite: false,
    node_repl_auto_review_required: false, node_repl_disabled: false,
  };
  return JSON.parse(JSON.stringify(_fallbackEntry));
}

// 用兜底形状补齐缺字段的条目（旧目录、别人写的不完整条目都靠它救回来）
function normalizeEntry(e) { return { ...FALLBACK_ENTRY(), ...e }; }

// ---------------------------------------------------------------- 命令

async function cmdStatus() {
  log(`CODEX_HOME : ${HOME}`);
  const exists = fs.existsSync(CFG);
  log(`config.toml: ${exists ? CFG : '不存在'}`);

  let cfg = exists ? fs.readFileSync(CFG, 'utf8') : '';
  const prov = getTop(cfg, 'model_provider');
  const model = getTop(cfg, 'model');
  const wire = prov ? (readSection(cfg, `[model_providers.${prov.replace(/"/g, '')}]`) || {}).wire_api : null;
  log(`\nprovider   : ${prov || '(未设置)'}`);
  log(`model      : ${model || '(未设置)'}`);
  log(`wire_api   : ${wire || '(未设置)'}`);
  out.steps.push({ provider: prov, model, wire_api: wire });

  const headers = listProviderHeaders(cfg);
  log(`\n已定义 provider: ${headers.length ? headers.join('  ') : '(无)'}`);
  for (const h of headers) {
    const s = readSection(cfg, h) || {};
    log(`  ${h.replace(/^\[model_providers\.|\]$/g, '')}  base_url=${s.base_url || '?'}  wire_api=${s.wire_api || '?'}  ${s.requires_openai_auth ? 'auth.json' : (s.env_key ? 'env:' + s.env_key : '')}`);
  }

  try {
    const k = JSON.parse(fs.readFileSync(AUTH, 'utf8')).OPENAI_API_KEY;
    log(`\nauth.json  : 有 key ${mask(k)}`);
  } catch (e) { log(`\nauth.json  : ${fs.existsSync(AUTH) ? '读取失败 ' + e.message : '不存在'}`); }

  const cat = getTop(cfg, 'model_catalog_json');
  if (cat) {
    const p = catalogFile();
    if (p && fs.existsSync(p)) {
      const c = readCatalog(p);
      const cur = (model || '').replace(/"/g, '');
      const has = !!(c && c.models.some(m => m.slug === cur));
      const eff = resolveEffectiveCatalog();
      log(`模型目录   : ${path.basename(p)} 声明 ${c ? c.models.length : '?'} 条`
        + `，App 实际可见 ${eff.ok ? eff.slugs.length + ' 条' : '未知（' + eff.err + '）'}`);
      log(`             ${has ? '已包含当前模型 ' + cur : '⚠ 未包含当前模型 ' + cur + '，App 里选不到'}`);
      log('             注意：目录文件是「覆盖」内置目录，不是追加');
      out.steps.push({ catalog: p, declared: c ? c.models.map(m => m.slug) : null, effective: eff.ok ? eff.slugs : null, model_declared: has });
    }
  }

  const env = await environmentProbe();
  if (env.launcherProcs || env.proxyOpen) out.warnings.push('检测到第三方启动器（Codex++）在运行，它会覆写 config.toml');
  if (!opt.offline && prov) {
    const base = (readSection(cfg, `[model_providers.${prov.replace(/"/g, '')}]`) || {}).base_url;
    if (base) {
      const b = base.replace(/^"|"$/g, '');
      try {
        const k = JSON.parse(fs.readFileSync(AUTH, 'utf8')).OPENAI_API_KEY;
        const m = await getModels(b, k);
        log(`\n通道实测   : ${b} -> ${m.ok ? `OK, ${m.ids.length} 个模型 [${m.ids.slice(0, 8).join(', ')}]` : 'FAIL ' + (m.status || m.err)}`);
        out.steps.push({ base_url: b, models_ok: m.ok, models: m.ids || [], status: m.status });
      } catch (e) { log(`\n通道实测   : 跳过（${e.message}）`); }
    }
  }
  const cli = detectCliExe();
  if (cli) {
    const v = (() => { try { return execFileSync(cli, ['--version'], { encoding: 'utf8', timeout: 60000 }).trim(); } catch (e) { return '读取失败'; } })();
    log(`\nCodex CLI  : ${cli}\n             ${v}`);
    out.steps.push({ cli, version: v });
  }
  out.ok = true;
}

function cmdList() {
  if (!fs.existsSync(CFG)) { log('config.toml 不存在'); return; }
  const cfg = fs.readFileSync(CFG, 'utf8');
  const prov = (getTop(cfg, 'model_provider') || '').replace(/"/g, '');
  const headers = listProviderHeaders(cfg);
  if (!headers.length) { log('没有任何 [model_providers.*] 段'); return; }
  log('provider'.padEnd(16) + 'base_url'.padEnd(44) + 'wire_api'.padEnd(12) + '模型');
  for (const h of headers) {
    const slug = h.replace(/^\[model_providers\.|\]$/g, '');
    const s = readSection(cfg, h) || {};
    const cur = slug === prov;
    log((cur ? '* ' : '  ') + slug.padEnd(14) + (s.base_url || '?').replace(/"/g, '').padEnd(44)
      + (s.wire_api || '?').replace(/"/g, '').padEnd(12) + (cur ? (getTop(cfg, 'model') || '').replace(/"/g, '') : '-'));
  }
  log('\n* = 当前使用。切换: codex-deploy.js use <name> --model <model>');
  out.ok = true;
}

function cmdUse() {
  const slug = positional[1];
  if (!slug) { console.error('用法: use <name> [--model <model>]'); process.exit(2); }
  const cfg = fs.readFileSync(CFG, 'utf8');
  if (!sectionRange(lines(cfg), `[model_providers.${slug}]`)) {
    console.error(`找不到 provider: ${slug}`); process.exit(1);
  }
  let next = setTop(cfg, 'model_provider', JSON.stringify(slug));
  if (opt.model) {
    next = setTop(next, 'model', JSON.stringify(opt.model));
    if (getTop(next, 'review_model')) next = setTop(next, 'review_model', JSON.stringify(opt.model));
  } else {
    out.warnings.push('未指定 --model，沿用当前模型名；若新通道不支持该模型会 503');
  }
  const b = backup(CFG);
  fs.writeFileSync(CFG, next, 'utf8');
  log(`${H.ok} 已切换到 ${slug}${opt.model ? ' / ' + opt.model : ''}`);
  if (b) log(`备份: ${path.basename(b)}`);
  out.ok = true;
}

function cmdRestore() {
  const sel = positional[1];
  const list = allBackups(CFG);
  const alist = allBackups(AUTH);
  if (!list.length && !alist.length) { console.error('没有可回滚的备份'); process.exit(1); }
  let name = list[list.length - 1];
  if (sel) {
    const byIndex = /^\d+$/.test(sel) ? list[list.length - 1 - parseInt(sel, 10)] : null;
    const byName = list.find(f => f.includes(sel));
    if (!byIndex && !byName) {
      console.error(`找不到备份: ${sel}\n现有备份:\n  ` + (list.join('\n  ') || '(无)'));
      process.exit(1);
    }
    name = byIndex || byName;
  }
  if (name) {
    fs.copyFileSync(name, CFG);
    log(`${H.ok} config.toml 已回滚自 ${path.basename(name)}`);
    const cfg = fs.readFileSync(CFG, 'utf8');
    log(`  现 provider=${getTop(cfg, 'model_provider')} model=${getTop(cfg, 'model')}`);
  }
  // auth.json 只在 config 一起回滚时跟随；单独 restore 不猜用户意图
  if (alist.length && !sel) {
    const ab = alist[alist.length - 1];
    fs.copyFileSync(ab, AUTH);
    log(`${H.ok} auth.json 已回滚自 ${path.basename(ab)}`);
  }
  out.ok = true;
}

function cmdBackups() {
  const list = allBackups(CFG), alist = allBackups(AUTH);
  log(`config.toml 备份 (${list.length}):`);
  list.forEach((f, i) => log(`  ${i === list.length - 1 ? '*' : ' '} ${f}`));
  log(`\nauth.json 备份 (${alist.length}):`);
  alist.forEach((f, i) => log(`  ${i === alist.length - 1 ? '*' : ' '} ${f}`));
  log('\n* = restore 默认取这一份。指定某份: restore <文件名片段或序号(0=最新)>');
  out.ok = true;
}

async function cmdModels() {
  const cfg = fs.existsSync(CFG) ? fs.readFileSync(CFG, 'utf8') : '';
  const prov = (getTop(cfg, 'model_provider') || '').replace(/"/g, '');
  const sec = prov ? (readSection(cfg, `[model_providers.${prov}]`) || {}) : {};
  const base = (sec.base_url || '').replace(/"/g, '');
  if (!base) { console.error('没有可用的 provider，先跑 deploy'); process.exit(1); }
  let key = opt.key || process.env.OPENAI_API_KEY || '';
  try { key = key || JSON.parse(fs.readFileSync(AUTH, 'utf8')).OPENAI_API_KEY || ''; } catch (_) {}
  const m = await getModels(base, key);
  if (!m.ok) { console.error(`拉取失败: ${m.status || ''} ${m.err}`); process.exit(1); }
  const cur = (getTop(cfg, 'model') || '').replace(/"/g, '');
  // 把全部可用模型写进目录（App 选择器只认目录里的条目）
  if (opt.allModels) {
    const e = await syncCatalog({ ids: m.ids, base, key, dryRun: opt.dryRun });
    if (!e) process.exit(1);
    out.ok = true; out.models = m.ids;
    return;
  }
  const catRel = (getTop(cfg, 'model_catalog_json') || '').replace(/^["']|["']$/g, '');
  let declared = [];
  if (catRel) {
    try {
      const p = path.isAbsolute(catRel) ? catRel : path.join(HOME, catRel);
      declared = (JSON.parse(fs.readFileSync(p, 'utf8')).models || []).map(x => x.slug);
    } catch (_) {}
  }
  log(`${base}  共 ${m.ids.length} 个模型（${m.ms}ms）\n`);
  for (const id of m.ids) {
    const tags = [];
    if (id === cur) tags.push('当前');
    if (declared.includes(id)) tags.push('App可选');
    log(`  ${id === cur ? '*' : ' '} ${id}${tags.length ? '   [' + tags.join(' / ') + ']' : ''}`);
  }
  log(`\n* = 当前使用。「App可选」= 目录里声明过，App 模型选择器里能选到（目录共 ${declared.length} 条）。`);
  log('目录写的是「覆盖」内置目录，不是追加 —— 想让 App 里多几个模型，就跑：');
  log('   codex-deploy.js catalog sync        （把全部可对话模型写进目录并验收）');
  log('   codex-deploy.js models --sync       （同上，快捷写法）');
  log('换当前模型: deploy --model <名字>');
  out.ok = true;
  out.models = m.ids;
}

async function cmdTest() {
  const cfg = fs.existsSync(CFG) ? fs.readFileSync(CFG, 'utf8') : '';
  const prov = (getTop(cfg, 'model_provider') || '').replace(/"/g, '');
  const model = (getTop(cfg, 'model') || '').replace(/"/g, '');
  const base = prov ? ((readSection(cfg, `[model_providers.${prov}]`) || {}).base_url || '').replace(/"/g, '') : '';
  if (base) {
    let key = process.env.OPENAI_API_KEY || '';
    try { key = JSON.parse(fs.readFileSync(AUTH, 'utf8')).OPENAI_API_KEY || key; } catch (_) {}
    const p = await probeResponsesRetry(base, key, model);
    const tag = p.ok ? H.ok : (p.status === 0 ? H.warn : H.bad);
    log(`协议实测 : POST ${base}/responses -> ${p.ok ? 'OK' : (p.status === 0 ? '超时/网络不通' : 'FAIL')} ${p.status || ''} ${p.ms}ms`);
    if (p.ok) log(`回复     : ${(p.text || '').trim().slice(0, 80) || '(空)'}`);
    else {
      log(`错误     : ${p.err}`);
      if (p.status === 401 || p.status === 403) out.errors.push('鉴权失败：key 与 base_url 不匹配或已失效');
      if (p.status === 0) out.warnings.push('协议探测超时（不代表配置无效，请看下方 CLI 实测结论）');
    }
    out.steps.push({ protocol: p.ok, status: p.status, ms: p.ms });
  }
  const cli = detectCliExe();
  if (!cli) { log('未找到 codex.exe，跳过 CLI 实测'); out.ok = true; return; }
  log(`CLI 实测 : ${cli}`);
  await new Promise(res => {
    const t0 = Date.now();
    const p = spawn(cli, ['exec', '--skip-git-repo-check', 'reply with exactly: PONG'],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, CODEX_HOME: HOME } });
    let o = '', e = '';
    p.stdout.on('data', x => o += x);
    p.stderr.on('data', x => e += x);
    p.stdin.end('');                                   // 不关 stdin 会永久卡住
    const timer = setTimeout(() => { log('超时 180s，强制结束'); p.kill(); }, 180000);
    p.on('close', code => {
      clearTimeout(timer);
      const fatal = /Error loading config\.toml|is no longer supported|unrecognized/i.test(e);
      log(`exit=${code} 耗时=${((Date.now() - t0) / 1000).toFixed(1)}s 配置致命错误=${fatal ? 'YES' : 'no'}`);
      log('stdout: ' + (o.trim().slice(0, 300) || '(空)'));
      if (e.trim()) log('stderr: ' + e.trim().slice(0, 400));
      out.steps.push({ cli_exit: code, fatal });
      out.ok = code === 0 && !fatal;
      res();
    });
    p.on('error', x => { clearTimeout(timer); log('spawn 失败: ' + x.message); res(); });
  });
}

async function cmdDeploy() {
  // 1) 取 key
  let key = opt.key || process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY;
  if (opt.keyStdin) key = fs.readFileSync(0, 'utf8').trim();
  if (!key && fs.existsSync(AUTH) && opt.force !== true) {
    try { key = JSON.parse(fs.readFileSync(AUTH, 'utf8')).OPENAI_API_KEY; } catch (_) {}
    if (key) log(`${H.info} 未提供 --key，沿用 auth.json 里已有的 key ${mask(key)}`);
  }
  if (!key) { console.error('缺少 key：用 --key <sk-...>，或 --key-stdin，或设置环境变量 CODEX_API_KEY'); process.exit(2); }
  if (key.length < 12) { console.error('key 长度异常，拒绝写入'); process.exit(2); }
  out.key = mask(key);

  const cfgOld = fs.existsSync(CFG) ? fs.readFileSync(CFG, 'utf8') : '';
  const curModel = (getTop(cfgOld, 'model') || '').replace(/"/g, '') || null;
  const slug = (opt.name || DEFAULT_SLUG).replace(/[^A-Za-z0-9_\-]/g, '');

  // 2) 探测候选地址
  const cands = candidates(currentBaseUrl(cfgOld));
  let chosen = null;
  if (opt.offline) {
    chosen = { base: cands[0], ids: [], wireApi: 'responses' };
    log('--offline：跳过探测，直接采用第一个候选地址');
  } else {
    log('探测候选地址（GET /v1/models）:');
    for (const base of cands) {
      const m = await getModels(base, key);
      if (m.ok) {
        log(`  ${H.ok} ${base}  ${m.ids.length} 个模型 ${m.ms}ms`);
        const model = opt.model || pickModel(m.ids, curModel);
        const pr = await probeResponsesRetry(base, key, model);
        let wire = 'responses';
        if (pr.ok) log(`  ${H.ok} /responses 可用  ${pr.ms}ms -> "${(pr.text || '').trim().slice(0, 40)}"`);
        else {
          log(`  ${H.warn} /responses 不可用 (${pr.status} ${pr.err})，回退探测 /chat/completions`);
          const pc = await probeChat(base, key, model);
          if (pc.ok) { wire = 'chat'; log(`  ${H.warn} 该通道只支持 chat 协议`); }
          else { log(`  ${H.bad} 两种协议都不可用，换下一个候选`); continue; }
        }
        chosen = { base, ids: m.ids, model, wireApi: wire };
        break;
      }
      log(`  ${H.bad} ${base}  ${m.status || ''} ${String(m.err || '').slice(0, 90)}`);
    }
  }
  if (!chosen) {
    console.error('\n所有候选地址都不可用，未改动任何文件。');
    console.error('用 --base-url <你的地址> 显式指定，或先确认 key 是否有效/是否欠费。');
    process.exit(1);
  }
  const { base, ids, wireApi } = chosen;
  const model = chosen.model || opt.model;
  if (!model) { console.error('无法确定模型名，请用 --model 指定'); process.exit(1); }

  if (wireApi === 'chat' && !opt.allowChat) {
    console.error(`\n拒绝写入：该通道不支持 /v1/responses，只有 chat 协议。`);
    console.error(`当前 Codex CLI 只接受 wire_api = "responses"，写 chat 会让 App 直接加载配置失败。`);
    console.error(`换一个支持 responses 的中转，或加 --allow-chat 强行写入（后果自负）。`);
    process.exit(1);
  }

  log(`\n选用: base_url=${base}`);
  log(`      model=${model}   wire_api=${wireApi}   provider=${slug}`);
  if (ids.length && !ids.includes(model)) out.warnings.push(`模型 "${model}" 不在 /models 返回的列表里`);

  // 3) 组装新 config
  const useEnvKey = opt.envKey || null;
  // provider 显示名：已有则沿用，否则用 base_url 主机名
  const oldProv = readSection(cfgOld, `[model_providers.${slug}]`) || {};
  let provName = slug;
  try { provName = JSON.parse(oldProv.name).toString() || slug; } catch (_) { provName = new URL(base).host; }
  const provEntries = [
    ['name', JSON.stringify(provName)],
    ['base_url', JSON.stringify(base)],
    ['wire_api', JSON.stringify(wireApi)],
  ];
  if (useEnvKey) {
    provEntries.push(['env_key', JSON.stringify(useEnvKey)]);
    provEntries.push(['requires_openai_auth', null]);
  } else {
    provEntries.push(['requires_openai_auth', 'true']);
    provEntries.push(['env_key', null]);
  }

  let next = cfgOld;
  next = setTop(next, 'model_provider', JSON.stringify(slug));
  next = setTop(next, 'model', JSON.stringify(model));
  if (getTop(next, 'review_model')) next = setTop(next, 'review_model', JSON.stringify(model));
  next = upsertSection(next, `[model_providers.${slug}]`, provEntries);

  // 4) 写前校验
  const errs = sanity(next);
  if (errs.length) { console.error('候补配置结构非法，已中止:\n  ' + errs.join('\n  ')); process.exit(1); }
  if (cfgOld && fingerprint(cfgOld, slug) !== fingerprint(next, slug)) {
    console.error('候补配置改动了无关内容（指纹不一致），已中止。这是脚本 bug，请保留现场。');
    process.exit(1);
  }
  // 只允许新增 provider 段，绝不允许悄悄删掉已有的（全新机器时 0 -> 1 属正常）
  const oldHeads = listProviderHeaders(cfgOld);
  const newHeads = listProviderHeaders(next);
  const vanished = oldHeads.filter(h => !newHeads.includes(h));
  if (vanished.length) { console.error(`候补配置丢失了已有 provider 段（${vanished.join(', ')}），已中止`); process.exit(1); }
  const s2 = readSection(next, `[model_providers.${slug}]`) || {};
  const must = [
    [s2.base_url === JSON.stringify(base), 'base_url'],
    [s2.wire_api === JSON.stringify(wireApi), 'wire_api'],
    [useEnvKey ? s2.env_key === JSON.stringify(useEnvKey) : s2.requires_openai_auth === 'true', '认证方式'],
    [getTop(next, 'model') === JSON.stringify(model), 'model'],
    [getTop(next, 'model_provider') === JSON.stringify(slug), 'model_provider'],
  ];
  log('\n写前校验:');
  let allOk = true;
  for (const [pass, name] of must) { log(`  ${pass ? H.ok : H.bad} ${name}`); if (!pass) allOk = false; }
  if (!allOk) { console.error('校验未通过，未写入任何文件。'); process.exit(1); }

  if (opt.dryRun) {
    log('\n--dry-run：不写文件。改动预览：');
    log(next.split('\n').filter(l => /^(model_provider|model|review_model)\s*=/.test(l)).map(l => '  ' + l).join('\n'));
    const r = sectionRange(lines(next), `[model_providers.${slug}]`);
    if (r) log(lines(next).slice(r.start, r.end).map(l => '  ' + l).join('\n'));
    out.ok = true; out.dry_run = true;
    log('\n配置结构体检: ' + (sanity(next).length ? '有问题' : '通过'));
    return;
  }

  // 5) 落盘
  const fileBackups = [];
  const b1 = backup(CFG); if (b1) fileBackups.push(b1);
  fs.writeFileSync(CFG, next, 'utf8');
  log(`\n${H.ok} 已写入 ${CFG}`);

  let authWritten = null;
  if (!useEnvKey) {
    let auth = {};
    try { auth = JSON.parse(fs.readFileSync(AUTH, 'utf8')); } catch (_) {}
    const b2 = backup(AUTH); if (b2) fileBackups.push(b2);
    auth.OPENAI_API_KEY = key;
    fs.writeFileSync(AUTH, JSON.stringify(auth, null, 2) + '\n', 'utf8');
    authWritten = AUTH;
    log(`${H.ok} 已写入 ${AUTH}（key ${mask(key)}）`);
  } else {
    log(`${H.info} 认证走环境变量 ${useEnvKey}，未写 auth.json`);
  }

  // 6) 同步模型目录（App 的模型选择器读它；文件是覆盖内置，所以可用的条目要一次写全）
  let catResult = null;
  const catRel = (getTop(next, 'model_catalog_json') || '').replace(/^["']|["']$/g, '');
  if (catRel && !opt.noCatalog) {
    const catPath = path.isAbsolute(catRel) ? catRel : path.join(HOME, catRel);
    if (fs.existsSync(catPath)) {
      const written = await syncCatalog({ ids: ids.length ? ids : [model], base, key });
      if (written) {
        const nb = allBackups(catPath);
        if (nb.length) fileBackups.push(nb[nb.length - 1]);
        catResult = `目录现有 ${written.length} 条模型，App 里可全选（${path.basename(catPath)}）`;
      } else {
        catResult = '模型目录同步失败（详见上面输出）';
        out.warnings.push(catResult);
      }
    } else {
      log(`${H.warn} 目录文件不存在，跳过同步: ${catPath}`);
    }
  }

  // 7) 环境告警
  const env = await environmentProbe();
  if (env.launcherProcs || env.proxyOpen) {
    if (opt.killLauncher) {
      const n = killLauncher();
      log(`${H.ok} 已结束启动器进程 ${n} 个（它会在启动时覆写 config.toml）`);
    } else {
      out.warnings.push('Codex++ 启动器在运行：它下次启动会把 config.toml 改回 127.0.0.1:<PORT>，务必先关掉它，或加 --kill-launcher');
      log(`${H.warn} Codex++ 启动器在运行，它会覆写 config.toml —— 建议加 --kill-launcher`);
    }
  }
  if (env.appRunning) out.warnings.push('Codex App 正在运行：配置是启动时读入的，必须重启 App 才生效');

  // 8) 实测：cmdTest 内部同时做协议探测和真实 CLI 调用，不重复探测（避免二次超时误导）
  if (!opt.noTest) {
    log('\n=== 实测 ===');
    await cmdTest();
  } else {
    out.warnings.push('已跳过实测（--no-test）：配置是否真的可用尚未验证');
  }

  out.ok = true;
  out.result = { base_url: base, model, wire_api: wireApi, provider: slug, config: CFG, auth: authWritten, catalog: catResult, backups: fileBackups.map(f => path.basename(f)) };
  log('\n完成。备份文件: ' + (fileBackups.length ? fileBackups.map(f => path.basename(f)).join(', ') : '(无)'));
  log('回滚: codex-deploy.js restore');
}

function currentBaseUrl(cfg) {
  const prov = (getTop(cfg, 'model_provider') || '').replace(/"/g, '');
  if (!prov) return null;
  const s = readSection(cfg, `[model_providers.${prov}]`);
  return s && s.base_url ? s.base_url.replace(/"/g, '') : null;
}

// ---------------------------------------------------------------- main

(async () => {
  try {
    if (cmd === 'deploy') await cmdDeploy();
    else if (cmd === 'status') await cmdStatus();
    else if (cmd === 'list') cmdList();
    else if (cmd === 'models') await cmdModels();
    else if (cmd === 'catalog') await cmdCatalog(positional[1] || 'list');
    else if (cmd === 'use') cmdUse();
    else if (cmd === 'restore') cmdRestore();
    else if (cmd === 'backups') cmdBackups();
    else if (cmd === 'test') await cmdTest();
    else { console.error(`未知命令: ${cmd}\n可用: deploy | status | list | models | catalog [sync|list] | use <name> | test | restore [备份] | backups`); process.exit(2); }
  } catch (e) {
    console.error('执行异常: ' + (e && e.stack || e));
    process.exit(1);
  }
  if (opt.json) {
    out.warnings.forEach(w => log(''));
    console.log(JSON.stringify(out, null, 2));
  }
  process.exit(out.ok ? 0 : 1);
})();
