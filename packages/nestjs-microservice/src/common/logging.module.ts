import { Module, Global } from '@nestjs/common';
import type { DynamicModule, LoggerService } from '@nestjs/common';
import { format } from 'util';
import { LOGGER } from './tokens';

export function createContextLogger(base: any, context: string): LoggerService {
    const call = (method: string, ...args: any[]) => {
        const fn = base?.[method] ?? base?.log;
        if (!fn) return;
        if (method === 'error' || method === 'fatal') {
            const [message, ...optionalParams] = args;
            const traceParam = optionalParams.length === 1 ? optionalParams[0] : undefined;
            const trace = traceParam instanceof Error ? traceParam.stack : traceParam;
            fn.call(base, message, trace, context);
        } else {
            const [message, ...optionalParams] = args;
            const formattedMessage = optionalParams.length > 0 ? format(message, ...optionalParams) : message;
            fn.call(base, formattedMessage, context);
        }
    };

    return {
        log: (msg: any, ...optionalParams: any[]) => call('log', msg, ...optionalParams),
        error: (msg: any, trace?: string) => call('error', msg, trace),
        fatal: (msg: any, trace?: string) => call('fatal', msg, trace),
        warn: (msg: any, ...optionalParams: any[]) => call('warn', msg, ...optionalParams),
        debug: (msg: any, ...optionalParams: any[]) => call('debug', msg, ...optionalParams),
        verbose: (msg: any, ...optionalParams: any[]) => call('verbose', msg, ...optionalParams),
    };
}


@Global()
@Module({})
export class LoggingModule {
    static forRoot(loggerInstance: unknown): DynamicModule {
        return {
            module: LoggingModule,
            providers: [
                {
                    provide: LOGGER,
                    useValue: loggerInstance
                }
            ],
            exports: [LOGGER],
        };
    }
}
