# kimi-swarm

将 Kimi Code CLI 原生 Swarm 接入思考档位，在 `/effort`、`/thinking` 和 `/model` 中与 High、Max 一起选择。

Swarm 的实际请求参数为 **Max**，同时开启原生 Swarm。插件系统指令要求 Kimi 对每个新用户任务必须调用原生 `AgentSwarm`，普通子代理调用不能代替。切回 High 或 Max 会关闭原生 Swarm 并清除默认记忆。权限模式、审批流程和子代理上限继续由 Kimi 管理。

当前版本 **0.1.2，实验性**。支持 **Windows、Node.js ≥24.15**，已验证 **Kimi Code 2.4.1、2.5.2**。一次安装后，普通 `kimi` 入口长期生效。原版升级后，启动器会自动准备同版本的 Swarm 副本；代码接口检查与真实引擎验证全部通过后才切换。无法保证任意未来版本都兼容：检查失败时运行原版并说明原因。

## 安装并改造 CLI

在仓库根目录运行：

```powershell
npm run install:cli
```

脚本自动完成下载、补丁、启动验证、插件登记与命令入口设置。无需手工修改 CLI 源码。安装完成后重新启动终端应用，再运行 `kimi`。

安装过程：

1. 检查现有 `kimi.exe --version`，使用原版的稳定版本，最低为 2.4.1。
2. 查询官方 npm 包来源，按精确版本与 lockfile 安装到 `~/.kimi-code/swarm/releases/` 下的独立副本。新版本生成独立 lockfile；使用 `npm ci --ignore-scripts`，保留原包许可证和原始 JS 备份。
3. 校验全部修改位置，接入思考选择器、原生切换和状态栏字段，再检查语法、`--version`、`--help` 和隔离 home 中的真实引擎持久化。
4. 将策略插件登记到 Kimi 的插件列表，保留其他插件和安装前快照。
5. 创建 `kimi` / `kimi-swarm` 启动入口，把专用 `bin` 目录放到当前用户 PATH 前面。原有 `kimi.exe` 不改动、不删除。

管理器、更新器和策略文件随安装保存，不依赖此源码仓库。每次启动只检查原版版本号；没有后台轮询。检测到升级时才下载并验证匹配副本，同一版本适配失败后不反复下载；可用 `kimi swarm repair` 主动重试。`kimi upgrade` / `kimi update` 转交原版执行，下次启动再适配。

安装器会输出专用 `kimi-swarm.cmd` 的完整路径，可立即使用。若系统级 PATH 中已有 `kimi`，脚本会明确报告无法由用户 PATH 覆盖；此时使用专用入口，不提升权限改系统设置。

只准备独立副本、不修改 PATH：

```powershell
npm run install:cli -- --no-activate
```

仅通过官方 `/plugins install` 安装本仓库，只能加载策略提示词。官方插件接口尚不能注册新的 effort，**仍需运行本安装脚本完成 CLI 接入**。不用手工应用补丁。

## 使用

```text
/effort swarm
/effort high
/effort max
```

也可以打开 `/effort` 或 `/model`，用左右键选择 **Swarm**。仅在插件启用且模型声明支持 Max 时显示该选项。

- 选择 Swarm 后独立保存默认记忆；`/new`、重新打开 CLI 和重启后，新会话都会恢复 Max + 原生 Swarm，不受宿主 Max 默认值保存上限影响。
- 选择其他 effort 时关闭 Swarm 并清除该记忆。这两项规则也适用于 `Alt+S`；普通 effort 的原生默认值保存方式保持不变。
- 切换到不支持 Max 的模型时不强行启用 Swarm，也不改变模型；记忆仍保留，直到选择其他 effort 或禁用插件。
- 当前会话的原生 Swarm 状态由 Kimi 持久化，恢复会话时继续使用真实状态。
- 运行、压缩或恢复历史期间不能切换。切换失败会尝试还原原来的模型、effort 和 Swarm 状态，并报告实际结果。
- Swarm 系统指令明确要求每个新任务必须调用原生 `AgentSwarm`，任务简单或仅调用普通子代理都不能替代。更具体的用户禁止指令及宿主工具、权限、容量限制仍优先；被阻止时必须如实报告。这是模型指令要求，不伪称运行时已强制派发。

## kimi-code-monitor

兼容 `kimi-code-monitor` 的 CLI HUD，不要求安装 monitor。

CLI 内置状态栏显示 `thinking: swarm`。自定义状态栏收到：

```json
{
  "thinkingEffort": "swarm",
  "reasoningEffort": "max",
  "swarmMode": true
}
```

`thinkingEffort` 是给 HUD 的展示值；模型请求仍使用 `max`。monitor 的 Node `hud.mjs` 与此前的 Python `hud.py` 都优先读取该字段，可显示 `思考 swarm`，无需改动其源码或 `tui.toml`。窄终端继续遵循 monitor 自己的布局规则。

Swarm 字样使用 better-dsh 推理滑条 Ultra 的颜色：浅色主题 `#4941cf`、深色主题 `#a5a0ff`。选择器、内置状态栏和 monitor 的思考标签共用这组颜色，尊重终端的禁用颜色设置。High、Max 保持宿主样式。

## 检查、停用与撤销

```powershell
kimi swarm status
kimi swarm disable
kimi swarm uninstall
```

`disable` 停用当前插件并撤销用户 PATH 接入；`uninstall` 还会恢复安装前的同名插件记录（首次安装则禁用）。两者都保留会话、偏好、安装副本与备份。旧终端中缓存的入口也会立即转发到原版 CLI。正在运行的会话不会被强行改变，可先执行 `/swarm off`。

停用后，使用保留的专用入口重新启用：

```powershell
& "$HOME\.kimi-code\swarm\bin\kimi-swarm.cmd" enable
```

专用入口也支持 `status`、`disable`、`uninstall`、`repair`。`repair` 重新准备匹配当前原版的副本，不会自动重新启用已停用的入口。源码目录中的 `npm run check` / `npm run deactivate` 仍可用。

`--root` 可指定安装目录，`--home` 可指定独立 Kimi home。检查与停用同样接受 `--root`。这些参数适合隔离验证。

## 开发与验证

本项目自身无第三方开发依赖，使用 Node 内置测试：

```powershell
npm test
```

下载并解包官方 npm 包后，可验证真实包中的选择器和状态栏代码：

```powershell
node scripts/verify-bundle.mjs <官方包解包目录>
```

设置 `KIMI_MONITOR_MODULE` 为 monitor 的 `hud.mjs` 路径时，还会调用真实渲染器检查 `思考 swarm` 及颜色适配。此前的 Python 版本可设置 `KIMI_MONITOR_PY` 指向 `hud.py`。

真实引擎集成检查使用独立 home、临时会话和不发起请求的本地模型配置：

```powershell
node scripts/install.mjs --root .cache/installed --home .cache/test-home --no-activate
node scripts/verify-engine.mjs .cache/installed/active.json
```

此检查从已安装官方包导出原生 SDK 以验证插件加载、Swarm/High 切换、权限保持、新会话默认值及会话恢复。它不会发送模型请求，因此不证明真实 Kimi 会积极派发子代理。完整交互式终端体验、真实子代理质量及其他 Kimi 版本仍需后续验证。

实现结构：`src/runtime.mjs` 处理档位映射和原生状态；`src/patch-bundle.mjs` 校验代码接口并接入；`src/compatibility.mjs` 跟随原版升级；`src/lifecycle.mjs` 管理启停；`scripts/install.mjs` 安装独立副本；`SYSTEM.md` 提供条件化委派策略。

代码与策略复用的来源和许可证见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
