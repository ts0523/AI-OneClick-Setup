#!/usr/bin/env node
/**
 * 隐私与合规扫描器
 * ---------------------------------------------------------------
 * 在开源 / 公开分享前扫描仓库，找出不该出现的东西：
 *   · API 密钥、token、JWT
 *   · 邮箱、手机号
 *   · 真实姓名、昵称、客户名
 *   · 本机绝对路径
 *   · 第三方产品名 / 商标（IP 风险）
 *
 * 用法：
 *   node privacy-scan.js              扫描整个项目
 *   node privacy-scan.js --fix        扫描并自动脱敏（会改文件）
 *   node privacy-scan.js --path <dir> 只扫某个目录
 *
 * 设计要点：用 os.walk 递归而不是 glob —— glob 默认不下钻 `.` 开头的目录，
 * 会漏掉 `.git`、`.cursor`、`.claude` 这类目录，隐私就藏在里面。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const FIX = args.includes('--fix');
const pathArgIdx = args.indexOf('--path');
const SCAN_ROOT = pathArgIdx >= 0 ? path.resolve(args[pathArgIdx + 1]) : ROOT;

// ---------- 扫描规则 ----------
const RULES = [
  // 严重级：泄露即事故
  { level: 'CRITICAL', name: 'OpenRouter 密钥', re: /(sk-or-v1-)[A-Za-z0-9]{20,}/g },
  { level: 'CRITICAL', name: '通用 API 密钥', re: /(?<![A-Za-z0-9])sk-[A-Za-z0-9]{24,}(?![A-Za-z0-9])/g },
  { level: 'CRITICAL', name: 'GitHub token', re: /(gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}/g },
  { level: 'CRITICAL', name: 'JWT', re: /(?<![A-Za-z0-9_-])ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?![A-Za-z0-9_-])/g },
  { level: 'CRITICAL', name: 'AWS Access Key', re: /AKIA[0-9A-Z]{16}/g },
  { level: 'CRITICAL', name: 'Google API Key', re: /AIza[0-9A-Za-z_-]{35}/g },
  { level: 'CRITICAL', name: '私钥文件', re: /-----BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/g },

  // 高危：个人身份
  { level: 'HIGH', name: '邮箱地址', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { level: 'HIGH', name: '手机号（中国大陆）', re: /(?<!\d)1[3-9]\d{9}(?!\d)/g },
  { level: 'HIGH', name: '真实姓名', re: /(邱凤兰|田\s*硕)/g },
  { level: 'HIGH', name: '客户/商号名', re: /(和润生鲜|和润|吉水直聘|吉水)/g },

  // 中危：机器指纹
  // 注意转义形式要覆盖：单反斜杠（文档）、双反斜杠（JS 字符串字面量）、
  // 四反斜杠（嵌套转义）、八反斜杠（双重转义后的字面量）。
  // 之前只匹配单/双反斜杠，漏掉了嵌套转义那一层。
  { level: 'MEDIUM', name: '本机用户目录', re: /[A-Za-z]:(?:\\+|\\\\+|\\\\\\\\+)\s*Users(?:\\+|\\\\+|\\\\\\\\+)[A-Za-z0-9._-]+/g },
  { level: 'MEDIUM', name: '本机绝对路径', re: /D:(?:\\+|\\\\+)(?:codetool|mingw64|android-toolchain|AI技能库|AI一键配置[^\\"]*)/g },
  // 通用兜底：任何盘符下的具体用户目录名。
  // 之前只硬编码了 D:\codetool 这几个已知路径，结果漏掉了
  // D:\360Downloads\Codex++ 和 D:\lmstudio\Bionic 这类自己机器上的真实路径。
  // 占位符（<工具目录>、%USERPROFILE%、%LOCALAPPDATA%）不含具体名字，不会命中。
  {
    level: 'MEDIUM',
    name: '疑似本机安装路径（盘符+目录名）',
    re: /[A-Za-z]:(?:\\+|\\\\+|\\\\\\\\+)(?!\s*(?:Users|Program Files|Windows|Android|Temp|opt|usr|var|etc|home|Applications|Program Files \(x86\)))[A-Za-z0-9_.\-一-鿿]+(?:\\+|\\\\+|\\\\\\\\+)[A-Za-z0-9_.\-一-鿿]+/g,
  },
  { level: 'MEDIUM', name: '代理端口', re: /127\.0\.0\.1:\d{4,5}/g },
  { level: 'MEDIUM', name: '硬件具体型号', re: /(i3-\d{5}|i5-\d{5}|i7-\d{5}|i9-\d{5}|RTX\s?\d{4}|Intel UHD \d{3})/gi },
  { level: 'MEDIUM', name: '32位哈希（可能是机器标识）', re: /(?<![A-Za-z0-9])[a-f0-9]{32}(?![A-Za-z0-9])/g },

  // 商标 / IP：不是隐私，但开源仓库里同样是风险
  { level: 'IP', name: '第三方产品名（商标）', re: /(Minecraft|泰拉瑞亚|Terraria|饥荒|Don't\s*Starve|星露谷|Stardew|纸嫁衣|DayZ|Craft\s*PE)/gi },
];

// 脱敏替换表
const FIXERS = [
  [/(sk-or-v1-)[A-Za-z0-9]{20,}/g, '$1<YOUR_KEY>'],
  [/(?<![A-Za-z0-9])sk-[A-Za-z0-9]{24,}(?![A-Za-z0-9])/g, 'sk-<YOUR_KEY>'],
  [/(gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}/g, '<YOUR_GH_TOKEN>'],
  [/(?<![A-Za-z0-9_-])ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?![A-Za-z0-9_-])/g, '<YOUR_JWT>'],
  [/AKIA[0-9A-Z]{16}/g, '<YOUR_AWS_KEY>'],
  [/AIza[0-9A-Za-z_-]{35}/g, '<YOUR_GOOGLE_KEY>'],
  [/(-----BEGIN )((RSA |OPENSSH |EC |DSA )?PRIVATE KEY)(-----)/g, '$1<REDACTED_KEY>$3'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<YOUR_EMAIL>'],
  [/(?<!\d)1[3-9]\d{9}(?!\d)/g, '<YOUR_PHONE>'],
  [/(邱凤兰|田\s*硕)/g, '<NAME>'],
  [/(和润生鲜|和润|吉水直聘|吉水)/g, '<CUSTOMER>'],
  // 转义形式（本项目配置脚本里大量存在，1~4 层反斜杠都要覆盖）
  [/[A-Za-z]:(?:\\+|\\\\+|\\\\\\\\+)\s*Users(?:\\+|\\\\+|\\\\\\\\+)[A-Za-z0-9._-]+(?:\\+|\\\\+|\\\\\\\\+)/g, '%USERPROFILE%\\\\'],
  [/[A-Za-z]:(?:\\+|\\\\+|\\\\\\\\+)\s*Users(?:\\+|\\\\+|\\\\\\\\+)[A-Za-z0-9._-]+/g, '%USERPROFILE%'],
  [/D:(?:\\+|\\\\+)(?:codetool|mingw64|android-toolchain|AI技能库)/g, '%TOOLCHAIN%\\\\'],
  [/D:(?:\\+|\\\\+)AI一键配置[^\\"]*/g, '%PROJECT%\\\\'],
  [/127\.0\.0\.1:\d{4,5}/g, '127.0.0.1:<PORT>'],
  [/(i3-\d{5}|i5-\d{5}|i7-\d{5}|i9-\d{5}|RTX\s?\d{4}|Intel UHD \d{3})/gi, '<HARDWARE>'],
  [/(?<![A-Za-z0-9])[a-f0-9]{32}(?![A-Za-z0-9])/g, '<HASH>'],
];

