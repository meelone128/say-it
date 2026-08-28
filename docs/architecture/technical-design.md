# Say It：MVP 技术设计

> 版本：0.1 草案  
> 日期：2026-08-17  
> 关联文档：`docs/product/mvp-prd.md`、`docs/product/ui-flow.md`

## 1. 设计目标

首版完成以下闭环：

```text
中文录音
→ 中文语音识别
→ 生成自然美式英语
→ 自动拆句
→ 生成逐句音频
→ 命名并保存学习单元
→ 文章学习
→ 左右滑动检验
→ 查看已掌握和未掌握句子
```

设计优先级：

1. 快速完成可用 MVP。
2. 保证 AI 输出稳定、可校验。
3. AI 供应商可以替换，但首版不拆微服务。
4. 录音、模型和音频处理失败后能够重试。
5. 用户数据可以从游客本地状态合并到账号。

## 2. 技术选型

| 位置 | 推荐技术 | 说明 |
|---|---|---|
| 移动端 | React Native + Expo + TypeScript | 同时支持 iOS 和 Android |
| 后端 | NestJS + TypeScript | 模块化单体，适合业务 Module 划分 |
| 数据库 | PostgreSQL + Prisma | 保存账号、学习单元和学习状态 |
| 异步任务 | Redis + BullMQ | 执行语音识别、英语生成和 TTS |
| 文件存储 | S3 兼容对象存储 | 保存中文录音和英语音频 |
| 本地存储 | 移动端安全存储 + SQLite | 游客数据、令牌和必要缓存 |
| 接口形式 | HTTPS JSON | App 与后端通信 |

首版采用模块化单体。只有 AI、对象存储和任务队列位于外部 seam，通过 Adapter 接入。

## 3. 系统结构

```text
Mobile App
  │
  ├─ 录音与本地状态
  ├─ 学习单元界面
  ├─ 文章学习与检验
  └─ 学习记录与账号
  │
  ▼
NestJS 模块化单体
  ├─ Accounts Module
  ├─ LearningUnit Module
  ├─ ProcessingPipeline Module
  ├─ LearningProgress Module
  ├─ Vocabulary Module
  └─ Media Module
  │
  ├─ PostgreSQL
  ├─ Redis / BullMQ
  ├─ Object Storage Adapter
  ├─ Speech Recognition Adapter
  ├─ Language Model Adapter
  └─ Text-to-Speech Adapter
```

## 4. 核心 Module 与 Interface

### 4.1 LearningUnit Module

负责一个学习单元从创建到删除的完整生命周期。

Interface 包含：

- 从已上传录音创建学习单元。
- 查询转换状态。
- 命名并保存学习单元。
- 查询学习单元列表和详情。
- 重新生成英语版本。
- 选择最终版本。
- 收藏、取消收藏、重命名和删除。

该 Module 隐藏数据库写入、版本选择、删除关联资源和权限校验。

### 4.2 ProcessingPipeline Module

输入录音引用，返回结构化学习内容。

Interface 只暴露：

- 启动处理。
- 查询阶段和进度。
- 重试失败阶段。
- 获取完成结果。

Implementation 内部完成格式检查、ASR、自然英语生成、拆句、TTS、重试和结果校验。App 不需要知道使用哪个模型。

### 4.3 LearningProgress Module

负责句子的掌握状态和未来出现日期。

Interface 包含：

- 将句子判断为已掌握。
- 将句子判断为未掌握。
- 查询已掌握列表。
- 查询未掌握列表。
- 查询今日到期句子。

左滑调用“已掌握”，右滑调用“未掌握”。同一请求重复提交不能重复改变状态。

### 4.4 Vocabulary Module

负责单词解释和语境收藏。

Interface 包含：

- 查询单词在当前句子中的解释。
- 收藏或取消收藏句中单词。
- 查询句子中已收藏单词。

收藏单词不会创建独立单词卡，而是把来源句子放入未掌握列表，并高亮收藏词。

### 4.5 Accounts Module

负责：

- 自定义用户名和密码注册、登录。
- 邮箱验证和找回密码。
- 令牌刷新和退出登录。
- 游客数据合并。
- 注销账号和删除数据。

### 4.6 Media Module

负责：

- 生成录音上传地址。
- 校验音频大小、格式和时长。
- 保存和访问逐句音频。
- 删除过期或用户删除的媒体文件。

## 5. 数据模型

### 5.1 User

| 字段 | 说明 |
|---|---|
| id | 用户唯一标识 |
| username | 自定义登录名，唯一 |
| password_hash | 密码哈希，不能保存明文 |
| email | 验证及找回密码邮箱 |
| email_verified_at | 邮箱验证时间 |
| created_at | 注册时间 |

### 5.2 LearningUnit

