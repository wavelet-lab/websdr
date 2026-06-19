import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { JwtModuleOptions } from '@nestjs/jwt';
import type { Algorithm } from 'jsonwebtoken';
import type ms from 'ms';

export const JWT_CONFIG = 'JWT_CONFIG';

const SUPPORTED_JWT_ALGORITHMS = new Set<Algorithm>([
    'HS256', 'HS384', 'HS512',
    'RS256', 'RS384', 'RS512',
    'ES256', 'ES384', 'ES512',
    'PS256', 'PS384', 'PS512',
]);

export interface JwtConfig extends JwtModuleOptions {
    secret: string;
    signOptions: {
        algorithm: Algorithm;
        expiresIn: ms.StringValue | number;
    };
    verifyOptions: {
        algorithms: Algorithm[];
    };
}

export function createJwtConfig(config: ConfigService): JwtConfig {
    const secret = config.get<string>('JWT_SECRET')
        || 'just_a_demo_secret_key_you_should_change_me';
    const algorithm = config.get<string>('JWT_ALGORITHM') || 'HS256';

    if (!SUPPORTED_JWT_ALGORITHMS.has(algorithm as Algorithm)) {
        throw new Error(`Unsupported JWT_ALGORITHM: ${algorithm}`);
    }

    const jwtAlgorithm = algorithm as Algorithm;
    return {
        secret,
        signOptions: {
            algorithm: jwtAlgorithm,
            expiresIn: (config.get<string>('JWT_EXPIRES_IN') || '1h') as ms.StringValue,
        },
        verifyOptions: {
            algorithms: [jwtAlgorithm],
        },
    };
}

@Module({
    imports: [ConfigModule],
    providers: [
        {
            provide: JWT_CONFIG,
            inject: [ConfigService],
            useFactory: createJwtConfig,
        },
    ],
    exports: [JWT_CONFIG],
})
export class JwtConfigModule { }
