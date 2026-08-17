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

## 交互与持久化

- **点击回顾**——点**身体**会在气泡里轮播：名字/陪伴天数，以及最近的
  会话事件（完成的回合、goal/plan 里程碑、带工具名和退出码的失败、
  输入时的问候）。其它部位不同：**尾巴**冒心并立刻巡游，**背鳍**立刻巡游，**鳍**吐泡。
- **右键菜单**——和鲸鲸聊天（LLM，见下文）、查看/删除记忆（「鲸鲸记得什么…」）、
  给鲸鲸命名、开关角落吸附、立即回到角落、隐藏。
  菜单支持键盘操作（Enter/Space），点击外部或 Esc 关闭。
- **角落吸附**——超过点击阈值的真实拖拽在松手后会滑向最近角落，可在菜单里开关。
- **`Ctrl`/`Cmd` + `Alt` + `W`**——随时显示/隐藏桌宠，隐藏后快捷键仍有效。
- **持久化**——名字、位置、隐藏状态和吸附偏好通过 `localStorage` 跨刷新保存
  （对隐私模式做了防护），回顾气泡还会记录你们已经相伴的天数。

## LLM 聊天与记忆

右键菜单的 **「和鲸鲸聊天…」** 会在桌宠旁弹出内联输入气泡（回车发送，Esc/点外部
关闭；输入上限 200 字，不展示聊天记录），鲸鲸在气泡里回复。host 支持 SSE
（`Accept: text/event-stream`）时气泡会随 token 增长，而不是每个增量弹一次。
气泡上方有**模型选择器**和**思考强度选择器**：
模型列表来自 DSH 的 LLM 服务（`GET /api/whale-pet/models`），选中的模型若支持
多档推理（如 deepseek-reasoner 的低/高），会显示思考强度下拉；选择会持久化到
`localStorage`（`dsh.whale-pet.chat-prefs.v1`），每次聊天自动带上。

架构：浏览器端的鲸鲸不直接请求上游 LLM——本包的 host 侧入口在 web server 上注册
`/api/whale-pet` 前缀，客户端只调用同源的 `POST /api/whale-pet/chat`，API Key 始终
留在服务端。

**后端自动选择**：当 DSH 的 `ctx.llm` 服务可用时，代理直接走它（复用 DSH 已配置的
provider、凭证、重试与推理档位）；否则回退到直连上游（OpenAI 兼容端点），此时
Key 按顺序解析：

1. 插件 `config.apiKey`（patch 条目 `config:` 字段）
2. 环境变量 `DSH_WHALE_API_KEY`（回退 `DEEPSEEK_API_KEY`）
3. dsh 的 credentials 服务（`DEEPSEEK_API_KEY`）——与 agent 共用同一把 Key，
   零额外配置即可用

其他配置（仅直连模式生效）：`DSH_WHALE_API_BASE`（默认 `https://api.deepseek.com`，
OpenAI 兼容上游地址）与 `DSH_WHALE_API_MODEL`（默认 `deepseek-chat`）。

记忆：鲸鲸在 `dsh.whale-pet.memory.v1` 这个 localStorage 键下保存关于你的长期事实和
有界近期对话（与桌宠其他状态同一套带防护的存储通道）。右键 **「鲸鲸记得什么…」**
可查看并删除事实；聊天框本身不展示历史。系统提示要求模型用
`[记住] 事实` 行回报值得记住的内容；协调器展示气泡前会剥掉这些标记并把事实写入记忆。
请求在途时鲸鲸保持 `thinking` 情绪（外部覆盖，会话观察器会尊重它）；代理不可达或未
配置（无 Key → HTTP 503）时表现为 error 情绪 + 冒汗。

### 会话进度（只读，询问时主动探寻）

鲸鲸能回答"进度如何了"：**当你询问时**，桌宠会主动探寻当前的进度，把一份精简的
**只读进度快照**附进桌宠自己的系统提示，让它如实回答长任务的进度。探寻分三层——
投影层的实时状态（当前运行的工具、回合时长、节点数、goal/plan 阶段）+ host 事件日志
的细粒度摘要（当前第几步、最新动态如"运行 bash：npm test"、最近结果摘要）+ **jobs
后台任务注册表的真实状态**（运行中任务的名称、已跑时长、输出尾部，如
"进度 45%"，见 `GET /api/whale-pet/progress?session=<id>`）。这份快照只读，
**绝不写入 DSH 会话**，不影响长对话的上下文。

