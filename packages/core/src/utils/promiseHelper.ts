export class PromiseHelper {
    protected _promiseMap: Map<number, Record<string, any>> = new Map<number, Record<string, any>>();
    protected _promiseMapId: number = 0;

    createPromise<T>(): [number, Promise<T>] {
        ++this._promiseMapId;
        return [
            this._promiseMapId,
            new Promise<T>((resolve, reject) => {
                this._promiseMap.set(this._promiseMapId, { resolve: resolve, reject: reject });
            })
        ];
    }

    clear() {
        this._promiseMap = new Map<number, Record<string, any>>();
        this._promiseMapId = 0;
    }

    getPromise(id: number) {
        return this._promiseMap.get(id);
    }

    deletePromise(id: number) {
        return this._promiseMap.delete(id);
    }

    promiseResolve(promise: Record<string, any>, res?: any) {
        if (promise && promise.resolve)
            promise.resolve(res);
    }

    promiseReject(promise: Record<string, any>, res?: any) {
        if (promise && promise.reject)
            promise.reject(res);
    }
}