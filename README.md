# 英语口语练习助手

面向希望提升日常英语口语的用户：录制最长 60 秒中文，生成自然美式英语学习单元，并支持逐句播放、文章学习、检验与复习。

## 当前工程

```text
apps/
  mobile/        Expo + React Native 移动端
  api/           NestJS API
packages/
  contracts/     App 与 API 共享的 TypeScript 业务契约
docs/            PRD、UI 流程、架构和验证报告
evaluation/      AI 模型评测语料、脚本和契约
```

## 环境要求

- Node.js 22 或更高版本。
- npm 11 或兼容版本。
- Android/iOS 真机测试可使用 Expo Go。

## 安装与启动

```bash
npm install
npm run dev:api
npm run dev:mobile
```

API 健康检查：`GET http://localhost:3000/api/v1/health`

常用验证：

```bash
npm run typecheck
npm run test
npm run build:api
npm run lint --workspace @spoken-english/mobile
npm run lint --workspace @spoken-english/api
```

## AI 默认组合

- ASR：`fun-asr-flash-2026-06-15`，Qwen3-ASR 作为备用。
- 文本：`qwen3-max` 非思考模式。
- TTS：`cosyvoice-v3-flash`。
- 默认音色：`loongabby_v3` 美式女声。

API Key 只保存在本地 `.env.local`，禁止提交。可从 `.env.example` 查看所需变量。

## 当前开发状态

项目骨架和 AI 供应商验证已完成。下一模块是移动端录音首页，包括权限、60 秒限制、暂停/继续、句首保护和录音预览。

当前移动端固定使用 Expo SDK 54，与测试手机中的 Expo Go 实际支持版本保持一致。正式发布前仍需使用 development build 做原生能力和发布配置验证，并重新执行依赖安全审计。
