# installers/ — 离线安装包放这里

`install/02-install-tools.ps1` 会**优先**用本目录里的离线安装包，
没有才提示你手动下载。好处：网络不通、或公司网/校园网有 TLS 中间人代理时，
别人依然能一次装好。

---

## 放什么

| 脚本要找的文件名 | 对应工具 | 官方下载地址 |
| --- | --- | --- |
| `Git-*-64-bit.exe` | Git for Windows | https://git-scm.com/download/win |
| `gh_*_windows_amd64.zip` | GitHub CLI | https://cli.github.com/ |
| `x86_64-*.7z` | MinGW-w64 | https://www.mingw-w64.org/downloads/ |
| `ninja-win.zip` | ninja | https://github.com/ninja-build/ninja/releases |

**文件名要按上面的模式**，脚本靠模式匹配（`Get-ChildItem -Filter`）。

---

## 不要提交到 Git

本目录已在 `.gitignore` 里排除。原因：

1. 安装包动辄几十上百 MB，会让仓库变得极重。
2. 第三方安装包再分发可能涉及授权问题。

想提供离线安装能力，两个办法：

- **开 Release**：把安装包挂到 GitHub Release 的附件里，README 里给下载链接。
- **只留下载脚本**：写个 `install/fetch-installers.ps1` 自动下载并校验 SHA256。

---

## 校验完整性

无论从哪里拿包，都**必须校验哈希**。在 PowerShell 里：

```powershell
Get-FileHash .\Git-2.55.0-64-bit.exe -Algorithm SHA256
```

把结果和官方公布的 SHA256 对比。不一致就别用。

> 本机网络有 TLS 中间人代理时，`curl` / `npm` / `winget` 常常报
> `unable to verify the first certificate` 或 `CRYPT_E_NO_REVOCATION_CHECK`。
> **不要**为了下载成功就关掉证书校验 —— 那样等于放弃了对中间人的防护。
> 正确做法：关校验下载 + **用官方 SHA256 校验完整性**，两头都不失守。
