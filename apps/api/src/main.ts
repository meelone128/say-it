import { NestFactory } from '@nestjs/core';
import { resolve } from 'node:path';
import { AppModule } from './app.module';

async function bootstrap() {
  try {
    process.loadEnvFile(resolve(process.cwd(), '../../.env.local'));
  } catch {
    // Production environments inject variables directly and do not need this file.
  }

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: true,
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
void bootstrap();
