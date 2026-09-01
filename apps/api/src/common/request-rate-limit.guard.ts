import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

const WINDOW_MS = 60_000;

function limitFor(path: string) {
  if (path.endsWith('/speech')) return 6;
  if (path.endsWith('/transcriptions')) return 8;
  if (path.endsWith('/generations')) return 8;
  if (path.endsWith('/dictionary')) return 30;
  return 20;
}

/**
 * Keeps the public guest experience available while preventing one source from
 * rapidly exhausting the shared AI quota. Per-account limits can replace this
 * when AI generation becomes login-only.
 */
@Injectable()
export class RequestRateLimitGuard implements CanActivate {
  private readonly requests = new Map<string, number[]>();

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const path = request.path || request.originalUrl || '';
    const key = `${request.ip}:${path}`;
    const now = Date.now();
    const recent = (this.requests.get(key) ?? []).filter(
      (timestamp) => now - timestamp < WINDOW_MS,
    );

    if (recent.length >= limitFor(path)) {
      throw new HttpException(
        '操作太频繁，请稍等一分钟后再试',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    recent.push(now);
    this.requests.set(key, recent);
    return true;
  }
}
