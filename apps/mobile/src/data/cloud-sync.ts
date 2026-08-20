import { Directory, File, Paths } from "expo-file-system";
import {
  listLearningUnits,
  SavedLearningUnit,
  upsertLearningUnitsFromCloud,
} from "./learning-units";
import { supabase } from "../lib/supabase";

export interface CloudSyncResult {
  unitCount: number;
  sentenceCount: number;
}

const AUDIO_BUCKET = "learning-audio";

function audioPath(userId: string, unitId: string, sequence: number) {
  return `${userId}/${unitId}/${sequence}.mp3`;
}

/** Removes a unit and its generated audio from the signed-in user's cloud copy. */
export async function deleteLearningUnitFromCloud(
  userId: string,
  unitId: string,
) {
  const folder = `${userId}/${unitId}`;
  const { data: audioFiles, error: listError } = await supabase.storage
    .from(AUDIO_BUCKET)
    .list(folder);
  if (listError) throw listError;

  if (audioFiles.length) {
    const { error: removeAudioError } = await supabase.storage
      .from(AUDIO_BUCKET)
      .remove(audioFiles.map((file) => `${folder}/${file.name}`));
    if (removeAudioError) throw removeAudioError;
  }

  const { error: deleteError } = await supabase
    .from("learning_units")
    .delete()
    .eq("id", unitId)
    .eq("user_id", userId);
  if (deleteError) throw deleteError;
}

/**
 * 将这台手机保存的文字学习数据备份到当前登录账号。
 * 包含句子状态、复习日期和每句英语音频。
 */
export async function syncLearningDataToCloud(
  userId: string,
): Promise<CloudSyncResult> {
  const units = await listLearningUnits();

  if (units.length === 0) {
    return { unitCount: 0, sentenceCount: 0 };
  }

  const { error: unitsError } = await supabase.from("learning_units").upsert(
    units.map((unit) => ({
      id: unit.id,
      user_id: userId,
      title: unit.title,
      source_transcript: unit.sourceTranscript,
      english_paragraph: unit.englishParagraph,
      saved_at: unit.savedAt,
      is_favorite: unit.isFavorite,
      updated_at: new Date().toISOString(),
    })),
  );
  if (unitsError) throw unitsError;

  await Promise.all(
    units.flatMap((unit) =>
      unit.sentences.map(async (sentence) => {
        const audio = new File(sentence.audioUri);
        if (!audio.exists) return;
        const { error } = await supabase.storage
          .from(AUDIO_BUCKET)
          .upload(audioPath(userId, unit.id, sentence.sequence), await audio.bytes(), {
            contentType: "audio/mpeg",
            upsert: true,
          });
        if (error) throw error;
      }),
    ),
  );

  const sentences = units.flatMap((unit) =>
    unit.sentences.map((sentence) => ({
      unit_id: unit.id,
      sequence: sentence.sequence,
      user_id: userId,
      english_text: sentence.englishText,
      chinese_meaning: sentence.chineseMeaning,
      mastery: sentence.mastery,
      review_due_at: sentence.reviewDueAt ?? null,
      review_step: sentence.reviewStep,
    })),
  );

  if (sentences.length > 0) {
    const { error: sentencesError } = await supabase
      .from("learning_sentences")
      .upsert(sentences);
    if (sentencesError) throw sentencesError;
  }

  const { data: cloudUnits, error: downloadUnitsError } = await supabase
    .from("learning_units")
    .select("id, title, source_transcript, english_paragraph, saved_at, is_favorite")
    .eq("user_id", userId)
    .order("saved_at", { ascending: false });
  if (downloadUnitsError) throw downloadUnitsError;

  const { data: cloudSentences, error: downloadSentencesError } = await supabase
    .from("learning_sentences")
    .select("unit_id, sequence, english_text, chinese_meaning, mastery, review_due_at, review_step")
    .eq("user_id", userId)
    .order("sequence", { ascending: true });
  if (downloadSentencesError) throw downloadSentencesError;

  const sentenceByUnit = new Map<string, typeof cloudSentences>();
  for (const sentence of cloudSentences ?? []) {
    const matching = sentenceByUnit.get(sentence.unit_id) ?? [];
    matching.push(sentence);
    sentenceByUnit.set(sentence.unit_id, matching);
  }

  const restored = await Promise.all(
    (cloudUnits ?? []).map(async (unit): Promise<SavedLearningUnit> => {
      const unitDirectory = new Directory(Paths.document, "learning-units", unit.id);
      unitDirectory.create({ intermediates: true, idempotent: true });
      const cloudUnitSentences = sentenceByUnit.get(unit.id) ?? [];
      const localSentences = await Promise.all(
        cloudUnitSentences.map(async (sentence) => {
          const localAudio = new File(unitDirectory, `${sentence.sequence}.mp3`);
          if (!localAudio.exists) {
            const { data, error } = await supabase.storage
              .from(AUDIO_BUCKET)
              .createSignedUrl(audioPath(userId, unit.id, sentence.sequence), 60);
            if (error) throw error;
            await File.downloadFileAsync(data.signedUrl, localAudio, {
              idempotent: true,
            });
          }
          return {
            sequence: sentence.sequence,
            englishText: sentence.english_text,
            chineseMeaning: sentence.chinese_meaning,
            audioUri: localAudio.uri,
            mastery: sentence.mastery,
            reviewDueAt: sentence.review_due_at ?? undefined,
            reviewStep: sentence.review_step ?? 0,
          };
        }),
      );
      return {
        id: unit.id,
        title: unit.title,
        sourceTranscript: unit.source_transcript,
        englishParagraph: unit.english_paragraph,
        savedAt: unit.saved_at,
        isFavorite: unit.is_favorite,
        sentences: localSentences,
      };
    }),
  );
  await upsertLearningUnitsFromCloud(restored);

  return { unitCount: restored.length, sentenceCount: cloudSentences?.length ?? 0 };
}
