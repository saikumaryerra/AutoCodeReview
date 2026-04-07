import winston from 'winston';
import path from 'path';

const LOG_DIR = path.resolve(process.env.REPOS_DIR || './data', '..', 'logs');

export const logger = winston.createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'pr-review' },
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ timestamp, level, message, module, ...rest }) => {
                    const mod = module ? `[${module}]` : '';
                    const extra = Object.keys(rest).length > 1 ? ` ${JSON.stringify(rest)}` : '';
                    return `${timestamp} ${level} ${mod} ${message}${extra}`;
                })
            ),
        }),
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'app.log'),
            maxsize: 10 * 1024 * 1024, // 10MB
            maxFiles: 5,
            tailable: true,
        }),
    ],
});

export function createModuleLogger(module: string) {
    return logger.child({ module });
}
