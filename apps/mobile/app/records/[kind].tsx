import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  FavoriteUnitsView,
  RecordSentenceListView,
} from "../index";
import {
  listLearningUnits,
  setSentenceMastery,
  type SavedLearningUnit,
  type SavedSentence,
} from "../../src/data/learning-units";

type RecordKind = "unmastered" | "mastered" | "favorites";

export default function LearningRecordRoute() {
  const router = useRouter();
  const { kind } = useLocalSearchParams<{ kind: string }>();
  const [units, setUnits] = useState<SavedLearningUnit[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void listLearningUnits()
        .then((items) => {
          if (active) setUnits(items);
        })
        .finally(() => {
          if (active) setIsLoaded(true);
        });
      return () => {
        active = false;
      };
    }, []),
  );

  const changeStatus = async (
    unitId: string,
    sentence: SavedSentence,
    mastery: SavedSentence["mastery"],
  ) => {
    const previous = units;
    setUnits((current) =>
      current.map((unit) =>
        unit.id === unitId
          ? {
              ...unit,
              sentences: unit.sentences.map((item) =>
                item.sequence === sentence.sequence
                  ? { ...item, mastery }
                  : item,
              ),
            }
          : unit,
      ),
    );
    try {
      await setSentenceMastery(unitId, sentence.sequence, mastery);
    } catch {
      setUnits(previous);
      Alert.alert("学习状态没有保存成功", "请稍后再试");
    }
  };

  if (!isLoaded) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color="#F17362" size="large" />
        <Text style={styles.message}>正在加载学习记录</Text>
      </SafeAreaView>
    );
  }

  if (kind === "favorites") {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        <FavoriteUnitsView
          units={units}
          onBack={() => router.back()}
          onOpen={(unit) =>
            router.push({
              pathname: "/unit/[id]/article",
              params: { id: unit.id },
            })
          }
        />
      </SafeAreaView>
    );
  }

  const recordKind: RecordKind =
    kind === "mastered" ? "mastered" : "unmastered";
  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <RecordSentenceListView
        title={recordKind === "mastered" ? "已掌握" : "未掌握"}
        status={recordKind === "mastered" ? "MASTERED" : "UNMASTERED"}
        units={units}
        onBack={() => router.back()}
        onChangeStatus={changeStatus}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#FFF9EF" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF9EF",
  },
  message: { marginTop: 14, color: "#817D73", fontSize: 14 },
});
