# 大肥鱼设计对照

只对照设计。本文不搬三个仓库的代码。

阅读提交：

- SurfCore `Mieksido/surfcore` @ `0deb826`
- KiraAI `xxynet/KiraAI` @ `8901374`（README 指向 `KiraAI-Dev/KiraAI`）
- QQ DSH Bridge `NoMindSama/qq-dsh-bridge` @ `5f3f4ff`
- 文档站 `moeru-ai/airi-docs` @ `7b66644`
- 本仓库 @ `996bfd754`

三个仓库都没有实时视频通话，也没有把摄像头帧送进模型。语音都是「整段音频消息」或「文字合成后再发出」，不是双工通话。

## SurfCore

定位：给 DeepSeek Harness（DSH）一个身份。QQ、B站、桌宠共用一张人格和一张会衰减的记忆卡。它不是把模型接进 QQ 的通用框架。总纲在 `docs/guides/ARCHITECTURE.md`。

进程有三截。DSH 宿主里跑 `plugins/surfcore`。独立进程 `src/bridge.js` 连 SnowLuma 的 OneBot v11。仓库外的语音引擎听 `127.0.0.1:8765`（本地）和 `8767`（云端）。桌宠是另一个 Electron 仓库，用本地令牌 HTTP 进来。SnowLuma 由用户自己安装并扫码。桥接只探测，不代启、不代登。见 `README.md` 与 `docs/guides/ARCHITECTURE.md` 第 1 节。

模块按依赖从上往下：

| 层 | 位置 |
| --- | --- |
| 设置页和控制台 | `plugins/surfcore/lib/client.js`、`public/console.html` |
| 宿主装配 | `plugins/surfcore/lib/index.js` |
| QQ 桥接主程序 | `src/bridge.js`（约 1.5 万行，控制台路由写在同一条 if 链里） |
| 纯引擎 | `src/memory-card.js`、`src/purpose-engine.js`、`src/voice-core.js`、`src/voice-tts.js`、`src/voice-packs.js`、`src/session-map.js` |

目录地图：`docs/guides/FOLDER_MAP.md`。插件用相对路径直接 import `src/*.js`。这是耦合，不是可复用包边界。

消息和会话：

1. QQ 经 SnowLuma WebSocket 进桥接。
2. 白名单、模式、敏感词先丢弃。白名单为空等于谁都不响应。
3. 未读进 `social-v2`。唤醒看 @、名字、提问、关键词、拍一拍、概率。
4. 命中后组人格、记忆卡、未读窗，调用 DSH `session.prompt`。每个 QQ 会话一个 DSH 会话，外加独立 agent token。映射在 `state/sessions.json`。`src/session-map.js` 发现多个 key 指向同一 sessionId 时，删掉这些映射，避免群和私聊串上下文。
5. 二代模式 `reserved2` 里，模型文本不自动发到 QQ。发言必须调工具。
6. 出站走 MCP stdio，再打桥接 HTTP。令牌、白名单、额度、敏感词、长度都在这里再拦一次。回执用 `get_msg` 核对。

语音在 `docs/guides/SUBSYSTEM-VOICE.md`。模型调 `qq_send_voice`。`src/voice-tts.js` 对 voxd 发 `POST /v1/speak/file`，得到整段 wav。`src/bridge.js` 把它放进 OneBot `record` 段。SnowLuma 转 SILK。没有 VAD，没有流式 ASR，没有播放中打断。回合是社交策略：防抖合批、潜水前 `qq_wait_for_messages`、`src/conversation-closure.js` 记「下次怎么接」。延迟来自整段合成、转码和回读，不来自双工传输。桌宠语音是另一条 HTTP：`plugins/surfcore/lib/pet-chat.js` 合成 wav，再由 pet-api 播放。

视频：B站调度看的是站点上的视频和动态（`docs/guides/SUBSYSTEM-BILI.md`），不是摄像头帧。

## KiraAI

定位：一个进程里的多平台数字生命。LLM、TTS、STT、图像和视频生成都是 provider。QQ、Telegram、微信、Discord、B站都是 adapter。入口是 `main.py`。监督进程在 `core/supervisor.py`，子进程在 `core/child.py`。说明在 `README.md` 和 `AGENTS.md`。

模块：

