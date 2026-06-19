import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createJwtConfig } from '@/auth/jwt-config.module';

describe('createJwtConfig', () => {
    it('uses HS256 and a one-hour expiry by default', () => {
        const config = new ConfigService({});

        expect(createJwtConfig(config)).toEqual({
            secret: 'just_a_demo_secret_key_you_should_change_me',
            signOptions: {
                algorithm: 'HS256',
                expiresIn: '1h',
            },
            verifyOptions: {
                algorithms: ['HS256'],
            },
        });
    });

    it('applies the configured algorithm to signing and verification', () => {
        const config = new ConfigService({
            JWT_SECRET: 'test-secret',
            JWT_ALGORITHM: 'HS512',
            JWT_EXPIRES_IN: '15m',
        });

        expect(createJwtConfig(config)).toEqual({
            secret: 'test-secret',
            signOptions: {
                algorithm: 'HS512',
                expiresIn: '15m',
            },
            verifyOptions: {
                algorithms: ['HS512'],
            },
        });
    });

    it('uses the configured algorithm in an issued token', async () => {
        const jwtConfig = createJwtConfig(new ConfigService({
            JWT_SECRET: 'test-secret',
            JWT_ALGORITHM: 'HS512',
        }));
        const jwtService = new JwtService(jwtConfig);

        const token = await jwtService.signAsync({ sub: '123' });
        const decoded = jwtService.decode(token, { complete: true });

        expect(decoded?.header.alg).toBe('HS512');
        await expect(jwtService.verifyAsync(token)).resolves.toMatchObject({
            sub: '123',
        });
    });

    it('rejects unsupported algorithms', () => {
        const config = new ConfigService({
            JWT_ALGORITHM: 'none',
        });

        expect(() => createJwtConfig(config)).toThrow(
            'Unsupported JWT_ALGORITHM: none',
        );
    });
});
