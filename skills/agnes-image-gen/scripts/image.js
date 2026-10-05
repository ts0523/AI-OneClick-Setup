#!/usr/bin/env node
// agnes-image-gen: 调用 Agnes AI 图像生成接口（OpenAI 兼容）
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE = 'https://apihub.agnes-ai.com/v1';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v === undefined ? def : v;
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

async function download(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('download failed ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return dest;
}

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

  const body = {
    model: arg('model', 'agnes-image-2.5-flash'),
    prompt,
    n: parseInt(arg('n', '1'), 10),
  };
  const size = arg('size', '');
  if (size) body.size = size;
  const image = arg('image', '');
  if (image) body.image = image;

  let lastErr = null;
  let data = null;
  for (let attempt = 1; attempt <= 6; attempt++) {
    const r = await fetch(BASE + '/images/generations', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const txt = await r.text();
    if (r.ok) {
      try { data = JSON.parse(txt); } catch (e) { lastErr = 'bad json: ' + txt.slice(0, 200); }
      if (data) break;
    } else {
      lastErr = 'HTTP ' + r.status + ' ' + txt.slice(0, 300);
      if (r.status === 429 || r.status >= 500) {
        await sleep(2000 * attempt);
        continue;
      }
      break;
    }
  }

  if (!data || !data.data) {
    console.log(JSON.stringify({ ok: false, error: lastErr || 'unknown' }));
    process.exit(1);
  }

  const outDir = arg('out', process.cwd());
  fs.mkdirSync(outDir, { recursive: true });

  const files = [];
  const urls = [];
  for (const item of data.data) {
    const url = item.url || (item.b64_json ? null : null);
    if (!url) continue;
    urls.push(url);
    const ext = (path.extname(new URL(url).pathname) || '.png').split('?')[0] || '.png';
    const dest = path.join(outDir, 'agnes-image-' + Date.now() + '-' + files.length + ext);
    try {
      files.push(await download(url, dest));
    } catch (e) {
      // 下载失败仍返回 URL，让用户可手动取
    }
  }

  console.log(JSON.stringify({ ok: true, model: body.model, files, urls, task_id: data.task_id || null }));
  if (files.length) files.forEach(f => console.log('FILE ' + f));
  else console.log('NOTE 图片已生成但下载失败，URL: ' + urls.join(' , '));
})();
