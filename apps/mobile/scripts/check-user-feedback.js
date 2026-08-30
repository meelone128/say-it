const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "app", "index.tsx"),
  "utf8",
);
const guideStart = source.indexOf("function UserGuideModal");
const guideEnd = source.indexOf("function RecordPage", guideStart);
const guideSource = source.slice(guideStart, guideEnd);

const checks = [
  [guideSource.includes('onPress={onNext}'), "教程必须保留下一页按钮"],
  [
    source.includes('const GUIDE_STORAGE_KEY = "say-it-guide-completed-v3"'),
    "新版教程必须使用新的完成标记，确保升级用户会重新看到教程",
  ],
  [
    guideSource.includes("horizontal") && guideSource.includes("pagingEnabled"),
    "教程必须使用系统原生横向分页",
  ],
  [guideSource.includes("onMomentumScrollEnd"), "滑动结束后必须同步教程页码"],
  [!guideSource.includes("guideSwipeResponder"), "教程必须移除不可靠的手写滑动响应器"],
  [!guideSource.includes("guideSwipeHint"), "教程视觉应恢复上一版，不显示新增滑动提示"],
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
