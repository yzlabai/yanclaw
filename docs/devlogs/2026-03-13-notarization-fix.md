# macOS 公证失败：server binary 未签名

## 问题

v0.8.1 发布时 macOS aarch64 构建在 Apple 公证（notarization）阶段失败，报三个错误：

```
YanClaw.app/Contents/Resources/server/yanclaw-server:
  - The signature of the binary is invalid.
  - The signature does not include a secure timestamp.
  - The executable does not have the hardened runtime enabled.
```

## 原因

`yanclaw-server` 是 `bun build --compile` 生成的独立可执行文件，通过 Tauri 的 `bundle.resources: ["server/*"]` 复制到 `.app/Contents/Resources/server/` 中。

**关键点**：Tauri 在打包时只对主 app binary（`MacOS/yanclaw`）和 `.app` 本身执行 `codesign`，**不会对 `Resources/` 下的文件签名**。Apple 公证要求 bundle 内所有可执行文件都必须：

1. 有有效签名
2. 包含安全时间戳（`--timestamp`）
3. 启用 hardened runtime（`--options runtime`）

## 修复 (v0.8.2)

### 1. Release workflow 新增签名步骤

在 `tauri-apps/tauri-action` 之前增加两个步骤：

```yaml
# 导入证书
- name: Import Apple certificate
  run: |
    # 创建临时 keychain，导入 .p12 证书
    security create-keychain ...
    security import ...

# 编译 + 签名
- name: Build and sign server binary (macOS)
  run: |
    bun run --filter @yanclaw/server build:compile
    codesign --sign "$APPLE_SIGNING_IDENTITY" \
      --options runtime \
      --timestamp \
      --force \
      src-tauri/server/yanclaw-server
```

### 2. 防止 Tauri 重新编译覆盖签名

Tauri 的 `beforeBuildCommand` 会触发 server 编译，这会覆盖已签名的二进制。新增条件编译脚本：

```json
// packages/server/package.json
"build:compile:skip-if-exists": "node -e \"...existsSync check...\" || bun run build:compile"
```

`beforeBuildCommand` 改用此脚本：
```json
// src-tauri/tauri.conf.json
"beforeBuildCommand": "bun run --filter @yanclaw/web build && bun run --filter @yanclaw/server build:compile:skip-if-exists"
```

流程：macOS CI 先编译+签名 → Tauri 打包时检测到 binary 已存在 → 跳过编译 → 签名保持完整。

非 macOS 平台（Windows/Linux）不执行签名步骤，`skip-if-exists` 检测不到 binary，正常编译。

### 3. 改动文件

| 文件 | 改动 |
|---|---|
| `.github/workflows/release.yml` | 新增证书导入 + server binary 签名步骤 |
| `src-tauri/tauri.conf.json` | `beforeBuildCommand` 改用 `build:compile:skip-if-exists` |
| `packages/server/package.json` | 新增 `build:compile:skip-if-exists` 脚本 |

## 经验

- Tauri `resources` 是纯文件复制，不做 codesign —— 任何放在 resources 中的可执行文件都需要手动签名
- Apple 公证对 bundle 内所有 Mach-O 二进制都有签名要求，不只是主程序
- `bun build --compile` 生成的二进制是标准 Mach-O 文件，可以正常 codesign
