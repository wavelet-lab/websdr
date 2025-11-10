import { describe, it, expect } from 'vitest';
import { UsersService, OmitPassword } from '@/users/users.service';
import type { User } from '@/users/users.service';

describe('UsersService', () => {
    const service = new UsersService();

    it('findUser returns full user with password', async () => {
        const user = await service.findUser('admin');
        expect(user).toMatchObject({ username: 'admin', password: 'admin' });
    });

    it('findSafeUser omits password', async () => {
        const user = await service.findSafeUser('admin');
        expect(user).toMatchObject({ username: 'admin', name: 'Administrator' });
        // @ts-expect-error password should be omitted
        expect(user.password).toBeUndefined();
    });

    it('findUserById returns full user', async () => {
        const user = await service.findUserById(2);
        expect(user).toMatchObject({ id: 2, username: 'user', password: 'user' });
    });

    it('findSafeUserById omits password', async () => {
        const user = await service.findSafeUserById(2);
        expect(user).toMatchObject({ id: 2, username: 'user', name: 'User' });
        // @ts-expect-error password should be omitted
        expect(user.password).toBeUndefined();
    });

    it('findSafeUser returns undefined for unknown username', async () => {
        const user = await service.findSafeUser('nope');
        expect(user).toBeUndefined();
    });

    it('generateUserId returns valid UUID v4', () => {
        const id = service.generateUserId();
        const uuidV4Regex =
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        expect(id).toMatch(uuidV4Regex);
    });
});

describe('OmitPassword decorator (standalone behavior)', () => {
    class TestService {
        private data: User[] = [
            { id: 1, username: 'a', password: 'pa', name: 'A' },
            { id: 2, username: 'b', password: 'pb', name: 'B' },
        ];

        @OmitPassword()
        getOneSync(): User {
            return this.data[0]!;
        }

        @OmitPassword()
        getOneAsync(): Promise<User> {
            return Promise.resolve(this.data[1]!);
        }

        @OmitPassword()
        getArray(): User[] {
            return this.data;
        }

        @OmitPassword()
        getArrayAsync(): Promise<User[]> {
            return Promise.resolve(this.data);
        }

        @OmitPassword()
        getNull(): User | null {
            return null;
        }

        @OmitPassword()
        throws(): User {
            throw new Error('Failure');
        }
    }

    const ts = new TestService();

    it('removes password from sync single user', () => {
        const u = ts.getOneSync();
        expect(u.password).toBeUndefined();
        expect(u.username).toBe('a');
    });

    it('removes password from async single user', async () => {
        const u = await ts.getOneAsync();
        expect(u.password).toBeUndefined();
        expect(u.username).toBe('b');
    });

    it('removes password from array', () => {
        const arr = ts.getArray();
        expect(arr).toHaveLength(2);
        arr.forEach(u => {
            expect(u.password).toBeUndefined();
        });
    });

    it('removes password from async array', async () => {
        const arr = await ts.getArrayAsync();
        expect(arr).toHaveLength(2);
        arr.forEach(u => {
            expect(u.password).toBeUndefined();
        });
    });

    it('returns null unchanged', () => {
        expect(ts.getNull()).toBeNull();
    });

    it('re-throws errors', () => {
        expect(() => ts.throws()).toThrow('Failure');
    });
});