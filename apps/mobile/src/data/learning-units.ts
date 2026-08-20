import { Directory, File, Paths } from "expo-file-system";
import * as SQLite from "expo-sqlite";

export interface SavedSentence {
  sequence: number;
  englishText: string;
  chineseMeaning: string;
  audioUri: string;
  mastery: "UNRATED" | "MASTERED" | "UNMASTERED";
  reviewDueAt?: string;
  reviewStep: number;
}

export interface SavedLearningUnit {
  id: string;
  title: string;
  sourceTranscript: string;
  englishParagraph: string;
  savedAt: string;
  isFavorite: boolean;
  sentences: SavedSentence[];
}

interface UnitRow {
  id: string;
  title: string;
  source_transcript: string;
  english_paragraph: string;
  saved_at: string;
  is_favorite: number;
}

interface SentenceRow {
  sequence: number;
  english_text: string;
  chinese_meaning: string;
  audio_uri: string;
  mastery: SavedSentence["mastery"];
  review_due_at: string | null;
  review_step: number;
}

interface SaveLearningUnitInput {
  title: string;
  sourceTranscript: string;
  englishParagraph: string;
  sentences: {
    sequence: number;
    englishText: string;
    chineseMeaning: string;
  }[];
  audios: { sequence: number; audioUrl: string }[];
}

let databasePromise: ReturnType<typeof SQLite.openDatabaseAsync> | undefined;

