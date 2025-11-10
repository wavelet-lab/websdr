import initControlModule from '@/control/control'
import type { ControlModule } from '@/control/control'
import type { WebUsb } from './webUsbBase';
import { getDeviceHash, getWebUsbInstance } from './webUsb';

declare global {
    var webUsbDeviceManager: WebUsbDeviceManager | undefined;
}

export async function initControl(overrides?: Partial<ControlModule>) {
    if (globalThis.controlModule === undefined)
        globalThis.controlModule = await initControlModule(overrides);
    if (globalThis.webUsbDeviceManager === undefined && globalThis.controlModule !== undefined) {
        globalThis.webUsbDeviceManager = new WebUsbDeviceManager({ module: globalThis.controlModule });
    }
    // console.log('MODULE', controlModule, 'WebUsbManager', globalThis.webUsbDeviceManager)
}

export function isControlInitialized(): boolean {
    return globalThis.controlModule !== undefined && globalThis.webUsbDeviceManager !== undefined;
}

export class WebUsbDeviceManager {
    public module: ControlModule | undefined;
    protected webUsbDevices: Array<WebUsb | undefined>;

    constructor(params: WebUsbManagerParams) {
        this.webUsbDevices = [];
        this.module = params.module;
    }

    async open(vid: number, pid: number): Promise<WebUsb | undefined> {
        if (!this.module) {
            console.error('Error: control module is not defined')
            return undefined;
        }

        for (let i = 0; i < this.webUsbDevices.length; ++i) {
            const dev = this.webUsbDevices[i];
            if (dev !== undefined && dev.vid === vid && dev.pid === pid) {
                //TODO: Replace with checking serial number when it will be actual
                // console.log('FOUND OPENED DEVICE', this.webUsbDevices[i])
                return this.webUsbDevices[i];
            }
        }

        let fd = -1
        for (let i = 0; i < this.webUsbDevices.length; ++i) {
            if (this.webUsbDevices[i] == undefined) {
                fd = i;
                break;
            }
        }
        // Next line means that we didn't find any free slot, so we replace the first one.
        // We can't add new one because it should consistently work with C side array.
        if (fd < 0) fd = 0;
        this.webUsbDevices[fd] = getWebUsbInstance(getDeviceHash({ vendorId: vid, productId: pid }), { fd: fd, module: this.module, vid: vid, pid: pid });
        if (this.webUsbDevices[fd] === undefined) {
            console.error(`Error: unsupported WebUSB device vid=0x${vid.toString(16)}, pid=0x${pid.toString(16)}`);
            return undefined;
        }
        await this.webUsbDevices[fd]?.open();
        return this.webUsbDevices[fd];
    }

    async close(fd: number): Promise<boolean> {
        if (fd < 0 || fd >= this.webUsbDevices.length || this.webUsbDevices[fd] == undefined) return false;
        await this.webUsbDevices[fd]?.close();
        this.webUsbDevices[fd] = undefined;
        return true;
    }

    async closeAll() {
        for (let fd = 0; fd < this.webUsbDevices.length; ++fd) {
            await this.close(fd);
        }
    }

    getDevice(fd: number): WebUsb | undefined {
        if (fd < 0 || fd >= this.webUsbDevices.length || this.webUsbDevices[fd] == undefined) return undefined;
        return this.webUsbDevices[fd];
    }

    getDevices(): Array<number> {
        const ret = new Array<number>();
        for (let i = 0; i < this.webUsbDevices.length; ++i) {
            const dev = this.webUsbDevices[i];
            if (dev !== undefined) ret.push(dev.fd);
        }

        return ret;
    }
}

export interface WebUsbManagerParams {
    module: ControlModule,
}
