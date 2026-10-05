---
name: android-webview-apk
description: 在没有 Gradle、没有 Android Studio 的 Windows 机器上，把一套 HTML/CSS/JS 界面（设计稿还原页、单页 WebView 应用、小游戏）打成可直接安装的签名 APK。涵盖工具链获取（JDK + build-tools + platform）、aapt2→javac→d8→zipalign→apksigner 全手工流水线、Java2D 生成多密度启动图标、自适应图标、WebView 壳 Activity，以及三个必踩的坑（aapt2 在 Windows 写反斜杠导致 assets 404、resources.arsc 必须未压缩+对齐、dex 必须在 zipalign 之后追加）。当用户说「把网页打包成 APK」「生成 Android 应用」「没有 Android Studio 怎么打包」「设计稿做成 App 装到手机上」「WebView 壳应用」「做成能安装的 App」「签名 APK」「为什么装不上/白屏/字体不对」时使用。
agent_created: true
---

# 手工流水线：HTML → 可安装 APK

适用场景：机器上**没有** Gradle / Android Studio / Android SDK，只有一个 HTML+CSS+JS 的界面
（典型来源：Ardot/Figma 还原出来的页面、单页小游戏、内部工具）。
一次构建约 15 秒，产物 300 KB～几 MB。

## 0. 先做决策，别急着下载

| 目标 | 路线 | 说明 |
|---|---|---|
| 只要能看/能点，发个链接就行 | **不要打 APK** | 静态站点直接部署发链接，成本差两个数量级 |
| 要装到 Android 手机上 | WebView 壳 + 本 skill | 本文 |
| 要上架应用商店 | **本 skill 不够** | 需要 App Bundle、隐私政策、软著等，先确认合规路径 |
| 要 iOS | 本 skill 不适用 | Windows 上无法构建 iOS |

确认要打 APK 之后，再进入下面流程。

## 1. 工具链（一次性，约 300 MB，存在 `toolchain/` 里别删）

只需要三样：**JDK、build-tools、platform**。不需要 `cmdline-tools`，不需要 Gradle。

```
toolchain/
  jdk/jdk-17.0.2/bin/{javac,java,keytool}.exe
  sdk-bt/android-14/{aapt2.exe, zipalign.exe, d8.bat, apksigner.bat, lib/{d8.jar,apksigner.jar}}
  sdk-plat/android-34/android.jar
```

可用的下载源（华为云 / Google 官方，2026-09 实测可用）：
- JDK 17.0.2 Windows x64：`https://mirrors.huaweicloud.com/openjdk/17.0.2/openjdk-17.0.2_windows-x64_bin.zip`
- build-tools r34：`https://dl.google.com/android/repository/build-tools_r34-windows.zip`
- platform 34：`https://dl.google.com/android/repository/platform-34-ext7_r02.zip`（解压后 `android.jar` 在 `android-14/` 或 `android-34/`）

解压用系统自带的 bsdtar（`C:\Windows\System32\tar.exe -xf x.zip -C dir`），
本机没有 unzip 也能用。**下载用 Node 的 https 流式写文件**，别指望 curl/wget。

## 2. 工程结构

```
project/
  index.html              ← 界面本体
  assets/                 ← 字体/图片（相对 index.html 的 ./assets/...）
  android/
    AndroidManifest.xml
    res/values/{strings,colors,styles}.xml
    res/drawable/ic_launcher_foreground.xml
    res/mipmap-anydpi-v26/ic_launcher.xml
    res/mipmap-*/ic_launcher.png        ← 由 IconGen 生成
    src/com/<pkg>/MainActivity.java
    tools/{IconGen.java, zipadd.js, preview.html}
    build.js              ← 一键构建
```

`AndroidManifest.xml` 要点：`package`、`minSdkVersion 21`、`targetSdkVersion 34`、
`screenOrientation="portrait"`、`configChanges` 带上 `density|fontScale|uiMode`、
**零权限**（全内置资源的 WebView 不需要任何权限声明）。

## 3. 构建流水线（顺序不能换）

