# AI evaluation workspace

本目录用于在 App 开发前验证核心 AI 链路。

## 内容

- `cases/zh-to-spoken-en.json`：30 条中文测试语料。
- `contracts/learning-unit-output.schema.json`：语言模型输出契约。
- `prompts/spoken-en-v1.md`：第一次调用使用的历史 Prompt。
- `prompts/spoken-en-v2.md`：历史 Prompt；完整段落改为由句子数组派生。
- `prompts/spoken-en-v3.md`：历史 Prompt；进一步要求每句语法完整并适合独立播放。
- `prompts/spoken-en-v4.md`：历史 Prompt；加强数字货币保护和母语搭配自检。
- `prompts/spoken-en-v5.md`：历史 Prompt；加入通用反翻译腔示例。
- `prompts/spoken-en-v7.md`：当前 Prompt；移除冗余中文回显，并增加易错搭配与逗号拼接检查。

## 首轮运行顺序

1. 使用 30 条中文文本测试 Qwen3-Max 非思考模式与 JSON Mode。
2. 对模型输出运行 JSON Schema 和业务规则校验。
   在最终校验前，合并被模型错误拆开的逗号片段和小写承接片段。
3. 人工评价忠实度、口语自然度、难度和拆句。
4. 从测试语料选择至少 10 条录制真人中文音频。
5. A/B 测试 Qwen3-ASR-Flash 与 Fun-ASR。
6. 为通过文本质量门槛的英文句子生成 CosyVoice 音频。
7. 汇总成功率、延迟和实际费用。

## 密钥规则

- 不要把 API Key 写进仓库、测试数据、日志或报告。
- 后续验证脚本只从本地环境变量读取密钥。
- `.env` 必须被 Git 忽略，仓库只允许提交 `.env.example`。
