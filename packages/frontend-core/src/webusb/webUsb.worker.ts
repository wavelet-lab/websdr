import { initControl, isControlInitialized } from './webUsbDeviceManager';
import { WebUsb } from './webUsbBase';
import type {
    WebUsbWorkerRequest,
    WebUsbWorkerResponse,
    WebUsbRequestType,
} from './webUsb.worker.types';

// hoist reusable sets to module scope to avoid recreating them per message
const NON_MANAGER_TYPES: ReadonlySet<WebUsbRequestType> = new Set([
    'START', 'STOP', 'GET_OPENED_DEVICE_LIST', 'CLOSE_ALL'
]);


const NOT_NEEDED_DEVICE_TYPES: ReadonlySet<WebUsbRequestType> = new Set([
    'OPEN', 'CLOSE', 'GET_OPENED_DEVICE_LIST'
]);

// helper to ensure correct typing of sendResponse calls
const sendResponse = (type: WebUsbRequestType | undefined, id: number | string | undefined, res: 'ok' | 'error', payload?: any, err?: any) => {
    const msg: WebUsbWorkerResponse = { type, id, res, ret: payload, err };
    try {
        self.postMessage(msg);
    } catch (e) {
        console.error('postMessage failed', e);
    }
};

// main handler — accept unknown and narrow to discriminated union
self.onmessage = async (event: MessageEvent<unknown>) => {
    const msg = event.data as WebUsbWorkerRequest | undefined;

    // basic runtime validation
    if (!msg || typeof (msg as any).type !== 'string') {
        sendResponse(undefined, (msg as any)?.id, 'error', undefined, 'invalid message');
        return;
    }

    try {
        if (globalThis.debug_mode) console.log('Message from WebUsb', msg);
        let dev: WebUsb | undefined = undefined;
        let ret: any;

        // get device manager or device instance as needed
        if (!NON_MANAGER_TYPES.has(msg.type)) {
            if (globalThis.webUsbDeviceManager === undefined) {
                sendResponse(msg.type, msg.id, 'error', undefined, 'webUsbDeviceManager is not defined');
                return;
            }
            if (!NOT_NEEDED_DEVICE_TYPES.has(msg.type)) {
                // safe access because CLOSE and OPEN handled separately
                dev = globalThis.webUsbDeviceManager.getDevice((msg as any).fd);
                if (!dev) {
                    sendResponse(msg.type, msg.id, 'error', undefined, `error getting a webusb device (fd = ${(msg as any).fd})`);
                    return;
                }
            }
        }

        switch (msg.type) {
            case 'START':
                await initControl();
                sendResponse(msg.type, msg.id, isControlInitialized() ? 'ok' : 'error');
                break;

            case 'STOP':
                sendResponse(msg.type, msg.id, isControlInitialized() ? 'ok' : 'error');
                break;

            case 'OPEN': {
                const m = msg; // narrowed to OPEN
                await initControl();
                dev = await globalThis.webUsbDeviceManager!.open(m.vendorId, m.productId);
                ret = dev !== undefined ? dev.fd : -1;
                sendResponse(msg.type, msg.id, ret >= 0 ? 'ok' : 'error', ret,
                    ret < 0 ? `error opening a webusb device (vid = 0x${m.vendorId.toString(16)}, pid = 0x${m.productId.toString(16)})` : undefined);
                break;
            }

            case 'CLOSE': {
                const m = msg;
                ret = await globalThis.webUsbDeviceManager!.close(m.fd);
                sendResponse(msg.type, msg.id, ret ? 'ok' : 'error', ret, !ret ? `error closing a webusb device (fd = ${m.fd})` : undefined);
                break;
            }

            case 'CLOSE_ALL':
                await globalThis.webUsbDeviceManager?.closeAll();
                sendResponse(msg.type, msg.id, 'ok', true);
                break;

            case 'GET_DEV_NAME': {
                const m = msg;
                ret = dev!.getName();
                sendResponse(msg.type, msg.id, ret ? 'ok' : 'error', ret, !ret ? `error getting a name of webusb device (fd = ${m.fd})` : undefined);
                break;
            }

            case 'GET_SERIAL_NUMBER': {
                const m = msg;
                ret = dev!.getSerialNumber();
                sendResponse(msg.type, msg.id, ret ? 'ok' : 'error', ret, !ret ? `error getting a serial number of webusb device (fd = ${m.fd})` : undefined);
                break;
            }

            case 'GET_RX_SAMPLES_COUNT': {
                const m = msg as any;
                ret = dev!.getRXSamplesCount(m.samples);
                sendResponse(msg.type, msg.id, ret ? 'ok' : 'error', ret, !ret ? `error getting samples count of webusb device (fd = ${m.fd})` : undefined);
                break;
            }

            case 'SEND_COMMAND': {
                const m = msg;
                dev!.sendCommand(m.req)
                    .then(res => sendResponse(msg.type, msg.id, 'ok', res))
                    .catch(err => sendResponse(msg.type, msg.id, 'error', undefined, String(err)));
                break;
            }

            case 'SEND_DEBUG_COMMAND': {
                const m = msg;
                dev!.sendDebugCommand(m.req)
                    .then(res => sendResponse(msg.type, msg.id, 'ok', res))
                    .catch(err => sendResponse(msg.type, msg.id, 'error', undefined, String(err)));
                break;
            }

            case 'SUBMIT_RX_PACKET': {
                const m = msg;
                dev!.submitRxPacket(m.samples, m.opts)
                    .then((res) => sendResponse(msg.type, msg.id, 'ok', res))
                    .catch(err => sendResponse(msg.type, msg.id, 'error', undefined, String(err)));
                break;
            }

            case 'SEND_TX_PACKET': {
                const m = msg;
                dev!.sendTxPacket(m.data, m.opts)
                    .then((res) => sendResponse(msg.type, msg.id, 'ok', { bytesWritten: res.usbOutTransferResult?.bytesWritten }))
                    .catch(err => sendResponse(msg.type, msg.id, 'error', undefined, String(err)));
                break;
            }

            case 'GET_STREAM_STATUS': {
                const m = msg;
                ret = dev!.getStreamStatus();
                sendResponse(msg.type, msg.id, ret ? 'ok' : 'error', ret, !ret ? `error getting a stream status of webusb device (fd = ${m.fd})` : undefined);
                break;
            }

            case 'SET_STREAM_STATUS': {
                const m = msg;
                dev!.setStreamStatus(m.status);
                sendResponse(msg.type, msg.id, 'ok', m.status);
                break;
            }

            case 'GET_CONFIGURATION': {
                const m = msg;
                ret = dev!.getConfiguration();
                sendResponse(msg.type, msg.id, ret ? 'ok' : 'error', ret, !ret ? `error getting a configuration of webusb device (fd = ${m.fd})` : undefined);
                break;
            }

            case 'GET_OPENED_DEVICE_LIST': {
                const devs: any[] = [];
                if (globalThis.webUsbDeviceManager !== undefined) {
                    const dev_fds = globalThis.webUsbDeviceManager.getDevices();
                    if (dev_fds !== undefined) {
                        dev_fds.forEach((fd: number) => {
                            const d = globalThis.webUsbDeviceManager!.getDevice(fd);
                            if (d) devs.push({ devName: WebUsb.getDeviceName(d.device), vendorId: d.vid, productId: d.pid })
                        })
                    }
                }
                sendResponse(msg.type, msg.id, 'ok', devs);
                break;
            }

            default:
                throw new Error('Unhandled message type: ' + msg as never);
        }
    } catch (e) {
        console.error('webUsb.worker handler failed', e);
        try { self.postMessage({ type: (msg as any)?.type, id: (msg as any)?.id, res: 'error', err: String(e) }); } catch { /* ignore */ }
    }
}