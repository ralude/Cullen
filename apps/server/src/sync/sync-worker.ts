import type { application, ExecutionContext } from '@supermarket/core';

export type SyncWorkerCycle = {
  /** Un ciclo por destino; cada uno conserva su claim y su progreso. */
  readonly destinationNodeId: string;
  readonly relay: application.OutboxRelay;
};

/**
 * Resuelve los destinos de cada ciclo. Se consulta en cada vuelta porque el
 * registro confiable cambia en caliente: una terminal dada de alta o revocada
 * no debe esperar a un reinicio del proceso para entrar o salir de la entrega.
 */
export type SyncWorkerCycles = () => Promise<readonly SyncWorkerCycle[]>;

export type SyncWorkerOptions = {
  readonly intervalMilliseconds: number;
  readonly batchLimit?: number;
  /** Procesamiento del inbox del receptor; ausente en una terminal pura. */
  readonly inbox?: application.ProcessSyncInbox;
  /**
   * Reemisión de concesiones del coordinador. Se ejecuta **antes** de entregar
   * para que la terminal conectada conserve siempre ocho horas por delante y,
   * al cortarse la LAN, siga operando dentro de esa ventana. Ausente en una
   * terminal, que no emite concesiones.
   */
  readonly grants?: {
    readonly publisher: application.PublishOperatorGrants;
    readonly context: ExecutionContext;
  };
  readonly onError?: (error: unknown, destinationNodeId: string | null) => void;
};

/**
 * Worker de sincronización del proceso dueño de SQLite.
 *
 * Un solo ciclo activo: el temporizador se reprograma después de terminar,
 * nunca en paralelo, de modo que dos ejecuciones no se solapan. El cierre deja
 * de reclamar y espera el ciclo en curso antes de que el proceso cierre la base;
 * una terminación forzada se recupera por lease, sin resetear `PROCESSING`,
 * generación, pausa ni bloqueos.
 *
 * No comprueba conectividad por su cuenta ni confirma entregas: solo ordena
 * ciclos acotados de los casos de uso que sí lo hacen.
 */
export class SyncWorker {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private stopped = false;

  constructor(
    private readonly cycles: SyncWorkerCycles,
    private readonly options: SyncWorkerOptions
  ) {}

  start(): void {
    if (this.timer !== undefined || this.stopped) return;
    this.schedule();
  }

  /**
   * Ejecuta un ciclo completo. Se expone para pruebas deterministas: evita
   * depender del temporizador y de tiempos de pared.
   */
  async runOnce(): Promise<number> {
    const limit = this.options.batchLimit ?? 20;
    let processed = 0;
    let destinations: readonly SyncWorkerCycle[] = [];
    try {
      destinations = await this.cycles();
    } catch (error) {
      this.options.onError?.(error, null);
      return 0;
    }
    /**
     * La reemisión precede a la entrega para que la concesión renovada viaje
     * en este mismo ciclo. Un fallo aquí no cancela las entregas pendientes.
     */
    if (!this.stopped && this.options.grants) {
      try {
        await this.options.grants.publisher.renewIfDue(this.options.grants.context);
      } catch (error) {
        this.options.onError?.(error, null);
      }
    }
    for (const cycle of destinations) {
      if (this.stopped) break;
      try {
        processed += await cycle.relay.runBatch(limit);
      } catch (error) {
        this.options.onError?.(error, cycle.destinationNodeId);
      }
    }
    if (!this.stopped && this.options.inbox) {
      try {
        processed += await this.options.inbox.runBatch(limit);
      } catch (error) {
        this.options.onError?.(error, null);
      }
    }
    return processed;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.running;
  }

  private schedule(): void {
    this.timer = setTimeout(() => {
      this.running = this.runOnce()
        .then(() => undefined)
        .catch((error: unknown) => { this.options.onError?.(error, null); })
        .finally(() => {
          this.running = undefined;
          if (!this.stopped) this.schedule();
        });
    }, this.options.intervalMilliseconds);
    this.timer.unref?.();
  }
}
