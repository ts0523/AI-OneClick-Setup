#!/usr/bin/env node
/**
 * codex-deploy 自测：用本地 mock 中转站验证全流程，全程在临时 CODEX_HOME 里跑，
 * 不碰真实配置。
 *
 *   node selftest.js
 *
 * 覆盖：正常接入 / 候选地址回退 / 401 拒绝 / 只有 chat 协议时拒绝写入 /
 *      无关配置零改动 / 模型目录同步 / 备份与回滚 / key 不外泄 / 全新机器
 *
 * 注意：子进程必须用异步 spawn。用 execFileSync 会阻塞本进程事件循环，
 *       mock 服务器收不到请求，测试会假失败。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const SCRIPT = path.join(__dirname, 'codex-deploy.js');
const NODE = process.execPath;
const KEY = 'sk-selftest-0123456789abcdefghijklmn';
const MODEL = 'mock-gpt-5.6-sol';
const OLDKEY = 'sk-old-key-000000000000000000';

let pass = 0, fail = 0;
const results = [];
function check(cond, name, extra = '') {
  if (cond) { pass++; results.push('  [OK]   ' + name); }
  else { fail++; results.push('  [FAIL] ' + name + (extra ? '  <-- ' + extra : '')); }
}
const section = t => results.push('=== ' + t + ' ===');

// ---------------------------------------------------------------- fixture

const FIXTURE = `model_provider = "custom"
model = "gpt-5.6-sol"
review_model = "gpt-5.6-sol"
model_reasoning_effort = "medium"
model_catalog_json = "codex-launcher-model-catalog.json"

notify = [ "%USERPROFILE%\\\\AppData\\\\Local\\\\OpenAI\\\\Codex\\\\runtimes\\\\cua_node\\\\<HASH>\\\\bin\\\\node_modules\\\\@oai\\\\sky\\\\bin\\\\windows\\\\codex-computer-use.exe", "turn-ended" ]
[mcp_servers]

[mcp_servers.node_repl]
args = []
command = '%USERPROFILE%\\AppData\\Local\\OpenAI\\Codex\\runtimes\\cua_node\\<RUNTIME_HASH>\\bin\\node_repl.exe'
env_vars = ["CODEX_WINDOWS_REGISTERED_CORE"]
startup_timeout_sec = 120

[mcp_servers.node_repl.env]
NODE_REPL_NODE_MODULE_DIRS = '%USERPROFILE%\\AppData\\Local\\OpenAI\\Codex\\runtimes\\cua_node\\<RUNTIME_HASH>\\bin\\node_modules'
NODE_REPL_TRUSTED_CODE_PATHS = '%USERPROFILE%\\.codex;<NODE_PATH>\\node_modules'
NODE_REPL_TRUSTED_SERVICES = '{"browser":"%USERPROFILE%/.codex/plugins/cache/openai-bundled/browser/<VERSION>/scripts/browser-service.mjs","sky":"@oai/sky/service"}'
SKY_CUA_NATIVE_PIPE_DIRECTORY = '\\.\pipe\codex-computer-use-<UUID>'
CODEX_CLI_PATH = '<FAKE_CODEX_PATH>'

[plugins."chrome@openai-bundled"]
enabled = true

[desktop]
appearanceTheme = "light"

[windows]
sandbox = "elevated"

[projects.'d:\\pixelwilderness']
trust_level = "trusted"

[model_providers.other]
name = "别家中转"
base_url = "https://other.example.com/v1"
wire_api = "responses"
requires_openai_auth = true

[model_providers.custom]
name = "API Nexus"
base_url = "https://apinexus.dpdns.org/v1"
wire_api = "responses"
requires_openai_auth = true
`;

const CATALOG = {
  models: [{
    slug: 'gpt-5.6-sol', display_name: 'gpt-5.6-sol', description: 'gpt-5.6-sol',
    base_instructions: 'You are Codex.', default_reasoning_level: 'medium',
    supported_reasoning_levels: [{ effort: 'low', description: 'fast' }],
    shell_type: 'shell_command', visibility: 'list', supported_in_api: true,
    priority: 1000, context_window: 1000000, input_modalities: ['text', 'image'],
  }],
};

/** 剔除「本次允许改动」的行，用于证明其余配置逐字未变 */
const MANAGED = /^(model_provider|model|review_model|name|base_url|wire_api|requires_openai_auth|env_key)\s*=/;
const canonical = t => t.split('\n').filter(l => !MANAGED.test(l)).join('\n');

