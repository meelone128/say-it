import {
  HttpException,
  HttpStatus,
  type ExecutionContext,
} from '@nestjs/common';
import { RequestRateLimitGuard } from './request-rate-limit.guard';

function requestContext(path: string, ip = '203.0.113.10') {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ path, originalUrl: path, ip }),
    }),
  } as unknown as ExecutionContext;
}

describe('RequestRateLimitGuard', () => {
  it('allows normal requests but blocks repeated speech requests from one source', () => {
    const guard = new RequestRateLimitGuard();
    const context = requestContext('/api/v1/speech');

    for (let index = 0; index < 6; index += 1) {
      expect(guard.canActivate(context)).toBe(true);
    }

    expect(() => guard.canActivate(context)).toThrow(HttpException);
    try {
      guard.canActivate(context);
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  });
});
