import { DataType } from '@websdr/core/common';
import { usleep } from '@websdr/core/utils';
import {
    ensureWebUsb, initControl, isControlInitialized,
    getWebUsbManagerInstance, WebUsbManager, WebUsbManagerMode,
    ControlWebUsb,
    WebUsbDirection
} from '@websdr/frontend-core/webusb';

const debug_webusb = false;

const mode = WebUsbManagerMode.SINGLE;
const packetSize = 8192;

interface StreamConfig {
    samplerate: number;
    bandwidth: number;
    frequency: number;
    gain: number;
}

const rxConfig: StreamConfig = {
    samplerate: 10e6,
    bandwidth: 10e6,
    frequency: 100e6,
    gain: 15
};

const txConfig: StreamConfig = {
    samplerate: 10e6,
    bandwidth: 10e6,
    frequency: 1000e6,
    gain: 0
};


async function testUsbRX(control: ControlWebUsb, webUsbManager: WebUsbManager, fd: number): Promise<bigint> {
    console.log('▶️  Starting RX stream...');
    await control.sendCommand('START_STREAMING', { samplerate: rxConfig.samplerate, throttleon: 0, param: 7, mode: WebUsbDirection.RX });
    await control.setParameter('SET_RX_FREQUENCY', { frequency: rxConfig.frequency }, true);
    await control.setParameter('SET_RX_BANDWIDTH', { frequency: rxConfig.bandwidth }, true);
    await control.setParameter('SET_RX_GAIN', { gain: rxConfig.gain }, true);
    await control.sendCommand('CONTROL_STREAMING', { samplerate: 0, throttleon: 0, param: 0 });
    console.log('✅ RX stream started');
    // Read RX Data
    console.log('📥 Reading RX data...');
    const TOTAL_PACKETS = 1000;
    const WINDOW = 128;

    let pktPooled = 0, pktRecv = 0, pktErrors = 0;
    let overrun = 0, realigned = 0, dropped = 0;
    let timestamp = 0n;
    // Produce packets with sliding window backpressure: never more than WINDOW in-flight
    while (pktPooled < TOTAL_PACKETS) {
        const inFlight = pktPooled - (pktRecv + pktErrors);
        if (inFlight >= WINDOW) {
            // wait a bit for completions before queuing more
            await usleep(10);
            continue;
        }
        webUsbManager.submitRxPacket(fd, packetSize)
            .then((data) => {
                ++pktRecv;
                if (debug_webusb) console.log(`RX packet ${pktRecv}/${TOTAL_PACKETS} received, timestamp: ${data.timestamp}, overrun: ${data.overrun}, realigned: ${data.realigned}, dropped: ${data.dropped}`);
                timestamp = data.timestamp;
                overrun += data.overrun;
                realigned += data.realigned;
                dropped += data.dropped;
            })
            .catch(() => { ++pktErrors; });
        ++pktPooled;
    }

    // Wait until all submitted packets are settled (pktPooled === pktRecv + pktErrors)
    await new Promise<void>((resolve, reject) => {
        const maxWaitMs = 120_000; // safety timeout
        const start = Date.now();
        const timer = setInterval(() => {
            if (pktPooled === pktRecv + pktErrors) {
                clearInterval(timer);
                resolve();
                return;
            }
            if (Date.now() - start > maxWaitMs) {
                clearInterval(timer);
                reject(new Error('Timeout waiting for packets to finish'));
            }
        }, 20);
    });
    console.log('✅ RX data received:', { pktPooled, pktRecv, pktErrors, overrun, realigned, dropped, timestamp });
    // Stop RX Stream
    console.log('⏹️  Stopping RX stream...');
    await control.sendCommand('STOP_STREAMING');
    console.log('✅ RX stream stopped');
    return timestamp
}