| 目录 | 职责 |
| --- | --- |
| `core/adapter` | 平台连接和消息能力 |
| `core/workflow/src/im` | 入站流水线 |
| `core/chat` | 会话和消息链 |
| `core/agent` | 工具循环 |
| `core/provider` | 模型客户端 |
| `core/plugin` | 插件，含 `builtin_plugins/memory` |
| `core/persona` | 人格 |
| `webui` | Vue 3 管理台 |

一条消息的阶段在 `core/workflow/src/im/workflow.py`：

- 事件：`ReceiveStage` 归档并跑插件，`RouteStage` 决定丢弃、立刻触发、缓冲或刷出。
- 批次：`PrepareBatchStage` 压图并格式化，`BuildRequestStage`，`AssembleRequestStage`，`ExecuteAgentStage`，`FinalizeStage`。
- 阶段返回 false 就停。agent 一旦开始，收尾钩子和记忆保存仍要跑。并发上限默认 3。

会话键是 `adapter:type:id`。`core/chat/session.py` 的 `sid` 就是这三段。私聊和群聊因此不会共用一段历史。内容在数据库里，`core/chat/session_manager.py` 不在内存里留全量缓存。

QQ 适配器是 `core/adapter/src/qq/qq.py`。它持有一个 `NapCatWebSocketClient`（`core/adapter/src/qq/napcat_client/client.py`）。默认 `ws://localhost:3001`，请求头带 access token。事件分 group、private、notice。重连最多 20 次，退避上限 60 秒，两次重连至少隔 1 秒。永久失败只打日志并停收，不代登录。入站 OneBot 段在 `core/adapter/src/qq/im.py` 映射成 `Text`、`Image`、`Record`、`Video`、`File`、`Forward`、`Poke`。出站再组回 OneBot 段，经 `send_group_message` / `send_direct_message` 发出。白名单或黑名单在 `QQAdapter._configure_access`。另有官方 QQ 适配器 `core/adapter/src/qq_official/`，含 `qr_login.py`。扫码属于用户。

语音和视频都是消息元素，不是通话。`core/provider/provider.py` 的 `TTSModelClient.text_to_speech` 和 `STTModelClient.speech_to_text` 吃整段 `Record`。实现包括 OpenAI 兼容、阿里云、GPT-SoVITS。没有 WebRTC，没有 VAD，没有播放中打断。`capabilities.py` 里的 `send_voice` 仍是注释。视频生成是 `ModelType.VIDEO` 的 provider。QQ 里的 `video` 段只是一条文件消息。`PrepareBatchStage` 对图片做压缩，再按会话能力选择 VLM 描述。它不抽摄像头帧。

记忆插件 `core/plugin/builtin_plugins/memory/main.py` 用 SQLite，可选向量和 rerank。`scope.py` 把一条记忆标成 user、group 或 self，并绑到 persona、adapter 和来源消息。模型用工具写入。这和 SurfCore「一份衰减卡注入提示词」不同。

## qq-dsh-bridge

定位：把 DSH 桌面 agent 接进 QQ 的适配层。链路写在根 `README.md`：

`QQ → SnowLuma(OneBot v11) → qq-bridge → DSH Web API → agent loop → MCP → 回到 QQ`

`qq-bridge/` 与 SurfCore 同构：`src/bridge.js`、`src/dsh-client.js`、`src/snowluma-conn.js`、`src/voice-core.js`、`dsh/agent-presets/`。它不是第三套实时媒体栈。

和 SurfCore 相比，这里多三件设计：

1. 每会话策略。`qq-bridge/src/core/session-router.mjs` 是纯函数。给定会话 key，返回 mode、preset、model。默认是仿真档，没有本机工具。`closed-agent` 只能来自主人的私聊记录。未知模式直接抛错。
2. 上下文只在空闲边界压缩。对话中阈值很高，避免改写前缀、打掉 KV cache。安静超过 30 分钟才先写记忆，再调 DSH `/compact`。写不进记忆就不压。见根 `README.md`「上下文」一节。
3. 记忆四层加一层自我叙述。L0 原文 JSONL，L1 会话摘要，L2 带衰减的事实，L3 产物索引，L4 `selfNote`。`selfNote` 只在新会话第一次唤醒时读一次，不每轮注入。

入站仍是白名单、未读、唤醒、默认 2 秒合批。忙则进待唤醒队列。出站文本不自动发送，必须经工具，再过令牌、档位、限流和敏感词。