const configPath = h => path.join(h, 'config.toml');
const authPath = h => path.join(h, 'auth.json');
const catPath = h => path.join(h, 'codex-launcher-model-catalog.json');
const readCfg = h => fs.readFileSync(configPath(h), 'utf8');
const readAuth = h => JSON.parse(fs.readFileSync(authPath(h), 'utf8'));

function makeHome(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-deploy-selftest-' + tag + '-'));
  fs.writeFileSync(configPath(dir), FIXTURE, 'utf8');
  fs.writeFileSync(authPath(dir), JSON.stringify({ OPENAI_API_KEY: OLDKEY }, null, 2), 'utf8');
  fs.writeFileSync(catPath(dir), JSON.stringify(CATALOG, null, 2), 'utf8');
  return dir;
}

function run(home, args) {
  return new Promise(res => {
    const p = spawn(NODE, [SCRIPT, ...args, '--codex-home', home], { stdio: ['ignore', 'pipe', 'pipe'] });
    let o = '', e = '';
    p.stdout.on('data', d => o += d);
    p.stderr.on('data', d => e += d);
    const timer = setTimeout(() => { try { p.kill(); } catch (_) {} }, 120000);
    p.on('close', code => { clearTimeout(timer); res({ code, stdout: o, stderr: e }); });
    p.on('error', x => { clearTimeout(timer); res({ code: -1, stdout: o, stderr: String(x) }); });
  });
}

// ---------------------------------------------------------------- mock 中转站

// deadModels: 在 /models 里列出但 /responses 一律 500 not implemented —— 复刻真实中转的「虚报」行为
function startMock({ key = KEY, mode = 'full', models = [MODEL, 'text-embedding-3-small'], deadModels = [] } = {}) {
  return new Promise(res => {
    const srv = http.createServer((req, rep) => {
      const j = (code, obj) => { rep.writeHead(code, { 'Content-Type': 'application/json' }); rep.end(JSON.stringify(obj)); };
      const auth = (req.headers.authorization || '').replace(/^Bearer\s+/, '');
      if (auth !== key) return j(401, { error: { message: 'invalid api key' } });
      if (req.url.endsWith('/models')) return j(200, { data: models.map(id => ({ id })) });
      if (req.url.endsWith('/chat/completions')) return j(200, { choices: [{ message: { content: 'pong' } }] });
      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        if (req.url.endsWith('/responses')) {
          if (mode === 'chat-only') return j(404, { error: { message: 'not found' } });
          let asked = '';
          try { asked = JSON.parse(body).model || ''; } catch (_) {}
          if (deadModels.includes(asked)) return j(500, { error: { message: 'not implemented' } });
          return j(200, { id: 'resp_x', status: 'completed', output_text: 'PONG' });
        }
        j(404, { error: { message: 'unknown route ' + req.url } });
      });
    });
    srv.listen(0, '127.0.0.1', () => res({ srv, base: `http://127.0.0.1:${srv.address().port}/v1` }));
  });
}

const DEAD = 'http://127.0.0.1:1/v1';

// ---------------------------------------------------------------- 用例

