# TTS 首轮验证报告

> 日期：2026-08-17  
> 模型：`cosyvoice-v3-flash`  
> 测试文本：`I'm really happy for you. All your hard work finally paid off.`

## 结果

| 音色 | 官方定位 | 请求并下载耗时 | 文件大小 | 结果 |
|---|---|---:|---:|---|
| `loongabby_v3` | 美式英文女声，30～35 岁 | 1.11 秒 | 198,284 bytes | 通过 |
| `longanyang` | 阳光青年男声，中英双语 | 1.59 秒 | 205,964 bytes | 通过 |
| `longanhuan` | 元气青年女声，中英双语 | 1.43 秒 | 204,044 bytes | 通过 |

音频保存在 `evaluation/results/tts-2026-08-17T06-56-53-372Z`。

## 最终决策

产品负责人已选择 1 号音色。MVP 默认使用 `loongabby_v3`，因为官方音色表明确标注为美式英语，最贴近产品的“自然美式日常口语”定位。

正式验证还需要：

1. 用至少 10 句不同长度、数字、人名、缩写和疑问句测试发音。
2. 检查语速是否适合中级学习者跟读。
3. 检查逐句播放与全文连续播放时的音量、停顿和音色一致性。
4. 记录实际字符成本并确认音频缓存策略。

官方说明 `cosyvoice-v3-flash` 支持英文、WAV 等格式，并按北京地域 1 元/万字符计费。[模型说明](https://help.aliyun.com/zh/model-studio/cosyvoice-v3-flash)、[CosyVoice 音色列表](https://help.aliyun.com/zh/model-studio/cosyvoice-voice-list)
