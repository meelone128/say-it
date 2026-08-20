export type ProcessingStatus =
  | 'UPLOADING'
  | 'TRANSCRIBING'
  | 'AWAITING_TRANSCRIPT_CONFIRMATION'
  | 'GENERATING_ENGLISH'
  | 'GENERATING_AUDIO'
  | 'READY'
  | 'FAILED';

export type SentenceMastery = 'UNRATED' | 'MASTERED' | 'UNMASTERED';

export interface LearningSentence {
  id: string;
  sequence: number;
  englishText: string;
  chineseMeaning: string;
  audioUrl: string | null;
  mastery: SentenceMastery;
}

export interface LearningUnit {
  id: string;
  title: string;
  sourceTranscript: string;
  status: ProcessingStatus;
  isFavorite: boolean;
  savedAt: string;
  sentences: LearningSentence[];
}

export interface HealthResponse {
  status: 'ok';
  service: 'spoken-english-api';
}
