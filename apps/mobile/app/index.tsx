import Ionicons from "@expo/vector-icons/Ionicons";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import Reanimated, { LinearTransition } from "react-native-reanimated";
import Storage from "expo-sqlite/kv-store";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useAuth } from "../src/auth/auth-provider";
import {
  deleteLearningUnit,
  listLearningUnits,
  saveLearningUnit,
  type SavedLearningUnit,
  type SavedSentence,
} from "../src/data/learning-units";

const COLORS = {
  ink: "#181719",
  muted: "#77747E",
  canvas: "#FBFAFF",
  coral: "#8C72E8",
  coralSoft: "#E8E1FF",
  blue: "#8FB7F5",
  blueSoft: "#DDEBFF",
  green: "#5BAF83",
  greenSoft: "#DCF3E7",
  red: "#E16D75",
  redSoft: "#FFE3E5",
  yellow: "#FFC45E",
  line: "#E9E6F0",
};

const UNIT_CARD_LAYOUT = LinearTransition.springify()
  .damping(22)
  .stiffness(150)
  .mass(0.75);

const PAGE_ICONS: (keyof typeof Ionicons.glyphMap)[] = [
  "mic",
  "grid",
  "book",
  "person",
];
const MAX_RECORDING_MILLIS = 60_000;
const GUIDE_STORAGE_KEY = "say-it-guide-completed-v2";
const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL || "http://192.168.31.31:3000/api/v1";

type RecordingPhase =
  | "idle"
  | "recording"
  | "paused"
  | "recorded"
  | "transcribing"
  | "confirming"
  | "generating"
  | "synthesizing"
  | "preview";

interface GeneratedSentence {
  sequence: number;
  englishText: string;
  chineseMeaning: string;
}

interface GeneratedResult {
  sourceTranscript: string;
  englishParagraph: string;
  sentences: GeneratedSentence[];
}

interface GeneratedAudio {
  sequence: number;
  audioUrl: string;
}

interface DictionaryEntry {
  word: string;
  phonetic: string;
  partOfSpeech: string;
  meaning: string;
  spokenNote: string;
  example: string;
  exampleChinese: string;
}

const GUIDE_STEPS: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  backgroundColor: string;
  eyebrow: string;
  title: string;
  description: string;
}[] = [
  {
    icon: "chatbubbles",
    color: COLORS.coral,
    backgroundColor: COLORS.coralSoft,
    eyebrow: "使用场景",
    title: "想说，却不知道怎么说？",
    description: "聊天、旅行、课堂或工作中，只要遇到一句想用英语表达的话，就把中文说给 Say It。它会帮你变成自然、日常的美式口语。",
  },
  {
    icon: "bulb",
    color: "#B98519",
    backgroundColor: "#F7E8B8",
    eyebrow: "核心方法",
    title: "学习你真正想说的话",
    description: "不背脱离生活的固定课文。用自己的经历生成句子，再通过听、跟读和检验反复练习，慢慢建立属于你的口语表达库。",
  },
  {
    icon: "mic",
    color: COLORS.red,
    backgroundColor: COLORS.redSoft,
    eyebrow: "操作 1 / 4",
    title: "说一段中文",
    description: "点击红色录音按钮，说出你真正想表达的话。每次最长 60 秒，也可以暂停和继续。",
  },
  {
    icon: "sparkles",
    color: COLORS.coral,
    backgroundColor: COLORS.coralSoft,
    eyebrow: "操作 2 / 4",
    title: "生成自然英语",
    description: "确认中文内容后，Say It 会生成日常美式口语。点击右上角“下一步”，生成发音并保存学习单元。",
  },
  {
    icon: "headset",
    color: COLORS.green,
    backgroundColor: COLORS.greenSoft,
    eyebrow: "操作 3 / 4",
    title: "听一句，跟读一句",
    description: "进入学习单元后，点击句子播放发音，点击单词查看解释。点击“检”进入检验模式。",
  },
  {
    icon: "swap-horizontal",
    color: "#B98519",
    backgroundColor: "#F7E8B8",
    eyebrow: "操作 4 / 4",
    title: "记录掌握状态",
    description: "检验时左滑表示已掌握，右滑表示未掌握。底部四个图标既可以点击，也可以左右滑动切换页面。",
  },
];

export default function HomeScreen() {
  const auth = useAuth();
  const { width } = useWindowDimensions();
  const pagerRef = useRef<ScrollView>(null);
  const pageScrollX = useRef(new Animated.Value(0)).current;
  const [page, setPage] = useState(0);
  const [units, setUnits] = useState<SavedLearningUnit[]>([]);
  const [isGuideVisible, setIsGuideVisible] = useState(false);
  const [guideStep, setGuideStep] = useState(0);

  useEffect(() => {
    let isActive = true;
    void Storage.getItem(GUIDE_STORAGE_KEY)
      .then((completed) => {
        if (isActive && !completed) setIsGuideVisible(true);
      })
      .catch(() => {
        if (isActive) setIsGuideVisible(true);
      });
    return () => {
      isActive = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      void listLearningUnits()
        .then(setUnits)
        .catch(() =>
          Alert.alert("学习单元没有加载成功", "请重新打开应用后再试"),
        );
    }, []),
  );

  const handleUnitSaved = (unit: SavedLearningUnit) => {
    setUnits((current) => [unit, ...current]);
    setPage(1);
    pagerRef.current?.scrollTo({ x: width, animated: true });
  };

  const handleUnitDeleted = async (id: string) => {
    try {
      if (auth.user) {
        const { deleteLearningUnitFromCloud } = await import(
          "../src/data/cloud-sync"
        );
        await deleteLearningUnitFromCloud(auth.user.id, id);
      }
      await deleteLearningUnit(id);
      setUnits((current) => current.filter((unit) => unit.id !== id));
    } catch {
      Alert.alert(
        "删除没有完成",
        auth.user ? "请检查网络后重试，确保云端内容也能安全删除。" : "请稍后再试",
      );
    }
  };

  const handlePageChange = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPage(Math.round(event.nativeEvent.contentOffset.x / width));
  };

  const selectPage = (index: number) => {
    setPage(index);
    pagerRef.current?.scrollTo({ x: width * index, animated: true });
  };

  const openGuide = () => {
    setGuideStep(0);
    setIsGuideVisible(true);
  };

  const finishGuide = () => {
    setIsGuideVisible(false);
    setGuideStep(0);
    void Storage.setItem(GUIDE_STORAGE_KEY, "completed").catch(() => undefined);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <Animated.ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handlePageChange}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: pageScrollX } } }],
          { useNativeDriver: true },
        )}
        scrollEventThrottle={16}
        style={styles.pager}
      >
        <Page width={width} index={0} scrollX={pageScrollX}>
          <RecordPage onUnitSaved={handleUnitSaved} />
        </Page>
        <Page width={width} index={1} scrollX={pageScrollX}>
          <UnitsPage units={units} onDelete={handleUnitDeleted} />
        </Page>
        <Page width={width} index={2} scrollX={pageScrollX}>
          <ProgressPage units={units} />
        </Page>
        <Page width={width} index={3} scrollX={pageScrollX}>
          <AccountPage onOpenGuide={openGuide} />
        </Page>
      </Animated.ScrollView>

      <BottomNavigation
        page={page}
        scrollX={pageScrollX}
        pageWidth={width}
        onSelect={selectPage}
      />
      <UserGuideModal
        step={guideStep}
        visible={isGuideVisible}
        onBack={() => setGuideStep((current) => Math.max(0, current - 1))}
        onClose={finishGuide}
        onNext={() =>
          guideStep === GUIDE_STEPS.length - 1
            ? finishGuide()
            : setGuideStep((current) => current + 1)
        }
      />
    </SafeAreaView>
  );
}