语音仍是 `qq_send_voice` 到整段音频再到 OneBot `record`。`qq-bridge/src/voice-core.js` 与 `src/send-voice-lib.js` 负责探测和发送。没有 VAD 和打断。`src/media-normalize.js` 处理收到的图片和文件，不建立视频通话。

`dsh-plugins/dsh-thinking-zh` 是 DSH 桌面浮球，用来切思考链语言。它不参与 QQ 协议。

凭据：用户自己启动 SnowLuma，自己把 token 和 QQ 号写进本地 `config.json`。仓库声明桥接不代启 SnowLuma。

## 对照 AIRI

AIRI 已经有这些边界。大肥鱼应接在边界上，不换运行时。

| 已有部分 | 位置 | 和参考项目的关系 |
| --- | --- | --- |
| WebSocket 频道 | `packages/server-runtime`，默认端口 6121，路径 `/ws`（`src/bin/run.ts`、`src/index.ts`） | 相当于 SurfCore 的桥接总线，但是类型化事件，不是 1.5 万行 if 链 |
| 频道客户端 | `packages/server-sdk` 的 `Client`，默认 `ws://localhost:6121/ws`（`src/client.ts`） | 外部模块用它宣布自己并收发事件 |
| 事件合同 | `packages/plugin-protocol/src/types/events.ts` | `input:text` 是聊天入口，消费组 `chat-ingestion` 只交给第一个消费者。`context:update` 是提示，策略只有 `replace-self` 和 `append-self` |
| 编排 | `packages/core-agent`，舞台在 `packages/stage-ui/src/stores/chat.ts` 调用 `createChatOrchestratorRuntime` | 一个角色一个主会话。场景回复和后台任务不说话 |
| 长期记忆 | `docs/ai/adr/2026-10-10-skills-automations-and-memory.md`，存储在 stage-ui | 索引加事实，按角色卡隔离。工具读写。这是权威写入者 |
| 记忆侧车雏形 | `packages/memory-pgvector` | 已经是 server-sdk 进程，目前只连上并听 `module:configure` |
| 语音 | `packages/core-agent/src/voice/`、`packages/pipelines-audio`、`packages/stage-ui/src/stores/modules/hearing.ts`、`stores/modules/speech.ts`、`stores/voice-call.ts` | 已有 Silero VAD、流式转写、播放、按名字打断。`core-agent` README 写明实时传输还没有做 |
| 平台机器人 | `integrations/telegram-bot`、`discord-bot`、`satori-bot`、`minecraft` | Satori 文档已写可通过 Koishi 接 QQ |

适合拿来的想法：

- Kira 的会话键 `adapter:type:id`，以及 SurfCore「一个外部会话绝不共享一个 agent 会话」。AIRI 场景绑定已经要求每个 binding 一个持久会话（上述 ADR 的 Scenes）。QQ 或别的入口必须沿用 binding，不能把群消息倒进主人主会话。
- Kira 的流水线阶段返回 false 即停，以及记忆范围绑到 persona 和来源消息。可做成记忆模块的写入规则，不替换 `core-agent`。
- qq-dsh-bridge 的 fail-closed：未知模式拒绝，特权模式只能显式授予。外部模块的工具面应默认最小。
- qq-dsh-bridge 的「空闲时再压缩，进行中不改写前缀」。AIRI 已有 `getContextWindow` 保留最近 90% 回合。不要在每个语音帧上重写历史。
- `selfNote` 只在新会话读一次。若大肥鱼要「它对自己的叙述」，用现有记忆条目，并规定注入频率。不要每轮塞进 system。
- SurfCore 的「发出去了必须有回执」。语音条或消息发出后，以频道事件为准，模型不能自称已发送。

不拿来的想法：

- 不搬 `src/bridge.js`，也不搬 DSH preset、MCP stdio 和 SnowLuma 补丁。那是另一套 agent。AIRI 的编排在 `core-agent`。
- 不把整段 TTS wav 再转 SILK 当作语音通话。那是 QQ 语音条。通话已经在 `VoiceController` 和 `useVoiceCallStore`。
- 不做 Kira 那种「整段 Record 再 STT」的通话。Hearing 已经是流式转写。
- 不在 AIRI 里启动、扫码或保存 QQ 登录态。三个参考仓库都把这一步留给用户。
- 不把 B站观看、桌宠目的机制、鱼群保护放进第一批。它们依赖 DSH 和 Windows 路径。
- 不学 Kira 在同一次提交里改中文和英文本地化。AIRI 只改英文源，Crowdin 管其他语言。见 `packages/i18n/AGENTS.md`。

