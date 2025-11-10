import { describe, it, expect, beforeEach } from 'vitest';
import { PromiseHelper } from '@/utils/promiseHelper';

describe('PromiseHelper', () => {
    let ph: PromiseHelper;

    beforeEach(() => {
        ph = new PromiseHelper();
    });

    it('createPromise returns increasing ids and promise resolves via promiseResolve', async () => {
        const [id1, p1] = ph.createPromise<string>();
        const [id2, p2] = ph.createPromise<number>();

        expect(id2).toBeGreaterThan(id1);

        const ref1 = ph.getPromise(id1);
        expect(ref1).toBeDefined();
        // resolve
        ph.promiseResolve(ref1!, 'ok');
        await expect(p1).resolves.toBe('ok');

        const ref2 = ph.getPromise(id2);
        expect(ref2).toBeDefined();
        ph.promiseResolve(ref2!, 42);
        await expect(p2).resolves.toBe(42);
    });

    it('promiseReject rejects promise via promiseReject', async () => {
        const [id, p] = ph.createPromise<void>();
        const ref = ph.getPromise(id);
        expect(ref).toBeDefined();

        ph.promiseReject(ref!, new Error('fail'));
        await expect(p).rejects.toThrow('fail');
    });

    it('deletePromise removes stored promise and returns boolean', () => {
        const [id] = ph.createPromise<void>();
        expect(ph.getPromise(id)).toBeDefined();
        const deleted = ph.deletePromise(id);
        expect(deleted).toBe(true);
        expect(ph.getPromise(id)).toBeUndefined();
        // deleting non-existent id returns false
        expect(ph.deletePromise(9999)).toBe(false);
    });

    it('clear resets internal map and id counter', () => {
        const [id] = ph.createPromise<void>();
        expect(ph.getPromise(id)).toBeDefined();
        ph.clear();
        expect(ph.getPromise(id)).toBeUndefined();

        const [newId] = ph.createPromise<void>();
        // after clear id counter should restart from 1
        expect(newId).toBe(1);
    });

    it('promiseResolve / promiseReject are safe when given undefined', () => {
        // should not throw
        expect(() => ph.promiseResolve(undefined as any)).not.toThrow();
        expect(() => ph.promiseReject(undefined as any)).not.toThrow();
    });
});