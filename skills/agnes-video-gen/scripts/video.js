#!/usr/bin/env node
// agnes-video-gen: 创建视频任务 -> 轮询 -> 下载 mp4
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE = 'https://apihub.agnes-ai.com/v1';
const APIHUB = 'https://apihub.agnes-ai.com';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  return process.argv[i + 1] === undefined ? def : process.argv[i + 1];
}
function argAll(name) {
  const out = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === '--' + name && process.argv[i + 1]) out.push(process.argv[i + 1]);
  }
  return out;
}

function getKey() {
  if (process.env.AGNES_API_KEY) return process.env.AGNES_API_KEY;
  try {
    const p = path.join(os.homedir(), '.workbuddy', 'models.json');
    const list = JSON.parse(fs.readFileSync(p, 'utf8'));
    const hit = list.find(m => (m.url || '').includes('apihub.agnes-ai.com') && m.apiKey);
    if (hit) return hit.apiKey;
  } catch (e) {}
  return null;
}

const sleep = ms => new Promise(s => setTimeout(s, ms));

const MODE_MAP = {
  'agnes-video-v2.0': { text: 'ti2vid', keyframe: 'keyframes', reference: 'multi_reference' },
};

(async () => {
  const prompt = arg('prompt');
  if (!prompt) {
    console.log(JSON.stringify({ ok: false, error: 'missing --prompt' }));
    process.exit(1);
  }
  const key = getKey();
  if (!key) {
    console.log(JSON.stringify({ ok: false, error: 'no api key: set AGNES_API_KEY or add an apihub.agnes-ai.com entry to ~/.workbuddy/models.json' }));
    process.exit(1);
  }

  const model = arg('model', 'agnes-video-2.5-flash');
  let mode = arg('mode', 'text');
  const map = MODE_MAP[model];
  if (map && map[mode]) mode = map[mode];

  const body = { model, prompt, mode };
  if (model === 'agnes-video-2.5-flash') {
    body.seconds = arg('seconds', '5');
    body.size = arg('size', '720P');
    body.aspect_ratio = arg('aspect-ratio', '16:9');
  }
  const ff = arg('first-frame', '');
  const lf = arg('last-frame', '');
  if (ff) body.first_frame = ff;
  if (lf) body.last_frame = lf;
  const imgs = argAll('image');
  if (imgs.length) body.images = imgs;
  const auds = argAll('audio');
  if (auds.length) body.audios = auds;

  // 1. 创建任务（429 / 503 退避重试）
  let created = null;
  let lastErr = null;
  for (let i = 1; i <= 10; i++) {
    const r = await fetch(BASE + '/videos', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const txt = await r.text();
    if (r.ok) {
      try { created = JSON.parse(txt); } catch (e) { lastErr = 'bad json: ' + txt.slice(0, 200); }
      if (created) break;
    } else {
      lastErr = 'HTTP ' + r.status + ' ' + txt.slice(0, 300);
      if (r.status === 429 || r.status === 503) {
        console.error('  retry ' + i + ': ' + lastErr);
        await sleep((i <= 3 ? 15000 : 30000));
        continue;
      }
      break;
    }
  }

  if (!created) {
    console.log(JSON.stringify({ ok: false, stage: 'create', error: lastErr }));
    process.exit(1);
  }

  const videoId = created.video_id || created.id || created.task_id;
  console.log('CREATED model=' + model + ' video_id=' + videoId);
  console.log('RAW ' + JSON.stringify(created).slice(0, 800));

  if (process.argv.includes('--no-wait') || !videoId) {
    console.log(JSON.stringify({ ok: true, stage: 'created', model, video_id: videoId, raw: created }));
    process.exit(0);
  }

  // 2. 轮询
  const timeoutMs = parseInt(arg('timeout', '900'), 10) * 1000;
  const t0 = Date.now();
  let status = '';
  let result = null;
  let gap = 10000;
  while (Date.now() - t0 < timeoutMs) {
    await sleep(gap);
    const q = await fetch(APIHUB + '/agnesapi?video_id=' + encodeURIComponent(videoId) + '&model_name=' + model, {
      headers: { Authorization: 'Bearer ' + key },
    });
    const txt = await q.text();
    let j = null;
    try { j = JSON.parse(txt); } catch (e) {}
    if (j && j.error) {
      // 查询太频繁会被 429：拉长间隔后继续，不要放弃任务
      gap = Math.min(gap + 5000, 25000);
      console.error('  poll ' + Math.round((Date.now() - t0) / 1000) + 's throttled(' + (j.error.code || '') + '), gap -> ' + gap / 1000 + 's');
      continue;
    }
    if (j) {
      status = j.status || (j.data && j.data.status) || status;
      result = j;
    }
    console.error('  poll ' + Math.round((Date.now() - t0) / 1000) + 's status=' + status);
    if (/completed|succeeded|success/i.test(status)) break;
    if (/failed|error/i.test(status)) break;
  }

  if (!/completed|succeeded|success/i.test(status)) {
    console.log(JSON.stringify({ ok: false, stage: 'poll', video_id: videoId, status, raw: result }));
    process.exit(1);
  }

  // 3. 找视频 URL：优先顶层 url 字段，其次在整包里正则捞
  let url = null;
  const cand = [result && result.url, result && result.data && result.data.url];
  for (const c of cand) { if (typeof c === 'string' && /^https?:/i.test(c)) { url = c; break; } }
  if (!url) {
    const m = JSON.stringify(result).match(/https?:[^"\\ ]+?\.(?:mp4|mov|webm)(?:\?[^"\\ ]*)?/i);
    if (m) url = m[0].replace(/\\/g, '');
  }
  if (!url) {
    console.log(JSON.stringify({ ok: false, stage: 'download', video_id: videoId, error: 'no video url in response', raw: result }));
    process.exit(1);
  }

  const outDir = arg('out', process.cwd());
  fs.mkdirSync(outDir, { recursive: true });
  const dest = path.join(outDir, 'agnes-video-' + Date.now() + '.mp4');
  const r = await fetch(url);
  if (!r.ok) {
    console.log(JSON.stringify({ ok: false, stage: 'download', video_id: videoId, url, error: 'HTTP ' + r.status }));
    process.exit(1);
  }
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  console.log(JSON.stringify({ ok: true, model, video_id: videoId, file: dest, url }));
  console.log('FILE ' + dest);
})();
