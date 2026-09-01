import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GenerationsController } from './generations/generations.controller';
import { GenerationsService } from './generations/generations.service';
import { DictionaryController } from './dictionary/dictionary.controller';
import { DictionaryService } from './dictionary/dictionary.service';
import { SpeechController } from './speech/speech.controller';
import { SpeechService } from './speech/speech.service';
import { TranscriptionsController } from './transcriptions/transcriptions.controller';
import { TranscriptionsService } from './transcriptions/transcriptions.service';
import { RequestRateLimitGuard } from './common/request-rate-limit.guard';

@Module({
  imports: [],
  controllers: [
    AppController,
    TranscriptionsController,
    GenerationsController,
    DictionaryController,
    SpeechController,
  ],
  providers: [
    AppService,
    TranscriptionsService,
    GenerationsService,
    DictionaryService,
    SpeechService,
    RequestRateLimitGuard,
  ],
})
export class AppModule {}
