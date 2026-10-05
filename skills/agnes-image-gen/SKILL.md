---
name: agnes-image-gen
description: |
  用 Agnes AI 的图像模型生成图片（文生图 / 图生图）。当用户要求「生成图片、
  画一张图、配图、做海报、生成插画、把这张图改成…」且希望走 Agnes 通道时使用。
  支持 agnes-image-2.5-flash（默认）/ 2.1-flash / 2.0-flash，当前全部免费。
  调用的是 apihub.agnes-ai.com/v1 的 OpenAI 兼容接口。
agent_created: true
---

# agnes-image-gen

通过 Agnes AI 的 OpenAI 兼容接口生成图片。结果**必须下载到本地**（平台返回的 URL 有
时效性，不能直接丢给用户）。

## 可用模型（当前均免费）

| 模型 ID | 说明 |
| --- | --- |
| `agnes-image-2.5-flash` | **默认**，最新 |
| `agnes-image-2.1-flash` | 次新 |
| `agnes-image-2.0-flash` | 旧版 |

## 调用

```bash
<你的 node.exe 路径> "<技能库>/agnes-image-gen/scripts/image.js" \
  --prompt "霓虹赛博城市夜景，电影级构图" \
  --out "<当前项目>/outputs"
```

> 路径用你自己的：`node.exe` 一般在 Node.js 安装目录下，
> `<技能库>` 就是你放技能的文件夹。

参数：

- `--prompt`（必填）画面描述。中文可用，写具体些（主体 + 环境 + 光线 + 构图）。
- `--model` 默认 `agnes-image-2.5-flash`。
- `--size` `1024x1024` 这类 `WxH`，或 `1K` / `2K` / `3K` / `4K` 档位。默认不传（用平台默认）。
- `--n` 生成张数，默认 1。
- `--image` 参考图 URL（图生图 / 编辑）。传了这个参数就是 i2i，此时**单个 `image`
  字符串**，不要传 `images` 数组（平台会 400）。
- `--out` 输出目录，默认当前工作目录。

脚本会打印一张一行 JSON，含 `ok`、`files`（本地绝对路径数组）、`urls`。

成功后用 `present_files` 把 `files` 里的路径呈现给用户。

## 要点

- API Key 从 `~/.workbuddy/models.json` 里第一条 `apihub.agnes-ai.com` 配置读取；
  也可用环境变量 `AGNES_API_KEY` 覆盖。换 Key 只改 models.json 即可。
- 免费账户有速率限制：撞到 `rate_limit_exceeded`(429) 时脚本自动退避重试
  （最多 6 次，间隔递增）。仍失败就告知用户稍后再试，不要死循环刷。
- `/images/edits` 不接受字符串 URL，必须 multipart 上传，本 skill 不走它。
