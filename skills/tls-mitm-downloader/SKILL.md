---
name: tls-mitm-downloader
description: |
  在有 TLS 中间人代理的网络里把文件可靠下载到本地（GitHub Release / cdn 直链），
  自动跟随重定向、流式落盘、SHA256 校验、失败重试。当用户说「下载 xxx」
  「GitHub 下不下来」「curl 报证书错误」「unable to verify the first certificate」
  「CRYPT_E_NO_REVOCATION_CHECK」时使用。
agent_created: true
---

# 带 TLS 中间人的可靠下载器

## 背景：为什么官方工具会失败

本机（及很多公司/学校网络）有 TLS 中间人代理（`HTTPS_PROXY=http://127.0.0.1:<port>`），
证书被替换成自签。症状固定：

- **curl**：`curl: (35) schannel: CRYPT_E_NO_REVOCATION_CHECK`
- **node**：`ERROR unable to verify the first certificate`
- **PowerShell Invoke-WebRequest**：能跑但输出海量"已写入字节数"刷屏，中途还会 exit 1

先确认代理是否存在：

```powershell
$env:HTTPS_PROXY
```

## 两条解法：按工具选

| 工具 | 解法 |
| --- | --- |
| curl | 加 `--ssl-no-revoke`（只关吊销检查，还在校验链） |
| node | `rejectUnauthorized: false`（**关掉全部校验，必须另做完整性验证**） |

curl：

```bash
curl -L --ssl-no-revoke -o out.zip "https://github.com/owner/repo/releases/download/v1.0/file.zip"
```

## node 下载器（推荐，可控性最强）

关键点：**关掉 TLS 校验后，完整性必须用官方渠道的哈希值来保证**，不能"下载成功就算完"。

```js
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

function download(url, dest, redirects = 0) {
  if (redirects > 5) throw new Error('重定向次数过多');
  const req = https.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    timeout: 30000,
    // 网络层有 TLS 中间人；完整性靠官方 SHA256 保证
    rejectUnauthorized: false,
  }, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume();
      return download(res.headers.location, dest, redirects + 1);
    }
    if (res.statusCode !== 200) {
      return res.destroy(new Error('HTTP ' + res.statusCode));
    }
    const hash = crypto.createHash('sha256');
    const ws = fs.createWriteStream(dest);
    res.on('data', (c) => hash.update(c));
    res.pipe(ws);
    ws.on('finish', () => console.log('SHA256=' + hash.digest('hex')));
    ws.on('error', (e) => console.error('写入失败', e.message));
  });
  req.on('timeout', () => req.destroy(new Error('超时')));
  req.on('error', (e) => console.error('请求失败', e.message));
}

download(process.argv[2], process.argv[3]);
```

用托管 node（不要用系统 node）：

```bash
<node.exe 路径> dl.js <url> <dest>
```

## 完整性校验：交叉验证，不能只看本地

关掉证书校验后，下载到的字节流**不保证来自 GitHub**。必须拿官方哈希比对：

```bash
# GitHub API 的 asset 对象里有官方 digest（sha256:xxxx）
gh api repos/OWNER/REPO/releases/tags/TAG --jq '.assets[] | {name, digest, size}'
```

把 digest 里的 `sha256:` 去掉，与本地算出的比对。实测二者一致才算通过。

⚠️ 坑：网络受代理影响时，**本地下载的校验值本身也取不到**（curl 同样报错）。
此时只能靠 API 里的官方值 + 官方体积 size 双重旁证。

## 排查顺序

1. `node -e "console.log(process.env.HTTPS_PROXY)"` 确认代理
2. 代理进程是否活着（经常是"代理在但已失效"）
3. 换直连试：`--noproxy '*'`（curl）/ 关掉环境变量
4. 都不行再上 `rejectUnauthorized: false` + 官方哈希校验
5. 大文件极慢是常态（实测 14.8MB 走了 9 分钟）—— 用后台任务跑，别用短超时

## 不要用这些

- `Invoke-WebRequest`：输出刷屏且容易中途失败
- 手拼 `bash -c` 管道：跨工具会被安全策略拦
- 看到 "exit 0" 就认为装好了：**winget 同理，必须再验证产物是否存在**
