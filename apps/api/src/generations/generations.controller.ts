import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { GenerationsService } from './generations.service';

interface GenerationRequest {
  sourceTranscript?: unknown;
}

@Controller('generations')
export class GenerationsController {
  constructor(private readonly generationsService: GenerationsService) {}

  @Post()
  generate(@Body() body: GenerationRequest) {
    if (
      typeof body?.sourceTranscript !== 'string' ||
      !body.sourceTranscript.trim()
    ) {
      throw new BadRequestException('请先确认中文内容');
    }

    const sourceTranscript = body.sourceTranscript.trim();
    if (sourceTranscript.length > 2000) {
      throw new BadRequestException('中文内容过长，请控制在 2000 字以内');
    }

    return this.generationsService.generate(sourceTranscript);
  }
}
