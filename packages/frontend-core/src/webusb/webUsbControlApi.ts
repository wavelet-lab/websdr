import { WebUsbEndpoints } from "./webUsbBase";
// import { WASMErrno } from "@/common/wasmErrno";

const debug_ep_log = false;
const debug_write_log = false;

export async function write_ep1(fd: number, data: number, len: number): Promise<number> {
    // const start = Date.now();
    if (globalThis.debug_mode || debug_ep_log)
        console.log(`write_ep1(${fd}, ${data}, ${len}): `/* start = ${start}` */)
    const dev = globalThis.webUsbDeviceManager?.getDevice(fd);
    if (!dev || !dev.module || !dev.write) {
        console.error('write_ep1 error: dev = ', dev, 'webUsbWorkerManager', globalThis.webUsbDeviceManager, 'fd', fd)
        return 0;
    }
    const buf = new Uint8Array(dev.module.HEAPU8.buffer, ((data) >> 0), len);
    if (globalThis.debug_mode) console.log(buf.subarray(0, 10))
    dev.write(WebUsbEndpoints.CONTROL_EP, buf as BufferSource);
    // const end = Date.now();
    // console.log(`write_ep1(${fd}, ${data}, ${len}): duration = ${end - start}`)
    return len;
}

export async function write_ep2(fd: number, data: number, len: number): Promise<number> {
    // const start = Date.now();
    if (globalThis.debug_mode || debug_ep_log)
        console.log(`write_ep2(${fd}, ${data}, ${len}): `/* start = ${start}` */)
    const dev = globalThis.webUsbDeviceManager?.getDevice(fd);
    if (!dev || !dev.module || !dev.write) {
        console.error('write_ep2 error: dev = ', dev, 'webUsbWorkerManager', globalThis.webUsbDeviceManager, 'fd', fd)
        return 0;
    }
    const buf = new Uint8Array(dev.module.HEAPU8.buffer, ((data) >> 0), len);
    if (globalThis.debug_mode) console.log(buf.subarray(0, 10))
    dev.write(WebUsbEndpoints.NOTIFY_EP, buf as BufferSource);
    // const end = Date.now();
    // console.log(`write_ep2(${fd}, ${data}, ${len}): duration = ${end - start}`)
    return len;
}

export async function read_ep1(fd: number, data: number, len: number): Promise<number> {
    // const start = Date.now();
    if (globalThis.debug_mode || debug_ep_log)
        console.log(`read_ep1(${fd}, ${data}, ${len}): `/* start = ${start}` */)
    const dev = globalThis.webUsbDeviceManager?.getDevice(fd);
    if (!dev || !dev.module || !dev.read) {
        console.error('read_ep1 error: dev = ', dev, 'webUsbWorkerManager', globalThis.webUsbDeviceManager, 'fd', fd)
        return 0;
    }
    const result = await dev.read(WebUsbEndpoints.CONTROL_EP, 512);
    // const end = Date.now();
    // console.log(`read_ep1(${fd}, ${data}, ${len}): duration = ${end - start}`)

    if (result && result.data && result.status == "ok") {
        const buf = new Uint8Array(dev.module.HEAPU8.buffer, ((data) >> 0), len);
        const readbackvalue = new Uint8Array(result.data.buffer);
        buf.set(readbackvalue);
        if (globalThis.debug_mode)
            console.log(` => rb ${readbackvalue}`);
        return readbackvalue.length;
    }
    return -22;
}

export async function read_ep2(fd: number, data: number, len: number): Promise<number> {
    // const start = Date.now();
    if (globalThis.debug_mode || debug_ep_log)
        console.log(`read_ep2(${fd}, ${data}, ${len}): `/* start = ${start}` */)
    const dev = globalThis.webUsbDeviceManager?.getDevice(fd);
    if (!dev || !dev.module || !dev.read) {
        console.error('read_ep2 error: dev = ', dev, 'webUsbWorkerManager', globalThis.webUsbDeviceManager, 'fd', fd)
        return 0;
    }
    const result = await dev.read(WebUsbEndpoints.NOTIFY_EP, 64);
    // const end = Date.now();
    // console.log(`read_ep2(${fd}, ${data}, ${len}): duration = ${end - start}`)

    if (result && result.data && result.status == "ok") {
        const buf = new Uint8Array(dev.module.HEAPU8.buffer, ((data) >> 0), len);
        const readbackvalue = new Uint8Array(result.data.buffer);
        buf.set(readbackvalue);
        if (globalThis.debug_mode)
            console.log(` => ntfy ${readbackvalue}`);
        return readbackvalue.length;
    }
    return -22;
}

export async function write_log_js(fd: number, severity: number, str: number): Promise<number> {
    if (globalThis.debug_mode || debug_write_log) {
        const dev = globalThis.webUsbDeviceManager?.getDevice(fd);
        if (!dev || !dev.module) return 0;
        var s = dev.module.AsciiToString(str);
        console.log(`write_log_js(${fd}, ${severity}, ${s})`)
    }
    return 0;
}
