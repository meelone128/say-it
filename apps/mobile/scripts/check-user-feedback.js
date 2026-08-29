const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "app", "index.tsx"),
  "utf8",
);

const checks = [
  [source.includes('onPress={onNext}'), "教程必须保留下一页按钮"],
  [source.includes("guideSwipeResponder.panHandlers"), "教程卡片必须接入滑动手势"],
  [source.includes("onSwipeNext"), "教程必须支持左滑进入下一页"],
  [source.includes("onSwipeBack"), "教程必须支持右滑返回上一页"],
  [source.includes("SPEECH_RECORDING_OPTIONS"), "录音必须使用语音识别专用配置"],
  [source.includes("sampleRate: 16000"), "语音录音采样率应为 16 kHz"],
  [source.includes("numberOfChannels: 1"), "语音录音应使用单声道"],
  [source.includes("bitRate: 64000"), "语音录音码率应限制为 64 kbps"],
  [source.includes("warmUpApi();"), "应用必须提前唤醒后端"],
  [source.includes('fetch(`${API_BASE_URL}/health`)'), "预热必须调用健康接口"],
];

const failed = checks.filter(([passed]) => !passed);
if (failed.length) {
  for (const [, message] of failed) console.error(`FAIL: ${message}`);
  process.exit(1);
}

console.log("PASS: 第二位测试用户反馈已覆盖");
