# AI 供应商组合调研（MVP）

> 调研日期：2026-08-17  
> 项目范围：最长 60 秒中文录音 → 中文转写 → 地道美式日常英语段落与拆句 → 逐句英文语音  
> 资料原则：仅引用供应商官方文档、官方价格页和中国政府官方网站。价格和模型可随时调整，上线前必须再次核对控制台。

## 结论先行

### 建议（不是供应商官方事实）

**MVP 首选：阿里云百炼单供应商组合**

- ASR：默认 `fun-asr-flash-2026-06-15`，`qwen3-asr-flash` 作为备用 adapter
- 文本转换与拆句：`qwen3-max` 非思考模式，JSON mode；`qwen3.7-plus` 作为低成本备选
- TTS：`cosyvoice-v3-flash` 的中英双语系统音色
- 部署范围：华北 2（北京）

选择原因：三段能力均有中国大陆部署和人民币公开价格；60 秒录音远低于限制；单一账号、网络链路和账单最适合个人/小团队快速验证。`cosyvoice-v3-flash` 有现成中英双语系统音色，而更新的 `cosyvoice-v3.5-flash` 官方说明不支持系统音色，MVP 反而需要先做声音设计或复刻，因此不作为第一选择。

**MVP 备选：火山引擎豆包语音 + DeepSeek 文本**

- ASR：豆包大模型录音文件极速版识别
- 文本转换与拆句：DeepSeek `deepseek-v4-flash`（非思考模式、JSON Output）
- TTS：豆包大模型语音合成的英语音色

选择原因：豆包语音公开文档覆盖中文录音识别、智能分句和英文 TTS；DeepSeek 文本 API 成本低且支持 JSON Output。代价是两个供应商、两套鉴权和数据条款，且火山引擎部分正式按量价格需登录控制台/商务确认。

**国际对照：OpenAI 全栈，不作为中国大陆主体的默认方案。** 中国大陆未列入 OpenAI API 官方支持地区；官方明确警告，从未列出的地区访问或提供访问可能导致账号被封禁或暂停。因此除非未来由位于官方支持地区、具备数据出境合规条件的合法主体部署，否则不进入大陆 MVP 主链路。

## 快速对比

| 组合 | 60 秒中文 ASR | 自然英语与拆句 | 逐句英文 TTS | 结构化输出 | 大陆可部署性 | MVP 判断 |
|---|---|---|---|---|---|---|
| 阿里云百炼全栈 | Qwen3-ASR / Fun-ASR | Qwen3-Max | CosyVoice v3 Flash | JSON mode；仍需服务端 Schema 校验 | 华北 2（北京）有模型与价格 | **首选** |
| 火山语音 + DeepSeek | 豆包录音文件极速版 | DeepSeek V4 Flash | 豆包大模型 TTS | DeepSeek JSON Output；仍需 Schema 校验 | 国内云服务链路可行 | **备选** |
| OpenAI 全栈 | GPT-4o mini Transcribe | GPT-4o mini 或更新文本模型 | TTS-1 | Structured Outputs 可严格匹配 JSON Schema | 中国大陆不在支持地区 | 仅国际对照 |

## 组合 A：阿里云百炼全栈

### 官方事实

#### 1. 中文 ASR

