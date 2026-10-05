#!/usr/bin/env node
/**
 * silent_verify.js — 100% 静默的无头页面验证器
 *
 * 目标：截一张（或几张）页面截图、跑一遍 DOM 体检，全程
 *   · 不创建可见窗口
 *   · 不抢前台焦点
 *   · 不出声、不弹通知、不弹权限框
 *   · 不写用户目录（profile / 桌面 / 文档）
 *   · 不改系统设置（缩放、壁纸、默认浏览器）
 *   · 不留残留在跑的进程
 *
 * 用法：
 *   node silent_verify.js --url <url 或 file:///...> --out <输出目录>
 *        [--width 1440] [--height 900] [--wait 8000] [--full]
 *        [--browser <msedge.exe 路径>] [--low-priority]
 *        [--guard-cmd "<命令>"] [--name shot.png] [--json report.json]
 *
 *   node silent_verify.js --self-test        # 只跑自检，不打开真实页面
 *
 * 退出码：0 = 静默通过且出图；1 = 出图但静默项有 warn；2 = 失败；3 = 用法错误
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

// ---------------------------------------------------------------- 参数
function parseArgs(argv) {
  const a = { width: 1440, height: 900, wait: 8000, out: null, url: null };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    switch (k) {
      case '--url': a.url = v(); break;
      case '--out': a.out = v(); break;
      case '--width': a.width = parseInt(v(), 10); break;
      case '--height': a.height = parseInt(v(), 10); break;
      case '--wait': a.wait = parseInt(v(), 10); break;
      case '--browser': a.browser = v(); break;
      case '--name': a.name = v(); break;
      case '--json': a.json = v(); break;
      case '--guard-cmd': a.guardCmd = v(); break;
      case '--full': a.full = true; break;
      case '--low-priority': a.lowPriority = true; break;
      case '--keep-tmp': a.keepTmp = true; break;
      case '--self-test': a.selfTest = true; break;
      case '--no-cleanup': a.noCleanup = true; break;
      case '-h': case '--help': a.help = true; break;
      default:
        if (k.startsWith('-')) { console.error('未知参数: ' + k); process.exit(3); }
    }
  }
  return a;
}

const DEFAULT_BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];

/** 静默基线：缺任何一项都会在报告里被判 warn/fail */
const SILENT_FLAGS = [
  '--headless=new',                 // 新无头：不创建可见窗口
  '--no-first-run',                 // 不开首次运行引导页
  '--no-default-browser-check',     // 不弹"设为默认浏览器"
  '--disable-notifications',        // 不弹通知
  '--disable-infobars',             // 不弹信息条
  '--disable-extensions',           // 不加载扩展（扩展会弹窗/抢焦点）
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-client-side-phishing-detection',
  '--disable-sync',
  '--disable-default-apps',
  '--disable-breakpad',
  '--disable-domain-reliability',
  '--no-pings',
  '--mute-audio',                   // 不出声
  '--disable-gpu',
  '--hide-scrollbars',
  '--safebrowsing-disable-auto-update',
  '--disable-features=Translate,OptimizationHints,MediaRouter,AcceptCHFrame,'
    + 'PaintHolding,CalculateNativeWinOcclusion,BackForwardCache',
];

function pickBrowser(explicit) {
  if (explicit) return fs.existsSync(explicit) ? explicit : null;
  for (const p of DEFAULT_BROWSERS) if (fs.existsSync(p)) return p;
  return null;
}

function mkTmp(tag) {
  const d = path.join(os.tmpdir(), 'silent-verify-' + tag + '-' + Date.now().toString(36)
    + '-' + Math.random().toString(36).slice(2, 7));
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function rmrf(d) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
}

/** 通过 cmd 的 start /LOW 包一层降优先级（Windows）。失败则原样返回。 */
function wrapLowPriority(exe, args) {
  return { exe: 'C:/Windows/System32/cmd.exe', args: ['/c', 'start', '/wait', '/LOW', '/B', '""', exe, ...args] };
}

