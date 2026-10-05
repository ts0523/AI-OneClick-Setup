#!/usr/bin/env node
/**
 * probe-llama-server.js — 直接驱动 LM Studio 自带的 llama-server.exe 做参数矩阵实测。
 *
 * 用法:
 *   node probe-llama-server.js --model <xxx.gguf> [--backend vulkan|cpu|cuda]
 *        [--mmproj <mmproj.gguf>] [--timeout 120] -- <-ngl> <99> <-c> <32768> ...
 *
 * 说明:
 *   - exe 与全部 DLL 同目录，所以 cwd 必须设成后端目录。
 *   - 健康信号是 stdout 出现 "listening on http://"，命中即退出（不等超时）。
 *   - 失败通常 1~6 秒返回，成功 6~80 秒。每轮只跑一个实例，别并行。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();
const BACKENDS_ROOT = path.join(HOME, '.lmstudio', 'extensions', 'backends');

function resolveBackend(kind) {
  let dirs = [];
  try {
    dirs = fs.readdirSync(BACKENDS_ROOT, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .filter(n => n.startsWith('llama.cpp-win-x86_64-'));
  } catch (e) {
    throw new Error('找不到后端目录: ' + BACKENDS_ROOT);
  }
  const match = {
    vulkan: /-vulkan-/,
    cuda: /-nvidia-cuda-/,
    cpu: /^llama\.cpp-win-x86_64-avx2-/,
  }[kind];
  if (!match) throw new Error('未知 backend: ' + kind);
  const hits = dirs.filter(n => match.test(n));
  if (!hits.length) throw new Error('没有匹配 ' + kind + ' 的后端，现有: ' + dirs.join(', '));
  // 版本号大的优先
  hits.sort((a, b) => {
    const va = (a.match(/-(\d+\.\d+\.\d+)$/) || [, '0'])[1].split('.').map(Number);
    const vb = (b.match(/-(\d+\.\d+\.\d+)$/) || [, '0'])[1].split('.').map(Number);
    return (vb[0] - va[0]) || (vb[1] - va[1]) || (vb[2] - va[2]);
  });
  return path.join(BACKENDS_ROOT, hits[0]);
}

// ---- 解析参数 ----
const argv = process.argv.slice(2);
const opt = { backend: 'vulkan', mmproj: null, timeout: 120, model: null };
let i = 0, extra = [];
for (; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--') { extra = argv.slice(i + 1); break; }
  if (a === '--model') { opt.model = argv[++i]; }
  else if (a === '--backend') { opt.backend = argv[++i]; }
  else if (a === '--mmproj') { opt.mmproj = argv[++i]; }
  else if (a === '--timeout') { opt.timeout = Number(argv[++i]); }
  else if (a === '--help' || a === '-h') { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]); process.exit(0); }
  else { extra.push(a); }
}
if (!opt.model) { console.error('必须给 --model <xxx.gguf>'); process.exit(2); }

const backendDir = resolveBackend(opt.backend);
const exe = path.join(backendDir, 'llama-server.exe');
if (!fs.existsSync(exe)) { console.error('找不到 ' + exe); process.exit(2); }

const port = 19000 + Math.floor(Math.random() * 900);
const args = ['-m', opt.model, ...extra, '--no-ui', '--host', '127.0.0.1', '--port', String(port)];
if (opt.mmproj) args.push('--mmproj', opt.mmproj);

console.log('backend : ' + path.basename(backendDir));
console.log('exe     : ' + exe);
console.log('args    : ' + args.join(' '));
console.log(''.padEnd(70, '-'));

const t0 = Date.now();
const p = spawn(exe, args, { cwd: backendDir, windowsHide: true });
let out = '', done = false, iv;
const OK = /listening on http/;                       // 注意: 不是 "server is listening"
const BAD = /cannot run the operation|GGML_ASSERT|GGML_ABORT|failed to allocate buffer for kv cache|failed to allocate .* buffer of size/i;

function finish(tag) {
  if (done) return; done = true; clearInterval(iv);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const lines = out.split(/\r?\n/).filter(l => l.trim());
  const bad = lines.filter(l => BAD.test(l) || /failed to/i.test(l));
  console.log('RESULT: ' + tag + '   (' + secs + 's)');
  if (bad.length) bad.slice(-5).forEach(l => console.log('   !! ' + l.trim().slice(0, 190)));
  else console.log('   last: ' + (lines[lines.length - 1] || '(no output)').trim().slice(0, 190));
  try { p.kill(); } catch (e) { /* ignore */ }
  setTimeout(() => process.exit(tag.startsWith('OK') ? 0 : 1), 800);
}

p.stdout.on('data', d => { out += d; });
p.stderr.on('data', d => { out += d; });
p.on('exit', c => finish('EXIT code=' + c + ' hex=0x' + (c >>> 0).toString(16).toUpperCase()));

iv = setInterval(() => {
  if (OK.test(out)) finish('OK   -> listening');
  else if (BAD.test(out)) finish('FAIL -> fatal');
}, 250);

setTimeout(() => finish('TIMEOUT'), opt.timeout * 1000);