阿里云当前语音识别文档优先列出 Fun-ASR 和 Qwen-ASR。`qwen3-asr-flash` 支持 URL、Base64 或本地文件，单个音频最多 10 MB、5 分钟；`fun-asr-flash-2026-06-15` 支持 URL 或 Base64，最长 5 分钟。两者均足以处理本项目 60 秒录音。[阿里云语音识别模型文档](https://help.aliyun.com/zh/model-studio/asr-model/)

华北 2（北京）公开按量价格：`qwen3-asr-flash` 为 **0.00022 元/秒**，`fun-asr` 为 **0.00022 元/秒**，`paraformer-v2` 为 **0.00008 元/秒**；页面同时列明部分新开通账号的限期免费额度。[阿里云百炼模型价格](https://help.aliyun.com/zh/model-studio/model-pricing)

> 对 60 秒完整录音，仅 ASR 公示价约为 `60 × 0.00022 = 0.0132 元`。这是按公开单价计算，不含对象存储、流量和优惠。

#### 2. 自然英语生成与拆句

Qwen 文本模型支持 JSON mode：请求中使用 `response_format: {"type":"json_object"}`，并在消息中明确包含 JSON 要求，模型会返回可解析 JSON。[阿里云结构化输出文档](https://help.aliyun.com/en/model-studio/qwen-structured-output)

需要注意：该官方能力承诺的是**有效 JSON 字符串**，不是像 OpenAI `strict: true` 那样的 JSON Schema 严格遵循。因此后端仍须用 Zod/JSON Schema 校验 `sourceText`、`naturalEnglish` 和 `sentences[]`，失败后做一次修复重试。

华北 2（北京）`qwen3-max` 在单次输入不超过 32K Token 时，公开原价为输入 **2.5 元/百万 Token**、非思考输出 **10 元/百万 Token**，缓存命中输入为 **0.5 元/百万 Token**；价格和活动可能变化。[Qwen3-Max 模型说明](https://help.aliyun.com/zh/model-studio/model-qwen3-max)

本项目 30 条固定文本实测中，`qwen3-max` 对金额、人物关系、委婉语气和自然搭配的整体表现优于 `qwen-plus` 与 `qwen3.7-plus`，因此由最初的 `qwen-plus` 建议调整为 `qwen3-max`。这是项目测试结论，不是供应商承诺。

#### 3. 英文逐句 TTS

`cosyvoice-v3-flash` 支持系统音色、声音复刻和声音设计；系统音色支持英语（具体取决于音色），可输出 `pcm`、`wav`、`mp3`、`opus`。官方音色列表中有中英双语系统音色。[阿里云语音合成模型](https://help.aliyun.com/zh/model-studio/tts-model)、[阿里云音色列表](https://help.aliyun.com/zh/model-studio/multimodal-timbre-list)

华北 2（北京）`cosyvoice-v3-flash` 按输入文本字符计费，公开价为 **1 元/万字符**；`cosyvoice-v3.5-flash` 为 **0.8 元/万字符**，但 v3.5 官方说明不支持系统音色。[阿里云百炼模型价格](https://help.aliyun.com/zh/model-studio/model-pricing)、[CosyVoice v3.5 Flash 模型说明](https://help.aliyun.com/zh/model-studio/cosyvoice-v3-5-flash)

#### 4. 地域、账号与数据

- 需要开通阿里云百炼、创建 API Key，并保证 API endpoint、模型部署地域与数据资源地域匹配。
- 价格页明确区分华北 2（北京）和新加坡等部署范围；本项目建议统一使用北京地域，避免无意跨境。
- 阿里云百炼官方 FAQ 表述其不会使用客户数据进行模型训练，并称传输数据会加密；但公开 FAQ 未给出常规推理请求统一的具体保留天数。因此可以把“不用于训练”作为供应商公开口径，仍需在生产合同或工单中书面确认保留期、删除机制和适用服务范围。[阿里云百炼官方 FAQ](https://help.aliyun.com/en/model-studio/what-is-model-studio)

### 本项目建议

- 录音完成后使用**非实时** ASR；本产品不是实时对话，没必要为流式链路增加复杂度。
- ASR 同时试测 `qwen3-asr-flash` 与 `fun-asr-flash-2026-06-15`，按真实中文录音的语义错误、字错率和延迟选一个，不凭型号新旧决定。
- 文本阶段固定非思考模式和低随机度，一次输出完整英文段落及有序句子数组。
- TTS 按句调用并缓存；选择一个官方中英双语系统音色，在产品文案中说明为 AI 合成语音。

## 组合 B：火山引擎豆包语音 + DeepSeek 文本

### 官方事实

#### 1. 豆包 ASR

豆包“大模型录音文件极速版识别”一次请求返回结果，音频不超过 2 小时、100 MB，支持 WAV、MP3、OGG/OPUS；需在控制台开通 `volc.bigasr.auc_turbo` 资源权限。[火山引擎极速版识别 API](https://www.volcengine.com/docs/6561/1631584)

豆包录音文件识别支持中文和英文、自动标点、智能分句、数字规整等能力；标准产品文档给出的上限远高于本项目 60 秒。[豆包语音识别大模型说明](https://www.volcengine.com/docs/6561/1354871)

官方商品页公开显示“大模型录音文件识别”30 小时资源包刊例价 66 元（新人活动价另计），折合约 **2.2 元/小时**、60 秒约 **0.0367 元**。这不等同于极速版按量价，极速版和正式按量阶梯价格仍需以控制台订单页为准。[豆包语音产品页](https://www.volcengine.com/products/Audio-editing-and-sound-processing)

#### 2. DeepSeek 只承担文本转换

DeepSeek 当前 API 价格页列出的 `deepseek-v4-flash` / `deepseek-v4-pro` 是文本模型，支持 JSON Output、工具调用和 Responses API；官方页面没有 ASR 或 TTS endpoint。因此 DeepSeek **不能单独完成本项目音频链路**，只适合“中文转自然美式英语 + 拆句”。[DeepSeek 模型与价格](https://api-docs.deepseek.com/quick_start/pricing/)

DeepSeek 中国区官方价格页显示 `deepseek-v4-flash` 缓存未命中输入为 **1 元/百万 Token**、输出 **2 元/百万 Token**；`deepseek-v4-pro` 为输入 **3 元/百万 Token**、输出 **6 元/百万 Token**。不同部署范围和活动价格可能不同，应以调用当天账号所在区域页面为准。[DeepSeek 模型与价格（中国区）](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)

DeepSeek 的 JSON Output 保证应视为 JSON mode，而不是严格 JSON Schema；服务端仍须校验和重试。[DeepSeek JSON Output 官方指南](https://api-docs.deepseek.com/guides/json_mode)

#### 3. 豆包英文 TTS

豆包大模型语音合成支持中文、英文、日文和西班牙语，支持多种音色；输出可使用 PCM、OGG/OPUS、MP3，单向流式/非流式支持 24k/16k/8k 采样率，并支持语速调整。[豆包语音合成大模型说明](https://www.volcengine.com/docs/6561/1257543)

火山引擎官方商品页当前展示大模型语音合成 10 万字资源包刊例价 45 元（新人活动价另计），折合约 **4.5 元/万字**；若一个单元生成约 200 个英文字符，资源包口径约 **0.09 元**。具体音色授权、字符计数规则与正式按量价依控制台而变，仍标记为**开通测试账号后核价**。[豆包语音产品页](https://www.volcengine.com/products/Audio-editing-and-sound-processing)

#### 4. 地域、账号与数据

- 豆包语音需要火山引擎账号、控制台应用和对应资源权限；DeepSeek 需要独立 API 账号和余额。
- 两家供应商意味着中文转写文本会从火山引擎后端发送给 DeepSeek。虽然不需要把原始录音发送给 DeepSeek，但仍属于新增的委托处理链路。
- 生产前分别确认两家的企业服务协议、输入输出保留期、是否用于训练、删除机制与安全事件通知。尤其注意火山引擎官方《豆包模型数据授权使用协议》：若订购时另行勾选授权，协议允许为模型优化等目的传输、存储和使用客户数据。MVP 应避免勾选非必要授权，并通过企业合同确认实际条款。[火山引擎豆包模型数据授权使用协议](https://www.volcengine.com/docs/82379/1359327)

### 本项目建议

- 仅将 ASR 纯文本交给 DeepSeek，原始录音留在本方对象存储和火山语音链路中。
- 用统一内部接口包装两家供应商；任何一家失败都能独立重试，避免重复上传录音或重复生成全部句子音频。
- 在测试表中重点比较豆包英语音色的美式口音自然度；“支持英文”不等于一定符合“自然美式日常口语”。

## 组合 C：OpenAI 全栈（国际对照）

### 官方事实

- 文件转写推荐使用 Transcription API；上传文件最大 25 MB，支持 MP3、MP4、MPEG、MPGA、M4A、WAV、WebM。`gpt-4o-mini-transcribe` 官方估算为 **0.003 美元/分钟**。[OpenAI 文件转写](https://developers.openai.com/api/docs/guides/speech-to-text)、[OpenAI API 价格](https://developers.openai.com/api/docs/pricing)
- `gpt-4o-mini` 支持多语言文本和 Structured Outputs；官方价格为输入 **0.15 美元/百万 Token**、输出 **0.60 美元/百万 Token**。[GPT-4o mini 模型页](https://developers.openai.com/api/docs/models/gpt-4o-mini)
- Structured Outputs 使用 `json_schema` 与 `strict: true` 时，可保证匹配所提供的受支持 JSON Schema 子集。这是三套方案中最强的结构契约。[OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- `tts-1` 使用 Speech endpoint，公开价 **15 美元/百万字符**；TTS 支持英语并提供多种内置音色。OpenAI 要求向终端用户清楚披露其听到的是 AI 生成语音。[TTS-1 模型页](https://developers.openai.com/api/docs/models/tts-1)、[OpenAI TTS 指南](https://developers.openai.com/api/docs/guides/text-to-speech)
- OpenAI API 默认不使用业务客户/API 的输入输出训练模型（除非显式选择共享）；默认滥用监控日志通常最多保留 30 天。官方数据控制表列明 `/v1/audio/transcriptions` 无滥用监控保留和应用状态保留，`/v1/audio/speech` 默认有 30 天滥用监控保留。[OpenAI API 数据控制](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint)
- **地区硬限制：** OpenAI 支持国家/地区列表没有中国大陆；官方说明，从列表外地区访问或提供 API 访问可能导致账号被封禁或暂停。[OpenAI API 支持国家和地区](https://help.openai.com/en/articles/5347006-openai-api-supported-countries-and-territories/)

### 本项目建议

OpenAI 可用来定义“理想结构化输出”和做境外质量基准，但不应通过代理、借用账号等方式接入中国大陆 MVP。即使未来有合法的支持地区主体，境内用户录音/转写发送到境外也需要独立完成数据出境评估。

## 数据隐私与合规注意事项

### 官方监管事实

- 录音、转写文字、账号、学习记录可能包含个人信息。生成式 AI 服务提供者对用户输入和使用记录有保护义务，不得收集非必要个人信息，也不得非法留存或提供可识别用户身份的输入和记录。[生成式人工智能服务管理暂行办法](https://www.cac.gov.cn/2023-07/13/c_1690898327029107.htm)
- 向境外提供个人信息，需要满足《个人信息保护法》第三十八条规定的条件之一，并采取必要措施使境外接收方达到法定保护标准；向境外提供还属于应事前进行个人信息保护影响评估的情形。[中华人民共和国个人信息保护法](https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm)
- 《网络数据安全管理条例》要求告知处理目的、方式、种类、保存期限和用户权利路径，并规定数据出境条件。[网络数据安全管理条例](https://www.cac.gov.cn/2024-09/30/c_1729384452307680.htm)

### 本项目落地建议

1. 默认使用中国大陆地域的 ASR、LLM、TTS 和对象存储，第一版不跨境。
2. 只收集完成功能所必需的 60 秒录音；在录音前明确告知用途、供应商类别、保存时间与删除方式。
3. 原始录音设置短保留期，例如学习单元生成并确认后 24 小时自动删除；若产品确需长期保存，必须提供明确选择和一键删除。
4. 供应商日志中禁止记录完整录音 URL、原始转写、账号密码和 API Key；使用短期签名 URL。
5. 账号与学习数据和 AI 处理日志分离；供应商请求使用内部随机 ID，不传用户名、邮箱等无关标识。
6. 未成年人使用场景需要单独评估同意、监护与规则要求。
7. 上线前以实际签署合同为准，书面确认：数据地域、保留期、训练用途、分包商、删除 SLA、安全事件通知和数据导出/注销机制。

## 开工前的两天验证计划

1. 同时开通阿里云北京地域的 Qwen3-ASR、Fun-ASR、Qwen3-Max、CosyVoice v3 Flash。
2. 用既定 30 条录音分别比较 ASR 字错、口语词、停顿与标点；不要只测普通话朗读稿。
3. 对同一转写运行固定 Prompt，人工按“忠实、自然、美式、难度、拆句”五项盲评。
4. 试听至少 3 个英语系统音色，选择一个默认音色；记录生成延迟和实际字符费用。
5. 用 JSON Schema 在服务端做 100 次契约测试，统计一次成功率和重试率。
6. 若阿里云任一核心指标不达标，再开通“豆包语音 + DeepSeek”备选链路对照，而不是首日同时维护两套生产集成。

## 最终决策

**首版先接阿里云百炼全栈，但 Provider 接口必须保持可替换。** 这不是认定其模型效果必然最好，而是它在大陆部署、公开计价、三段能力和集成复杂度之间最适合 MVP。最终模型选择必须由本项目 30 条真实录音的盲测结果决定。

**备选保留“豆包语音 + DeepSeek 文本”。** 若阿里 ASR 或英语音色未过质量线，只替换对应 adapter，不改学习单元、句子和前端数据契约。

**OpenAI 只做国际质量对照，不进入大陆生产路径。**