## 语音通话和视频通话

方向：继续用 AIRI 模块。不改 `core-agent` 的调度和 `VoiceController` 的状态机。

语音通话已经是「用户点开始后的连续听写」。证据：`docs/ai/adr/2026-10-29-web-voice-composer-and-call.md`，`packages/stage-ui/src/stores/voice-call.ts`。打断把静音和「通知 agent」分成两步：`packages/core-agent/src/voice/interruption.ts`。VAD 在 Hearing 的 Silero worker。播放和分句在 `packages/pipelines-audio`。

视频没有现成通话。三个参考项目也没有可抄的帧管道。`core-agent` README 写明实时传输未实现，将来的会话适配器必须单独定义连续输入、打断和会话所有权。在那之前，画面只作为现有视觉附件，低频送入，不新建传输。

建议的小 PR，每个都能单独验证：

1. 语音通话回归。不改行为。为现有 `useVoiceCallStore` 补测试：开始、静音、挂断、Hearing 关闭时通话结束。通过即说明后面的模块没有另起一条通话栈。
2. 大肥鱼音色。只在现有 speech provider 上选择音色和语言。用户可见字符串进 `packages/i18n` 的英文源。不新起 8765 进程。
3. 打断策略插件。实现 `VoiceController` 已有的 trusted plugin 接口，在播放中检测到主人语音时对指定 turn 调用 `interrupt`。不改 `controller.ts` 的状态机。测试只断言插件发出的 interrupt 目标。
4. 画面帧模块。舞台侧按间隔抓一帧，走现有图像附件或 `airi-asset:` 引用。不走 WebRTC，不进 `server-runtime`。测试：一帧变成一条视觉输入，角色舞台仍在。UI 遵守 `DESIGN.md`：舞台留给角色，控件保持小块，不盖住角色。

第 4 个 PR 之后才考虑真正的双工视频传输。那个改动会碰到 `core-agent` 的会话所有权，必须单独评审，不能塞进上面四个 PR。

## QQ 桥接

现在不值得做进大肥鱼主路径。语音、记忆和人格都不依赖 QQ。

若以后要做，位置是 `integrations/`，与 `telegram-bot`、`discord-bot`、`satori-bot` 并列。优先复用 `integrations/satori-bot`。`airi-docs` 的 `content/zh-Hans/docs/integrations/satori.md` 已写明：Koishi 的 Satori 可以接 QQ，令牌放 `.env.local`，不提交。

只有 Satori 不够时，再新增 `integrations/qq-bot`：一个 server-sdk 客户端，把 OneBot 文本映射成 `input:text`，用 `overrides.binding` 分开会话，从 `output:gen-ai:chat:message` 读回复。NapCat 或 SnowLuma 由用户自己运行。URL 和 token 只在本地环境变量里。

不要把 QQ 协议放进 `packages/stage-ui` 或 `packages/core-agent`。

需要用户本人完成、本仓库永远不代做的事：

- SnowLuma 或 NapCat 的安装、启动和扫码登录
- OneBot access token、QQ 号、群号
- Kira 官方适配器那类 QR 登录
- Satori token、模型 API key
- TencentDB 的连接密钥

这些值看起来像私有数据。按根 `AGENTS.md` 的 Private Data，它们不进仓库、不进提交说明、不进 PR。

## 必须遵守的规则

以后的设计和 PR 以这些文件为准。

- 贡献流程：<https://github.com/moeru-ai/airi/blob/main/.github/CONTRIBUTING.md>。提交前 `pnpm lint` 和 `pnpm typecheck`。合并前 Unit Test 必须过。分支推到 fork，不推 `main`。
- 本仓库代理规则：`AGENTS.md`。共享逻辑放 `packages/`。文件名 kebab-case。不用 `any`。Valibot 放在使用处。IPC 用 `@moeru/eventa`。常规提交 `feat(<package>): ...`。分支名 `username/feat/short-name`。文档和对应代码同一个 PR。不改其他语言的翻译。
- 文档站总览和贡献：`airi-docs` `content/zh-Hans/docs/overview/index.md`、`content/zh-Hans/docs/contributing/index.md`。网页端在 `apps/stage-web`，命令 `pnpm dev`。桌面端见 `contributing/tamagotchi.md`。
- 设计：本仓库 `DESIGN.md` 是界面依据。舞台把空间留给角色。设置用共享布局。文档站 `content/zh-Hans/docs/contributing/design-guidelines/index.md` 仍标为施工中。`design-guidelines/resources.md` 只是外部参考，不是组件规范。
- 界面字符串：`packages/i18n/AGENTS.md`。先读 `packages/i18n/glossary/terms.yaml`。只改英文源。改键之后跑 `pnpm i18n:check`。不改 `.x18n/check-baseline.json`。
- 架构：`packages/plugin-sdk/docs/design/architecture.md`。插件、桥和 viewer 走 Eventa。高频流和控制面分开。`packages/server-shared/README.md` 规定 `context:update` 用来补充记忆和提示，不抢占当前回合。
- 包布局：`pnpm-workspace.yaml` 包含 `packages/**`、`integrations/**`、`services/**`。频道客户端在 `packages/server-sdk`。机器人在 `integrations/`。`services/computer-use-mcp` 是 MCP 工具服务，不是频道记忆模块。

