---
name: agnes-video-gen
description: |
  用 Agnes AI 的视频模型生成视频（文生视频 / 首尾帧控制 / 图片参考）。
  当用户要求「生成视频、做一段短视频、把这个图片变成视频、AI 视频」且希望走
  Agnes 通道时使用。默认 agnes-video-2.5-flash（限时免费），备选
  agnes-video-v2.0（当前免费）。任务是异步的：创建 → 轮询 → 下载 mp4。
agent_created: true
---

# agnes-video-gen

异步两步：创建任务 → 轮询结果 → 下载到本地。**平台返回的视频 URL 有时效，必须
下载到本地再交付。**

## 可用模型（均为当前免费）

| 模型 ID | 分辨率 | 时长 | mode 取值 |
| --- | --- | --- | --- |
| `agnes-video-2.5-flash`（默认） | 固定 `720P` | `"4"`–`"12"`，默认 `"5"` | `text` / `keyframe` / `reference` |
| `agnes-video-v2.0` | 平台默认 | 默认 | `ti2vid` / `keyframes` / `multi_reference` |

`agnes-video-2.5`（非 flash）**收费**，账号余额为 0 时会 403，本 skill 不用它。
脚本会自动做 mode 名映射：写 `text` 时，v2.0 会转成 `ti2vid`。

## 调用

```bash
<node.exe 路径> \
  "<技能库>/agnes-video-gen/scripts/video.js" \
  --prompt "雨后霓虹街道，银色跑车缓慢驶过，电影级运镜" \
  --seconds 5 --aspect-ratio 16:9 \
  --out "D:/当前项目/outputs"
```

参数：

- `--prompt`（必填）
- `--model` 默认 `agnes-video-2.5-flash`
- `--mode` `text`（默认）| `keyframe` | `reference`
- `--seconds` `"4"`–`"12"`，默认 `"5"`（仅 2.5-flash 支持，v2.0 会忽略）
- `--aspect-ratio` `21:9` / `16:9`（默认）/ `4:3` / `1:1` / `3:4` / `9:16`
- `--size` 2.5-flash 只能 `720P`，传别的会 400
- `--first-frame` / `--last-frame` 图片 URL（keyframe 模式，至少给一个）
- `--image` 参考图 URL，可重复传，**最多 5 个**（reference 模式）
- `--audio` 参考音频 URL，可重复传，**最多 3 个**（reference 模式）
- `--out` 输出目录，默认当前工作目录
- `--timeout` 轮询上限秒数，默认 900
- `--no-wait` 只创建任务、打印 video_id 就退出（适合后台跑批）

## 限流（重要）

免费账户视频队列经常 429（`rate_limit_exceeded`）或 503（`video_queue_full`）。
脚本内置退避重试（创建最多 10 次，间隔 15s 起递增），仍失败就**如实告知用户
「Agnes 视频队列忙，稍后再试」**，不要疯狂重试刷接口。

成功后用 `present_files` 呈现下载好的 mp4。
