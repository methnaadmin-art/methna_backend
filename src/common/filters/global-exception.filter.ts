import {
    ExceptionFilter,
    Catch,
    ArgumentsHost,
    HttpException,
    HttpStatus,
    Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(GlobalExceptionFilter.name);

    catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const request = ctx.getRequest<Request>();

        let status = HttpStatus.INTERNAL_SERVER_ERROR;
        let message = 'Internal server error';
        let errors: any = null;
        let businessStatus: string | null = null;
        let extraPayload: Record<string, any> = {};

        if (exception instanceof HttpException) {
            status = exception.getStatus();
            const exceptionResponse = exception.getResponse();

            if (typeof exceptionResponse === 'string') {
                message = exceptionResponse;
            } else if (typeof exceptionResponse === 'object') {
                const resp = exceptionResponse as any;
                message = resp.message || message;
                errors = resp.errors || null;
                businessStatus = typeof resp.status === 'string' ? resp.status : null;

                const {
                    message: _message,
                    errors: _errors,
                    status: _status,
                    success: _success,
                    statusCode: _statusCode,
                    timestamp: _timestamp,
                    path: _path,
                    ...rest
                } = resp;
                extraPayload = rest;
            }
        } else if (exception instanceof Error) {
            // Log full error internally but never expose to client
            this.logger.error(
                `Unhandled exception: ${exception.message}`,
                exception.stack,
            );
            // In production, hide internal error details from response
            message = process.env.NODE_ENV === 'development'
                ? exception.message
                : 'Internal server error';
        }

        response.status(status).json({
            success: false,
            statusCode: status,
            status: businessStatus,
            message,
            errors,
            ...extraPayload,
            timestamp: new Date().toISOString(),
            path: request.url,
        });
    }
}