## 对照 TencentDB 记忆方案

方案：`services/tencentdb-memory` 作为 server-sdk 模块，连 `ws://localhost:6121/ws`，用 `context:update` 写记忆，拆成 4 个 PR。本仓库里还没有这个目录。最近的先例是 `packages/memory-pgvector`。

对齐的部分：

- 地址就是 `Client` 的默认值（`packages/server-sdk/src/client.ts`）。端口和路径与 `server-runtime` 一致。
- `context:update` 的字段是 `lane`、`text`、`hints`、`strategy`（`replace-self` 或 `append-self`）、稳定的 `contextId`。这适合「本轮可读的短记忆」，也符合 `server-shared` 里「不抢占回合」的用法。
- 拆成可单独验证的 PR，符合小步提交。

冲突和改法：

1. 目录。`services/` 现在是 MCP 服务。记忆侧车的先例在 `packages/memory-pgvector`，而且它已经占用名字 `memory-pgvector` 并连接同一条频道。把第二份 Client 放进 `services/tencentdb-memory` 会和「共享逻辑放 packages」冲突，也会出现两个记忆模块。改法：进程放在 `packages/tencentdb-memory`，依赖现成的 `@proj-airi/server-sdk`，不改 `server-sdk` 本身。和 `memory-pgvector` 的关系写进 ADR：只保留一个写入者。另一个保持不连接。
2. 和本地记忆双写。ADR `2026-10-10` 规定长期记忆在本机 IndexedDB，按角色卡隔离，由记忆工具读写。若 TencentDB 再每轮 `context:update`，提示词里会有两套事实。改法：这个模块只作为该 ADR 的存储后端，或者只在设置里关闭本地记忆时注入。4 个 PR 里必须写明谁拥有提示词里的记忆段。
3. 不要订阅 `input:text`。该事件的消费组是 `chat-ingestion`，选择策略是 `first`。记忆模块若注册成消费者，会抢走舞台的聊天。改法：只听 `output:gen-ai:chat:complete` 一类完成事件，再发出 `context:update`。聊天正文仍走 `input:text`。
4. 载荷。协议注释要求 `context:update` 保持短，大块用引用，不要塞二进制（`events.ts` 里 spark 一节）。语音 PCM、视频帧、记忆全图都不走这条事件。改法：记忆模块只发短文本。语音继续走 Hearing 和 `input:text:voice`。画面走第 4 个语音/视频 PR 的图像附件。思维导图读取模块自己的查询接口，不从 WebSocket 事件流画图。
5. 密钥。TencentDB 密钥由用户提供，放本地环境变量。代码在没有密钥时用假适配器完成测试。不提交密钥，不在日志里打印连接串。
6. 四个 PR 的切分改成下面这样，才和「不改 core、每步可验证」一致：
   - PR1：包骨架。连上 `/ws` 并完成模块宣布。测试使用假服务器。不调用腾讯 API。
   - PR2：在一轮聊天完成后发送一条 `context:update`（`replace-self`、短文本、固定 `contextId`）。合同测试对照 `ContextUpdate`。不需要密钥。
   - PR3：存储适配器接口和假实现。只有环境变量里有密钥时才构造真客户端。
   - PR4：设置开关、英文 i18n、`docs/ai/adr` 一篇。思维导图单独开 PR，因为它要改设置页布局，并遵守 `DESIGN.md`。

语音方案和这个记忆方案不互相阻塞。通话不等待 `context:update`。记忆模块不持有麦克风，也不播放 TTS。