| 字段 | 说明 |
|---|---|
| id | 学习单元 ID |
| user_id | 所属用户；游客状态使用本地临时 ID |
| title | 用户自定义名称 |
| source_audio_key | 中文录音对象存储 key |
| source_transcript | 中文识别段落 |
| selected_generation_id | 用户最终选择的英语版本 |
| processing_status | 当前转换状态 |
| is_favorite | 是否五角星收藏 |
| saved_at | 保存时间 |
| created_at / updated_at | 创建和更新时间 |

### 5.3 GenerationVersion

| 字段 | 说明 |
|---|---|
| id | 生成版本 ID |
| learning_unit_id | 所属学习单元 |
| english_paragraph | 完整英语段落 |
| model_provider | 模型供应商 |
| model_name | 模型名称 |
| prompt_version | Prompt 版本 |
| is_selected | 是否为用户选择版本 |
| created_at | 生成时间 |

### 5.4 Sentence

| 字段 | 说明 |
|---|---|
| id | 句子 ID |
| generation_id | 所属英语版本 |
| sequence | 句子顺序，从 1 开始 |
| english_text | 英文句子 |
| chinese_meaning | 对应中文含义 |
| audio_key | 逐句音频 key |
| audio_duration_ms | 音频时长 |

`generation_id + sequence` 唯一，保证句子顺序稳定。

### 5.5 SentenceProgress

| 字段 | 说明 |
|---|---|
| id | 状态 ID |
| user_id | 所属用户 |
| sentence_id | 对应句子 |
| status | UNASSESSED / MASTERED / UNMASTERED |
| next_review_at | 下次进入检验时间 |
| last_judged_at | 最近判断时间 |
| updated_at | 更新时间 |

`user_id + sentence_id` 唯一，一个句子不能同时属于两个状态。

### 5.6 CollectedWord

| 字段 | 说明 |
|---|---|
| id | 收藏记录 ID |
| user_id | 所属用户 |
| sentence_id | 来源句子 |
| surface_form | 句中实际形式 |
| lemma | 单词原形 |
| start_offset / end_offset | 在句子中的字符位置 |
| created_at | 收藏时间 |

同一句中可以收藏多个词，但未掌握列表只展示一条句子。

### 5.7 WordExplanation

| 字段 | 说明 |
|---|---|
| id | 解释 ID |
| lemma | 单词原形 |
| context_hash | 语境摘要，用于缓存 |
| phonetic_us | 美式音标 |
| pronunciation_audio_key | 单词发音 |
| definition_zh | 当前语境中文含义 |
| common_meanings | 常用含义 |
| part_of_speech | 词性 |
| inflections | 常见词形变化 |
| grammar_notes | 语法和搭配 |
| examples | 例句及中文解释 |

### 5.8 ProgressEvent

保存左右滑动历史：

- user_id
- sentence_id
- result：MASTERED / UNMASTERED
- previous_status
- next_review_at
- client_event_id：客户端生成的幂等 ID
- created_at

## 6. AI 输出契约

语言模型不能只返回自由文本，必须返回可校验的结构化结果。

```text
sentences[]
  ├─ sequence
  ├─ english_text
  └─ chinese_meaning
metadata
  ├─ style = AMERICAN_DAILY_SPOKEN
  ├─ difficulty = EVERYDAY_INTERMEDIATE
  └─ prompt_version
```

`source_transcript` 不由语言模型回显。它直接使用 ASR 后经用户确认的文本写入 `LearningUnit`，避免模型复制时改写原文。完整英语段落由服务端按 `sequence` 拼接句子得到。

约束：

- `sentences` 顺序必须与自然表达的叙述顺序一致。
- 完整英语段落由后端按顺序拼接 `sentences[].english_text` 得到，不在模型输出中重复保存。
- 每个句子必须是可独立播放的自然语音片段。
- 不增加中文原文中没有的关键事实。
- 使用自然美式日常口语，避免考试和书面表达。
- 单句不宜过长；目标上限在真实测试后确定。
- 结构校验失败时自动重试，仍失败则进入人工可理解的错误状态。

## 7. AI 处理状态

```text
UPLOADED
→ TRANSCRIBING
→ GENERATING_ENGLISH
→ VALIDATING
→ GENERATING_AUDIO
→ READY_TO_NAME
→ SAVED
```

异常状态：

- FAILED_UPLOAD
- FAILED_TRANSCRIPTION
- FAILED_GENERATION
- FAILED_VALIDATION
- PARTIAL_AUDIO_FAILURE

音频部分失败时，已经完成的文本仍可展示，并允许只重试失败音频。

## 8. 主要 HTTP 接口

### 8.1 账号

- `POST /accounts/register`
- `POST /accounts/login`
- `POST /accounts/refresh`
- `POST /accounts/verify-email`
- `POST /accounts/forgot-password`
- `POST /accounts/merge-guest-data`
- `DELETE /accounts/me`

### 8.2 学习单元

