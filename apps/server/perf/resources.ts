/**
 * Recursos de una serie de medición: CPU, memoria y tamaño en disco.
 *
 * El consumo medido se acumula sobre el MISMO intervalo que la latencia, así
 * que la semilla, el warm-up y la verificación quedan fuera. El costo del
 * instrumento no se estima: se publica también el consumo del proceso entero
 * y la diferencia contra lo medido es ese costo.
 *
 * `process.cpuUsage()` se actualiza en Windows con la granularidad del reloj
 * de planificación —unos 15,6 ms—, de modo que una repetición corta puede
 * registrar cero. Sólo la suma de la serie tiene significado; una observación
 * individual de CPU no lo tiene.
 */
import { statSync } from 'node:fs';
import { cpus } from 'node:os';
import type { Server, Socket } from 'node:net';

/** Bytes sobre el cable, cifrado incluido: se leen del socket TCP, no del cuerpo. */
export type Traffic = { readonly bytesRead: number; readonly bytesWritten: number };

/**
 * Cuenta el tráfico de un servidor sobre su socket TCP —antes de TLS—, así que
 * incluye handshake y cabeceras y no sólo el cuerpo. Un socket cerrado ya no se
 * puede consultar: aporta su total al cerrarse.
 */
export const countTraffic = (server: Server): (() => Traffic) => {
  let closedBytesRead = 0;
  let closedBytesWritten = 0;
  const live = new Set<Socket>();
  server.on('connection', (socket: Socket) => {
    live.add(socket);
    socket.once('close', () => {
      closedBytesRead += socket.bytesRead;
      closedBytesWritten += socket.bytesWritten;
      live.delete(socket);
    });
  });
  return (): Traffic => {
    let bytesRead = closedBytesRead;
    let bytesWritten = closedBytesWritten;
    for (const socket of live) {
      bytesRead += socket.bytesRead;
      bytesWritten += socket.bytesWritten;
    }
    return { bytesRead, bytesWritten };
  };
};

/** Escenario que corre dentro del arnés: sus repeticiones suman sobre un proceso. */
export type ScenarioResources = {
  readonly cpu: {
    readonly measuredUserMs: number;
    readonly measuredSystemMs: number;
    readonly processUserMs: number;
    readonly processSystemMs: number;
  };
  readonly memory: {
    readonly baselineRssBytes: number;
    readonly peakRssBytes: number;
    readonly peakHeapUsedBytes: number;
  };
  readonly database?: {
    readonly seededBytes: number;
    readonly finalBytes: number;
    readonly walBytes: number;
  };
};

/**
 * Escenario que corre en procesos aparte: cada repetición es un proceso
 * entero, así que su estadístico comparable es la mediana entre repeticiones,
 * no la suma de una serie dentro de un mismo proceso.
 */
export type ProcessResources = {
  readonly sample: number;
  readonly medianCpuUserMs: number;
  readonly medianCpuSystemMs: number;
  readonly medianRssBytes: number;
  readonly peakRssBytes: number;
};

export const microsToMs = (micros: number): number => Number((micros / 1_000).toFixed(3));

/** Un archivo que aún no existe ocupa cero; WAL y SHM aparecen recién al escribir. */
export const fileBytes = (path: string): number => {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
};

/**
 * Tamaño operativo de la base: el archivo y su WAL todavía sin consolidar. Se
 * lee antes de cerrar la conexión; después, el WAL ya no está.
 */
export const databaseBytes = (path: string): number => fileBytes(path) + fileBytes(path + '-wal');

export const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = (sorted.length - 1) / 2;
  return (sorted[Math.floor(middle)]! + sorted[Math.ceil(middle)]!) / 2;
};

/** Tamaño representativo de un artefacto que cada repetición reconstruye. */
export const medianBytes = (values: readonly number[]): number => Math.round(median(values));

