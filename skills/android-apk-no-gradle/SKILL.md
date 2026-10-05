---
name: android-apk-no-gradle
description: 在没有 Android Studio / Gradle 的 Windows 机器上，从零搭出 JDK + Android SDK 编译链，并用 aapt2 + javac + d8 + zipalign + apksigner 手工产出一个已签名、可安装的 APK。也包含「把已有 HTML/设计稿包成 WebView 原生 App」的完整做法。当用户要求「生成 apk」「打包安卓应用」「把网页做成安卓 App」「装到手机上」，或需要在无网络/弱网络的国内环境下载 Android SDK 时使用。
agent_created: true
---

# 无 Gradle 手工构建 Android APK（Windows）

适用：本机没有 Android Studio / Gradle，甚至没有 JDK；目标是一个**能装到手机上的真 APK**。

## 0. 决策：先确认形态

- 用户要 `.apk` → **不要**只交付 HTML，必须走完编译链。
- 如果原型是网页/设计稿 → **WebView 壳 + 内嵌单页** 是首选：
  版式由 HTML/CSS 精确承载，原生侧只做全屏承载与返回键，比用 Kotlin 重画一遍更快、更不容易走形。
- 需要原生性能/传感器/后台才考虑 Kotlin 重写。

## 1. 探测现状（先做，别盲下）

检查 `java` / `javac` / `gradle` / `adb` / `aapt2` 是否在 PATH，`ANDROID_HOME`、`JAVA_HOME` 是否设置，
以及 `%LOCALAPPDATA%\Android\Sdk`、`C:\Android`、`D:\Android` 是否存在。

本机 Bash 工具 PATH 可能损坏（无 `ls/mkdir/cp/grep`），且 PowerShell 工具 stdout 不回传。
**可靠做法**：写 node 脚本，用 `execFileSync` 调 `powershell.exe -NoProfile -NonInteractive -Command`，
输出就能正常拿到。

## 2. 装工具链

统一放到工程**外**的目录（如 `%ANDROID_SDK%`），别把 1GB 级工具链塞进工作区。

**JDK 17**（约 178MB，MS CDN 稳定）：
`https://aka.ms/download-jdk/microsoft-jdk-17.0.13-windows-x64.zip`

**Android SDK**：`dl.google.com` 在国内会 **ECONNRESET 中途断流**。改用国内镜像：

```
https://mirrors.cloud.tencent.com/AndroidSDK/<文件名的扁平名>
```

该镜像**不做目录索引**（GET 根路径只有 ~1.5KB），必须知道确切文件名。拿文件名的办法：

1. 下 `https://dl.google.com/android/repository/repository2-3.xml`（~416KB，小文件能下完）
2. 在 `<remotePackage path="platforms;android-34">` 这类块里找 **`<host-os>windows</host-os>`** 那个 `<archive>` 的 `<url>`
3. ⚠️ **同一个包的第一个 `<archive>` 是 linux**。用正则抓"第一个 `<url>`"会拿到 linux 包，必须按 host-os 过滤。

本机实测可用的三个包（sha1 与 XML 一致）：

| 包 | 文件 | 体积 |
|---|---|---|
| platforms;android-34 | `platform-34-ext7_r03.zip` | 60.3 MB |
| build-tools;34.0.0 | `build-tools_r34-windows.zip` | 55.6 MB |
| platform-tools | `platform-tools_r37.0.1-win.zip` | 7.7 MB |

下载器用 node `https.get` + **Range 断点续传 + 重试**（`curl -o` 在本机会静默失败：退出码 0 但不落盘）。
解压用 PowerShell `Expand-Archive`。校验 sha1 后再铺目录；build-tools 的 zip 解出来是旧代号目录（如 `android-14`），
要重命名成 `34.0.0`，platform 同理挑出含 `android.jar` 的那层改名 `android-34`。

也可以直接跑 `sdkmanager`，但它只认 `dl.google.com`，弱网下容易断；手工铺包更可控。

## 3. 工程骨架

```
app/
├── AndroidManifest.xml        # 不要写 uses-sdk，交给 aapt2 link 的参数
├── res/values/{strings,styles}.xml
├── res/drawable/ic_launcher_{background,foreground}.xml   # 矢量，免 PNG
├── res/mipmap-anydpi-v26/ic_launcher.xml                  # adaptive-icon
├── java/<pkg>/MainActivity.java
└── assets/index.html          # 从工程根拷贝，保持单一真源
```

minSdk 定 **26** 就可以只用 adaptive icon XML，**完全不需要任何 PNG 图标**。
`AndroidManifest.xml` 里 activity 必须 `android:exported="true"`（targetSdk 31+ 强制）。

## 4. 构建六步

