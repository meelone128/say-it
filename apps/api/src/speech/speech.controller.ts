import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RequestRateLimitGuard } from '../common/request-rate-limit.guard';
import { SpeechService } from './speech.service';

interface SpeechRequest {
  sentences?: unknown;
}

@Controller('speech')
@UseGuards(RequestRateLimitGuard)
export class SpeechController {
  constructor(private readonly speechService: SpeechService) {}

  @Post()
  synthesize(@Body() body: SpeechRequest) {
    if (!Array.isArray(body?.sentences) || body.sentences.length === 0) {
      throw new BadRequestException('请提供需要朗读的英语句子');
    }
    if (body.sentences.length > 30) {
      throw new BadRequestException('一次最多生成 30 句话的发音');
    }

    const sentences = body.sentences.map((value) => {
      if (typeof value !== 'string' || !value.trim() || value.length > 500) {
        throw new BadRequestException('英语句子内容无效');
      }
      return value.trim();
    });

    return this.speechService.synthesize(sentences);
  }
}
