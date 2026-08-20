import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { DictionaryService } from './dictionary.service';

interface DictionaryRequest {
  word?: unknown;
  sentence?: unknown;
}

@Controller('dictionary')
export class DictionaryController {
  constructor(private readonly dictionaryService: DictionaryService) {}

  @Post()
  explain(@Body() body: DictionaryRequest) {
    if (typeof body?.word !== 'string' || !/^[a-z][a-z'-]*$/i.test(body.word.trim())) {
      throw new BadRequestException('请选择一个英文单词');
    }
    if (typeof body?.sentence !== 'string' || !body.sentence.trim()) {
      throw new BadRequestException('缺少单词所在的句子');
    }
    return this.dictionaryService.explain(
      body.word.trim(),
      body.sentence.trim().slice(0, 500),
    );
  }
}