agent 忙碌时**单击鲸鲸**会直接弹出趣味进度气泡（"正在鼓捣终端（bash），已经 3 分钟"、
"正在深度思考…"；有后台任务时优先显示"正在后台跑 npm run build（已 5 分钟）"），无需打字。

桌宠自身的上下文是**有界**的：最多 24 条记忆事实（每条 80 字符）+ 最近 8 轮对话
（每轮 240 字符）+ 进度块，最坏约 4.4KB（≈1.3k tokens）。对话超出 8 轮时，被挤出的
旧轮次不会直接丢弃，而是**压缩**进一条有上限的摘要（`summary`，400 字符）继续保留
"早前聊过什么"的粗粒度记忆。

### 任务派发（subagent）

当用户向桌宠请求需要**实际执行**的任务（写代码、跑命令、查资料、修 bug 等）时，桌宠
不会硬答，而是回复 `[TASK] <任务描述>` 标记。只有这个标记才会派活——只含执行动词、
没有标记的闲聊仍走直接回答。客户端识别后调用
`POST /api/whale-pet/task`，host 侧通过 `ctx.subagents` **派遣一个真正的子代理会话**
（与 agent 的 `subagent` 工具同一条机制：独立会话、独立工具调用、结果独立保存）。
子代理会话出现在 DSH 的 subagent 视图里，用户可以直接打开查看；完成后桌宠在气泡里
总结结果（超时则报告子代理会话 id）。parent 取当前活动的 agent（`currentInitiator`），
空闲时自动创建一个新 agent 作为 parent。

调试：`GET /api/whale-pet/health` 返回 `{ ok, configured }`。

## 会话联动

插件通过 `ctx.sessions` 观察当前 DSH 会话，并从会话快照以及 `goal`/`plan`
投影驱动桌宠情绪。桥接会在 sessions 服务可用前持续重试，并在绑定后吸收
历史窗口的延迟加载，避免旧错误误触发反应。

| 会话状态 | 桌宠反应 |
|---|---|
| 正在产生 token 或运行工具 | `working`/`thinking`：游动加快、看向输入区、周期性吐泡泡 |
| 单轮持续超过 20s | `focused`：轻微下潜/专注姿态 |
| 工具失败（非零退出码或错误节点） | `error`：连续冒汗 + 身体颤抖 + 红色"！"脉冲标记 + 瞪眼，持续 3 秒 |
| 长任务完成（≥15s）、goal 完成或退出 plan | `celebrating`：沿大椭圆 360° 绕圈，yaw 连续旋转并带近大远小深度，同时每 650ms 冒爱心 |
| 你在输入框聚焦/打字（准备回复） | `listening`：看向输入区、头顶漂浮 "？"，点击会回顾"在呢，我听着～" |
| 会话卡在等你（`pendingInteraction`：审批 / 提问 / 计划过目） | `awaiting`：同样看向输入区并冒 "？"；点击回顾「有个审批等你拍板」/「有个问题等你回答」/「有个计划等你过目」。压过 `working`，因为卡住时回合往往仍标成 running |
| 睡觉时悬停或拖拽 | 立即醒来并重置空闲计时 |
| 60s 无活动 | `sleeping`：闭眼、呼吸和游动变慢、显示 z-z-z |
| 当天第一次空闲/睡觉 | 主动说一句「今天也在～」/「又见面啦，第 N 天」；每天最多一次 |
| 绑定稳定窗口后出现 compaction 节点 | 说一句「记忆被压扁了一点，我还在～」；不跑定时 LLM |

桌宠元素上的调试属性：

- `data-whale-activity` — 当前情绪（`idle`、`thinking`、`working`、`focused`、`celebrating`、`error`、`sleeping`、`listening`、`awaiting`）
- `data-whale-bridge` — 会话桥接状态（`off`、`waiting`、`bound`）

## 安装

### 即插即用（推荐）

仓库自带预构建产物（`lib/`），下载后无需 pnpm workspace 和构建步骤。运行 `dsh` 的机器需要 Node.js 22 或更高版本。

1. 下载仓库（GitHub ZIP 或 `git clone`）。
2. 运行 profile 安装脚本：

   ```sh
   node install-profile.mjs web
   ```

   脚本会把包复制到 `$DSH_HOME/profiles/web/plugins/ui-whale-pet`，
   写入 profile 清单并创建 node_modules 链接，同时把
   `ui-whale-pet` Cordis 条目追加到 `$DSH_HOME/profiles/web/cordis.patch.yml`。

   如需安装到其他 profile，把 `web` 换成对应名称即可。
