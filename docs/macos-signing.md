# macOS 应用签名与公证指南

YanClaw 使用 Tauri v2 打包 macOS 应用。未签名的 `.app` 会被 Gatekeeper 拦截，提示"已损坏，无法打开"。本文档记录完整的签名 + 公证流程。

## 前置条件

| 项目 | 说明 |
|------|------|
| Apple Developer 账号 | [developer.apple.com](https://developer.apple.com)，$99/年 |
| Developer ID Application 证书 | **不是** Apple Development 证书（那个只能本机调试） |
| App 专用密码 | 用于公证提交，在 [appleid.apple.com](https://appleid.apple.com/account/manage) 生成 |

## 1. 创建 Developer ID Application 证书

### 1.1 生成 CSR

打开 **Keychain Access** → 菜单栏 **证书助理** → **从证书颁发机构请求证书**：

- 用户电子邮件：填 Apple ID 邮箱
- 常用名称：随意
- 请求是：**存储到磁盘**

保存 `.certSigningRequest` 文件。

### 1.2 在 Apple Developer 后台创建证书

1. 打开 [Certificates](https://developer.apple.com/account/resources/certificates/list)
2. 点 **+** → 选择 **Developer ID Application**
3. 上传刚才的 CSR 文件
4. 下载 `.cer` 文件，双击导入 Keychain

### 1.3 验证

```bash
security find-identity -v -p codesigning
```

应能看到：

```
"Developer ID Application: Your Name (TEAM_ID)"
```

## 2. 生成 App 专用密码

1. 访问 [appleid.apple.com](https://appleid.apple.com/account/manage)
2. 登录 → **App 专用密码** → 生成
3. 记下格式为 `xxxx-xxxx-xxxx-xxxx` 的密码

## 3. 本地签名打包

设置环境变量后执行 Tauri 构建：

```bash
# 证书名称（从 security find-identity 输出中复制）
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAM_ID)"

# 公证所需
export APPLE_ID="your@apple.id"
export APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="XXXXXXXXXX"

# 构建
bun run tauri build
```

Tauri 会自动完成：签名 → 提交公证 → staple 公证票据到 `.app`。

> **提示**：可以把环境变量写入 `~/.zshrc` 或项目根目录的 `.env.local`（已在 `.gitignore` 中），避免每次手动 export。

### 构建产物

```
src-tauri/target/release/bundle/dmg/YanClaw_x.x.x_aarch64.dmg   # Apple Silicon
src-tauri/target/release/bundle/dmg/YanClaw_x.x.x_x64.dmg       # Intel
```

## 4. CI 签名（GitHub Actions）

在 GitHub repo **Settings → Secrets and variables → Actions** 中添加：

| Secret | 值 |
|--------|-----|
| `APPLE_CERTIFICATE` | `.p12` 证书的 base64 编码（见下方） |
| `APPLE_CERTIFICATE_PASSWORD` | 导出 `.p12` 时设置的密码 |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Your Name (TEAM_ID)` |
| `APPLE_ID` | Apple ID 邮箱 |
| `APPLE_PASSWORD` | App 专用密码 |
| `APPLE_TEAM_ID` | Team ID |

### 导出 .p12 并编码

```bash
# 在 Keychain Access 中右键证书 → 导出 → 选 .p12 格式 → 设置密码
# 然后 base64 编码
base64 -i Certificates.p12 | pbcopy
# 粘贴到 GitHub Secret APPLE_CERTIFICATE 中
```

### release.yml 配置

在 `tauri-apps/tauri-action` 的 `env` 中添加：

```yaml
- name: Build Tauri app
  uses: tauri-apps/tauri-action@v0
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
    # macOS 签名 + 公证
    APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
    APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
    APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
    APPLE_ID: ${{ secrets.APPLE_ID }}
    APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
    APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
```

这些变量只在 macOS runner 上生效，Windows/Linux 构建会自动忽略。

## 5. 验证签名

```bash
# 检查签名
codesign -dvv /Applications/YanClaw.app

# 检查公证状态
spctl -a -vvv /Applications/YanClaw.app
# 应输出：accepted / source=Notarized Developer ID

# 检查 Gatekeeper
spctl --assess --type exec /Applications/YanClaw.app
```

## 6. 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| "已损坏，无法打开" | 未签名或签名无效 | 临时：`xattr -cr /Applications/YanClaw.app`；正式：配置签名 |
| 公证失败 `invalid signature` | 用了 Apple Development 证书 | 必须用 **Developer ID Application** 证书 |
| 公证超时 | Apple 公证服务慢 | 重试，通常 2-10 分钟完成 |
| CI 签名报 `no identity found` | 证书未正确导入 | 检查 `APPLE_CERTIFICATE` base64 编码和密码是否正确 |
| CORS 错误 `tauri://localhost` | 打包后 WebView origin 不同于开发模式 | 服务端 CORS 白名单需包含 `tauri://localhost` |
