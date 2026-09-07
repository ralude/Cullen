import { describe, expect, it, vi } from 'vitest';
import type { application } from '@supermarket/core';
import { SyncWorker, type SyncWorkerCycle } from './sync-worker.ts';

const cycles = (...entries: SyncWorkerCycle[]) =>
  async (): Promise<readonly SyncWorkerCycle[]> => entries;

type RelayLike = Pick<application.OutboxRelay, 'runBatch'>;

const relay = (behaviour: (limit: number) => Promise<number>): application.OutboxRelay =>
  ({ runBatch: behaviour } as RelayLike as application.OutboxRelay);

describe('SyncWorker', () => {
  it('ejecuta un ciclo por destino y el inbox del receptor', async () => {
    const calls: string[] = [];
    const worker = new SyncWorker(cycles(
      { destinationNodeId: 'node-terminal-1', relay: relay(async () => { calls.push('t1'); return 1; }) },
      { destinationNodeId: 'node-terminal-2', relay: relay(async () => { calls.push('t2'); return 2; }) }
    ), {
      intervalMilliseconds: 1_000,
      inbox: { runBatch: async () => { calls.push('inbox'); return 3; } } as application.ProcessSyncInbox
    });

    await expect(worker.runOnce()).resolves.toBe(6);
    expect(calls).toEqual(['t1', 't2', 'inbox']);
  });

  it('un destino que falla no impide avanzar al vecino', async () => {
    const failures: Array<string | null> = [];
    const worker = new SyncWorker(cycles(
      { destinationNodeId: 'node-terminal-1', relay: relay(async () => { throw new Error('down'); }) },
      { destinationNodeId: 'node-terminal-2', relay: relay(async () => 4) }
    ), {
      intervalMilliseconds: 1_000,
      onError: (_error, destinationNodeId) => failures.push(destinationNodeId)
    });

    await expect(worker.runOnce()).resolves.toBe(4);
    expect(failures).toEqual(['node-terminal-1']);
  });

  it('mantiene un solo ciclo activo y no solapa temporizadores', async () => {
    vi.useFakeTimers();
    let active = 0;
    let overlaps = 0;
    let runs = 0;
    const worker = new SyncWorker(cycles({
      destinationNodeId: 'node-coordinator',
      relay: relay(async () => {
        active += 1;
        if (active > 1) overlaps += 1;
        runs += 1;
        await Promise.resolve();
        active -= 1;
        return 0;
      })
    }), { intervalMilliseconds: 10 });

    worker.start();
    worker.start();
    for (let tick = 0; tick < 4; tick += 1) await vi.advanceTimersByTimeAsync(10);
    await worker.stop();
    vi.useRealTimers();

    expect(overlaps).toBe(0);
    expect(runs).toBe(4);
  });

  it('el cierre deja de reclamar y espera al ciclo en curso', async () => {
    vi.useFakeTimers();
    let started = 0;
    let finished = 0;
    let release: (() => void) | undefined;
    const worker = new SyncWorker(cycles({
      destinationNodeId: 'node-coordinator',
      relay: relay(async () => {
        started += 1;
        await new Promise<void>((resolve) => { release = resolve; });
        finished += 1;
        return 0;
      })
    }), { intervalMilliseconds: 10 });

    worker.start();
    await vi.advanceTimersByTimeAsync(10);
    const stopping = worker.stop();
    release?.();
    await stopping;
    await vi.advanceTimersByTimeAsync(100);
    vi.useRealTimers();

    expect(started).toBe(1);
    expect(finished).toBe(1);
  });

  it('no reanuda ciclos después del cierre', async () => {
    let runs = 0;
    const worker = new SyncWorker(cycles({
      destinationNodeId: 'node-coordinator',
      relay: relay(async () => { runs += 1; return 0; })
    }), { intervalMilliseconds: 1 });

    await worker.stop();
    worker.start();
    await worker.runOnce();

    expect(runs).toBe(0);
  });
});