/** Resume el consumo de las repeticiones de un escenario fuera de proceso. */
export const summarizeProcessResources = (
  usages: readonly { readonly cpuUserMicros: number; readonly cpuSystemMicros: number; readonly rssBytes: number }[]
): ProcessResources => ({
  sample: usages.length,
  medianCpuUserMs: microsToMs(median(usages.map(({ cpuUserMicros }) => cpuUserMicros))),
  medianCpuSystemMs: microsToMs(median(usages.map(({ cpuSystemMicros }) => cpuSystemMicros))),
  medianRssBytes: Math.round(median(usages.map(({ rssBytes }) => rssBytes))),
  peakRssBytes: Math.max(...usages.map(({ rssBytes }) => rssBytes))
});

/**
 * Acumulador de un escenario en proceso. La línea base se toma con el dataset
 * ya sembrado: es lo que el nodo ocupa antes de que la serie empiece.
 */
export const recordResources = (databasePath?: string) => {
  const seededBytes = databasePath === undefined ? 0 : databaseBytes(databasePath);
  const baselineRssBytes = process.memoryUsage().rss;
  let measuredUser = 0;
  let measuredSystem = 0;
  let peakRssBytes = baselineRssBytes;
  let peakHeapUsedBytes = 0;
  return {
    /** Una repetición medida, con el consumo de su propio intervalo. */
    add: (cpu: NodeJS.CpuUsage, memory: NodeJS.MemoryUsage): void => {
      measuredUser += cpu.user;
      measuredSystem += cpu.system;
      peakRssBytes = Math.max(peakRssBytes, memory.rss);
      peakHeapUsedBytes = Math.max(peakHeapUsedBytes, memory.heapUsed);
    },
    close: (): ScenarioResources => {
      const consumed = process.cpuUsage();
      return {
        cpu: {
          measuredUserMs: microsToMs(measuredUser),
          measuredSystemMs: microsToMs(measuredSystem),
          processUserMs: microsToMs(consumed.user),
          processSystemMs: microsToMs(consumed.system)
        },
        memory: { baselineRssBytes, peakRssBytes, peakHeapUsedBytes },
        ...(databasePath === undefined ? {} : {
          database: {
            seededBytes,
            finalBytes: databaseBytes(databasePath),
            walBytes: fileBytes(databasePath + '-wal')
          }
        })
      };
    }
  };
};

/**
 * Ocupación de la estación, en porcentaje sobre el total de sus núcleos.
 *
 * El manifiesto exige medir sin suites, servidor de desarrollo ni otro Electron
 * compitiendo, pero hasta el 2026-09-16 nadie lo verificaba: el BEFORE de ese
 * día salió un 50 % más lento en su tercera serie porque la estación tenía
 * navegadores y aplicaciones Chromium abiertas, y sólo se detectó comparando
 * medianas a mano. Ahora la serie lo declara y aborta si no puede medir aislada.
 *
 * Se obtiene de `os.cpus()`, que acumula tiempo por núcleo desde el arranque:
 * dos lecturas separadas por un intervalo dan la ocupación de ese intervalo. No
 * distingue qué proceso consume —no hace falta para decidir si la estación está
 * libre— y no lee línea de comandos ni nombres de proceso ajenos.
 */
export const measureSystemLoad = async (sampleMs = 300): Promise<number> => {
  const snapshot = (): { idle: number; total: number } => {
    let idle = 0;
    let total = 0;
    for (const core of cpus()) {
      for (const [mode, ticks] of Object.entries(core.times)) {
        total += ticks;
        if (mode === 'idle') idle += ticks;
      }
    }
    return { idle, total };
  };
  const first = snapshot();
  await new Promise((resolve) => { setTimeout(resolve, sampleMs); });
  const second = snapshot();
  const total = second.total - first.total;
  if (total <= 0) return 0;
  const busy = 1 - (second.idle - first.idle) / total;
  return Number((Math.min(Math.max(busy, 0), 1) * 100).toFixed(1));
};
