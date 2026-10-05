#!/usr/bin/env node
/**
 * Codex 配置修复工具
 *   --dry-run  (默认) 只诊断，不改任何文件
 *   --apply    备份并修复 config.toml
 *   --test     实测 codex CLI（spawn + 立即关闭 stdin）
 *
 * 自动探测运行时 hash，不硬编码目录名。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CFG = '%USERPROFILE%\\.codex\\config.toml';
const AUTH = '%USERPROFILE%\\.codex\\auth.json';
const APP = '%USERPROFILE%\\AppData\\Local\\OpenAI\\Codex';
const RUNTIMES = path.join(APP, 'runtimes', 'cua_node');
const BINROOT = path.join(APP, 'bin');
const GOOD_BASE = 'https://apinexus.dpdns.org/v1';
const BAD_BASE = 'http://127.0.0.1:<PORT>/v1';

const mode = process.argv.includes('--apply') ? 'apply'
  : process.argv.includes('--test') ? 'test' : 'dry';

const log = s => console.log(s);
const H = { ok: '[OK]  ', bad: '[BAD] ', warn: '[WARN]' };

// ---------- 探测 ----------
function detectRuntimeHash() {
  try {
    for (const d of fs.readdirSync(RUNTIMES)) {
      if (fs.existsSync(path.join(RUNTIMES, d, 'bin', 'node_repl.exe'))) return d;
    }
  } catch (_) {}
  return null;
}
function detectBinHash() {
  try {
    for (const d of fs.readdirSync(BINROOT)) {
      if (fs.existsSync(path.join(BINROOT, d, 'codex.exe'))) return d;
    }
  } catch (_) {}
  return null;
}

// ---------- 诊断 ----------
function diagnose(cfg) {
  const issues = [], notes = [];
  const rt = detectRuntimeHash(), bh = detectBinHash();

  notes.push(`实际运行时 hash : ${rt || '未找到'}`);
  notes.push(`实际 bin   hash : ${bh || '未找到'}`);

  // 1. wire_api
  const wire = (cfg.match(/wire_api\s*=\s*"([^"]+)"/) || [])[1];
  if (wire === 'responses') notes.push(`wire_api = "${wire}"`);
  else issues.push(`wire_api = "${wire || '缺失'}" —— 新版 CLI 只接受 "responses"，写 chat 会导致配置整体加载失败（App 打不开）`);

  // 2. base_url
  const base = (cfg.match(/base_url\s*=\s*"([^"]+)"/) || [])[1];
  if (base === GOOD_BASE) notes.push(`base_url = ${base}`);
  else if (base === BAD_BASE) issues.push(`base_url 指向 Codex++ 本地代理 ${BAD_BASE}，它的模型白名单只有 agnes-*，会造成 503 model_not_found`);
  else issues.push(`base_url 异常: ${base || '缺失'}`);

  // 3. 模型名
  const model = (cfg.match(/^model\s*=\s*"([^"]+)"/m) || [])[1];
  if (model === 'gpt-5.6-sol') notes.push(`model = ${model}`);
  else issues.push(`model = "${model}" —— 直连通道只提供 gpt-5.6-sol`);

  // 4. stale 路径
  const staleRt = [...new Set([...cfg.matchAll(/cua_node\\(\w{16})\\/g)].map(m => m[1]))]
    .filter(h => h !== rt);
  const staleBin = [...new Set([...cfg.matchAll(/Codex\\bin\\(\w{16})\\/g)].map(m => m[1]))]
    .filter(h => h !== bh);
  if (staleRt.length) issues.push(`config 里的运行时 hash 已失效: ${staleRt.join(', ')}（应改为 ${rt}）`);
  if (staleBin.length) issues.push(`config 里的 bin hash 已失效: ${staleBin.join(', ')}（应改为 ${bh}）`);
  if (!staleRt.length && rt) notes.push('运行时路径全部有效');

  // 5. 引用文件真实存在性
  const refs = new Set();
  for (const m of cfg.matchAll(/'([A-Za-z]:\\[^']+\.(?:exe|mjs|js))'/g)) refs.add(m[1]);
  for (const m of cfg.matchAll(/"([A-Za-z]:\\\\.*?\.(?:exe|mjs|js))"/g)) refs.add(m[1].replace(/\\\\/g, '\\'));
  const missing = [...refs].filter(p => !fs.existsSync(p));
  missing.forEach(p => issues.push('引用路径不存在: ' + p));

  // 6. auth
  try {
    const k = JSON.parse(fs.readFileSync(AUTH, 'utf8')).OPENAI_API_KEY;
    if (k && k.length > 20) notes.push(`auth.json 有 key (${k.slice(0, 7)}..., ${k.length} 字符)`);
    else issues.push('auth.json 里的 OPENAI_API_KEY 异常');
  } catch (e) { issues.push('auth.json 读取失败: ' + e.message); }

  return { issues, notes, rt, bh, wire, base, model, missing };
}

// ---------- 修复 ----------
function applyFix(cfg, d) {
  const stamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 15);
  const bak = `${CFG}.bak-fix-${stamp}`;
  fs.writeFileSync(bak, cfg, 'utf8');
  log(`备份: ${bak}\n`);

  let out = cfg;
  const done = [];

  // stale hash -> 实际 hash（用通用正则，不依赖已知旧值）
  if (d.rt) {
    const n = (out.match(/cua_node\\\w{16}\\/g) || []).filter(x => x !== `cua_node\\${d.rt}\\`).length;
    if (n) { out = out.replace(/cua_node\\\w{16}\\/g, `cua_node\\${d.rt}\\`); done.push(`运行时 hash 修正 ${n} 处 -> ${d.rt}`); }
  }
  if (d.bh) {
    const n = (out.match(/Codex\\bin\\\w{16}\\/g) || []).filter(x => x !== `Codex\\bin\\${d.bh}\\`).length;
    if (n) { out = out.replace(/Codex\\bin\\\w{16}\\/g, `Codex\\bin\\${d.bh}\\`); done.push(`bin hash 修正 ${n} 处 -> ${d.bh}`); }
  }
  if (d.base !== GOOD_BASE) {
    out = out.replace(/base_url\s*=\s*"[^"]*"/, `base_url = "${GOOD_BASE}"`);
    done.push(`base_url -> ${GOOD_BASE}`);
  }
  if (d.wire !== 'responses') {
    out = out.replace(/wire_api\s*=\s*"[^"]*"/, 'wire_api = "responses"');
    done.push('wire_api -> responses');
  }
  if (d.model !== 'gpt-5.6-sol') {
    out = out.replace(/^model\s*=\s*"[^"]*"/m, 'model = "gpt-5.6-sol"');
    done.push('model -> gpt-5.6-sol');
  }

  log('应用的改动:');
  log(done.length ? done.map(x => '  - ' + x).join('\n') : '  (无需改动)');

  // 断言后再落盘
  const checks = [
    [/wire_api\s*=\s*"responses"/.test(out), 'wire_api 为 responses'],
    [new RegExp(`base_url\\s*=\\s*"${GOOD_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(out), 'base_url 为直连'],
    [d.rt ? !new RegExp(`cua_node\\\\(?!${d.rt}\\\\)\\w{16}\\\\`).test(out) : true, '无 stale 运行时 hash'],
    [d.bh ? !new RegExp(`Codex\\\\bin\\\\(?!${d.bh}\\\\)\\w{16}\\\\`).test(out) : true, '无 stale bin hash'],
    [!out.includes('57321'), '无 57321 残留'],
  ];
  log('\n校验:');
  let ok = true;
  for (const [pass, name] of checks) { log(`  ${pass ? H.ok : H.bad} ${name}`); if (!pass) ok = false; }

  if (ok) {
    fs.writeFileSync(CFG, out, 'utf8');
    log('\n配置已写入。');
    const d2 = diagnose(out);
    if (d2.missing.length) log(`\n注意：仍有 ${d2.missing.length} 个引用路径缺失，见诊断输出。`);
  } else {
    log('\n校验未通过，未写入。原文件未动，备份在: ' + bak);
  }
  return ok;
}

// ---------- 实测 ----------
function test() {
  const bh = detectBinHash();
  const CX = path.join(BINROOT, bh, 'codex.exe');
  log(`调用: ${CX}\n`);
  const t0 = Date.now();
  const p = spawn(CX, ['exec', '--skip-git-repo-check', '--strict-config', 'reply with exactly: PONG'],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let o = '', e = '';
  p.stdout.on('data', x => o += x);
  p.stderr.on('data', x => e += x);
  p.stdin.end('');                      // 关键：不关 stdin 会永久卡在 reading from stdin
  const timer = setTimeout(() => { log('超时 180s，强制结束'); p.kill(); }, 180000);
  p.on('close', code => {
    clearTimeout(timer);
    const fatal = /Error loading config\.toml|is no longer supported|unrecognized/i.test(e);
    log(`exit=${code}  耗时=${((Date.now() - t0) / 1000).toFixed(1)}s`);
    log(`配置致命错误: ${fatal ? 'YES' : 'no'}`);
    log('\n--- stdout ---\n' + (o.trim() || '(空)'));
    log('\n--- stderr ---\n' + (e.trim() || '(空)'));
    log(code === 0 && !fatal ? '\n结论: 通过。' : '\n结论: 未通过。');
  });
  p.on('error', x => { clearTimeout(timer); log('spawn 失败: ' + x.message); });
}

// ---------- 主流程 ----------
const cfg = fs.readFileSync(CFG, 'utf8');
if (mode === 'test') { test(); }
else {
  const d = diagnose(cfg);
  log('=== 诊断 ===');
  d.notes.forEach(n => log('  ' + n));
  log('\n=== 问题 ===');
  log(d.issues.length ? d.issues.map(x => '  ' + H.warn + ' ' + x).join('\n') : '  无');
  if (mode === 'apply') {
    if (!d.issues.length) log('\n没有需要修复的问题。');
    else { log('\n=== 修复 ==='); applyFix(cfg, d); }
  } else if (d.issues.length) {
    log('\n加 --apply 执行修复。');
  }
}
