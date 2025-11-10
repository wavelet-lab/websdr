import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';

// Mock the AuthService module to avoid loading real implementation via path alias
vi.mock('@/auth/auth.service', () => {
    class AuthService { }
    return { AuthService };
});


describe('JwtAuthGuard constructor', () => {
    it('should create an instance', () => {
        const mockAuthService = { isRevoked: vi.fn() };
        const guard = new JwtAuthGuard(mockAuthService as any);
        expect(guard).toBeInstanceOf(JwtAuthGuard);
    });

    it('should assign provided AuthService to instance', () => {
        const mockAuthService = { isRevoked: vi.fn() };
        const guard = new JwtAuthGuard(mockAuthService as any);
        expect((guard as any).authService).toBe(mockAuthService);
    });

    // Mock the AuthService module to avoid loading real implementation via path alias
    vi.mock('@/auth/auth.service', () => {
        class AuthService { }
        return { AuthService };
    });

    const makeContext = (req: any): ExecutionContext =>
    ({
        switchToHttp: () => ({
            getRequest: () => req,
        }),
    } as any);

    describe('JwtAuthGuard canActivate', () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('returns false when super.canActivate returns false', async () => {
            const mockAuthService = { isRevoked: vi.fn() };
            const guard = new JwtAuthGuard(mockAuthService as any);

            const parentProto = Object.getPrototypeOf(JwtAuthGuard.prototype);
            const superSpy = vi
                .spyOn(parentProto, 'canActivate')
                .mockResolvedValue(false as any);

            const req = { cookies: {}, headers: {} };
            const ctx = makeContext(req);

            const result = await guard.canActivate(ctx);
            expect(result).toBe(false);
            expect(superSpy).toHaveBeenCalledTimes(1);
            expect(mockAuthService.isRevoked).not.toHaveBeenCalled();
        });

        it('throws UnauthorizedException with "No token" when token missing', async () => {
            const mockAuthService = { isRevoked: vi.fn() };
            const guard = new JwtAuthGuard(mockAuthService as any);

            const parentProto = Object.getPrototypeOf(JwtAuthGuard.prototype);
            vi.spyOn(parentProto, 'canActivate').mockResolvedValue(true as any);

            const req = { cookies: {}, headers: {} };
            const ctx = makeContext(req);

            await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
            try {
                await guard.canActivate(ctx);
            } catch (e: any) {
                const res = typeof e.getResponse === 'function' ? e.getResponse() : undefined;
                if (res && typeof res === 'object') {
                    expect((res as any).message).toBe('No token');
                }
            }
            expect(mockAuthService.isRevoked).not.toHaveBeenCalled();
        });

        it('uses token from cookies and returns true when not revoked', async () => {
            const mockAuthService = { isRevoked: vi.fn().mockResolvedValue(false) };
            const guard = new JwtAuthGuard(mockAuthService as any);

            const parentProto = Object.getPrototypeOf(JwtAuthGuard.prototype);
            vi.spyOn(parentProto, 'canActivate').mockResolvedValue(true as any);

            const token = 'cookie-token';
            const req = { cookies: { jwt: token }, headers: {} };
            const ctx = makeContext(req);

            const result = await guard.canActivate(ctx);
            expect(result).toBe(true);
            expect(mockAuthService.isRevoked).toHaveBeenCalledWith(token);
        });

        it('uses token from Authorization header and throws when revoked', async () => {
            const mockAuthService = { isRevoked: vi.fn().mockResolvedValue(true) };
            const guard = new JwtAuthGuard(mockAuthService as any);

            const parentProto = Object.getPrototypeOf(JwtAuthGuard.prototype);
            vi.spyOn(parentProto, 'canActivate').mockResolvedValue(true as any);

            const token = 'header-token';
            const req = { cookies: {}, headers: { authorization: `Bearer ${token}` } };
            const ctx = makeContext(req);

            await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
            try {
                await guard.canActivate(ctx);
            } catch (e: any) {
                const res = typeof e.getResponse === 'function' ? e.getResponse() : undefined;
                if (res && typeof res === 'object') {
                    expect((res as any).message).toBe('Token revoked');
                }
            }
            expect(mockAuthService.isRevoked).toHaveBeenCalledWith(token);
        });

        it('treats non-Bearer Authorization header as missing token', async () => {
            const mockAuthService = { isRevoked: vi.fn() };
            const guard = new JwtAuthGuard(mockAuthService as any);

            const parentProto = Object.getPrototypeOf(JwtAuthGuard.prototype);
            vi.spyOn(parentProto, 'canActivate').mockResolvedValue(true as any);

            const req = { cookies: {}, headers: { authorization: 'Basic xyz' } };
            const ctx = makeContext(req);

            await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
            expect(mockAuthService.isRevoked).not.toHaveBeenCalled();
        });
    });

    describe('JwtAuthGuard handleRequest', () => {
        it('returns user when no error and user present', () => {
            const guard = new JwtAuthGuard({ isRevoked: vi.fn() } as any);
            const user = { id: 1 };
            expect(guard.handleRequest(null, user, null)).toBe(user);
        });

        it('throws provided error when error present', () => {
            const guard = new JwtAuthGuard({ isRevoked: vi.fn() } as any);
            const err = new Error('boom');
            expect(() => guard.handleRequest(err, null, null)).toThrow(err);
        });

        it('throws UnauthorizedException when no user and no error', () => {
            const guard = new JwtAuthGuard({ isRevoked: vi.fn() } as any);
            expect(() => guard.handleRequest(null, null, null)).toThrow(UnauthorizedException);
        });
    });
});