```
aapt2 compile --dir res -o build/res.zip
aapt2 link -o build/base.apk -I android.jar --manifest AndroidManifest.xml \
    -A build/www -0 arsc --java build/gen \
    --min-sdk-version 21 --target-sdk-version 34 \
    --version-code 1 --version-name 1.0 --no-compile-sdk-metadata build/res.zip
node tools/zipadd.js slash build/base.apk          # ★ 见坑 1，必做
javac -encoding UTF-8 -source 8 -target 8 -Xlint:-options \
    -classpath android.jar -d build/classes src/**/*.java build/gen/**/R.java
java -cp lib/d8.jar com.android.tools.r8.D8 --lib android.jar --min-api 21 --release \
    --output build/dex <所有 .class>
node tools/zipadd.js add build/base.apk classes.dex build/dex/classes.dex   # ★ 见坑 2
zipalign -f -p 4 build/base.apk build/aligned.apk
zipalign -c -v 4 build/aligned.apk                 # 必须 "Verification succesful"
keytool -genkeypair -keystore ks -alias a -keyalg RSA -keysize 2048 -validity 10950 \
    -storepass <pw> -keypass <pw> -dname "CN=X, O=X, C=CN"
java -jar lib/apksigner.jar sign --ks ks --ks-key-alias a \
    --ks-pass pass:<pw> --key-pass pass:<pw> \
    --v1-signing-enabled true --v2-signing-enabled true --out out.apk build/aligned.apk
java -jar lib/apksigner.jar verify --verbose --print-certs out.apk
aapt2 dump badging out.apk
```

`build/www` 的内容 = `index.html` + `assets/`。注意 `-A` 是把该目录的**内容**放到 APK 的
`assets/` 下，所以 APK 里会变成 `assets/assets/...`（index.html 在 `assets/index.html`），
页面里的 `./assets/img/x.jpg` 依然能正确解析。这个"assets 套 assets"是无害的，别去改源码路径。

## 4. 三个必踩的坑

### 坑 1 — aapt2 在 Windows 把嵌套目录写成反斜杠（最阴）

`-A` 打包时 aapt2 用本地分隔符写 zip 条目名：`assets\fonts\x.woff2`。
zip 规范要求正斜杠，Android 的 AssetManager 也只认正斜杠
→ **字体、图片、子目录里的所有资源全部 404**。
致命之处：**桌面浏览器预览一切正常**，只有装机才炸。

修法：`zipadd.js slash` 原地把条目名里的 `0x5C` 换成 `0x2F`。
两者都是 1 字节，所以偏移、长度、CRC 全不变，不需要重建 zip。
改完必须断言"条目名里没有反斜杠"——注意**不要去整个二进制里搜 0x5C**，
压缩流和 resources.arsc 里到处都有，会误报；只查 CD 条目名。

### 坑 2 — resources.arsc 必须未压缩 + 4 字节对齐，所以 dex 要在 zipalign 之后追加

Android 11+ 对 `targetSdk ≥ 30` 的应用硬性要求 `resources.arsc` 未压缩且 4 字节对齐。
两件事：
- aapt2 link 必须显式 `-0 arsc`；
- 顺序必须是 **zipalign → 追加 dex**。先追加再 zipalign 的话 zipalign 面对压缩的 arsc
  会直接放弃对齐（输出里没有 `resources.arsc (OK)`）。

追加是安全的：往 zip 末尾写新条目 + 追加中央目录条目 + 重写 EOCD，
**既有条目的 local header 偏移完全不动**，所以对齐不被破坏。实现见 `scripts/zipadd.js`。
classes.dex 用 **STORE（method 0）** 存，合法且 Android 推荐（可 mmap）。

### 坑 3 — JDK 17 编译 Android 源码的姿势

- `--release 8` 会和 `android.jar` 冲突；用 `-source 8 -target 8 -Xlint:-options`
  配 `-classpath android.jar`。
- 老系统兼容：`WindowInsetsController`（API 30）这类符号要放进**独立的静态嵌套类**，
  只在 `Build.VERSION.SDK_INT >= 30` 分支里调用，避免老系统类校验阶段就炸。
