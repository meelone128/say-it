import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { InspectionView } from "../../index";
import {
  listLearningUnits,
  setSentenceMastery,
  type SavedLearningUnit,
  type SavedSentence,
} from "../../../src/data/learning-units";

export default function InspectionRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [unit, setUnit] = useState<SavedLearningUnit>();
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void listLearningUnits()
      .then((units) => {
        if (active) setUnit(units.find((item) => item.id === id));
      })
      .finally(() => {
        if (active) setIsLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [id]);

  const rateSentence = async (
    sentence: SavedSentence,
    mastery: SavedSentence["mastery"],
  ) => {
    if (!unit) return;
    const previous = unit;
    setUnit({
      ...unit,
      sentences: unit.sentences.map((item) =>
        item.sequence === sentence.sequence ? { ...item, mastery } : item,
      ),
    });
    try {
      await setSentenceMastery(unit.id, sentence.sequence, mastery);
    } catch {
      setUnit(previous);
      Alert.alert("学习状态没有保存成功", "请稍后再试");
    }
  };

  if (!isLoaded) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color="#F17362" size="large" />
        <Text style={styles.message}>正在进入检验模式</Text>
      </SafeAreaView>
    );
  }

  if (!unit) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.missingTitle}>没有找到这个学习单元</Text>
        <Text onPress={() => router.back()} style={styles.backText}>
          返回
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        <InspectionView
          unit={unit}
          onBack={() => router.back()}
          onRate={rateSentence}
        />
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#1C1C1C" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF9EF",
  },
  message: { marginTop: 14, color: "#817D73", fontSize: 14 },
  missingTitle: { color: "#292722", fontSize: 20, fontWeight: "800" },
  backText: {
    marginTop: 18,
    color: "#F17362",
    fontSize: 15,
    fontWeight: "800",
  },
});