async function getDatabase() {
  databasePromise ??= SQLite.openDatabaseAsync("spoken-english.db");
  const database = await databasePromise;
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS learning_units (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      source_transcript TEXT NOT NULL,
      english_paragraph TEXT NOT NULL,
      saved_at TEXT NOT NULL,
      is_favorite INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS learning_sentences (
      unit_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      english_text TEXT NOT NULL,
      chinese_meaning TEXT NOT NULL,
      audio_uri TEXT NOT NULL,
      mastery TEXT NOT NULL DEFAULT 'UNRATED',
      review_due_at TEXT,
      review_step INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (unit_id, sequence),
      FOREIGN KEY (unit_id) REFERENCES learning_units(id) ON DELETE CASCADE
    );
  `);
  await ensureColumn(
    database,
    "learning_units",
    "is_favorite",
    "INTEGER NOT NULL DEFAULT 0",
  );
  await ensureColumn(database, "learning_sentences", "review_due_at", "TEXT");
  await ensureColumn(
    database,
    "learning_sentences",
    "review_step",
    "INTEGER NOT NULL DEFAULT 0",
  );
  await ensureColumn(
    database,
    "learning_sentences",
    "mastery",
    "TEXT NOT NULL DEFAULT 'UNRATED'",
  );
  return database;
}

export async function listLearningUnits(): Promise<SavedLearningUnit[]> {
  const database = await getDatabase();
  const units = await database.getAllAsync<UnitRow>(
    "SELECT * FROM learning_units ORDER BY saved_at DESC",
  );

  return Promise.all(
    units.map(async (unit) => {
      const sentences = await database.getAllAsync<SentenceRow>(
        "SELECT sequence, english_text, chinese_meaning, audio_uri, mastery, review_due_at, review_step FROM learning_sentences WHERE unit_id = ? ORDER BY sequence",
        unit.id,
      );
      return {
        id: unit.id,
        title: unit.title,
        sourceTranscript: unit.source_transcript,
        englishParagraph: unit.english_paragraph,
        savedAt: unit.saved_at,
        isFavorite: unit.is_favorite === 1,
        sentences: sentences.map((sentence) => ({
          sequence: sentence.sequence,
          englishText: sentence.english_text,
          chineseMeaning: sentence.chinese_meaning,
          audioUri: sentence.audio_uri,
          mastery: sentence.mastery,
          reviewDueAt: sentence.review_due_at ?? undefined,
          reviewStep: sentence.review_step ?? 0,
        })),
      };
    }),
  );
}

export async function saveLearningUnit(
  input: SaveLearningUnitInput,
): Promise<SavedLearningUnit> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const savedAt = new Date().toISOString();
  const audioBySequence = new Map(
    input.audios.map((audio) => [audio.sequence, audio.audioUrl]),
  );
  const unitDirectory = new Directory(Paths.document, "learning-units", id);
  unitDirectory.create({ intermediates: true, idempotent: true });

  const sentences = await Promise.all(
    input.sentences.map(async (sentence) => {
      const audioUrl = audioBySequence.get(sentence.sequence);
      if (!audioUrl) throw new Error(`第 ${sentence.sequence} 句缺少发音文件`);

      const localFile = new File(unitDirectory, `${sentence.sequence}.mp3`);
      const downloaded = await File.downloadFileAsync(audioUrl, localFile, {
        idempotent: true,
      });
      return {
        ...sentence,
        audioUri: downloaded.uri,
        mastery: "UNRATED" as const,
        reviewStep: 0,
      };
    }),
  );

  const database = await getDatabase();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      "INSERT INTO learning_units (id, title, source_transcript, english_paragraph, saved_at) VALUES (?, ?, ?, ?, ?)",
      id,
      input.title,
      input.sourceTranscript,
      input.englishParagraph,
      savedAt,
    );
    for (const sentence of sentences) {
      await transaction.runAsync(
        "INSERT INTO learning_sentences (unit_id, sequence, english_text, chinese_meaning, audio_uri) VALUES (?, ?, ?, ?, ?)",
        id,
        sentence.sequence,
        sentence.englishText,
        sentence.chineseMeaning,
        sentence.audioUri,
      );
    }
  });

  return {
    id,
    title: input.title,
    sourceTranscript: input.sourceTranscript,
    englishParagraph: input.englishParagraph,
    savedAt,
    isFavorite: false,
    sentences,
  };
}

export async function setLearningUnitFavorite(id: string, isFavorite: boolean) {
  const database = await getDatabase();
  await database.runAsync(
    "UPDATE learning_units SET is_favorite = ? WHERE id = ?",
    isFavorite ? 1 : 0,
    id,
  );
}

export async function deleteLearningUnit(id: string) {
  const database = await getDatabase();
  await database.runAsync("DELETE FROM learning_units WHERE id = ?", id);

  const unitDirectory = new Directory(Paths.document, "learning-units", id);
  if (unitDirectory.exists) {
    unitDirectory.delete();
  }
}

export async function setSentenceMastery(
  unitId: string,
  sequence: number,
  mastery: SavedSentence["mastery"],
) {
  const database = await getDatabase();
  await database.runAsync(
    "UPDATE learning_sentences SET mastery = ?, review_due_at = NULL, review_step = 0 WHERE unit_id = ? AND sequence = ?",
    mastery,
    unitId,
    sequence,
  );
}

/** Replaces local copies of units received from the user's own cloud backup. */
export async function upsertLearningUnitsFromCloud(
  units: SavedLearningUnit[],
) {
  const database = await getDatabase();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    for (const unit of units) {
      await transaction.runAsync(
        `INSERT INTO learning_units (id, title, source_transcript, english_paragraph, saved_at, is_favorite)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           source_transcript = excluded.source_transcript,
           english_paragraph = excluded.english_paragraph,
           saved_at = excluded.saved_at,
           is_favorite = excluded.is_favorite`,
        unit.id,
        unit.title,
        unit.sourceTranscript,
        unit.englishParagraph,
        unit.savedAt,
        unit.isFavorite ? 1 : 0,
      );
      for (const sentence of unit.sentences) {
        await transaction.runAsync(
          `INSERT INTO learning_sentences (unit_id, sequence, english_text, chinese_meaning, audio_uri, mastery, review_due_at, review_step)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(unit_id, sequence) DO UPDATE SET
             english_text = excluded.english_text,
             chinese_meaning = excluded.chinese_meaning,
             audio_uri = excluded.audio_uri,
             mastery = excluded.mastery,
             review_due_at = excluded.review_due_at,
             review_step = excluded.review_step`,
          unit.id,
          sentence.sequence,
          sentence.englishText,
          sentence.chineseMeaning,
          sentence.audioUri,
          sentence.mastery,
          sentence.reviewDueAt ?? null,
          sentence.reviewStep,
        );
      }
    }
  });
}

async function ensureColumn(
  database: SQLite.SQLiteDatabase,
  table: string,
  column: string,
  definition: string,
) {
  const columns = await database.getAllAsync<{ name: string }>(
    `PRAGMA table_info(${table})`,
  );
  if (!columns.some((item) => item.name === column)) {
    await database.execAsync(
      `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`,
    );
  }
}
