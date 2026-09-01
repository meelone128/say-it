import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { RequestRateLimitGuard } from '../common/request-rate-limit.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  TranscriptionsService,
  type AudioUpload,
} from './transcriptions.service';

const MAX_AUDIO_BYTES = 7 * 1024 * 1024;
const ALLOWED_AUDIO_TYPES = new Set([
  'audio/aac',
  'audio/m4a',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/opus',
  'audio/wav',
  'audio/webm',
  'application/octet-stream',
]);

@Controller('transcriptions')
@UseGuards(RequestRateLimitGuard)
export class TranscriptionsController {
  constructor(private readonly transcriptionsService: TranscriptionsService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('audio', {
      limits: { fileSize: MAX_AUDIO_BYTES, files: 1 },
      fileFilter: (_request, file, callback) => {
        if (!ALLOWED_AUDIO_TYPES.has(file.mimetype)) {
          callback(new BadRequestException('仅支持常见音频文件'), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  transcribe(@UploadedFile() audio?: AudioUpload) {
    if (!audio?.buffer?.length) {
      throw new BadRequestException('请上传录音文件');
    }

    return this.transcriptionsService.transcribe(audio);
  }
}
