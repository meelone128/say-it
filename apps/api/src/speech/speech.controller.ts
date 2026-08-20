import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { SpeechService } from './speech.service';

interface SpeechRequest {
  sentences?: unknown;
}

@Controller('speech')
export class SpeechController {
  constructor(private readonly speechService: SpeechService) {}

  @Post()
  synthesize(@Body() body: SpeechRequest) {
    if (!Array.isArray(body?.sentences) || body.sentences.length === 0) {
      throw new BadRequestException('请提供需要朗读的英语句子');
    }
    if (body.sentences.length > 12) {
      throw new BadRequestException('一次最多生成 12 句话的发音');
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