3. 配置聊天代理的 API Key（见「LLM 聊天与记忆」），否则聊天会提示未配置。
4. 重启 `dsh web`，并强制刷新浏览器。

### 从源码构建（独立仓库）

本仓库可独立构建（不需要 pnpm workspace 或 dsh checkout）：

```sh
npm install            # 开发工具链：typescript、esbuild、vitest、three 等
npm run build          # tsc 声明 + esbuild host/client 产物 → lib/
npm test               # vitest 套件（138 个用例）
node install-profile.mjs web
```

构建是自包含的：host 产物内联一切（只保留 type-only import），cordis loader 无需在插件
旁安装 node_modules；client 产物保持 DSH 的 `__ModuleLoader__.load` 浏览器格式，
仅 external `react`/`react/jsx-runtime`。

## 架构

- `src/client/activity.ts` — 纯情绪/特效词汇表和视图快照类型。
- `src/client/motion.ts` — 纯帧率无关的屏幕运动，包含庆祝绕圈路径和角落吸附。
- `src/client/persistence.ts` — 带防护的 `localStorage` 状态（名字、位置、隐藏、吸附偏好、首次见面日期）。
- `src/client/runtime/scheduler.ts` — 唯一的 `requestAnimationFrame` 时钟。
- `src/client/runtime/whale-pet-controller.ts` — 拥有 DOM 监听、调度器和逐帧渲染；组合 `src/client/whale` 中的 Three.js 场景。
- `src/client/runtime/whale-pet-service.ts` — 可观察运行时服务（`ctx.whalePet`），管理情绪、瞬时特效、回顾历史和持久化状态。
- `src/client/runtime/session-observer.ts` — 订阅当前会话快照（带低频轮询兜底）并映射为情绪/特效和用户输入状态。
- `src/client/whale/config.ts` — 共享几何/动画常量与 SVG 轮廓。
- `src/client/whale/geometry.ts` — 纯 SVG/轮廓工具与 BufferGeometry 构建器。
- `src/client/whale/materials.ts` — 材质工厂，包括蓝白身体遮罩 shader。
- `src/client/whale/animation.ts` — 逐帧姿态动画（游动、尾鳍、胸鳍、眼睛、漂浮、错误/睡眠反应）。
- `src/client/whale/scene.ts` — `createWhaleScene` 工厂，组合 config、geometry、materials 和 animation 为 `WhaleScene` 句柄。
- `src/client/WhalePet.tsx` — 通过 `useSyncExternalStore` 消费服务快照的薄视图；持有输入检测的 DOM 焦点监听、右键菜单和聊天气泡（模型/思考强度选择器）。
- `src/client/memory.ts` — 长期记忆库（事实 + 近期对话），带 `[记住]` 提取协议，经带防护的存储通道持久化。
- `src/client/llm.ts` — 同源聊天代理（`/api/whale-pet/chat`、`/api/whale-pet/models`）的浏览器传输层，可注入以便无头测试。
- `src/client/runtime/whale-pet-chat.ts` — 聊天协调器：思考覆盖、回复气泡、记忆持久化、错误反应、聊天偏好。
- `src/chat-proxy.ts` — 纯 host 代理逻辑：后端接口、直连上游转发、`/health`/`/models`/`/chat` HTTP handler。
- `src/llm-backend.ts` — dsh-llm 后端：带思考档位的模型目录、经 `ctx.llm` 的流式补全。
- `src/index.ts` — host 入口：在 `ctx.webServer` 上挂载 `/api/whale-pet` 前缀路由，选择后端（优先 dsh llm 服务，回退直连上游）。

## 模型来源与致谢

虎鲸模型和视觉设计的原始参考来自哔哩哔哩视频 [BV17Buf69EVV](https://www.bilibili.com/video/BV17Buf69EVV/)。感谢原作者公开模型演示与设计参考。

本插件仅将该模型移植并封装到 DeepSeek Harness 的交互和生命周期体系中。此处致谢不代表授予原模型或视频的额外权利；下游使用者仍需遵守原作者的相关条款。

## 生命周期

悬浮条目、DOM 监听器、动画帧、WebGL 渲染器、几何体、材质和纹理都随所属 Cordis Fiber 一同释放。host 侧聊天代理路由也随其 Fiber 释放；API Key 始终不进入浏览器。