function UserGuideModal({
  visible,
  step,
  onBack,
  onClose,
  onNext,
}: {
  visible: boolean;
  step: number;
  onBack: () => void;
  onClose: () => void;
  onNext: () => void;
}) {
  const content = GUIDE_STEPS[step];
  const isLast = step === GUIDE_STEPS.length - 1;

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <View style={styles.guideBackdrop}>
        <View style={styles.guideCard}>
          <View style={styles.guideTopRow}>
            <View style={styles.guideBrandPill}>
              <Text style={styles.guideBrandText}>SAY IT GUIDE</Text>
            </View>
            <Pressable
              accessibilityLabel="关闭使用教程"
              onPress={onClose}
              style={({ pressed }) => [
                styles.guideCloseButton,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="close" size={22} color={COLORS.ink} />
            </Pressable>
          </View>

          <View
            style={[
              styles.guideIcon,
              { backgroundColor: content.backgroundColor },
            ]}
          >
            <Ionicons name={content.icon} size={42} color={content.color} />
          </View>

          <Text style={styles.guideEyebrow}>{content.eyebrow}</Text>
          <Text style={styles.guideTitle}>{content.title}</Text>
          <Text style={styles.guideDescription}>{content.description}</Text>

          <View style={styles.guideDots}>
            {GUIDE_STEPS.map((item, index) => (
              <View
                key={item.title}
                style={[
                  styles.guideDot,
                  index === step && styles.guideDotActive,
                ]}
              />
            ))}
          </View>

          <View style={styles.guideActions}>
            <Pressable
              onPress={step > 0 ? onBack : onClose}
              style={({ pressed }) => [
                styles.guideBackButton,
                pressed && styles.pressed,
              ]}
            >
              {step > 0 ? (
                <Ionicons name="arrow-back" size={18} color={COLORS.ink} />
              ) : null}
              <Text style={styles.guideBackText}>
                {step > 0 ? "上一步" : "暂时跳过"}
              </Text>
            </Pressable>
            <Pressable
              onPress={onNext}
              style={({ pressed }) => [
                styles.guideNextButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.guideNextText}>
                {isLast ? "开始使用" : "下一步"}
              </Text>
              <Ionicons
                name={isLast ? "checkmark" : "arrow-forward"}
                size={18}
                color="#FFFFFF"
              />
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function BottomNavigation({
  page,
  scrollX,
  pageWidth,
  onSelect,
}: {
  page: number;
  scrollX: Animated.Value;
  pageWidth: number;
  onSelect: (index: number) => void;
}) {
  const translateX = scrollX.interpolate({
    inputRange: [0, pageWidth, pageWidth * 2, pageWidth * 3],
    outputRange: [0, 54, 108, 162],
    extrapolate: "clamp",
  });
  return (
    <View style={styles.pageIndicator}>
      <View style={styles.indicatorTrack}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.indicatorActiveBubble,
            { transform: [{ translateX }] },
          ]}
        />
        {PAGE_ICONS.map((icon, index) => (
          <Pressable
            accessibilityLabel={["录音", "学习单元", "学习记录", "账号设置"][index]}
            accessibilityRole="button"
            key={icon}
            onPress={() => onSelect(index)}
            style={({ pressed }) => [
              styles.indicatorItem,
              pressed && styles.indicatorItemPressed,
            ]}
          >
            <Ionicons
              name={icon}
              size={20}
              color={page === index ? COLORS.ink : "#BBB7C3"}
            />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Page({
  width,
  index,
  scrollX,
  children,
}: {
  width: number;
  index: number;
  scrollX: Animated.Value;
  children: React.ReactNode;
}) {
  const center = width * index;
  const transitionStyle = {
    opacity: scrollX.interpolate({
      inputRange: [center - width, center, center + width],
      outputRange: [0.82, 1, 0.82],
      extrapolate: "clamp",
    }),
    transform: [
      {
        scale: scrollX.interpolate({
          inputRange: [center - width, center, center + width],
          outputRange: [0.985, 1, 0.985],
          extrapolate: "clamp",
        }),
      },
    ],
  };

  return (
    <Animated.View style={[styles.page, { width }, transitionStyle]}>
      {children}
    </Animated.View>
  );
}

function RecordPage({
  onUnitSaved,
}: {
  onUnitSaved: (unit: SavedLearningUnit) => void;
}) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const player = useAudioPlayer(null, { updateInterval: 200 });
  const playerStatus = useAudioPlayerStatus(player);
  const stoppingRef = useRef(false);
  const [phase, setPhase] = useState<RecordingPhase>("idle");
  const [durationMillis, setDurationMillis] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [recordingUri, setRecordingUri] = useState<string>();
  const [transcript, setTranscript] = useState("");
  const [generatedResult, setGeneratedResult] = useState<GeneratedResult>();
  const [generatedAudios, setGeneratedAudios] = useState<GeneratedAudio[]>([]);
  const [isNamingVisible, setIsNamingVisible] = useState(false);
  const [unitTitle, setUnitTitle] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const stopRecording = useCallback(async () => {
    if (stoppingRef.current || (phase !== "recording" && phase !== "paused")) {
      return;
    }

    stoppingRef.current = true;
    setIsBusy(true);
    try {
      const finalDuration = recorderState.durationMillis;
      await recorder.stop();
      const uri = recorder.uri;

      if (!uri) {
        throw new Error("录音文件没有成功生成");
      }

      player.replace(uri);
      setRecordingUri(uri);
      setDurationMillis(finalDuration);
      setPhase("recorded");
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });
    } catch (error) {
      Alert.alert(
        "录音没有保存成功",
        error instanceof Error ? error.message : "请重新录制",
      );
      setPhase("idle");
    } finally {
      stoppingRef.current = false;
      setIsBusy(false);
    }
  }, [phase, player, recorder, recorderState.durationMillis]);

  useEffect(() => {
    if (
      recorderState.durationMillis >= MAX_RECORDING_MILLIS &&
      phase === "recording"
    ) {
      void stopRecording();
    }
  }, [phase, recorderState.durationMillis, stopRecording]);

  const startRecording = async () => {
    if (isBusy) return;

    setIsBusy(true);
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("需要麦克风权限", "请允许使用麦克风，才能录制中文。");
        return;
      }

      player.pause();
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setDurationMillis(0);
      setRecordingUri(undefined);
      setTranscript("");
      setGeneratedResult(undefined);
      setGeneratedAudios([]);
      setPhase("recording");
    } catch (error) {
      Alert.alert(
        "无法开始录音",
        error instanceof Error ? error.message : "请稍后再试",
      );
    } finally {
      setIsBusy(false);
    }
  };

  const pauseRecording = () => {
    recorder.pause();
    setPhase("paused");
  };

  const resumeRecording = () => {
    recorder.record();
    setPhase("recording");
  };

  const togglePlayback = async () => {
    if (playerStatus.playing) {
      player.pause();
      return;
    }

    if (
      playerStatus.didJustFinish ||
      playerStatus.currentTime >= playerStatus.duration - 0.1
    ) {
      await player.seekTo(0);
    }
    player.play();
  };

  const deleteRecording = async () => {
    player.pause();
    await player.seekTo(0);
    setDurationMillis(0);
    setRecordingUri(undefined);
    setTranscript("");
    setGeneratedResult(undefined);
    setGeneratedAudios([]);
    setPhase("idle");
  };

  const transcribeRecording = async () => {
    if (!recordingUri || isBusy) return;

    player.pause();
    setIsBusy(true);
    setPhase("transcribing");
    try {
      const form = new FormData();
      form.append("audio", {
        uri: recordingUri,
        name: `recording-${Date.now()}.m4a`,
        type: "audio/mp4",
      } as unknown as Blob);

      const response = await fetch(`${API_BASE_URL}/transcriptions`, {
        method: "POST",
        body: form,
      });
      const result = (await response.json().catch(() => ({}))) as {
        transcript?: string;
        message?: string | string[];
      };

      if (!response.ok || !result.transcript) {
        const message = Array.isArray(result.message)
          ? result.message.join("，")
          : result.message;
        throw new Error(message || "没有识别出中文，请重新录制");
      }

      setTranscript(result.transcript);
      setPhase("confirming");
    } catch (error) {
      setPhase("recorded");
      Alert.alert(
        "中文识别没有完成",
        error instanceof Error
          ? error.message
          : "请确认手机与电脑在同一 Wi-Fi 后重试",
      );
    } finally {
      setIsBusy(false);
    }
  };

  const generateEnglish = async () => {
    const confirmedTranscript = transcript.trim();
    if (!confirmedTranscript || isBusy) return;

    setIsBusy(true);
    setPhase("generating");
    setGeneratedAudios([]);
    try {
      const response = await fetch(`${API_BASE_URL}/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceTranscript: confirmedTranscript }),
      });
      const result = (await response
        .json()
        .catch(() => ({}))) as GeneratedResult & {
        message?: string | string[];
      };

      if (
        !response.ok ||
        !Array.isArray(result.sentences) ||
        !result.sentences.length
      ) {
        const message = Array.isArray(result.message)
          ? result.message.join("，")
          : result.message;
        throw new Error(message || "没有生成英语内容，请重试");
      }

      setGeneratedResult(result);
      setPhase("preview");
    } catch (error) {
      setPhase("confirming");
      Alert.alert(
        "英语生成没有完成",
        error instanceof Error ? error.message : "请稍后重试",
      );
    } finally {
      setIsBusy(false);
    }
  };

  const synthesizeSpeech = async () => {
    if (!generatedResult || isBusy) return;

    setIsBusy(true);
    setPhase("synthesizing");
    try {
      const response = await fetch(`${API_BASE_URL}/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sentences: generatedResult.sentences.map(
            (sentence) => sentence.englishText,
          ),
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        audios?: GeneratedAudio[];
        message?: string | string[];
      };

      if (!response.ok || !Array.isArray(result.audios)) {
        const message = Array.isArray(result.message)
          ? result.message.join("，")
          : result.message;
        throw new Error(message || "没有生成英语发音，请重试");
      }

      setGeneratedAudios(result.audios);
      setPhase("preview");
    } catch (error) {
      setPhase("preview");
      Alert.alert(
        "英语发音没有完成",
        error instanceof Error ? error.message : "请稍后重试",
      );
    } finally {
      setIsBusy(false);
    }
  };

  const openNaming = () => {
    setUnitTitle("");
    setIsNamingVisible(true);
  };

  const saveCurrentUnit = async () => {
    const title = unitTitle.trim();
    if (!title || !generatedResult || !generatedAudios.length || isSaving)
      return;

    setIsSaving(true);
    try {
      const saved = await saveLearningUnit({
        title,
        sourceTranscript: generatedResult.sourceTranscript,
        englishParagraph: generatedResult.englishParagraph,
        sentences: generatedResult.sentences,
        audios: generatedAudios,
      });
      setIsNamingVisible(false);
      await deleteRecording();
      onUnitSaved(saved);
    } catch (error) {
      Alert.alert(
        "学习单元没有保存成功",
        error instanceof Error ? error.message : "请稍后再试",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const visibleDuration =
    phase === "recorded" ? durationMillis : recorderState.durationMillis;

  return (
    <View style={styles.recordPage}>
      <View style={styles.brandPill}>
        <Text style={styles.brandText}>SAY IT</Text>
      </View>

      <View
        style={[
          styles.recordCenter,
          phase === "preview" && styles.previewRecordCenter,
        ]}
      >
        {phase === "idle" ? (
          <>
            <Text style={styles.heroTitle}>把想说的话，</Text>
            <Text style={styles.heroTitleAccent}>变成自然英语。</Text>
            <Text style={styles.heroSubtitle}>录一段中文，最长 60 秒</Text>

            <Pressable
              accessibilityLabel="开始录制中文"
              accessibilityRole="button"
              disabled={isBusy}
              onPress={startRecording}
              style={({ pressed }) => [
                styles.recordButtonOuter,
                (pressed || isBusy) && styles.pressed,
              ]}
            >
              <View style={styles.recordButtonInner}>
                <Ionicons name="mic" size={46} color="#FFFFFF" />
              </View>
            </Pressable>
            <Text style={styles.recordHint}>
              {isBusy ? "正在准备麦克风…" : "点击开始录音"}
            </Text>
          </>
        ) : null}

        {phase === "recording" || phase === "paused" ? (
          <RecordingControls
            durationMillis={visibleDuration}
            isPaused={phase === "paused"}
            isBusy={isBusy}
            onPause={pauseRecording}
            onResume={resumeRecording}
            onStop={stopRecording}
          />
        ) : null}

        {phase === "recorded" ? (
          <RecordedControls
            durationMillis={visibleDuration}
            isPlaying={playerStatus.playing}
            playbackMillis={playerStatus.currentTime * 1000}
            onDelete={deleteRecording}
            onPlay={togglePlayback}
            onUse={transcribeRecording}
          />
        ) : null}

        {phase === "transcribing" ? <TranscribingControls /> : null}

        {phase === "confirming" ? (
          <TranscriptConfirmation
            transcript={transcript}
            onChangeTranscript={setTranscript}
            onRetry={deleteRecording}
            onConfirm={generateEnglish}
          />
        ) : null}

        {phase === "generating" ? <GeneratingEnglish /> : null}

        {phase === "synthesizing" ? <SynthesizingSpeech /> : null}

        {phase === "preview" && generatedResult ? (
          <EnglishPreview
            result={generatedResult}
            audios={generatedAudios}
            onBack={() => setPhase("confirming")}
            onRegenerate={generateEnglish}
            onSave={openNaming}
            onSynthesize={synthesizeSpeech}
          />
        ) : null}
      </View>


      <NamingModal
        isSaving={isSaving}
        title={unitTitle}
        visible={isNamingVisible}
        onCancel={() => setIsNamingVisible(false)}
        onChangeTitle={setUnitTitle}
        onSave={saveCurrentUnit}
      />
    </View>
  );
}

function RecordingControls({
  durationMillis,
  isPaused,
  isBusy,
  onPause,
  onResume,
  onStop,
}: {
  durationMillis: number;
  isPaused: boolean;
  isBusy: boolean;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}) {
  return (
    <View style={styles.activeRecording}>
      <View style={[styles.liveBadge, isPaused && styles.pausedBadge]}>
        <View style={[styles.liveDot, isPaused && styles.pausedDot]} />
        <Text style={styles.liveText}>{isPaused ? "已暂停" : "正在录音"}</Text>
      </View>
      <Text style={styles.timer}>{formatMillis(durationMillis)}</Text>
      <Text style={styles.timerLimit}>最长 01:00</Text>

      <View style={styles.waveform}>
        {[18, 34, 54, 28, 68, 44, 24, 58, 38, 20].map((height, index) => (
          <View
            key={`${height}-${index}`}
            style={[
              styles.waveBar,
              { height: isPaused ? 12 : height },
              isPaused && styles.waveBarPaused,
            ]}
          />
        ))}
      </View>

      <View style={styles.recordActions}>
        <Pressable
          accessibilityLabel={isPaused ? "继续录音" : "暂停录音"}
          onPress={isPaused ? onResume : onPause}
          style={({ pressed }) => [
            styles.secondaryRoundButton,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons
            name={isPaused ? "mic" : "pause"}
            size={28}
            color={COLORS.ink}
          />
        </Pressable>
        <Pressable
          accessibilityLabel="结束录音"
          disabled={isBusy}
          onPress={onStop}
          style={({ pressed }) => [
            styles.stopButton,
            (pressed || isBusy) && styles.pressed,
          ]}
        >
          <View style={styles.stopSquare} />
        </Pressable>
      </View>
      <Text style={styles.recordActionHint}>
        {isBusy ? "正在保存…" : "方形按钮结束录音"}
      </Text>
    </View>
  );
}

function RecordedControls({
  durationMillis,
  playbackMillis,
  isPlaying,
  onDelete,
  onPlay,
  onUse,
}: {
  durationMillis: number;
  playbackMillis: number;
  isPlaying: boolean;
  onDelete: () => void;
  onPlay: () => void;
  onUse: () => void;
}) {
  return (
    <View style={styles.recordedPanel}>
      <View style={styles.completeIcon}>
        <Ionicons name="checkmark" size={30} color="#FFFFFF" />
      </View>
      <Text style={styles.recordedTitle}>录音完成</Text>
      <Text style={styles.recordedDuration}>
        {formatMillis(durationMillis)}
      </Text>

      <Pressable
        accessibilityLabel={isPlaying ? "暂停试听" : "试听录音"}
        onPress={onPlay}
        style={({ pressed }) => [styles.playButton, pressed && styles.pressed]}
      >
        <Ionicons
          name={isPlaying ? "pause" : "play"}
          size={30}
          color="#FFFFFF"
        />
        <Text style={styles.playButtonText}>
          {isPlaying
            ? `试听中 ${formatMillis(playbackMillis)}`
            : "试听这段录音"}
        </Text>
      </Pressable>

      <View style={styles.finishedActions}>
        <Pressable
          onPress={onDelete}
          style={({ pressed }) => [
            styles.deleteButton,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="trash-outline" size={21} color={COLORS.red} />
          <Text style={styles.deleteButtonText}>删除重录</Text>
        </Pressable>
        <Pressable
          onPress={onUse}
          style={({ pressed }) => [
            styles.continueButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.continueButtonText}>使用这段录音</Text>
          <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  );
}

function TranscribingControls() {
  return (
    <View style={styles.transcribingPanel}>
      <View style={styles.transcribingIcon}>
        <ActivityIndicator size="large" color={COLORS.coral} />
      </View>
      <Text style={styles.transcribingTitle}>正在听懂你的中文</Text>
      <Text style={styles.transcribingSubtitle}>
        通常只需要几秒，请不要退出页面
      </Text>
    </View>
  );
}

function GeneratingEnglish() {
  return (
    <View style={styles.transcribingPanel}>
      <View style={styles.generatingIcon}>
        <ActivityIndicator size="large" color={COLORS.ink} />
      </View>
      <Text style={styles.transcribingTitle}>正在变成自然英语</Text>
      <Text style={styles.transcribingSubtitle}>
        会自动拆成适合跟读的完整句子
      </Text>
    </View>
  );
}

function SynthesizingSpeech() {
  return (
    <View style={styles.transcribingPanel}>
      <View style={styles.speakingIcon}>
        <ActivityIndicator size="large" color={COLORS.coral} />
      </View>
      <Text style={styles.transcribingTitle}>正在生成美式发音</Text>
      <Text style={styles.transcribingSubtitle}>
        每句话都会有独立的播放按钮
      </Text>
    </View>
  );
}

function TranscriptConfirmation({
  transcript,
  onChangeTranscript,
  onRetry,
  onConfirm,
}: {
  transcript: string;
  onChangeTranscript: (value: string) => void;
  onRetry: () => void;
  onConfirm: () => void;
}) {
  const canConfirm = transcript.trim().length > 0;

  return (
    <View style={styles.transcriptPanel}>
      <View style={styles.transcriptHeader}>
        <View style={styles.completeIconSmall}>
          <Ionicons name="checkmark" size={22} color="#FFFFFF" />
        </View>
        <View>
          <Text style={styles.transcriptTitle}>确认中文内容</Text>
          <Text style={styles.transcriptHint}>如果有听错，可以直接修改</Text>
        </View>
      </View>

      <TextInput
        accessibilityLabel="识别出的中文内容"
        multiline
        onChangeText={onChangeTranscript}
        selectionColor={COLORS.coral}
        style={styles.transcriptInput}
        textAlignVertical="top"
        value={transcript}
      />

      <View style={styles.finishedActions}>
        <Pressable
          onPress={onRetry}
          style={({ pressed }) => [
            styles.deleteButton,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="mic-outline" size={21} color={COLORS.red} />
          <Text style={styles.deleteButtonText}>重新录音</Text>
        </Pressable>
        <Pressable
          disabled={!canConfirm}
          onPress={onConfirm}
          style={({ pressed }) => [
            styles.continueButton,
            (!canConfirm || pressed) && styles.pressed,
          ]}
        >
          <Text style={styles.continueButtonText}>确认中文</Text>
          <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  );
}

function EnglishPreview({
  result,
  audios,
  onBack,
  onRegenerate,
  onSave,
  onSynthesize,
}: {
  result: GeneratedResult;
  audios: GeneratedAudio[];
  onBack: () => void;
  onRegenerate: () => void;
  onSave: () => void;
  onSynthesize: () => void;
}) {
  const player = useAudioPlayer(null, { updateInterval: 200 });
  const playerStatus = useAudioPlayerStatus(player);
  const [playingSequence, setPlayingSequence] = useState<number>();
  const [isPlayingAll, setIsPlayingAll] = useState(false);
  const audioBySequence = useMemo(
    () => new Map(audios.map((audio) => [audio.sequence, audio.audioUrl])),
    [audios],
  );

  const playSequence = useCallback(
    (sequence: number, playAll = false) => {
      const audioUrl = audioBySequence.get(sequence);
      if (!audioUrl) return;

      if (playingSequence === sequence && playerStatus.playing) {
        player.pause();
        setIsPlayingAll(false);
        return;
      }

      if (playingSequence === sequence) {
        player.play();
      } else {
        player.replace(audioUrl);
        player.play();
        setPlayingSequence(sequence);
      }
      setIsPlayingAll(playAll);
    },
    [audioBySequence, player, playerStatus.playing, playingSequence],
  );

  useEffect(() => {
    if (!playerStatus.didJustFinish) return;

    if (isPlayingAll && playingSequence && playingSequence < audios.length) {
      playSequence(playingSequence + 1, true);
      return;
    }

    setIsPlayingAll(false);
    setPlayingSequence(undefined);
  }, [
    audios.length,
    isPlayingAll,
    playSequence,
    playerStatus.didJustFinish,
    playingSequence,
  ]);

  const togglePlayAll = () => {
    if (isPlayingAll && playerStatus.playing) {
      player.pause();
      setIsPlayingAll(false);
      return;
    }
    playSequence(1, true);
  };

  return (
    <View style={styles.previewPanel}>
      <View style={styles.previewHeader}>
        <Pressable
          accessibilityLabel="返回修改中文"
          onPress={onBack}
          style={({ pressed }) => [
            styles.previewBack,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="arrow-back" size={22} color={COLORS.ink} />
        </Pressable>
        <Text style={styles.previewTitle}>自然英语已生成</Text>
        <Pressable
          accessibilityLabel={audios.length ? "保存学习单元" : "下一步，生成英语发音"}
          onPress={audios.length ? onSave : onSynthesize}
          style={({ pressed }) => [
            styles.previewNextButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.previewNextText}>下一步</Text>
          <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
        </Pressable>
      </View>

      <View style={styles.previewMetaRow}>
        <Text style={styles.previewSubtitle}>
          {audios.length
            ? `${result.sentences.length} 句 · 发音已生成`
            : `${result.sentences.length} 个跟读句子`}
        </Text>
        {audios.length ? (
          <Pressable
            accessibilityLabel="全部播放"
            onPress={togglePlayAll}
            style={({ pressed }) => [
              styles.playAllButton,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons
              name={isPlayingAll && playerStatus.playing ? "pause" : "play"}
              size={16}
              color="#FFFFFF"
            />
            <Text style={styles.playAllText}>
              {isPlayingAll && playerStatus.playing ? "暂停" : "播放全部"}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.sentenceList}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        style={styles.sentenceScroller}
      >
        {result.sentences.map((sentence) => (
          <View key={sentence.sequence} style={styles.sentenceCard}>
            <View style={styles.sentenceNumber}>
              <Text style={styles.sentenceNumberText}>{sentence.sequence}</Text>
            </View>
            {audioBySequence.has(sentence.sequence) ? (
              <Pressable
                accessibilityLabel={`播放第 ${sentence.sequence} 句`}
                onPress={() => playSequence(sentence.sequence)}
                style={({ pressed }) => [
                  styles.sentencePlayButton,
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons
                  name={
                    playingSequence === sentence.sequence &&
                    playerStatus.playing
                      ? "pause"
                      : "volume-medium"
                  }
                  size={20}
                  color={COLORS.coral}
                />
              </Pressable>
            ) : null}
            <Text style={styles.englishSentence}>{sentence.englishText}</Text>
            <Text style={styles.chineseSentence}>
              {sentence.chineseMeaning}
            </Text>
          </View>
        ))}
      </ScrollView>

    </View>
  );
}

function NamingModal({
  visible,
  title,
  isSaving,
  onChangeTitle,
  onCancel,
  onSave,
}: {
  visible: boolean;
  title: string;
  isSaving: boolean;
  onChangeTitle: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const canSave = title.trim().length > 0 && !isSaving;

  return (
    <Modal
      animationType="fade"
      onRequestClose={onCancel}
      transparent
      visible={visible}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.modalBackdrop}
      >
        <View style={styles.namingCard}>
          <View style={styles.namingIcon}>
            <Ionicons name="bookmark" size={24} color={COLORS.coral} />
          </View>
          <Text style={styles.namingTitle}>给学习单元起个名字</Text>
          <Text style={styles.namingSubtitle}>
            以后可以在“学习单元”页面找到它
          </Text>
          <TextInput
            autoFocus
            maxLength={30}
            onChangeText={onChangeTitle}
            placeholder="例如：咖啡店点餐"
            placeholderTextColor={COLORS.muted}
            selectionColor={COLORS.coral}
            style={styles.namingInput}
            value={title}
          />
          <View style={styles.namingActions}>
            <Pressable
              disabled={isSaving}
              onPress={onCancel}
              style={({ pressed }) => [
                styles.namingCancel,
                (pressed || isSaving) && styles.pressed,
              ]}
            >
              <Text style={styles.namingCancelText}>取消</Text>
            </Pressable>
            <Pressable
              disabled={!canSave}
              onPress={onSave}
              style={({ pressed }) => [
                styles.namingSave,
                (!canSave || pressed) && styles.pressed,
              ]}
            >
              {isSaving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Text style={styles.namingSaveText}>保存</Text>
                  <Ionicons name="checkmark" size={20} color="#FFFFFF" />
                </>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function formatMillis(milliseconds: number) {
  const totalSeconds = Math.max(
    0,
    Math.min(60, Math.floor(milliseconds / 1000)),
  );
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function UnitsPage({
  units,
  onDelete,
}: {
  units: SavedLearningUnit[];
  onDelete: (id: string) => void;
}) {
  const router = useRouter();
  const [isGridLayout, setIsGridLayout] = useState(false);
  const cardColors = [
    "#FFBF67",
    "#B7D4FA",
    "#C9B9FF",
    "#F2AED6",
  ];

  const toggleUnitLayout = () => {
    setIsGridLayout((current) => !current);
  };
  const cardIcons: (keyof typeof Ionicons.glyphMap)[] = [
    "chatbubbles",
    "cafe",
    "briefcase",
    "airplane",
  ];
  const confirmDelete = (unit: SavedLearningUnit) => {
    Alert.alert(
      `删除“${unit.title}”吗？`,
      "这会删除本学习单元、句子记录和本机音频，删除后无法恢复。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "删除",
          style: "destructive",
          onPress: () => onDelete(unit.id),
        },
      ],
    );
  };

  return (
    <ScrollView
      contentContainerStyle={styles.scrollPage}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>MY LESSONS</Text>
        <View style={styles.unitsHeadingRow}>
          <Text style={styles.pageTitle}>学习单元</Text>
          <Pressable
            accessibilityLabel={isGridLayout ? "切换为错开排列" : "切换为双列排列"}
            onPress={toggleUnitLayout}
            style={({ pressed }) => [
              styles.layoutToggleButton,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons
              name={isGridLayout ? "git-compare-outline" : "grid-outline"}
              size={21}
              color={COLORS.ink}
            />
          </Pressable>
        </View>
        <Text style={styles.pageSubtitle}>
          每一段录音，都是你的专属口语材料。
        </Text>
      </View>

      <View style={[styles.unitList, isGridLayout && styles.unitGridList]}>
        {units.length === 0 ? (
          <View style={styles.emptyUnits}>
            <View style={styles.emptyUnitsIcon}>
              <Ionicons name="mic-outline" size={30} color={COLORS.coral} />
            </View>
            <Text style={styles.emptyUnitsTitle}>还没有学习单元</Text>
            <Text style={styles.emptyUnitsSubtitle}>
              回到录音页面，创建你的第一段口语材料
            </Text>
          </View>
        ) : null}

        {units.map((unit, index) => (
          <Reanimated.View
            key={unit.id}
            layout={UNIT_CARD_LAYOUT}
            style={[
              styles.unitCard,
              !isGridLayout &&
                (index % 2 === 0
                  ? styles.unitCardLeft
                  : styles.unitCardRight),
              isGridLayout && styles.unitCardGrid,
              { backgroundColor: cardColors[index % cardColors.length] },
            ]}
          >
            <Pressable
              onPress={() =>
                router.push({
                  pathname: "/unit/[id]/article",
                  params: { id: unit.id },
                })
              }
              style={({ pressed }) => [
                styles.unitCardInner,
                pressed && styles.pressed,
              ]}
            >
            <View style={styles.cardIconBubble}>
              <Ionicons
                name={cardIcons[index % cardIcons.length]}
                size={23}
                color={COLORS.ink}
              />
            </View>
            <Pressable
              hitSlop={8}
              onPress={() => confirmDelete(unit)}
              style={styles.cardDeleteButton}
            >
              <Ionicons name="trash-outline" size={19} color={COLORS.ink} />
            </Pressable>
            <Text numberOfLines={2} style={styles.unitName}>
              {unit.title}
            </Text>
            <Text style={styles.unitTime}>{formatSavedAt(unit.savedAt)}</Text>
            </Pressable>
          </Reanimated.View>
        ))}
      </View>
    </ScrollView>
  );
}

function useSentencePlayer(sentences: SavedSentence[]) {
  const player = useAudioPlayer(null, { updateInterval: 200 });
  const status = useAudioPlayerStatus(player);
  const [playingSequence, setPlayingSequence] = useState<number>();
  const [isPlayingAll, setIsPlayingAll] = useState(false);
  const audioBySequence = useMemo(
    () =>
      new Map(
        sentences.map((sentence) => [sentence.sequence, sentence.audioUri]),
      ),
    [sentences],
  );

  const playSequence = useCallback(
    (sequence: number, playAll = false) => {
      const audioUri = audioBySequence.get(sequence);
      if (!audioUri) return;
      if (playingSequence === sequence && status.playing) {
        player.pause();
        setIsPlayingAll(false);
        return;
      }
      if (playingSequence === sequence) {
        player.play();
      } else {
        player.replace(audioUri);
        player.play();
        setPlayingSequence(sequence);
      }
      setIsPlayingAll(playAll);
    },
    [audioBySequence, player, playingSequence, status.playing],
  );

  useEffect(() => {
    if (!status.didJustFinish) return;
    const currentIndex = sentences.findIndex(
      (sentence) => sentence.sequence === playingSequence,
    );
    if (
      isPlayingAll &&
      currentIndex >= 0 &&
      currentIndex < sentences.length - 1
    ) {
      playSequence(sentences[currentIndex + 1].sequence, true);
      return;
    }
    setIsPlayingAll(false);
    setPlayingSequence(undefined);
  }, [
    isPlayingAll,
    playSequence,
    playingSequence,
    sentences,
    status.didJustFinish,
  ]);

  const toggleAll = () => {
    if (isPlayingAll && status.playing) {
      player.pause();
      setIsPlayingAll(false);
      return;
    }
    if (sentences[0]) playSequence(sentences[0].sequence, true);
  };

  return { isPlayingAll, playingSequence, status, playSequence, toggleAll };
}

export function ArticleLearningView({
  unit,
  onBack,
  onInspect,
  onToggleFavorite,
}: {
  unit: SavedLearningUnit;
  onBack: () => void;
  onInspect: () => void;
  onToggleFavorite: () => void;
}) {
  const playback = useSentencePlayer(unit.sentences);
  const [dictionaryTarget, setDictionaryTarget] = useState<{
    word: string;
    sentence: string;
  } | null>(null);

  return (
    <View style={styles.articlePage}>
      <View style={styles.articleTopBar}>
        <Pressable onPress={onBack} style={styles.inspectionCloseButton}>
          <Ionicons name="close" size={32} color="#D8D8D8" />
        </Pressable>
        <View style={styles.articleTopSpacer} />
        <Pressable onPress={onToggleFavorite} style={styles.articleRoundButton}>
          <Ionicons
            name={unit.isFavorite ? "star" : "star-outline"}
            size={23}
            color={unit.isFavorite ? COLORS.yellow : COLORS.ink}
          />
        </Pressable>
        <Pressable onPress={onInspect} style={styles.inspectRoundButton}>
          <Text style={styles.inspectGlyph}>检</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.articleContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.articleEyebrow}>LEARNING UNIT</Text>
        <Text style={styles.articleTitle}>{unit.title}</Text>
        <Text style={styles.articleDate}>{formatSavedAt(unit.savedAt)}</Text>

        <View style={styles.sourceCard}>
          <Text style={styles.sourceLabel}>你说的中文</Text>
          <Text style={styles.sourceText}>{unit.sourceTranscript}</Text>
        </View>

        <Pressable
          onPress={playback.toggleAll}
          style={({ pressed }) => [
            styles.articlePlayAll,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons
            name={
              playback.isPlayingAll && playback.status.playing
                ? "pause"
                : "play"
            }
            size={22}
            color="#FFFFFF"
          />
          <Text style={styles.articlePlayAllText}>
            {playback.isPlayingAll && playback.status.playing
              ? "暂停播放"
              : "全部播放"}
          </Text>
        </Pressable>

        <View style={styles.articleSentences}>
          {unit.sentences.map((sentence) => (
            <Pressable
              key={sentence.sequence}
              onPress={() => playback.playSequence(sentence.sequence)}
              style={({ pressed }) => [
                styles.articleSentence,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.articleSentenceTop}>
                <Text style={styles.articleSentenceNumber}>
                  {sentence.sequence}
                </Text>
                <Ionicons
                  name={
                    playback.playingSequence === sentence.sequence &&
                    playback.status.playing
                      ? "pause-circle"
                      : "volume-medium"
                  }
                  size={24}
                  color={COLORS.coral}
                />
              </View>
              <ClickableEnglishText
                text={sentence.englishText}
                onWordPress={(word) =>
                  setDictionaryTarget({ word, sentence: sentence.englishText })
                }
              />
              <Text style={styles.articleChinese}>
                {sentence.chineseMeaning}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
      <DictionarySheet
        target={dictionaryTarget}
        onClose={() => setDictionaryTarget(null)}
      />
    </View>
  );
}

function ClickableEnglishText({
  text,
  onWordPress,
}: {
  text: string;
  onWordPress: (word: string) => void;
}) {
  const pieces = text.split(/([A-Za-z]+(?:['’-][A-Za-z]+)*)/g);
  return (
    <Text style={styles.articleEnglish}>
      {pieces.map((piece, index) => {
        if (!/^[A-Za-z]+(?:['’-][A-Za-z]+)*$/.test(piece)) return piece;
        const word = piece.replace('’', "'");
        return (
          <Text
            key={`${word}-${index}`}
            onPress={() => onWordPress(word)}
            style={styles.clickableWord}
          >
            {piece}
          </Text>
        );
      })}
    </Text>
  );
}

function DictionarySheet({
  target,
  onClose,
}: {
  target: { word: string; sentence: string } | null;
  onClose: () => void;
}) {
  const [entry, setEntry] = useState<DictionaryEntry | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!target) {
      setEntry(null);
      setIsLoading(false);
      return;
    }
    let active = true;
    setEntry(null);
    setIsLoading(true);
    void fetch(`${API_BASE_URL}/dictionary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(target),
    })
      .then(async (response) => {
        const body = (await response.json()) as DictionaryEntry & {
          message?: string;
        };
        if (!response.ok) throw new Error(body.message || "单词解释没有生成");
        return body;
      })
      .then((result) => {
        if (active) setEntry(result);
      })
      .catch((error) => {
        if (active) {
          Alert.alert(
            "暂时无法解释这个单词",
            error instanceof Error ? error.message : "请稍后再试",
          );
          onClose();
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [onClose, target]);

  return (
    <Modal transparent visible={Boolean(target)} animationType="slide" onRequestClose={onClose}>
      <View style={styles.dictionaryBackdrop}>
        <Pressable style={styles.dictionaryDismissArea} onPress={onClose} />
        <View style={styles.dictionarySheet}>
          <View style={styles.dictionarySheetTop}>
            <View>
              <Text style={styles.dictionaryWord}>{target?.word}</Text>
              {entry?.phonetic ? (
                <Text style={styles.dictionaryPhonetic}>{entry.phonetic}</Text>
              ) : null}
            </View>
            <Pressable onPress={onClose} style={styles.articleRoundButton}>
              <Ionicons name="close" size={22} color={COLORS.ink} />
            </Pressable>
          </View>
          {isLoading ? (
            <View style={styles.dictionaryLoading}>
              <ActivityIndicator color={COLORS.coral} />
              <Text style={styles.dictionaryLoadingText}>正在结合这句话解释…</Text>
            </View>
          ) : entry ? (
            <ScrollView showsVerticalScrollIndicator={false}>
              {entry.partOfSpeech ? (
                <Text style={styles.dictionaryPart}>{entry.partOfSpeech}</Text>
              ) : null}
              <Text style={styles.dictionaryMeaning}>{entry.meaning}</Text>
              {entry.spokenNote ? (
                <View style={styles.dictionaryNote}>
                  <Text style={styles.dictionaryNoteLabel}>口语里怎么用</Text>
                  <Text style={styles.dictionaryNoteText}>{entry.spokenNote}</Text>
                </View>
              ) : null}
              {entry.example ? (
                <View style={styles.dictionaryExample}>
                  <Text style={styles.dictionaryExampleText}>{entry.example}</Text>
                  <Text style={styles.dictionaryExampleChinese}>{entry.exampleChinese}</Text>
                </View>
              ) : null}
            </ScrollView>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

export function InspectionView({
  unit,
  onBack,
  onRate,
}: {
  unit: SavedLearningUnit;
  onBack: () => void;
  onRate: (sentence: SavedSentence, mastery: SavedSentence["mastery"]) => void;
}) {
  const { height } = useWindowDimensions();
  const [remaining, setRemaining] = useState(unit.sentences);
  const [activeIndex, setActiveIndex] = useState(0);
  const playback = useSentencePlayer(remaining);
  const lyricPadding = Math.max(110, (height - 204) / 2);

  const rate = (sentence: SavedSentence, mastery: SavedSentence["mastery"]) => {
    setRemaining((current) =>
      current.filter((item) => item.sequence !== sentence.sequence),
    );
    setActiveIndex((current) =>
      Math.max(0, Math.min(current, remaining.length - 2)),
    );
    onRate(sentence, mastery);
  };

  return (
    <View style={styles.inspectionPage}>
      <View style={styles.inspectionHeader}>
        <Pressable onPress={onBack} style={styles.articleRoundButton}>
          <Ionicons name="arrow-back" size={23} color={COLORS.ink} />
        </Pressable>
        <View style={styles.inspectionHeading}>
          <Text style={styles.inspectionTitle}>检验模式</Text>
          <Text style={styles.inspectionSubtitle}>左滑已掌握 · 右滑未掌握</Text>
        </View>
        <Text style={styles.inspectionProgress}>
          {Math.min(activeIndex + 1, remaining.length)}/{remaining.length}
        </Text>
      </View>

      {remaining.length ? (
        <ScrollView
          snapToInterval={140}
          decelerationRate="fast"
          contentContainerStyle={[
            styles.inspectionList,
            { paddingTop: lyricPadding, paddingBottom: lyricPadding + 80 },
          ]}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={(event) => {
            const nextIndex = Math.max(
              0,
              Math.min(
                remaining.length - 1,
                Math.round(event.nativeEvent.contentOffset.y / 140),
              ),
            );
            if (nextIndex !== activeIndex) setActiveIndex(nextIndex);
          }}
        >
          {remaining.map((sentence, index) => (
            <SwipeSentenceCard
              key={sentence.sequence}
              sentence={sentence}
              isActive={index === activeIndex}
              onPlay={() => playback.playSequence(sentence.sequence)}
              onRate={(mastery) => rate(sentence, mastery)}
            />
          ))}
        </ScrollView>
      ) : (
        <View style={styles.inspectionComplete}>
          <View style={styles.inspectionCompleteIcon}>
            <Ionicons name="checkmark" size={38} color="#FFFFFF" />
          </View>
          <Text style={styles.inspectionCompleteTitle}>本次检验完成</Text>
          <Text style={styles.inspectionCompleteText}>
            学习状态已经保存到学习记录
          </Text>
          <Pressable onPress={onBack} style={styles.inspectionDoneButton}>
            <Text style={styles.inspectionDoneText}>返回文章</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function SwipeSentenceCard({
  sentence,
  isActive,
  onPlay,
  onRate,
}: {
  sentence: SavedSentence;
  isActive: boolean;
  onPlay: () => void;
  onRate: (mastery: SavedSentence["mastery"]) => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const masteredRevealOpacity = translateX.interpolate({
    inputRange: [-150, -18, 0],
    outputRange: [1, 0.22, 0],
    extrapolate: "clamp",
  });
  const unmasteredRevealOpacity = translateX.interpolate({
    inputRange: [0, 18, 150],
    outputRange: [0, 0.22, 1],
    extrapolate: "clamp",
  });
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          isActive &&
          Math.abs(gesture.dx) > 8 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: (_event, gesture) =>
          translateX.setValue(gesture.dx),
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dx < -80) {
            Animated.timing(translateX, {
              toValue: -500,
              duration: 180,
              useNativeDriver: true,
            }).start(() => onRate("MASTERED"));
          } else if (gesture.dx > 80) {
            Animated.timing(translateX, {
              toValue: 500,
              duration: 180,
              useNativeDriver: true,
            }).start(() => onRate("UNMASTERED"));
          } else {
            Animated.spring(translateX, {
              toValue: 0,
              useNativeDriver: true,
            }).start();
          }
        },
      }),
    [isActive, onRate, translateX],
  );

  return (
    <View style={styles.swipeCardShell}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.swipeReveal,
          styles.swipeRevealMastered,
          { opacity: masteredRevealOpacity },
        ]}
      >
        <View style={styles.swipeRevealMasteredLabel}>
          <Ionicons name="checkmark" size={19} color="#FFFFFF" />
          <Text style={styles.swipeRevealText}>已掌握</Text>
        </View>
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.swipeReveal,
          styles.swipeRevealUnmastered,
          { opacity: unmasteredRevealOpacity },
        ]}
      >
        <View style={styles.swipeRevealUnmasteredLabel}>
          <Ionicons name="close" size={19} color="#FFFFFF" />
          <Text style={styles.swipeRevealText}>未掌握</Text>
        </View>
      </Animated.View>
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.swipeSentenceCard,
          isActive ? styles.swipeSentenceActive : styles.swipeSentenceDimmed,
          { transform: [{ translateX }] },
        ]}
      >
        <Pressable onPress={onPlay} style={styles.lyricSentenceContent}>
          <View style={styles.lyricTextBlock}>
            <Text numberOfLines={2} style={styles.swipeEnglish}>
              {sentence.englishText}
            </Text>
            <Text numberOfLines={1} style={styles.swipeChinese}>
              {sentence.chineseMeaning}
            </Text>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

function formatSavedAt(isoDate: string) {
  const date = new Date(isoDate);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = `${date.getHours().toString().padStart(2, "0")}:${date
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
  return sameDay
    ? `今天 ${time}`
    : `${date.getMonth() + 1}-${date.getDate()} ${time}`;
}

function ProgressPage({ units }: { units: SavedLearningUnit[] }) {
  const router = useRouter();
  const sentences = units.flatMap((unit) => unit.sentences);
  const unmasteredCount = sentences.filter(
    (sentence) => sentence.mastery === "UNMASTERED",
  ).length;
  const masteredCount = sentences.filter(
    (sentence) => sentence.mastery === "MASTERED",
  ).length;

  return (
    <ScrollView
      contentContainerStyle={styles.scrollPage}
      showsVerticalScrollIndicator={false}
    >
      <PageHeading
        eyebrow="KEEP GOING"
        title="学习记录"
        subtitle="句子会保留在这里，直到你真正掌握。"
      />

      <Pressable
        onPress={() =>
          router.push({
            pathname: "/records/[kind]",
            params: { kind: "unmastered" },
          })
        }
        style={({ pressed }) => [
          styles.progressCard,
          styles.unmasteredCard,
          pressed && styles.pressed,
        ]}
      >
        <View style={[styles.progressIcon, { backgroundColor: COLORS.red }]}>
          <Ionicons name="close" size={30} color="#FFFFFF" />
        </View>
        <View style={styles.progressText}>
          <Text style={styles.progressTitle}>未掌握</Text>
          <Text style={styles.progressSubtitle}>
            {unmasteredCount ? `有 ${unmasteredCount} 句还需要练习` : "暂时没有未掌握句子"}
          </Text>
        </View>
        <Text style={styles.progressCount}>{unmasteredCount}</Text>
      </Pressable>

      <Pressable
        onPress={() =>
          router.push({
            pathname: "/records/[kind]",
            params: { kind: "mastered" },
          })
        }
        style={({ pressed }) => [
          styles.progressCard,
          styles.masteredCard,
          pressed && styles.pressed,
        ]}
      >
        <View style={[styles.progressIcon, { backgroundColor: COLORS.green }]}>
          <Ionicons name="checkmark" size={30} color="#FFFFFF" />
        </View>
        <View style={styles.progressText}>
          <Text style={styles.progressTitle}>已掌握</Text>
          <Text style={styles.progressSubtitle}>看看已经学会的表达</Text>
        </View>
        <Text style={styles.progressCount}>{masteredCount}</Text>
      </Pressable>

      <Pressable
        onPress={() =>
          router.push({
            pathname: "/records/[kind]",
            params: { kind: "favorites" },
          })
        }
        style={({ pressed }) => [
          styles.progressCard,
          styles.favoriteCard,
          pressed && styles.pressed,
        ]}
      >
        <View style={[styles.progressIcon, { backgroundColor: COLORS.yellow }]}>
          <Ionicons name="star" size={28} color="#FFFFFF" />
        </View>
        <View style={styles.progressText}>
          <Text style={styles.progressTitle}>收藏夹</Text>
          <Text style={styles.progressSubtitle}>保存喜欢的学习单元</Text>
        </View>
        <Text style={styles.progressCount}>
          {units.filter((unit) => unit.isFavorite).length}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

export function RecordSentenceListView({
  title,
  status,
  units,
  onBack,
  onChangeStatus,
}: {
  title: string;
  status: "MASTERED" | "UNMASTERED";
  units: SavedLearningUnit[];
  onBack: () => void;
  onChangeStatus: (
    unitId: string,
    sentence: SavedSentence,
    mastery: SavedSentence["mastery"],
  ) => void;
}) {
  const items = units.flatMap((unit) =>
    unit.sentences
      .filter((sentence) => sentence.mastery === status)
      .map((sentence) => ({ unit, sentence })),
  );
  const nextStatus = status === "UNMASTERED" ? "MASTERED" : "UNMASTERED";

  return (
    <View style={styles.recordDetailPage}>
      <DetailHeader title={title} onBack={onBack} count={items.length} />
      <ScrollView
        contentContainerStyle={styles.recordDetailList}
        showsVerticalScrollIndicator={false}
      >
        {items.length ? (
          items.map(({ unit, sentence }) => (
            <RecordSentenceRow
              key={`${unit.id}-${sentence.sequence}`}
              unitTitle={unit.title}
              sentence={sentence}
              actionIcon={status === "UNMASTERED" ? "checkmark" : "close"}
              actionColor={
                status === "UNMASTERED" ? COLORS.green : COLORS.red
              }
              onAction={() =>
                onChangeStatus(unit.id, sentence, nextStatus)
              }
            />
          ))
        ) : (
          <RecordEmpty
            icon={status === "UNMASTERED" ? "sparkles" : "checkmark-done"}
            title={status === "UNMASTERED" ? "没有待练句子" : "还没有已掌握句子"}
            subtitle="完成检验后，句子会自动出现在这里"
          />
        )}
      </ScrollView>
    </View>
  );
}

function RecordSentenceRow({
  unitTitle,
  sentence,
  actionIcon,
  actionColor,
  onAction,
}: {
  unitTitle: string;
  sentence: SavedSentence;
  actionIcon: "checkmark" | "close";
  actionColor: string;
  onAction: () => void;
}) {
  const player = useAudioPlayer(sentence.audioUri);
  const status = useAudioPlayerStatus(player);

  return (
    <View style={styles.recordSentenceCard}>
      <Text style={styles.recordSource}>来自 · {unitTitle}</Text>
      <Text style={styles.recordEnglish}>{sentence.englishText}</Text>
      <Text style={styles.recordChinese}>{sentence.chineseMeaning}</Text>
      <View style={styles.recordDetailActions}>
        <Pressable
          onPress={() => (status.playing ? player.pause() : player.play())}
          style={styles.recordPlayButton}
        >
          <Ionicons
            name={status.playing ? "pause" : "volume-medium"}
            size={21}
            color={COLORS.coral}
          />
        </Pressable>
        <Pressable
          onPress={onAction}
          style={[styles.recordStatusButton, { backgroundColor: actionColor }]}
        >
          <Ionicons name={actionIcon} size={22} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  );
}

export function FavoriteUnitsView({
  units,
  onBack,
  onOpen,
}: {
  units: SavedLearningUnit[];
  onBack: () => void;
  onOpen: (unit: SavedLearningUnit) => void;
}) {
  const favorites = units.filter((unit) => unit.isFavorite);
  const cardColors = ["#FFBF67", "#B7D4FA", "#C9B9FF", "#F2AED6"];
  return (
    <View style={styles.recordDetailPage}>
      <DetailHeader title="收藏夹" onBack={onBack} count={favorites.length} />
      <ScrollView
        contentContainerStyle={styles.favoriteList}
        showsVerticalScrollIndicator={false}
      >
        {favorites.length ? (
          favorites.map((unit, index) => (
            <Pressable
              key={unit.id}
              onPress={() => onOpen(unit)}
              style={({ pressed }) => [
                styles.unitCard,
                styles.favoriteUnitCard,
                index % 2 === 0
                  ? styles.unitCardLeft
                  : styles.unitCardRight,
                { backgroundColor: cardColors[index % cardColors.length] },
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.cardIconBubble}>
                <Ionicons name="star" size={22} color={COLORS.ink} />
              </View>
              <Text numberOfLines={2} style={styles.unitName}>
                {unit.title}
              </Text>
              <Text style={styles.unitTime}>{formatSavedAt(unit.savedAt)}</Text>
            </Pressable>
          ))
        ) : (
          <RecordEmpty
            icon="star-outline"
            title="收藏夹还是空的"
            subtitle="进入文章学习页面，点击右上角五角星即可收藏"
          />
        )}
      </ScrollView>
    </View>
  );
}

function DetailHeader({
  title,
  onBack,
  count,
}: {
  title: string;
  onBack: () => void;
  count: number;
}) {
  return (
    <View style={styles.detailHeader}>
      <Pressable onPress={onBack} style={styles.articleRoundButton}>
        <Ionicons name="arrow-back" size={23} color={COLORS.ink} />
      </Pressable>
      <Text style={styles.detailTitle}>{title}</Text>
      <View style={styles.detailCountBubble}>
        <Text style={styles.detailCount}>{count}</Text>
      </View>
    </View>
  );
}

function RecordEmpty({
  icon,
  title,
  subtitle,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
}) {
  return (
    <View style={styles.recordEmpty}>
      <View style={styles.emptyUnitsIcon}>
        <Ionicons name={icon} size={29} color={COLORS.coral} />
      </View>
      <Text style={styles.emptyUnitsTitle}>{title}</Text>
      <Text style={styles.emptyUnitsSubtitle}>{subtitle}</Text>
    </View>
  );
}

function AccountPage({ onOpenGuide }: { onOpenGuide: () => void }) {
  const auth = useAuth();
  const [isAuthSheetVisible, setIsAuthSheetVisible] = useState(false);
  const [isAboutSheetVisible, setIsAboutSheetVisible] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncSummary, setSyncSummary] = useState<string | undefined>();
  const displayName =
    typeof auth.user?.user_metadata.display_name === "string"
      ? auth.user.user_metadata.display_name
      : undefined;

  const confirmSignOut = () => {
    Alert.alert("退出登录？", "这台手机上的学习内容仍会保留。", [
      { text: "取消", style: "cancel" },
      {
        text: "退出登录",
        style: "destructive",
        onPress: () => void auth.signOut(),
      },
    ]);
  };

  const syncToCloud = async () => {
    if (!auth.user) {
      setIsAuthSheetVisible(true);
      return;
    }
    setIsSyncing(true);
    try {
      const { syncLearningDataToCloud } = await import(
        "../src/data/cloud-sync"
      );
      const result = await syncLearningDataToCloud(auth.user.id);
      const summary = result.unitCount
        ? `已备份 ${result.unitCount} 个单元、${result.sentenceCount} 句`
        : "还没有需要备份的学习内容";
      setSyncSummary(summary);
      Alert.alert("已同步至云端", summary);
    } catch (error) {
      Alert.alert(
        "同步失败",
        error instanceof Error ? error.message : "请检查网络后再试",
      );
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.scrollPage}
      showsVerticalScrollIndicator={false}
    >
      <PageHeading
        eyebrow="YOUR SPACE"
        title="账号与设置"
        subtitle="登录后，学习内容可以长期保存。"
      />

      <View style={styles.accountCard}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={34} color={COLORS.ink} />
        </View>
        <View style={styles.accountCopy}>
          <Text style={styles.accountTitle}>
            {auth.isLoading
              ? "正在读取账号"
              : auth.user
                ? displayName || "已登录"
                : "当前为游客"}
          </Text>
          <Text style={styles.accountSubtitle}>
            {auth.user ? auth.user.email : "登录后，学习内容可以长期保存"}
          </Text>
        </View>
      </View>

      <Pressable
        onPress={() =>
          auth.user ? confirmSignOut() : setIsAuthSheetVisible(true)
        }
        style={({ pressed }) => [
          styles.primaryButton,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.primaryButtonText}>
          {auth.user ? "退出登录" : "注册或登录"}
        </Text>
      </Pressable>

      <View style={styles.settingsGroup}>
        <SettingRow
          icon="cloud-outline"
          title="同步状态"
          value={
            isSyncing
              ? "正在同步…"
              : syncSummary || (auth.user ? "点击备份到云端" : "登录后可同步")
          }
          onPress={() => void syncToCloud()}
          disabled={isSyncing}
        />
        <SettingRow
          icon="language-outline"
          title="英语偏好"
          value="美式日常口语"
        />
        <SettingRow
          icon="help-circle-outline"
          title="使用教程"
          value="重新查看"
          onPress={onOpenGuide}
        />
        <SettingRow
          icon="information-circle-outline"
          title="关于应用与隐私"
          onPress={() => setIsAboutSheetVisible(true)}
        />
      </View>

      <AuthSheet
        visible={isAuthSheetVisible}
        onClose={() => setIsAuthSheetVisible(false)}
      />
      <AboutSheet
        visible={isAboutSheetVisible}
        onClose={() => setIsAboutSheetVisible(false)}
      />
    </ScrollView>
  );
}

function AboutSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.dictionaryBackdrop}>
        <Pressable style={styles.dictionaryDismissArea} onPress={onClose} />
        <View style={styles.aboutSheet}>
          <View style={styles.dictionarySheetTop}>
            <Text style={styles.authSheetTitle}>关于与隐私</Text>
            <Pressable onPress={onClose} style={styles.articleRoundButton}>
              <Ionicons name="close" size={22} color={COLORS.ink} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.aboutSectionTitle}>Say It</Text>
            <Text style={styles.aboutText}>让你把想说的话，练成自然英语。</Text>
            <Text style={styles.aboutSectionTitle}>我们如何使用数据</Text>
            <Text style={styles.aboutText}>你主动录制的中文音频会发送给语音与 AI 服务，用于转写、生成自然英语和英语发音。登录后，学习单元、句子状态和生成音频会同步到你的个人账号。</Text>
            <Text style={styles.aboutSectionTitle}>删除与控制</Text>
            <Text style={styles.aboutText}>游客内容仅保存在当前手机。登录后，删除学习单元会同时删除该账号的云端学习文本和生成音频。你可以随时退出登录。</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function AuthSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const auth = useAuth();
  const [isRegistering, setIsRegistering] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) {
      Alert.alert("请填写邮箱和密码");
      return;
    }
    if (isRegistering && !displayName.trim()) {
      Alert.alert("请填写你的昵称");
      return;
    }
    setIsSubmitting(true);
    try {
      if (isRegistering) {
        const { needsEmailConfirmation } = await auth.signUp(
          displayName,
          email,
          password,
        );
        if (needsEmailConfirmation) {
          Alert.alert("请验证邮箱", "验证邮件已发送，请点击邮件中的链接完成注册。");
        }
      } else {
        await auth.signIn(email, password);
      }
      onClose();
      setPassword("");
    } catch (error) {
      Alert.alert(
        isRegistering ? "注册失败" : "登录失败",
        error instanceof Error ? error.message : "请稍后再试",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      animationType="slide"
      transparent
      visible={visible}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.authBackdrop}
      >
        <View style={styles.authSheet}>
          <View style={styles.authSheetTopRow}>
            <Text style={styles.authSheetTitle}>
              {isRegistering ? "创建账号" : "欢迎回来"}
            </Text>
            <Pressable onPress={onClose} style={styles.authCloseButton}>
              <Ionicons name="close" size={22} color={COLORS.ink} />
            </Pressable>
          </View>
          <Text style={styles.authSheetHint}>
            {isRegistering
              ? "注册后，你的学习内容可以同步到其他设备。"
              : "登录后继续你的口语练习。"}
          </Text>

          {isRegistering ? (
            <TextInput
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="昵称"
              placeholderTextColor="#A7A096"
              style={styles.authInput}
              maxLength={24}
            />
          ) : null}
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="邮箱"
            placeholderTextColor="#A7A096"
            style={[styles.authInput, isRegistering && styles.authInputFollowing]}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="密码（至少 6 位）"
            placeholderTextColor="#A7A096"
            style={[styles.authInput, styles.authInputFollowing]}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />

          <Pressable
            disabled={isSubmitting}
            onPress={() => void submit()}
            style={({ pressed }) => [
              styles.authSubmitButton,
              (isSubmitting || pressed) && styles.pressed,
            ]}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.authSubmitText}>
                {isRegistering ? "注册并验证邮箱" : "登录"}
              </Text>
            )}
          </Pressable>

          <Pressable
            disabled={isSubmitting}
            onPress={() => setIsRegistering((current) => !current)}
            style={styles.authSwitchButton}
          >
            <Text style={styles.authSwitchText}>
              {isRegistering ? "已有账号？去登录" : "没有账号？立即注册"}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function PageHeading({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <View style={styles.heading}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.pageTitle}>{title}</Text>
      <Text style={styles.pageSubtitle}>{subtitle}</Text>
    </View>
  );
}

function SettingRow({
  icon,
  title,
  value,
  onPress,
  disabled = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  value?: string;
  onPress?: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.settingRow, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={24} color={COLORS.ink} />
      <Text style={styles.settingTitle}>{title}</Text>
      {value ? <Text style={styles.settingValue}>{value}</Text> : null}
      <Ionicons name="chevron-forward" size={20} color={COLORS.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.canvas },
  pager: { flex: 1 },
  page: { flex: 1, backgroundColor: COLORS.canvas },
  recordPage: { flex: 1, paddingHorizontal: 24 },
  brandPill: {
    alignSelf: "flex-start",
    marginTop: 18,
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#E7DEFF",
  },
  brandText: {
    color: COLORS.ink,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.8,
  },
  recordCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ translateY: -82 }],
  },
  previewRecordCenter: {
    alignItems: "stretch",
    justifyContent: "flex-start",
    transform: [{ translateY: 0 }],
  },
  heroTitle: {
    color: COLORS.ink,
    fontSize: 33,
    lineHeight: 42,
    fontWeight: "900",
    letterSpacing: -1.5,
  },
  heroTitleAccent: {
    color: "#8B72E8",
    fontSize: 33,
    lineHeight: 42,
    fontWeight: "900",
    letterSpacing: -1.5,
  },
  heroSubtitle: { marginTop: 15, color: COLORS.muted, fontSize: 15, fontWeight: "600" },
  recordButtonOuter: {
    width: 148,
    height: 148,
    borderRadius: 74,
    marginTop: 34,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFD9DF",
  },
  recordButtonInner: {
    width: 108,
    height: 108,
    borderRadius: 54,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F55468",
    shadowColor: "#F55468",
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  recordHint: {
    marginTop: 18,
    color: COLORS.ink,
    fontSize: 16,
    fontWeight: "700",
  },
  activeRecording: { width: "100%", alignItems: "center" },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: COLORS.coralSoft,
  },
  pausedBadge: { backgroundColor: "#F4E7C8" },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
    backgroundColor: COLORS.coral,
  },
  pausedDot: { backgroundColor: COLORS.yellow },
  liveText: { color: COLORS.ink, fontSize: 14, fontWeight: "800" },
  timer: {
    marginTop: 26,
    color: COLORS.ink,
    fontSize: 56,
    lineHeight: 64,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  timerLimit: { marginTop: 4, color: COLORS.muted, fontSize: 13 },
  waveform: {
    height: 92,
    marginTop: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  waveBar: { width: 7, borderRadius: 6, backgroundColor: COLORS.coral },
  waveBarPaused: { backgroundColor: "#C9BFAE" },
  recordActions: {
    marginTop: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: 34,
  },
  secondaryRoundButton: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  stopButton: {
    width: 82,
    height: 82,
    borderRadius: 41,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.coral,
  },
  stopSquare: {
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: "#FFFFFF",
  },
  recordActionHint: { marginTop: 15, color: COLORS.muted, fontSize: 13 },
  recordedPanel: { width: "100%", alignItems: "center" },
  completeIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.green,
  },
  recordedTitle: {
    marginTop: 15,
    color: COLORS.ink,
    fontSize: 28,
    fontWeight: "900",
  },
  recordedDuration: {
    marginTop: 5,
    color: COLORS.muted,
    fontSize: 16,
    fontVariant: ["tabular-nums"],
  },
  playButton: {
    minWidth: 210,
    height: 58,
    marginTop: 26,
    paddingHorizontal: 22,
    borderRadius: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: COLORS.coral,
  },
  playButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  finishedActions: {
    width: "100%",
    marginTop: 22,
    flexDirection: "row",
    gap: 12,
  },
  deleteButton: {
    flex: 1,
    height: 54,
    borderRadius: 19,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: COLORS.redSoft,
  },
  deleteButtonText: { color: COLORS.red, fontSize: 14, fontWeight: "800" },
  continueButton: {
    flex: 1.45,
    height: 54,
    borderRadius: 19,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: COLORS.ink,
  },
  continueButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  transcribingPanel: { width: "100%", alignItems: "center" },
  transcribingIcon: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.coralSoft,
  },
  generatingIcon: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F7E8B8",
  },
  speakingIcon: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.blueSoft,
  },
  transcribingTitle: {
    marginTop: 24,
    color: COLORS.ink,
    fontSize: 24,
    fontWeight: "900",
  },
  transcribingSubtitle: { marginTop: 9, color: COLORS.muted, fontSize: 14 },
  transcriptPanel: { width: "100%" },
  transcriptHeader: { flexDirection: "row", alignItems: "center", gap: 13 },
  completeIconSmall: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.green,
  },
  transcriptTitle: { color: COLORS.ink, fontSize: 22, fontWeight: "900" },
  transcriptHint: { marginTop: 3, color: COLORS.muted, fontSize: 13 },
  transcriptInput: {
    minHeight: 170,
    maxHeight: 250,
    marginTop: 22,
    paddingHorizontal: 18,
    paddingVertical: 17,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: "#FFFFFF",
    color: COLORS.ink,
    fontSize: 18,
    lineHeight: 29,
  },
  previewPanel: { width: "100%", flex: 1, paddingTop: 12 },
  previewHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  previewBack: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  previewTitle: { flex: 1, color: COLORS.ink, fontSize: 20, fontWeight: "900" },
  previewNextButton: {
    height: 44,
    paddingHorizontal: 13,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.ink,
  },
  previewNextText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  previewMetaRow: {
    minHeight: 38,
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  previewSubtitle: { color: COLORS.muted, fontSize: 13 },
  playAllButton: {
    height: 40,
    paddingHorizontal: 13,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: COLORS.ink,
  },
  playAllText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  sentenceScroller: { flex: 1, marginTop: 14 },
  sentenceList: { gap: 12, paddingBottom: 12 },
  sentenceCard: {
    paddingHorizontal: 18,
    paddingVertical: 17,
    borderRadius: 24,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  sentenceNumber: {
    width: 27,
    height: 27,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.coralSoft,
  },
  sentenceNumberText: { color: COLORS.coral, fontSize: 12, fontWeight: "900" },
  sentencePlayButton: {
    position: "absolute",
    top: 14,
    right: 14,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.coralSoft,
  },
  englishSentence: {
    marginTop: 11,
    color: COLORS.ink,
    fontSize: 18,
    lineHeight: 27,
    fontWeight: "800",
  },
  chineseSentence: {
    marginTop: 8,
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  regenerateButton: {
    flex: 1,
    height: 54,
    borderRadius: 19,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  regenerateButtonText: { color: COLORS.ink, fontSize: 14, fontWeight: "800" },
  modalBackdrop: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: "rgba(41,39,34,0.42)",
  },
  namingCard: {
    paddingHorizontal: 22,
    paddingTop: 26,
    paddingBottom: 22,
    borderRadius: 30,
    backgroundColor: COLORS.canvas,
  },
  namingIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.coralSoft,
  },
  namingTitle: {
    marginTop: 17,
    color: COLORS.ink,
    fontSize: 24,
    fontWeight: "900",
  },
  namingSubtitle: { marginTop: 7, color: COLORS.muted, fontSize: 13 },
  namingInput: {
    height: 58,
    marginTop: 22,
    paddingHorizontal: 17,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: "#FFFFFF",
    color: COLORS.ink,
    fontSize: 17,
    fontWeight: "700",
  },
  namingActions: { marginTop: 18, flexDirection: "row", gap: 12 },
  namingCancel: {
    flex: 1,
    height: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.redSoft,
  },
  namingCancelText: { color: COLORS.red, fontSize: 15, fontWeight: "800" },
  namingSave: {
    flex: 1.4,
    height: 52,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: COLORS.ink,
  },
  namingSaveText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  swipeHint: {
    alignSelf: "center",
    marginBottom: 46,
    color: COLORS.muted,
    fontSize: 13,
  },
  scrollPage: { paddingHorizontal: 24, paddingTop: 22, paddingBottom: 112 },
  heading: { marginBottom: 28 },
  unitsHeadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  layoutToggleButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  eyebrow: {
    color: "#8B72E8",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.6,
  },
  pageTitle: {
    marginTop: 9,
    color: COLORS.ink,
    fontSize: 34,
    lineHeight: 41,
    fontWeight: "900",
    letterSpacing: -1.1,
  },
  pageSubtitle: {
    marginTop: 10,
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 23,
  },
  unitList: { width: "100%", gap: 16 },
  unitGridList: {
    gap: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 14,
  },
  emptyUnits: {
    minHeight: 230,
    paddingHorizontal: 24,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 0,
    shadowColor: "#978DB2",
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 2,
  },
  emptyUnitsIcon: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.coralSoft,
  },
  emptyUnitsTitle: {
    marginTop: 17,
    color: COLORS.ink,
    fontSize: 20,
    fontWeight: "900",
  },
  emptyUnitsSubtitle: {
    marginTop: 8,
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },
  unitCard: {
    width: 188,
    height: 188,
    borderRadius: 28,
    borderWidth: 0,
    shadowColor: "#776A91",
    shadowOpacity: 0.14,
    shadowRadius: 13,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  unitCardInner: {
    flex: 1,
    borderRadius: 28,
    padding: 19,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  unitCardLeft: { alignSelf: "flex-start" },
  unitCardRight: { alignSelf: "flex-end" },
  unitCardGrid: {
    width: "48%",
    height: 158,
    marginBottom: 0,
  },
  cardIconBubble: {
    position: "absolute",
    top: 18,
    left: 18,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.72)",
  },
  cardDeleteButton: {
    position: "absolute",
    top: 18,
    right: 18,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.72)",
  },
  unitName: {
    color: COLORS.ink,
    fontSize: 20,
    fontWeight: "900",
  },
  unitTime: {
    marginTop: 7,
    color: "rgba(24,23,25,0.58)",
    fontSize: 12,
    fontWeight: "600",
  },
  articlePage: { flex: 1, paddingHorizontal: 22, paddingTop: 10 },
  articleTopBar: { flexDirection: "row", alignItems: "center", gap: 10 },
  articleTopSpacer: { flex: 1 },
  articleRoundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  inspectRoundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.ink,
  },
  inspectGlyph: { color: "#FFFFFF", fontSize: 17, fontWeight: "900" },
  articleContent: { paddingTop: 24, paddingBottom: 110 },
  articleEyebrow: {
    color: COLORS.coral,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  articleTitle: {
    marginTop: 8,
    color: COLORS.ink,
    fontSize: 31,
    lineHeight: 38,
    fontWeight: "900",
  },
  articleDate: { marginTop: 7, color: COLORS.muted, fontSize: 13 },
  sourceCard: {
    marginTop: 22,
    padding: 18,
    borderRadius: 24,
    backgroundColor: COLORS.blueSoft,
  },
  sourceLabel: { color: COLORS.muted, fontSize: 12, fontWeight: "800" },
  sourceText: { marginTop: 9, color: COLORS.ink, fontSize: 15, lineHeight: 24 },
  articlePlayAll: {
    alignSelf: "flex-start",
    height: 48,
    marginTop: 18,
    paddingHorizontal: 18,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.ink,
  },
  articlePlayAllText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  articleSentences: { marginTop: 18, gap: 12 },
  articleSentence: {
    padding: 17,
    borderRadius: 23,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  articleSentenceTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  articleSentenceNumber: {
    color: COLORS.coral,
    fontSize: 12,
    fontWeight: "900",
  },
  articleEnglish: {
    marginTop: 9,
    color: COLORS.ink,
    fontSize: 18,
    lineHeight: 28,
    fontWeight: "800",
  },
  clickableWord: {
    textDecorationLine: "underline",
    textDecorationColor: COLORS.coral,
  },
  dictionaryBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(41,39,34,0.35)",
  },
  dictionaryDismissArea: { flex: 1 },
  dictionarySheet: {
    minHeight: 330,
    maxHeight: "72%",
    padding: 24,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    backgroundColor: COLORS.canvas,
  },
  aboutSheet: {
    minHeight: 420,
    maxHeight: "76%",
    padding: 24,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    backgroundColor: COLORS.canvas,
  },
  dictionarySheetTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dictionaryWord: { color: COLORS.ink, fontSize: 32, fontWeight: "900" },
  dictionaryPhonetic: { marginTop: 4, color: COLORS.muted, fontSize: 14 },
  dictionaryLoading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  dictionaryLoadingText: { color: COLORS.muted, fontSize: 14 },
  dictionaryPart: {
    marginTop: 24,
    color: COLORS.coral,
    fontSize: 13,
    fontWeight: "900",
  },
  dictionaryMeaning: {
    marginTop: 7,
    color: COLORS.ink,
    fontSize: 22,
    lineHeight: 32,
    fontWeight: "800",
  },
  dictionaryNote: {
    marginTop: 20,
    padding: 16,
    borderRadius: 18,
    backgroundColor: COLORS.coralSoft,
  },
  dictionaryNoteLabel: { color: COLORS.coral, fontSize: 12, fontWeight: "900" },
  dictionaryNoteText: { marginTop: 7, color: COLORS.ink, fontSize: 15, lineHeight: 23 },
  dictionaryExample: {
    marginTop: 15,
    padding: 16,
    borderRadius: 18,
    backgroundColor: COLORS.blueSoft,
  },
  dictionaryExampleText: {
    color: COLORS.ink,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "700",
  },
  dictionaryExampleChinese: {
    marginTop: 6,
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  aboutSectionTitle: {
    marginTop: 24,
    color: COLORS.ink,
    fontSize: 17,
    fontWeight: "900",
  },
  aboutText: {
    marginTop: 8,
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 23,
  },
  articleChinese: {
    marginTop: 7,
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 22,
  },
  inspectionPage: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 8,
    backgroundColor: "#1C1C1C",
  },
  inspectionHeader: {
    height: 64,
    flexDirection: "row",
    alignItems: "center",
  },
  inspectionCloseButton: {
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  inspectionHeading: {
    position: "absolute",
    left: 70,
    right: 70,
    alignItems: "center",
  },
  inspectionTitle: { color: "#DADADA", fontSize: 21, fontWeight: "700" },
  inspectionSubtitle: { marginTop: 3, color: "#686868", fontSize: 11 },
  inspectionProgress: {
    marginLeft: "auto",
    color: "#858585",
    fontSize: 13,
    fontWeight: "900",
  },
  inspectionList: { paddingTop: 76, paddingBottom: 220 },
  swipeCardShell: {
    height: 140,
    overflow: "hidden",
    backgroundColor: "transparent",
  },
  swipeReveal: {
    position: "absolute",
    top: 4,
    left: 0,
    right: 0,
    height: 132,
    borderRadius: 20,
  },
  swipeRevealMastered: { backgroundColor: COLORS.green },
  swipeRevealUnmastered: { backgroundColor: COLORS.red },
  swipeRevealMasteredLabel: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 5,
    paddingRight: 22,
  },
  swipeRevealUnmasteredLabel: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingLeft: 22,
  },
  swipeRevealText: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  swipeSentenceCard: {
    height: 132,
    marginVertical: 4,
    borderRadius: 20,
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  swipeSentenceActive: {
    opacity: 1,
    backgroundColor: "#292929",
  },
  swipeSentenceDimmed: { opacity: 0.25 },
  lyricSentenceContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
  },
  lyricTextBlock: { flex: 1, alignItems: "center" },
  swipeEnglish: {
    color: "#D5D5D5",
    fontSize: 20,
    lineHeight: 27,
    fontWeight: "500",
    textAlign: "center",
  },
  swipeChinese: {
    marginTop: 9,
    color: "#A7A7A7",
    fontSize: 15,
    lineHeight: 21,
    textAlign: "center",
  },
  inspectionComplete: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1C1C1C",
  },
  inspectionCompleteIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.green,
  },
  inspectionCompleteTitle: {
    marginTop: 20,
    color: "#F0F0F0",
    fontSize: 25,
    fontWeight: "900",
  },
  inspectionCompleteText: { marginTop: 8, color: "#8A8A8A", fontSize: 14 },
  inspectionDoneButton: {
    height: 52,
    marginTop: 24,
    paddingHorizontal: 27,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.ink,
  },
  inspectionDoneText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  progressCard: {
    minHeight: 142,
    borderRadius: 30,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "rgba(41,39,34,0.05)",
  },
  unmasteredCard: { backgroundColor: COLORS.redSoft },
  masteredCard: { backgroundColor: COLORS.greenSoft },
  favoriteCard: { backgroundColor: "#F7E8B8" },
  progressIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
  },
  progressText: { flex: 1, marginLeft: 16 },
  progressTitle: { color: COLORS.ink, fontSize: 22, fontWeight: "900" },
  progressSubtitle: { marginTop: 7, color: COLORS.muted, fontSize: 13 },
  progressCount: { color: COLORS.ink, fontSize: 30, fontWeight: "900" },
  recordDetailPage: { flex: 1, paddingHorizontal: 22, paddingTop: 10 },
  detailHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: 18,
  },
  detailTitle: {
    flex: 1,
    marginLeft: 14,
    color: COLORS.ink,
    fontSize: 25,
    fontWeight: "900",
  },
  detailCountBubble: {
    minWidth: 38,
    height: 38,
    paddingHorizontal: 11,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.coralSoft,
  },
  detailCount: { color: COLORS.coral, fontSize: 14, fontWeight: "900" },
  recordDetailList: { gap: 13, paddingTop: 8, paddingBottom: 90 },
  recordSentenceCard: {
    padding: 18,
    borderRadius: 24,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  recordSource: {
    color: COLORS.coral,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.3,
  },
  recordEnglish: {
    marginTop: 11,
    color: COLORS.ink,
    fontSize: 18,
    lineHeight: 27,
    fontWeight: "800",
  },
  recordChinese: {
    marginTop: 7,
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 22,
  },
  recordDetailActions: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  recordPlayButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.coralSoft,
  },
  recordStatusButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  recordEmpty: {
    minHeight: 300,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  favoriteList: { paddingTop: 8, paddingBottom: 90, gap: 16 },
  favoriteUnitCard: {
    padding: 19,
    justifyContent: "flex-end",
  },
  accountCard: {
    minHeight: 110,
    borderRadius: 28,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.blueSoft,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  accountCopy: { marginLeft: 16 },
  accountTitle: { color: COLORS.ink, fontSize: 20, fontWeight: "900" },
  accountSubtitle: { marginTop: 6, color: COLORS.muted, fontSize: 13 },
  primaryButton: {
    height: 56,
    borderRadius: 20,
    marginTop: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.ink,
  },
  primaryButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  authBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(20,18,15,0.42)",
  },
  authSheet: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 36,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    backgroundColor: COLORS.canvas,
  },
  authSheetTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  authSheetTitle: { color: COLORS.ink, fontSize: 27, fontWeight: "900" },
  authCloseButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  authSheetHint: {
    marginTop: 9,
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  authInput: {
    height: 54,
    marginTop: 24,
    paddingHorizontal: 17,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: "#FFFFFF",
    color: COLORS.ink,
    fontSize: 16,
  },
  authInputFollowing: { marginTop: 11 },
  authSubmitButton: {
    height: 56,
    marginTop: 18,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.ink,
  },
  authSubmitText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  authSwitchButton: {
    alignSelf: "center",
    paddingVertical: 16,
    paddingHorizontal: 12,
  },
  authSwitchText: { color: COLORS.coral, fontSize: 14, fontWeight: "800" },
  settingsGroup: {
    marginTop: 28,
    borderRadius: 26,
    paddingHorizontal: 17,
    backgroundColor: "#FFFFFF",
  },
  settingRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.line,
  },
  settingTitle: {
    flex: 1,
    marginLeft: 13,
    color: COLORS.ink,
    fontSize: 15,
    fontWeight: "700",
  },
  settingValue: { marginRight: 8, color: COLORS.muted, fontSize: 12 },
  guideBackdrop: {
    flex: 1,
    paddingHorizontal: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(24,23,25,0.46)",
  },
  guideCard: {
    width: "100%",
    maxWidth: 430,
    padding: 24,
    borderRadius: 32,
    backgroundColor: COLORS.canvas,
    shadowColor: "#181719",
    shadowOpacity: 0.2,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  guideTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  guideBrandPill: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: COLORS.coralSoft,
  },
  guideBrandText: {
    color: COLORS.ink,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  guideCloseButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  guideIcon: {
    width: 92,
    height: 92,
    marginTop: 30,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  guideEyebrow: {
    marginTop: 26,
    color: COLORS.coral,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  guideTitle: {
    marginTop: 8,
    color: COLORS.ink,
    fontSize: 29,
    lineHeight: 37,
    fontWeight: "900",
  },
  guideDescription: {
    minHeight: 84,
    marginTop: 12,
    color: COLORS.muted,
    fontSize: 15,
    lineHeight: 24,
  },
  guideDots: {
    marginTop: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  guideDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#D8D3E2",
  },
  guideDotActive: { width: 24, backgroundColor: COLORS.coral },
  guideActions: { marginTop: 24, flexDirection: "row", gap: 11 },
  guideBackButton: {
    flex: 1,
    height: 54,
    borderRadius: 19,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  guideBackText: { color: COLORS.ink, fontSize: 14, fontWeight: "800" },
  guideNextButton: {
    flex: 1.35,
    height: 54,
    borderRadius: 19,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: COLORS.ink,
  },
  guideNextText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  pageIndicator: {
    position: "absolute",
    bottom: 16,
    left: 72,
    right: 72,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.ink,
    shadowColor: "#1A1820",
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  indicatorTrack: {
    width: 204,
    height: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  indicatorActiveBubble: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 42,
    height: 42,
    borderRadius: 999,
    backgroundColor: "#FFFFFF",
  },
  indicatorItem: {
    width: 42,
    height: 42,
    borderRadius: 999,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  indicatorItemPressed: { transform: [{ scale: 0.9 }] },
  pressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
});
