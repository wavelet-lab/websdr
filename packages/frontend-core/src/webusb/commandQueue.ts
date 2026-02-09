import { CircularBuffer } from '@websdr/core/utils';

/**
 * Command queue item
 */
export interface CommandRequest<T = Record<string, any>> {
    req: T;
    resolve?: (rep: Record<string, any>) => void;
    reject?: (err: any) => void;
}

/**
 * Simple command queue that serially processes JSON commands via the
 * provided handler. Each pushed command returns a Promise that resolves
 * or rejects depending on the handler's result.
 */
export class CommandQueue {
    private _commands: CircularBuffer<CommandRequest>;
    private _running = false;
    private _handler: (req: Record<string, any>) => Promise<Record<string, any>>;

    constructor(handler: (req: Record<string, any>) => Promise<Record<string, any>>, size: number = 100) {
        this._commands = new CircularBuffer<CommandRequest>(size);
        this._handler = handler;
    }

    push(req: Record<string, any>): Promise<Record<string, any>> {
        const com: CommandRequest = { req };
        const p = new Promise<Record<string, any>>((resolve, reject) => {
            com.resolve = resolve;
            com.reject = reject;
        });
        this._commands.push_back(com);
        // start processing loop
        void this._run();
        return p;
    }

    clear() {
        this._commands.clear();
    }

    private async _run() {
        if (this._running) return;
        this._running = true;
        while (!this._commands.isEmpty()) {
            const com = this._commands.front();
            if (com) {
                try {
                    const rep = await this._handler(com.req);
                    if ((rep as any)['error'] !== undefined) {
                        const err = (rep as any)['error'];
                        const errmsg = `CommandQueue: Reply to command '${JSON.stringify(com.req)}' contains error: ${err}`;
                        com.reject?.(errmsg);
                    } else {
                        com.resolve?.(rep);
                    }
                } catch (err) {
                    const errmsg = `CommandQueue: Reply to command '${JSON.stringify(com.req)}' exception: ${err}`;
                    com.reject?.(errmsg);
                }
            }
            this._commands.pop_front();
        }
        this._running = false;
    }
}