(async () => {
  section('1. 正常接入（含候选地址回退）');
  const m1 = await startMock();
  const home1 = makeHome('ok');
  const r1 = await run(home1, ['deploy', '--key', KEY, '--base-url', DEAD, '--base-url', m1.base, '--no-test', '--no-catalog']);
  const cfg1 = readCfg(home1);
  check(r1.code === 0, '退出码 0', 'code=' + r1.code + ' | ' + (r1.stderr || '').slice(0, 200));
  check(/\[BAD\]\s+http:\/\/127\.0\.0\.1:1\/v1/.test(r1.stdout), '死候选被标记为 BAD 并继续');
  check(cfg1.includes(m1.base) && !cfg1.includes('apinexus'), 'base_url 落成可用候选');
  check(/^model = "mock-gpt-5\.6-sol"$/m.test(cfg1), 'model 自动选中 mock-gpt-5.6-sol');
  check(/^review_model = "mock-gpt-5\.6-sol"$/m.test(cfg1), 'review_model 同步');
  check(/wire_api = "responses"/.test(cfg1), 'wire_api = responses');
  check(/^model_provider = "custom"$/m.test(cfg1), 'model_provider = custom');
  check(/\[OK\]\s+\/responses 可用/.test(r1.stdout), '探测阶段 /responses 通过');
  check(readAuth(home1).OPENAI_API_KEY === KEY, 'auth.json 写入新 key');
  check(fs.readdirSync(home1).some(f => f.startsWith('config.toml.bak-api-')), '生成 config.toml 备份');
  check(fs.readdirSync(home1).some(f => f.startsWith('auth.json.bak-api-')), '生成 auth.json 备份');
  check(!r1.stdout.includes(KEY), 'stdout 不泄露完整 key');
  check(!cfg1.includes(KEY), 'config.toml 不写 key');
  check(canonical(cfg1) === canonical(FIXTURE), '无关配置逐字未变');
  check(cfg1.includes('[model_providers.other]') && cfg1.includes('https://other.example.com/v1'), '其他 provider 段保留');
  check(cfg1.includes("SKY_CUA_NATIVE_PIPE_DIRECTORY = '\\\\.\\pipe\\codex-computer-use-<UUID>'"), '含 [ 和 \\ 的特殊行未被误伤');
  check(/PONG/.test(r1.stdout), '写后实测有返回');

  section('2. 模型目录同步');
  const home2 = makeHome('catalog');
  const r2 = await run(home2, ['deploy', '--key', KEY, '--base-url', m1.base, '--no-test']);
  const cat2 = JSON.parse(fs.readFileSync(catPath(home2), 'utf8'));
  const added = cat2.models.find(m => m.slug === MODEL);
  check(r2.code === 0, '退出码 0', 'code=' + r2.code + ' | ' + (r2.stderr || '').slice(0, 200));
  check(!!added, '新模型被补进模型目录');
  check(cat2.models.some(m => m.slug === 'gpt-5.6-sol'), '原有模型条目保留');
  check(added && added.context_window === 1000000 && added.supported_in_api === true, '克隆条目字段完整');
  check(fs.readdirSync(home2).some(f => f.startsWith('codex-launcher-model-catalog.json.bak-api-')), '模型目录有备份');
  const r2b = await run(home2, ['deploy', '--key', KEY, '--base-url', m1.base, '--no-test']);
  const cat2b = JSON.parse(fs.readFileSync(catPath(home2), 'utf8'));
  check(cat2b.models.filter(m => m.slug === MODEL).length === 1, '重复部署不产生重复条目（幂等）');
  const rm2 = await run(home2, ['models']);
  check(rm2.code === 0 && /App可选/.test(rm2.stdout), 'models 标出哪些模型已写进模型目录（App 可选）', rm2.stdout.slice(0, 200));
  check(/text-embedding-3-small/.test(rm2.stdout), 'models 原样列出非对话模型（不过滤展示）');

  section('3. key 无效（401）');
  const home3 = makeHome('badkey');
  const r3 = await run(home3, ['deploy', '--key', 'sk-wrong-key-1234567890abcdef', '--base-url', m1.base, '--no-test']);
  check(r3.code !== 0, '退出码非 0');
  check(readCfg(home3) === FIXTURE, 'config.toml 未被改动');
  check(readAuth(home3).OPENAI_API_KEY === OLDKEY, 'auth.json 未被改动');
  check(!fs.readdirSync(home3).some(f => f.includes('bak-wren-api')), '未产生备份（没写就没备）');
  check(!r3.stdout.includes('sk-wrong-key-1234567890abcdef'), '错误 key 也不回显');

  section('4. 只有 chat 协议');
  const m4 = await startMock({ mode: 'chat-only' });
  const home4 = makeHome('chatonly');
  const r4 = await run(home4, ['deploy', '--key', KEY, '--base-url', m4.base, '--no-test']);
  check(r4.code !== 0, '默认拒绝写入');
  check(readCfg(home4) === FIXTURE, 'config.toml 未被改动');
  check(/responses/.test(r4.stdout + r4.stderr), '给出 responses 原因说明');
  const r4b = await run(home4, ['deploy', '--key', KEY, '--base-url', m4.base, '--no-test', '--no-catalog', '--allow-chat']);
  check(r4b.code === 0 && /wire_api = "chat"/.test(readCfg(home4)), '--allow-chat 时按 chat 写入');

  section('5. dry-run');
  const home5 = makeHome('dry');
  const r5 = await run(home5, ['deploy', '--key', KEY, '--base-url', m1.base, '--dry-run', '--no-test']);
  check(r5.code === 0, '退出码 0', (r5.stderr || '').slice(0, 200));
  check(readCfg(home5) === FIXTURE, 'dry-run 不写文件');
  check(!fs.readdirSync(home5).some(f => f.includes('bak-wren-api')), 'dry-run 不产生备份');
  check(/base_url/.test(r5.stdout), 'dry-run 打印改动预览');

  section('6. 缺少 key');
  const home6 = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-deploy-selftest-nokey-'));
  fs.writeFileSync(catPath(home6), JSON.stringify(CATALOG, null, 2), 'utf8');
  const r6 = await run(home6, ['deploy', '--base-url', m1.base, '--no-test']);
  check(r6.code === 2, '退出码 2（参数错误）', 'code=' + r6.code + ' | ' + (r6.stderr || '').slice(0, 120));
  check(!fs.existsSync(configPath(home6)), '未生成配置');
  const home6b = makeHome('reusekey');
  const r6b = await run(home6b, ['deploy', '--base-url', m1.base, '--no-test', '--no-catalog']);
  check(r6b.code !== 0 && /沿用 auth\.json 里已有的 key/.test(r6b.stdout), '有旧 key 时沿用并说明（旧 key 对新地址无效 → 失败）');

  section('7. status / list / use / restore / backups');
  const home7 = makeHome('ops');
  await run(home7, ['deploy', '--key', KEY, '--base-url', m1.base, '--no-test', '--no-catalog']);
  const postDeploy = readCfg(home7);
  const rs = await run(home7, ['status', '--offline']);
  check(rs.code === 0 && /provider\s*:\s*"custom"/.test(rs.stdout), 'status 输出当前 provider');
  check(/model\s*:\s*"mock-gpt-5\.6-sol"/.test(rs.stdout), 'status 输出当前 model');
  check(/有 key sk-self\.\.\.klmn/.test(rs.stdout), 'status 脱敏显示 key', rs.stdout.split('\n').filter(l => /key/.test(l)).join(' '));
  const rl = await run(home7, ['list']);
  check(rl.code === 0 && /\* custom/.test(rl.stdout) && /other/.test(rl.stdout), 'list 标出当前并列出其他 provider');
  const rm = await run(home7, ['models']);
  check(rm.code === 0 && rm.stdout.includes(MODEL) && new RegExp('\\* ' + MODEL).test(rm.stdout), 'models 列出可用模型并标出当前', rm.stdout.slice(0, 200));
  const ru = await run(home7, ['use', 'other', '--model', 'gpt-5.6-sol']);
  check(ru.code === 0 && /^model_provider = "other"$/m.test(readCfg(home7)), 'use 可切换 provider');
  const rr = await run(home7, ['restore']);
  check(rr.code === 0 && readCfg(home7) === postDeploy, 'restore 回滚到上一步（use 之前）',
    'diff=' + readCfg(home7).split('\n').filter((l, i) => l !== postDeploy.split('\n')[i]).slice(0, 3).join(' | '));
  const rr2 = await run(home7, ['restore', '1']);
  check(rr2.code === 0 && readCfg(home7) === FIXTURE, 'restore 1 回到更早一份（最初配置，逐字一致）',
    'diff=' + readCfg(home7).split('\n').filter((l, i) => l !== FIXTURE.split('\n')[i]).slice(0, 3).join(' | '));
  check(readAuth(home7).OPENAI_API_KEY === OLDKEY, 'restore 一并回滚 auth.json');
  const rb = await run(home7, ['backups']);
  const nBak = (fs.readdirSync(home7).filter(f => f.startsWith('config.toml.bak-api-')).length);
  check(rb.code === 0 && nBak >= 2, `同秒多次操作各留一份备份（实测 ${nBak} 份）`);

  section('8. 全新机器（无 config.toml）');
  const home8 = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-deploy-selftest-fresh-'));
  const r8 = await run(home8, ['deploy', '--key', KEY, '--base-url', m1.base, '--no-test']);
  const cfg8 = readCfg(home8);
  check(r8.code === 0, '退出码 0', (r8.stderr || '').slice(0, 200));
  check(/^model_provider = "custom"$/m.test(cfg8) && /^model = "mock-gpt-5\.6-sol"$/m.test(cfg8), '从零生成合法配置');
  check(/\[model_providers\.custom\]/.test(cfg8) && /requires_openai_auth = true/.test(cfg8), 'provider 段完整');

  section('9. agent 友好输出与 env_key 模式');
  const rj = await run(home7, ['status', '--offline', '--json']);
  let parsed = null; try { parsed = JSON.parse(rj.stdout); } catch (_) {}
  check(rj.code === 0 && parsed && parsed.command === 'status', '--json 输出可被解析');
  const home9 = makeHome('envkey');
  const r9 = await run(home9, ['deploy', '--key', KEY, '--base-url', m1.base, '--env-key', 'MY_RELAY_KEY', '--no-test', '--no-catalog']);
  const cfg9 = readCfg(home9);
  const secOf = (text, head) => { const i = text.indexOf(head); const j = text.indexOf('\n[', i + 1); return text.slice(i, j < 0 ? undefined : j); };
  const sec9 = secOf(cfg9, '[model_providers.custom]');
  check(r9.code === 0 && /env_key = "MY_RELAY_KEY"/.test(sec9), 'env_key 模式写入 env_key');
  check(!/requires_openai_auth/.test(sec9), 'env_key 模式移除自身的 requires_openai_auth');
  check(/requires_openai_auth = true/.test(secOf(cfg9, '[model_providers.other]')), '未误删其他 provider 的 requires_openai_auth');
  check(readAuth(home9).OPENAI_API_KEY === OLDKEY, 'env_key 模式不写 auth.json');

  section('10. 选模型时排除图像/embedding 类模型');
  const m10 = await startMock({ models: ['gpt-image-2', 'gpt-image-2.5-flare', 'text-embedding-3-small', MODEL] });
  const home10 = makeHome('pick');
  const r10 = await run(home10, ['deploy', '--key', KEY, '--base-url', m10.base, '--no-test', '--no-catalog']);
  check(r10.code === 0 && /^model = "mock-gpt-5\.6-sol"$/m.test(readCfg(home10)), '图像/embedding 排在前也不会被选中',
    readCfg(home10).split('\n').filter(l => /^model = /.test(l)).join());

  section('11. 目录同步剔除「虚报」模型（只写实测能应答的）');
  // 真实场景：中转 /models 列出 16 个，其中 12 个在 /responses 上是 500 not implemented
  const m11 = await startMock({ models: [MODEL, 'mock-claude-9', 'mock-deepseek-9', 'gpt-image-9'], deadModels: ['mock-claude-9', 'mock-deepseek-9'] });
  const home11 = makeHome('probe');
  const r11 = await run(home11, ['deploy', '--key', KEY, '--base-url', m11.base, '--no-test']);
  const cat11 = JSON.parse(fs.readFileSync(catPath(home11), 'utf8'));
  const slugs11 = cat11.models.map(m => m.slug);
  check(r11.code === 0, '退出码 0', (r11.stderr || '').slice(0, 200));
  check(slugs11.includes(MODEL), '能应答的模型被写入');
  check(!slugs11.includes('mock-claude-9') && !slugs11.includes('mock-deepseek-9'), '实测 500 的模型被剔除', slugs11.join(','));
  check(!slugs11.includes('gpt-image-9'), '图像模型被剔除');
  check(/实测可应答/.test(r11.stdout) && /2 个不可用已排除/.test(r11.stdout), '输出说明了剔除了几个');
  check(/200/.test(r11.stdout) && /500/.test(r11.stdout), '逐个模型的实测状态都打印了');

  const r11b = await run(home11, ['catalog', 'sync', '--include-dead']);
  const cat11b = JSON.parse(fs.readFileSync(catPath(home11), 'utf8'));
  check(r11b.code === 0 && cat11b.models.some(m => m.slug === 'mock-claude-9'), '--include-dead 时仍写入（明知是坑）');

  const r11c = await run(home11, ['catalog', 'sync', '--prune']);
  const cat11c = JSON.parse(fs.readFileSync(catPath(home11), 'utf8'));
  check(r11c.code === 0 && !cat11c.models.some(m => m.slug === 'gpt-5.6-sol'), '--prune 清掉不在中转列表里的旧条目',
    cat11c.models.map(m => m.slug).join(','));

  section('12. catalog 命令与字段补齐');
  const r12 = await run(home11, ['catalog', 'list']);
  check(r12.code === 0 && /App 可见/.test(r12.stdout), 'catalog list 显示 App 实际可见条数', r12.stdout.slice(0, 160));
  const home12 = makeHome('norm');
  const r12b = await run(home12, ['catalog', 'sync', '--dry-run', '--base-url', m1.base, '--key', KEY]);
  check(r12b.code === 0 && /--dry-run：未写文件/.test(r12b.stdout), 'catalog sync --dry-run 不写文件', r12b.stdout.slice(-200));
  check(JSON.parse(fs.readFileSync(catPath(home12), 'utf8')).models.length === 1, 'dry-run 后目录未变');
  const r12d = await run(home12, ['catalog', 'sync', '--base-url', m1.base, '--key', KEY]);
  check(r12d.code === 0 && JSON.parse(fs.readFileSync(catPath(home12), 'utf8')).models.some(m => m.slug === MODEL),
    'catalog sync 可用 --base-url/--key 指定通道（不动 config.toml）');
  check(readCfg(home12).includes('https://apinexus.dpdns.org/v1') && !readCfg(home12).includes(m1.base.replace('/v1', '')),
    'catalog sync 不改动 config.toml');
  const r12c = await run(home12, ['deploy', '--key', KEY, '--base-url', m1.base, '--no-test']);
  const cat12 = JSON.parse(fs.readFileSync(catPath(home12), 'utf8'));
  const kept = cat12.models.find(m => m.slug === 'gpt-5.6-sol');
  const added12 = cat12.models.find(m => m.slug === MODEL);
  check(r12c.code === 0, '对字段不全的旧目录也能完成部署', (r12c.stderr || '').slice(0, 200));
  check(!!kept && kept.support_verbosity === true && !!kept.truncation_policy, '保留下来的旧条目被补齐了必填字段');
  check(!!added12 && added12.support_verbosity === true && !!added12.model_messages, '新增条目带齐全字段');

  m1.srv.close(); m4.srv.close(); m10.srv.close(); m11.srv.close();

  console.log(results.join('\n'));
  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.log(results.join('\n'));
  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  console.error('自测异常（已打印前序断言）: ' + e.stack);
  process.exit(1);
});