- `apksigner.bat` 依赖 `JAVA_HOME`；直接 `java -jar lib/apksigner.jar` 更省事。
- OK 的产物标志：`zipalign -c -v 4` 全 `(OK)` + `apksigner verify` 里
  v1/v2/v3 都 `true`（v3.1/v4 为 false 是正常的，不影响安装）。

## 5. WebView 壳 MainActivity

只做四件事，别加别的：

1. `applyFullscreen()`：API 30+ 走 `setDecorFitsSystemWindows(false)` +
   `WindowInsetsController.hide(systemBars)` + `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`；
   老系统走 `SYSTEM_UI_FLAG_IMMERSIVE_STICKY` 那一套。
2. WebSettings：`setJavaScriptEnabled`、`setDomStorageEnabled`、`setAllowFileAccess`、
   `setUseWideViewPort`、`setLoadWithOverviewMode`、`setSupportZoom(false)`、
   **`setTextZoom(100)`**（否则系统字体大小会破坏版式还原）。
3. `loadUrl("file:///android_asset/index.html")`。
4. 返回键：
   ```java
   web.evaluateJavascript("(function(){try{return window.__appBack?window.__appBack():false;}catch(e){return false;}})()",
       v -> { if (!"true".equals(v)) finish(); });
   ```
   页面侧 `window.__appBack` 逐屏后退，返回 true 表示"已处理"。

**不要设 `windowLayoutInDisplayCutoutMode=shortEdges`**：设计稿自带状态栏，
短边模式内容会跑到刘海下面被遮挡。用默认值让系统给刘海让位。

`file://` 下**外部字体文件会被 CORS 拦掉**，字体必须 base64 内联进 HTML 的 `@font-face`。
woff2 的 `data:` URL 在 Chromium WebView（Chrome 37+）里是支持的。

## 6. 启动图标

两套都要有：`mipmap-anydpi-v26/ic_launcher.xml`（自适应，API 26+）
+ `mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher.png`（48/72/96/144/192，API 21–25 回退）。

- 自适应前景用**手写 vector drawable**，108×108 视口，内容压在中心 72×72 安全区；
  背景用 `<color>`。
- 位图图标**别用浏览器截图缩放**（headless 有最小视口宽度，小尺寸会被裁）。
  用 **Java2D + ImageIO** 直接按 108 网格坐标画，5 种密度一次出图，精确可控。
  模板见 `scripts/IconGen.java`，与 vector 用同一套坐标保证视觉一致。

## 7. 验证（装机前能做的部分）

没有设备也能验掉大部分问题：

1. **资产路径**：`node tools/zipadd.js list out.apk`，确认没有反斜杠、
   `resources.arsc` 是 STORE、`classes.dex` 在。
2. **对齐与签名**：`zipalign -c -v 4`、`apksigner verify --verbose`。
3. **清单**：`aapt2 dump badging out.apk` —— 看 package / label / icon / launchable-activity。
4. **界面还原**：无头浏览器渲染 + 像素比对（**用 iframe 拿真实 375×812 视口**，
   媒体查询才生效）。逐"墨迹带（row-band）"比对设计稿与实现，
   注意**合并间隙 ≤2 设备像素的相邻带**，否则一行抗锯齿变稀就会把一条带切成两条、误报偏移。
5. **出预览图给用户看**：多个 iframe 并排 + 无头浏览器 `--screenshot`，
   尺寸 = `--window-size`，精确可控。

装到手机上还要人眼确认的：中文字形（系统 Noto Sans CJK）、刘海遮挡、返回键手感、真机性能。

## 8. 交付时要说清

- APK 路径与大小、包名、minSdk/targetSdk、是否零权限。
- 签名密钥位置（**丢了就无法覆盖安装升级**）。
- 可编辑源在哪（改 HTML 即改 App 外观，重跑 `node build.js`）。
- 哪些是占位、怎么替换。
- 别把设计工具/第三方平台的**水印、品牌字标**打进成品；占位图要自己画。
