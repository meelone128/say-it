import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArticleLearningView } from "../../index";
import {
  listLearningUnits,
  setLearningUnitFavorite,
  type SavedLearningUnit,
} from "../../../src/data/learning-units";

export default function LearningUnitArticleRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [unit, setUnit] = useState<SavedLearningUnit>();
  const [isLoaded, setIsLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
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
    }, [id]),
  );

  const toggleFavorite = async () => {
    if (!unit) return;
    const previous = unit;
    const updated = { ...unit, isFavorite: !unit.isFavorite };
    setUnit(updated);
    try {
      await setLearningUnitFavorite(updated.id, updated.isFavorite);
    } catch {
      setUnit(previous);
      Alert.alert("收藏状态没有保存成功", "请稍后再试");
    }
  };

  if (!isLoaded) return <RouteLoading label="正在打开学习单元" />;
  if (!unit) return <RouteMissing onBack={() => router.back()} />;

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <ArticleLearningView
        unit={unit}
        onBack={() => router.back()}
        onInspect={() =>
          router.push({
            pathname: "/unit/[id]/inspection",
            params: { id: unit.id },
          })
        }
        onToggleFavorite={toggleFavorite}
      />
    </SafeAreaView>
  );
}

function RouteLoading({ label }: { label: string }) {
  return (
    <SafeAreaView style={styles.center}>
      <ActivityIndicator color="#F17362" size="large" />
      <Text style={styles.message}>{label}</Text>
    </SafeAreaView>
  );
}

function RouteMissing({ onBack }: { onBack: () => void }) {
  return (
    <SafeAreaView style={styles.center}>
      <Text style={styles.missingTitle}>没有找到这个学习单元</Text>
      <Text onPress={onBack} style={styles.backText}>
        返回学习单元
      </Text>
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
  missingTitle: { color: "#292722", fontSize: 20, fontWeight: "800" },
  backText: {
    marginTop: 18,
    color: "#F17362",
    fontSize: 15,
    fontWeight: "800",
  },
});