async function testUsbTX(control: ControlWebUsb, webUsbManager: WebUsbManager, fd: number, firstTimestamp: bigint) {
    console.log('▶️  Starting TX stream...');
    await control.sendCommand('START_STREAMING', { samplerate: txConfig.samplerate, param: 7, mode: WebUsbDirection.TX });
    await control.setParameter('SET_TX_FREQUENCY', { frequency: txConfig.frequency }, true);
    await control.setParameter('SET_TX_BANDWIDTH', { frequency: txConfig.bandwidth }, true);
    await control.setParameter('SET_TX_GAIN', { gain: txConfig.gain }, true);
    await control.sendCommand('CONTROL_STREAMING', { samplerate: 0, throttleon: 0, param: 0 });
    console.log('✅ TX stream started');
    // Send TX Data
    console.log('📥 Send TX data...');
    const TOTAL_PACKETS = 1000;

    let pktPooled = 0, pktSent = 0, pktErrors = 0;

    const data = new Int16Array(2 * packetSize);
    data.fill(0);

    let ts = 0n;//firstTimestamp;

    while (pktPooled < TOTAL_PACKETS) {
        await webUsbManager.sendTxPacket(fd, {
            data: data.buffer,
            byteOffset: 0,
            byteLength: data.buffer.byteLength,
            datatype: DataType.ci16,
            discard_timestamp: false,
            timestamp: ts,
        })
            .then(() => { ++pktSent; })
            .catch(() => { ++pktErrors; });
        ts += BigInt(data.length / 2); // increment timestamp by number of samples
        ++pktPooled;
        if (debug_webusb) console.log(`TX packet ${pktPooled}/${TOTAL_PACKETS} sent, timestamp: ${ts}`);
    }

    console.log('✅ TX data sent:', { pktPooled, pktSent, pktErrors });
    // Stop TX Stream
    console.log('⏹️  Stopping TX stream...');
    await control.sendCommand('STOP_STREAMING');
    console.log('✅ TX stream stopped');
}

async function testUsb() {
    await ensureWebUsb();
    let fd: number = -1;
    console.log('🧪 Starting USB tests...\n');
    const webUsbManager: WebUsbManager = getWebUsbManagerInstance(mode);
    try {
        // Test 1: WebUsbManager
        console.log('📊 Checking WebUsb manager...');
        if (!webUsbManager) {
            throw new Error('WebUsbManager instance is not available');
        }
        console.log('✅ WebUsbManager is available');
        // Test 2: Initialize control
        await initControl();
        if (!isControlInitialized()) {
            throw new Error('Control module is not initialized');
        }
        console.log('✅ Control module initialized');
        const control = new ControlWebUsb({ mode })
        if (!control) {
            throw new Error('ControlWebUsb instance is not available');
        }
        console.log('✅ ControlWebUsb is available');
        // Test 3: Request Device
        console.log('🔍 Getting USB devices...');
        const requestDevice = await webUsbManager.requestDevice();
        if (!requestDevice) {
            throw new Error('WebUsb device is not available');
        }
        console.log('✅ USB device:', requestDevice);
        // Test 4: Open Device
        console.log('🔌 Opening USB device...');
        fd = await webUsbManager.open(requestDevice.vendorId, requestDevice.productId, requestDevice.device);
        if (fd === -1) {
            throw new Error('Failed to open USB device');
        }
        console.log('✅ USB device opened');
        // Test 5: Get device info
        const devName = await webUsbManager.getName(fd);
        console.log('ℹ️  Device Name:', devName);
        const serialNumber = await webUsbManager.getSerialNumber(fd);
        console.log('ℹ️  Serial Number:', serialNumber);
        // Test 6: Open Control
        console.log('⚙️  Opening control interface...');
        await control.open(fd);
        console.log('✅ Control interface opened');
        // Test 7: Get Control Info
        console.log('ℹ️  Retrieving device info...');
        const deviceInfo = await control.getDeviceInfo();
        console.log('✅ Device info retrieved:', deviceInfo);
        // Test 8: RX Stream
        const lastTimestamp = await testUsbRX(control, webUsbManager, fd);
        // Test 9: TX Stream
        await testUsbTX(control, webUsbManager, fd, lastTimestamp);

        // Test 999: Close Control
        console.log('🔒 Closing control interface...');
        await control.close();
        console.log('✅ Control interface closed');

    } catch (err) {
        console.error('❌ USB test failed:', err);
        process.exitCode = 1;
    } finally {
        if (fd !== -1) {
            webUsbManager?.close(fd);
            console.log('🔌 Disconnected from USB');
        }
    }
}

testUsb()
    .then(() => {
        console.log('\n✅ USB test completed');
        process.exit(0);
    })
    .catch((e) => {
        console.error('\n❌ USB test error:', e);
        process.exit(1);
    });