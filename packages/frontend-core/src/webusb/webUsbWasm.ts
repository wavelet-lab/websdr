// import type { ControlModule } from '@/control/control'
import { WebUsb } from './webUsbBase'

const debug_webusbwasm = false;

/**
 * WASM-backed `WebUsb` implementation. Contains the legacy implementation
 * that uses the Emscripten/ControlModule (`send_command`) to talk to
 * firmware. Concrete drivers that rely on the wasm control module should
 * extend this class.
 */
export abstract class WebUsbWasm extends WebUsb {
    /** Emscripten/wasm control module exposing helper functions. */
    // module: ControlModule | undefined; //!!! TODO: it should be here

    /**
     * Implement the abstract hook using the wasm control module.
     */
    async sendCommandToDevice(req: Record<string, any>): Promise<Record<string, any>> {
        let ret: Record<string, any> = {};
        if (!this.module || !this.device) return { error: -1 };
        const in_cmd = this.module._malloc(512);
        const out_res = this.module._malloc(512);
        const req_str = JSON.stringify(req);
        this.module.stringToAscii(req_str, in_cmd);
        if (debug_webusbwasm) {
            this._start_ms = Date.now();
            console.log('1. WebUsbWasm.sendCommandToDevice: req = ', req)
        }
        const res = await this.module.ccall("send_command", "number", ["number", "number", "number", "number", "number"],
            [this.fd, in_cmd, req_str.length, out_res, 512], { async: true }
        );
        if (debug_webusbwasm) {
            this._end_ms = Date.now();
            console.log('2. WebUsbWasm.sendCommandToDevice: res = ', res, 'duration', this._end_ms - this._start_ms)
        }

        if (res != 0) {
            ret = { error: res };
        } else {
            const out_res_str = this.module.AsciiToString(out_res)
            ret = await JSON.parse(out_res_str);
        }

        this.module._free(in_cmd);
        this.module._free(out_res);

        return ret;
    }

    /**
     * Implement the abstract debug method by delegating to the WASM helper.
     */
    async sendDebugCommandToDevice(req: string): Promise<string> {
        if (!this.module || !this.device) return 'Error: module or device is undefined';
        const in_cmd = this.module._malloc(4096);
        const out_res = this.module._malloc(4096);
        this.module.stringToAscii(req, in_cmd);
        const res = await this.module.ccall("send_debug_command", "number", ["number", "number", "number", "number", "number"],
            [this.fd, in_cmd, req.length, out_res, 4096], { async: true }
        );

        const ret = this.module.AsciiToString(out_res)

        this.module._free(in_cmd);
        this.module._free(out_res);

        if (debug_webusbwasm) console.log('wasmSendDebugCommand("', req, '") => ', res, ': ', ret);
        return ret;
    }

    async open(): Promise<boolean> {
        if (!this.module) {
            console.error('Control module is not initialized');
            return false;
        }
        return super.open();
    }
}