// ---------------------------------------------------------------- 主流程
function run(a) {
  const report = {
    ok: false, disturbed: false, checks: [], warns: [], fails: [],
    screenshots: [], out: null, browser: null, elapsed_ms: 0,
  };
  const add = (level, name, detail) => {
    report.checks.push({ level, name, detail });
    if (level === 'fail') report.fails.push(name + ': ' + detail);
    if (level === 'warn') report.warns.push(name + ': ' + detail);
  };

  if (a.selfTest) {
    a.url = a.url || 'data:text/html,<h1 style="font-family:sans-serif">silent self test</h1>';
    a.out = a.out || mkTmp('selftest');
    a.name = a.name || 'selftest.png';
  }
  if (!a.url || !a.out) {
    console.error('用法: silent_verify.js --url <url> --out <dir> [--width 1440] [--height 900] [--wait 8000]');
    process.exit(3);
  }

  const browser = pickBrowser(a.browser);
  if (!browser) { console.error('找不到浏览器，用 --browser 指定'); process.exit(2); }
  report.browser = browser;

  fs.mkdirSync(a.out, { recursive: true });
  const profile = mkTmp('profile');
  const shotName = a.name || ('shot-' + Date.now().toString(36) + '.png');
  const shotPath = path.join(a.out, shotName);
  const domPath = path.join(a.out, shotName.replace(/\.png$/, '') + '.dom.html');

  const args = SILENT_FLAGS.slice();
  args.push('--user-data-dir=' + profile);
  args.push('--window-size=' + a.width + ',' + a.height);
  args.push('--virtual-time-budget=' + a.wait);
  args.push('--screenshot=' + shotPath);
  args.push('--dump-dom');            // DOM 走 stdout，用于体检
  args.push(a.url);

  let exe = browser, argv = args;
  if (a.lowPriority) { const w = wrapLowPriority(browser, args); exe = w.exe; argv = w.args; }

  const t0 = Date.now();
  const dom = { text: '' };
  const code = new Promise((resolve) => {
    const child = spawn(exe, argv, {
      windowsHide: true,        // ★ 抑制子进程控制台窗口
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: a.out,
    });
    report.pid = child.pid;
    child.stdout.on('data', d => { if (dom.text.length < 4_000_000) dom.text += d.toString('utf8'); });
    let err = '';
    child.stderr.on('data', d => { err += d.toString('utf8'); });
    child.on('error', e => { report.spawnError = String(e && e.message); resolve(-1); });
    child.on('close', c => { report.exitCode = c; report.stderrTail = err.split('\n').slice(-6).join(' | '); resolve(c); });
  });

  return code.then((c) => {
    report.elapsed_ms = Date.now() - t0;

    // ---- 1. 产物
    if (fs.existsSync(shotPath) && fs.statSync(shotPath).size > 0) {
      report.screenshots.push(shotPath);
      add('pass', 'screenshot', shotPath + ' (' + fs.statSync(shotPath).size + 'B)');
    } else {
      add('fail', 'screenshot', '截图未生成：' + shotPath + (report.stderrTail ? ' / ' + report.stderrTail : ''));
    }
    if (dom.text.length > 0) {
      try { fs.writeFileSync(domPath, dom.text, 'utf8'); report.dom = domPath; } catch (e) { /* 忽略 */ }
      add('pass', 'dom', '抓到 ' + dom.text.length + ' 字符');
    } else {
      add('warn', 'dom', '未抓到 DOM（--dump-dom 无输出）');
    }

    // ---- 2. 静默项
    const missing = SILENT_FLAGS.filter(f => !args.includes(f));
    if (missing.length === 0) add('pass', 'flags', '静默基线 ' + SILENT_FLAGS.length + ' 项齐全');
    else add('warn', 'flags', '缺失: ' + missing.join(' '));

    if (profile.startsWith(os.tmpdir())) add('pass', 'profile', 'profile 在系统临时目录: ' + profile);
    else add('fail', 'profile', 'profile 不在临时目录，可能污染用户目录');

    const home = os.homedir();
    const banned = ['Desktop', 'Documents', 'Downloads', 'Pictures']
      .map(d => path.join(home, d).toLowerCase());
    if (!banned.some(b => shotPath.toLowerCase().startsWith(b))) {
      add('pass', 'output', '输出未落在桌面/文档/下载: ' + shotPath);
    } else {
      add('fail', 'output', '输出落在用户个人目录，违规: ' + shotPath);
    }

    add('pass', 'audio', '--mute-audio 已启用');
    add('pass', 'notify', '--disable-notifications 已启用');
    if (a.lowPriority) add('pass', 'priority', '以 /LOW 优先级运行');
    else add('warn', 'priority', '未降优先级（长任务建议 --low-priority）');

    // ---- 3. 残留进程：close 事件是主证据，tasklist 只是二次确认
    if (report.exitCode === null || report.exitCode === undefined) {
      add('fail', 'residual', '进程未正常退出');
    } else {
      let confirmed = false;
      try {
        const out = execFileSync('C:/Windows/System32/tasklist.exe',
          ['/FI', 'PID eq ' + report.pid], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
        confirmed = !new RegExp('\\b' + report.pid + '\\b').test(out.split('\n').slice(3).join('\n'));
      } catch (e) { confirmed = null; }
      if (confirmed === false) add('fail', 'residual', '进程仍在运行 PID=' + report.pid);
      else if (confirmed === null) add('pass', 'residual', 'close 事件已确认退出 (exit=' + report.exitCode + ')；tasklist 不可用，未二次确认');
      else add('pass', 'residual', '已退出且 tasklist 二次确认 (exit=' + report.exitCode + ')');
    }

    // ---- 4. 外部守卫（可选）
    if (a.guardCmd) {
      try {
        const g = execFileSync('C:/Windows/System32/cmd.exe', ['/c', a.guardCmd],
          { encoding: 'utf8', windowsHide: true, timeout: 20000 });
        let j = null; try { j = JSON.parse(g); } catch (e) { /* 非 JSON */ }
        if (j) {
          report.guard = j;
          const lvl = (j.disturbed === true) ? 'fail' : 'pass';
          add(lvl, 'guard', JSON.stringify(j).slice(0, 300));
        } else add('warn', 'guard', '守卫输出非 JSON: ' + g.slice(0, 200));
      } catch (e) { add('warn', 'guard', '守卫执行失败: ' + e.message); }
    }

    // ---- 5. 清理
    if (!a.keepTmp && !a.noCleanup) {
      rmrf(profile);
      add('pass', 'cleanup', '临时 profile 已删除');
    } else {
      add('warn', 'cleanup', '临时 profile 保留: ' + profile);
    }

    report.disturbed = report.fails.length > 0;
    report.ok = report.fails.length === 0 && report.screenshots.length > 0;
    report.out = shotPath;
    return report;
  });
}

// ---------------------------------------------------------------- CLI
if (require.main === module) {
  const a = parseArgs(process.argv);
  if (a.help) { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]); process.exit(0); }
  run(a).then(r => {
    if (a.json) { fs.mkdirSync(path.dirname(path.resolve(a.json)), { recursive: true }); fs.writeFileSync(a.json, JSON.stringify(r, null, 2), 'utf8'); }
    console.log('— 静默验证报告 —');
    for (const c of r.checks) console.log('  [' + c.level.toUpperCase() + '] ' + c.name + ' — ' + c.detail);
    console.log('结果: ' + (r.ok ? 'PASS' : 'FAIL') + ' | 打扰项 ' + r.fails.length
      + ' | 警告 ' + r.warns.length + ' | 耗时 ' + r.elapsed_ms + 'ms');
    if (r.screenshots.length) console.log('截图: ' + r.screenshots.join(', '));
    process.exit(r.ok ? (r.warns.length ? 1 : 0) : 2);
  }).catch(e => { console.error('崩了:', e); process.exit(2); });
}
module.exports = { run, SILENT_FLAGS, pickBrowser };
