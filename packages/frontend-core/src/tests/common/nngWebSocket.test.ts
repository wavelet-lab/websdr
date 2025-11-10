import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NngWebSocket, Protocol } from '@/common/nngWebSocket'

/**
 * Re-declare a minimal FakeWebSocket for these additional tests so they can run standalone.
 */

// Polyfill CloseEvent in Node/Vitest environment if missing
if (typeof (globalThis as any).CloseEvent === 'undefined') {
    (globalThis as any).CloseEvent = class CloseEvent extends Event {
        wasClean: boolean;
        code: number;
        reason: string;
        constructor(type: string, init?: Partial<{ wasClean: boolean; code: number; reason: string }>) {
            super(type);
            this.wasClean = !!init?.wasClean;
            this.code = init?.code ?? 1000;
            this.reason = init?.reason ?? '';
        }
    };
}

class FakeWebSocket {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3

    static instances: FakeWebSocket[] = []

    url: string
    protocol: any
    readyState: number
    binaryType: string | undefined
    lastSent: any
    private listeners: Map<string, Function[]>

    constructor(url?: string, protocol?: any) {
        this.url = url ?? ''
        this.protocol = protocol
        this.readyState = FakeWebSocket.CONNECTING
        this.binaryType = 'arraybuffer'
        this.lastSent = undefined
        this.listeners = new Map()
        FakeWebSocket.instances.push(this)
    }

    addEventListener(type: string, cb: Function) {
        const arr = this.listeners.get(type) ?? []
        arr.push(cb)
        this.listeners.set(type, arr)
    }

    removeEventListener(type: string, cb: Function) {
        const arr = this.listeners.get(type) ?? []
        this.listeners.set(type, arr.filter(f => f !== cb))
    }

    send(data: any) {
        this.lastSent = data
    }

    close() {
        this.readyState = FakeWebSocket.CLOSED
        // emit a close event with wasClean true by default
        this.triggerClose(new CloseEvent('close', { wasClean: true }))
    }

    private trigger(type: string, ev: Event) {
        const arr = this.listeners.get(type) ?? []
        for (const f of arr) {
            try { f(ev) } catch { /* ignore */ }
        }
    }

    triggerOpen() {
        this.readyState = FakeWebSocket.OPEN
        this.trigger('open', new Event('open'))
    }

    triggerMessage(data: any) {
        const evt = new MessageEvent('message', { data })
        this.trigger('message', evt)
    }

    triggerClose(ev?: Partial<CloseEvent>) {
        const evt = new CloseEvent('close', { wasClean: ev?.wasClean ?? false, code: ev?.code ?? 1000, reason: ev?.reason ?? '' })
        this.trigger('close', evt)
    }

    triggerError(detail?: any) {
        const evt = new Event('error')
            ; (evt as any).data = detail
        this.trigger('error', evt)
    }
}

describe('NngWebSocket additional tests', () => {
    let originalWebSocket: any

    beforeEach(() => {
        originalWebSocket = (globalThis as any).WebSocket
            ; (globalThis as any).WebSocket = FakeWebSocket
        FakeWebSocket.instances = []
    })

    afterEach(() => {
        ; (globalThis as any).WebSocket = originalWebSocket
        FakeWebSocket.instances = []
        vi.restoreAllMocks()
    })

    it('close() rejects outstanding REQ promises (Error instance & message)', async () => {
        const nng = new NngWebSocket({ url: 'ws://req-close-test', protocol: Protocol.REQ, binaryType: NngWebSocket.TEXT })
        const p = nng.open()
        await new Promise<void>(r => setTimeout(r, 0))
        const fw = FakeWebSocket.instances[0]
        fw!.triggerOpen()
        await p

        const pending = nng.send('will-cancel')
        // close the socket; outstanding promise should reject with an Error whose message includes "connection closed"
        await nng.close()
        await expect(pending).rejects.toThrow(/connection closed/)
        expect(nng.isConnected()).toBe(false)
    })

    it('onWsError rejects pending REQ send promises with string details', async () => {
        const nng = new NngWebSocket({ url: 'ws://err-send-test', protocol: Protocol.REQ, binaryType: NngWebSocket.TEXT })
        const p = nng.open()
        await new Promise<void>(r => setTimeout(r, 0))
        const fw = FakeWebSocket.instances[0]
        fw!.triggerOpen()
        await p

        const pending = nng.send('will-fail', 1000)
        // trigger an error event containing string detail -> pending should reject with string including 'boom'
        fw!.triggerError('boom')
        await expect(pending).rejects.toMatch(/boom/)
    })

    it('receives plain string message for SUB and dispatches data & message events', async () => {
        const nng = new NngWebSocket({ url: 'ws://sub-string', protocol: Protocol.SUB, binaryType: NngWebSocket.TEXT })
        const p = nng.open()
        await new Promise<void>(r => setTimeout(r, 0))
        const fw = FakeWebSocket.instances[0]
        fw!.triggerOpen()
        await p

        const got: { data?: any; messageCount: number } = { data: undefined, messageCount: 0 }
        nng.addEventListener('data', (e: any) => { got.data = e.detail.data })
        nng.addEventListener('message', () => { got.messageCount++ })

        // send a string directly via MessageEvent
        fw!.triggerMessage('plain-text-msg')
        await new Promise<void>(r => setTimeout(r, 0))

        expect(got.data).toBe('plain-text-msg')
        expect(got.messageCount).toBeGreaterThanOrEqual(1)
    })

    it('non-REQ send after close rejects as not connected', async () => {
        const nng = new NngWebSocket({ url: 'ws://after-close', protocol: Protocol.SUB, binaryType: NngWebSocket.ARRAYBUFFER })
        const p = nng.open()
        await new Promise<void>(r => setTimeout(r, 0))
        const fw = FakeWebSocket.instances[0]
        fw!.triggerOpen()
        await p

        // close underlying websocket
        await nng.close()
        await expect(nng.send(new Uint8Array([1, 2, 3]).buffer)).rejects.toMatch(/not connected/)
    })
})
