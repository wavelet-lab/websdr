import { describe, it, expect } from 'vitest';
import { StreamMeter } from '@/telemetry/streamMeter';
import type { StreamMeterState } from '@/telemetry/streamMeter';

describe('StreamMeter', () => {
  it('has correct initial state', () => {
    const meter = new StreamMeter({ notifyIntervalMs: 1 });
    const s = meter.snapshot();
    expect(s.is_up).toBe(false);
    expect(s.cloud_is_up).toBe(false);
    expect(s.downloaded).toBe(0);
    expect(s.processed).toBe(0);
    expect(s.overrun).toBe(0);
    expect(s.wr_ahead_avg).toBe(0);
    expect(s.lastSend).toBe(0);
    expect(s.uploaded).toBe(0);
    expect(s.dropped).toBe(0);
    expect(s.skipped).toBe(0);
    expect(s.realigned).toBe(0);
    expect(s.errors).toBe(0);
  });

  it('notifies listeners on property set and flushes immediately', () => {
    const meter = new StreamMeter({ notifyIntervalMs: 1000 });
    const received: StreamMeterState[] = [];
    meter.subscribe((s) => received.push(s), false);
    meter.downloaded = 5;
    meter.flush();
    expect(received.length).toBe(1);
    expect(received[0]!.downloaded).toBe(5);
  });

  it('update patch changes multiple fields and notifies once', () => {
    const meter = new StreamMeter({ notifyIntervalMs: 1000 });
    const received: StreamMeterState[] = [];
    meter.subscribe((s) => received.push(s), false);
    meter.update({ uploaded: 10, dropped: 2 });
    meter.flush();
    expect(received.length).toBe(1);
    expect(received[0]!.uploaded).toBe(10);
    expect(received[0]!.dropped).toBe(2);
  });

  it('reset brings counters to zero', () => {
    const meter = new StreamMeter({ notifyIntervalMs: 1 });
    meter.downloaded = 7;
    meter.uploaded = 3;
    meter.reset();
    const s = meter.snapshot();
    expect(s.downloaded).toBe(0);
    expect(s.uploaded).toBe(0);
  });
});