```bash
# 1 编译资源
aapt2 compile --dir res -o res.zip

# 2 链接（res.zip 作为【位置参数】，不能用 -R）
aapt2 link -o base.apk -I <android.jar> --manifest AndroidManifest.xml -A assets \
  --min-sdk-version 26 --target-sdk-version 34 --version-code 1 --version-name 1.0 \
  res.zip

# 3 编译 Java
javac -encoding UTF-8 -source 8 -target 8 -classpath <android.jar> -d classes <pkg>/MainActivity.java

# 4 dex（--output 目录必须先存在）
java -cp <build-tools>\lib\d8.jar com.android.tools.r8.D8 \
  --min-api 26 --lib <android.jar> --output dex classes/<pkg>/MainActivity.class

# 5 把 dex 塞进 apk（见下方代码）
# 6 对齐 + 签名
zipalign -f -p 4 base.apk aligned.apk
keytool -genkeypair -keystore habit.keystore -alias habit -keyalg RSA -keysize 2048 \
  -validity 10950 -storepass android -keypass android -dname "CN=Dev, O=Dev, C=CN"
java -jar <build-tools>\lib\apksigner.jar sign --ks habit.keystore --ks-key-alias habit \
  --ks-pass pass:android --key-pass pass:android --out signed.apk aligned.apk
java -jar <build-tools>\lib\apksigner.jar verify --print-certs signed.apk
```

d8 与 apksigner 也可以直接 `java -cp/-jar`，比调 `.bat` 更可靠。

## 5. 六个必踩的坑

1. **`aapt2 link` 加 `--no-compress assets/index.html` 会报**
   `magic value is 0x4f44213c but AAPT expects 0x54504141`（`0x4f44213c` 就是 `<!DO`）。
   原因：那个路径被当成"输入的已编译资源"。资源靠 `-A assets` 带进去即可，别加 `--no-compress`。
2. **主资源包要用位置参数，不能用 `-R`**。`-R` 是 overlay，会报
   `resource style/X does not override an existing resource`。
3. **`d8 --output <dir>` 要求目录已存在**，否则 `Invalid output: dex`。
4. **PowerShell 不能直接点调用 .NET 扩展方法**：`$zip.CreateEntryFromFile(...)` 会失败
   **且退出码仍为 0**。必须走静态类：
   ```powershell
   $ErrorActionPreference='Stop'
   Add-Type -AssemblyName System.IO.Compression.FileSystem
   $z=[System.IO.Compression.ZipFile]::Open('base.apk','Update')
   [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z,'classes.dex','classes.dex',
     [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
   $z.Dispose()
   ```
   → **推论（最重要的一条）**：构建脚本必须**硬校验产物**——
   读 apk 字节确认含 `classes.dex` / `AndroidManifest.xml` / `resources.arsc` / `assets/...`，
   不能信退出码、也不能信自己打印的 "OK"。曾因此产出过一次"看起来成功"但缺 dex 的废包。
5. **编译全程放纯 ASCII 目录**（如 `D:\...\build-xxx`）。d8/apksigner 都走 `.bat`，
   中文路径会触发批处理编码损坏。产物最后由 node 拷回项目目录。
6. **`dexdump.exe` 相对路径不友好**（`ReadFileToString failed`）。更硬的替代是**自己解析 dex 头**：
   magic `dex\n03x\0`、`file_size` 等于实际长度、`header_size==0x70`、`endian_tag==0x12345678`、
   自算 **adler32(bytes[12:])** 对头部 checksum、自算 **sha1(bytes[32:])** 对签名字段，
   再在字符串表里搜 `L<pkg>/<Activity>;`。全对才说明 dex 能被 ART 加载。

## 6. 验收清单

```bash
aapt2 dump badging signed.apk     # package/versionCode/minSdk/label/icon/launchable-activity
zipalign -c -v 4 signed.apk       # 对齐
java -jar apksigner.jar verify --print-certs signed.apk
```
再补：解开 apk 里的 `assets/index.html` 与源文件比 **sha256**，确认内嵌资源没走样。

**诚实边界**：本地无法验证真机运行。交付时要明说"结构合法、签名有效，但未在真机安装过"。

## 7. WebView 壳要点

- `WebSettings`：`setJavaScriptEnabled(true)`、`setDomStorageEnabled(true)`、
  `setSupportZoom(false)`、**`setTextZoom(100)`（不跟随系统字体缩放，保证版式不漂移）**
- `web.setOverScrollMode(View.OVER_SCROLL_NEVER)`
- 返回键：`onKeyDown` 里 `web.canGoBack()` → `goBack()`
- 全屏：`Build.VERSION.SDK_INT >= 30` 用 `WindowInsetsController.hide(statusBars|navigationBars)`
  + `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`；低版本用 `SYSTEM_UI_FLAG_IMMERSIVE_STICKY`；
  并在 `onWindowFocusChanged` 里重新进入全屏
- 页面侧用 `scale(min(vw/W, vh/H))` + `height: vh/scale` 让 390×844 之类的设计画布铺满而不留黑边