// 只扫文本文件
const TEXT_EXT = new Set(['.md', '.json', '.txt', '.js', '.cjs', '.mjs', '.ts', '.py', '.ps1', '.bat', '.cmd',
  '.sh', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.xml', '.html', '.css', '.mdc', '.gitconfig', '']);

// 明确跳过的目录
// 注意：这里跳过的都是「本来就不该进版本库」的东西 —— 私有评估材料、AI 工具的
// 本地记忆（含本机路径与硬件型号）、依赖与构建产物。它们不是仓库内容，
// 扫它们只会让报告里全是自己写的噪声，反而掩盖真正该报的问题。
const SKIP_DIRS = new Set([
  '.git', 'node_modules', '__pycache__', '.venv', 'venv', 'dist', 'build',
  '.private',    // 含未成年人信息的内部评估
  '.workbuddy',  // AI 工具的项目级记忆
]);

const LEVEL_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, IP: 3 };

function walk(dir, out) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    if (e.isSymbolicLink()) continue;           // 不追符号链接，避免循环
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(p, out);
    } else out.push(p);
  }
}

const files = [];
walk(SCAN_ROOT, files);

const findings = [];
let fixedCount = 0;

for (const f of files) {
  const ext = path.extname(f).toLowerCase();
  if (!TEXT_EXT.has(ext)) continue;
  // 跳过明显是扫描器自身的规则文件，避免自我误报
  if (path.basename(f) === 'privacy-scan.js') continue;

  let raw;
  try { raw = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
  // 二进制内容检测（NUL 字节）
  if (raw.includes('\0')) continue;

  const rel = path.relative(SCAN_ROOT, f).replace(/\\/g, '/');
  const lines = raw.split('\n');

  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    for (let ln = 0; ln < lines.length; ln++) {
      rule.re.lastIndex = 0;
      const m = lines[ln].match(rule.re);
      if (!m) continue;
      for (const hit of m) {
        findings.push({ level: rule.level, rule: rule.name, file: rel, line: ln + 1, sample: String(hit).slice(0, 60) });
      }
    }
  }

  if (FIX) {
    let t = raw;
    for (const [re, rep] of FIXERS) t = t.replace(re, rep);
    if (t !== raw) { fs.writeFileSync(f, t, 'utf8'); fixedCount++; }
  }
}

