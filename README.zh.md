# @deepseek-ai/dsh-client-ui-whale-pet

[English](README.md) | 中文

DeepSeek Harness 3D 虎鲸桌宠的持久浏览器插件。

插件在 `shell.overlay` 中注册一个可叠加的 `whale-pet` 条目，使用编入客户端包的 `three@0.147.0` 直接渲染程序化虎鲸；运行时不依赖 CDN、iframe、Host RPC 或工作区绝对路径。

## 行为

- 栖息在视口边缘，只在较长的随机间隔后进行短距离巡游。
- 悬停时看向指针，并在悬停或键盘激活时显示短暂爱心反馈。
- 使用多个贴合身体轮廓的命中区域拖拽，而不是把整个矩形画布作为目标。
- 模型采用连续 yaw：注视、拖拽、巡游和庆祝都朝向真实运动方向，不再左右瞬间翻面。
- 屏幕移动和 Three.js 渲染共用同一个 `requestAnimationFrame` 循环。
- 拖拽跟随采用无过冲的指数收敛，释放惯性与显示帧率无关。
- 动画相位逐帧积分，速度变化不会使身体、尾鳍或胸鳍发生相位跳变。

## 会话联动

插件通过 `ctx.sessions` 观察当前 DSH 会话，并从会话快照以及 `goal`/`plan`
投影驱动桌宠情绪。桥接会在 sessions 服务可用前持续重试，并在绑定后吸收
历史窗口的延迟加载，避免旧错误误触发反应。

| 会话状态 | 桌宠反应 |
|---|---|
| 正在产生 token 或运行工具 | `working`/`thinking`：游动加快、看向输入区、周期性吐泡泡 |
| 单轮持续超过 20s | `focused`：轻微下潜/专注姿态 |
| 工具失败（非零退出码或错误节点） | `error`：汗滴 + 瞪眼，持续 8 秒 |
| 长任务完成（≥15s）、goal 完成或退出 plan | `celebrating`：沿大椭圆 360° 绕圈，yaw 连续旋转并带近大远小深度，同时每 650ms 冒爱心 |
| 睡觉时悬停或拖拽 | 立即醒来并重置空闲计时 |
| 60s 无活动 | `sleeping`：闭眼、呼吸和游动变慢、显示 z-z-z |

桌宠元素上的调试属性：

- `data-whale-activity` — 当前情绪（`idle`、`thinking`、`working`、`focused`、`celebrating`、`error`、`sleeping`）
- `data-whale-bridge` — 会话桥接状态（`off`、`waiting`、`bound`）

## 安装

本插件目前通过源码安装。请准备 Node.js 22 或更高版本，然后把插件克隆到 DeepSeek Harness 源码目录：

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
git clone https://github.com/rongzi5/dsh-whale-pet.git packages/client/ui-whale-pet
```

在 `packages/bundle/web-app/package.json` 中加入 workspace 依赖：

```json
"@deepseek-ai/dsh-client-ui-whale-pet": "workspace:^"
```

在 `packages/bundle/web-app/cordis.patch.yml` 的浏览器插件区域加入正式 Cordis 条目：

```yaml
- id: ui-whale-pet
  name: '@deepseek-ai/dsh-client-ui-whale-pet'
```

在 `tsconfig.base.json` 的 `compilerOptions.paths` 中加入源码映射：

```json
"@deepseek-ai/dsh-client-ui-whale-pet": ["./packages/client/ui-whale-pet/src"]
```

在 `tsconfig.client.json` 的 `references` 中加入项目引用：

```json
{ "path": "./packages/client/ui-whale-pet" }
```

安装依赖、构建并启动 Web UI：

```sh
corepack pnpm install
corepack pnpm run build
corepack pnpm dsh web
```

进程启动后打开 `http://127.0.0.1:3080`。Host composition 只在进程启动时加载，因此新增或更新本插件后需要重启 `dsh web`；仅刷新浏览器不会加入新的 composition 条目。

## 架构

- `src/client/motion.ts` — 纯帧率无关的屏幕运动，包含庆祝绕圈路径。
- `src/client/runtime/scheduler.ts` — 唯一的 `requestAnimationFrame` 时钟。
- `src/client/runtime/whale-pet-controller.ts` — 拥有 Three.js 场景、DOM 监听和逐帧渲染。
- `src/client/runtime/whale-pet-service.ts` — 可观察运行时服务（`ctx.whalePet`），管理情绪和瞬时特效。
- `src/client/runtime/session-observer.ts` — 轮询当前会话并映射为情绪/特效。
- `src/client/WhalePet.tsx` — 通过 `useSyncExternalStore` 消费服务快照的薄视图。

## 模型来源与致谢

虎鲸模型和视觉设计的原始参考来自哔哩哔哩视频 [BV17Buf69EVV](https://www.bilibili.com/video/BV17Buf69EVV/)。感谢原作者公开模型演示与设计参考。

本插件仅将该模型移植并封装到 DeepSeek Harness 的交互和生命周期体系中。此处致谢不代表授予原模型或视频的额外权利；下游使用者仍需遵守原作者的相关条款。

## 生命周期

悬浮条目、DOM 监听器、动画帧、WebGL 渲染器、几何体、材质和纹理都随所属 Cordis Fiber 一同释放。本包不提供 Host 侧行为。