- `POST /media/recording-upload`
- `POST /learning-units`
- `GET /learning-units`
- `GET /learning-units/:id`
- `GET /learning-units/:id/status`
- `POST /learning-units/:id/regenerate`
- `POST /learning-units/:id/select-generation`
- `PATCH /learning-units/:id`
- `DELETE /learning-units/:id`

`PATCH` 用于命名、重命名和五角星收藏状态。

### 8.3 学习状态

- `PUT /sentences/:id/progress`
- `GET /learning-records/mastered`
- `GET /learning-records/unmastered`
- `GET /learning-records/due`

判断请求包含 `client_event_id`，后端用它保证重试时不产生重复事件。

### 8.4 单词

- `GET /sentences/:sentenceId/words/:word/explanation`
- `PUT /sentences/:sentenceId/collected-words/:word`
- `DELETE /sentences/:sentenceId/collected-words/:word`

单词位置最好使用 token ID 或字符偏移，不只依靠单词字符串，避免同一句重复单词产生歧义。

## 9. 文件存储

对象 key 不保存用户原始文件名，建议结构：

```text
recordings/{user-or-guest-id}/{learning-unit-id}/source.m4a
sentences/{learning-unit-id}/{generation-id}/{sentence-id}.mp3
words/{voice-provider}/{lemma-hash}.mp3
```

访问方式：

- 上传使用短时有效的预签名地址。
- 私有录音不能公开访问。
- App 播放时使用短时下载地址或鉴权媒体接口。
- 删除学习单元时异步删除相关媒体。

## 10. 重新生成规则

- 重新生成使用已经确认的中文文本，不必重复执行 ASR。
- 新版本完成前保留当前可用版本。
- 新版本失败不能覆盖当前版本。
- 用户明确选择版本后才更新 `selected_generation_id`。
- 未选择的版本按保留策略自动清理。

## 11. 日期安排

首版只需要一个简单、可配置的日期策略：

- 首次判断未掌握：默认安排到次日。
- 再次判断未掌握：继续安排到较近日期。
- 判断已掌握：转入已掌握，不再主动安排。
- 已掌握句子被改回未掌握：重新安排到较近日期。
- 用户始终可以手动打开全部未掌握句子，不受日期限制。

具体天数放在后端配置中，不写死在 App。

## 12. 游客与账号数据

- 游客使用设备生成的 `guest_id` 保存本地数据。
- 游客可以完成录音、生成和本地学习。
- 注册或登录时，App 上传待合并的数据标识。
- 后端按学习单元 ID 和事件 ID 去重。
- 合并成功后，本地记录账号 ID 和同步版本。
- 同一游客数据只能首次绑定一个账号，避免重复复制。

## 13. 安全与隐私

- 密码使用成熟密码哈希算法，不能自行加密或保存明文。
- 登录使用短期访问令牌和可撤销刷新令牌。
- 所有学习单元查询必须验证所属用户。
- 限制录音最长 60 秒，并限制文件大小及格式。
- 模型调用日志不记录完整录音、令牌或不必要的用户原文。
- 用户删除学习单元或账号时，数据库和对象存储都需要进入删除流程。
- 对注册、登录、重新生成和词典生成进行频率限制。

## 14. 监控指标

- 各 AI 阶段成功率和耗时。
- 30 秒、60 秒录音的完整处理耗时。
- 单个学习单元的模型和音频成本。
- 结构化输出校验失败率。
- 逐句音频失败率。
- 重新生成次数。
- 左右滑动写入失败率。
- 游客数据合并失败率。

## 15. 开发阶段

### 阶段 1：AI 技术验证

- 准备 30 条真实中文录音。
- 验证 ASR、自然英语、拆句和 TTS。
- 确定供应商、平均耗时和成本。
- 固化 AI 输出契约和 Prompt v1。

### 阶段 2：第一条完整闭环

- 录音和上传。
- 异步处理进度。
- 中英文结果。
- 命名保存。
- 学习单元方形交错卡片。
- 文章学习和逐句播放。

### 阶段 3：学习功能

- 圆形“检”图标与检验模式。
- 左滑已掌握、右滑未掌握。
- 学习记录两张卡片。
- 日期安排。
- 单词解释和语境收藏。

### 阶段 4：账号与发布准备

- 自定义账号和邮箱验证。
- 游客数据合并与同步。
- 隐私、删除和频率限制。
- iOS、Android 真机测试。

## 16. 开工前剩余决策

1. 注册是否强制验证邮箱。建议强制，否则无法可靠找回密码。
2. 非最终英语生成版本保留多久。建议 24 小时后自动删除。
3. 首次和再次未掌握的日期间隔。建议先用次日再次出现，之后根据试用反馈调整。
4. AI 模型已确定：ASR 默认 `fun-asr-flash-2026-06-15`（Qwen3-ASR 备用），文本 `qwen3-max`，TTS `cosyvoice-v3-flash` + `loongabby_v3`。