// ---------- 输出 ----------
const rel = path.relative(path.dirname(ROOT), SCAN_ROOT) || '.';
console.log('==============================================');
console.log('  隐私与合规扫描');
console.log('==============================================');
console.log('扫描目录：' + rel);
console.log('文件数量：' + files.length);
console.log(FIX ? '模式：扫描 + 自动脱敏（已改动 ' + fixedCount + ' 个文件）' : '模式：只读扫描（不会改任何文件）');
console.log('');

if (findings.length === 0) {
  console.log('✅ 未发现问题。');
  process.exit(0);
}

findings.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.file.localeCompare(b.file));

const byLevel = {};
for (const f of findings) (byLevel[f.level] ||= []).push(f);

const LABEL = { CRITICAL: '🔴 严重（密钥泄露）', HIGH: '🟠 高危（个人身份）', MEDIUM: '🟡 中危（机器指纹）', IP: '🔵 商标/IP' };

for (const lv of ['CRITICAL', 'HIGH', 'MEDIUM', 'IP']) {
  const arr = byLevel[lv];
  if (!arr) continue;
  console.log(LABEL[lv] + ' — ' + arr.length + ' 处');
  // 同一文件同一规则只展示一条，避免刷屏
  const seen = new Set();
  let shown = 0;
  for (const f of arr) {
    const k = f.file + '|' + f.rule;
    if (seen.has(k)) continue;
    seen.add(k);
    if (shown++ >= 40) { console.log('   ... 还有 ' + (arr.length - shown + 1) + ' 处同类，略'); break; }
    console.log('   ' + f.file + ':' + f.line + '  [' + f.rule + ']  → ' + f.sample);
  }
  console.log('');
}

const crit = (byLevel.CRITICAL || []).length;
const high = (byLevel.HIGH || []).length;
console.log('==============================================');
if (crit) console.log('❌ 有 ' + crit + ' 处严重问题（密钥类）—— 必须清理后才能公开。');
else if (high) console.log('⚠️  有 ' + high + ' 处个人身份信息—— 建议清理后再公开。');
else console.log('✅ 无密钥、无个人身份信息。可公开。');
console.log('==============================================');

process.exit(crit || high ? 1 : 0);
