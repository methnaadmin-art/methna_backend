import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
    Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

const SLOW_THRESHOLD_MS = 500;
const CRITICAL_THRESHOLD_MS = 2000;

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
    private readonly logger = new Logger(LoggingInterceptor.name);

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const request = context.switchToHttp().getRequest();
        const method = request.method;
        const url = request.url;
        const userId = request.user?.sub || 'anon';
        const now = Date.now();

        return next.handle().pipe(
            tap(() => {
                const ms = Date.now() - now;
                if (ms < SLOW_THRESHOLD_MS) {
                    return;
                }

                const tag = ms >= CRITICAL_THRESHOLD_MS
                    ? '🔴 CRITICAL'
                    : ms >= SLOW_THRESHOLD_MS
                        ? '🟡 SLOW'
                        : '✅';
                const msg = `${tag} ${method} ${url} - ${ms}ms [user:${userId}]`;
                if (ms >= CRITICAL_THRESHOLD_MS) {
                    this.logger.error(msg);
                } else {
                    this.logger.warn(msg);
                }
            }),
        );
    }
}
