import { copyFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ApplicationError } from '@supermarket/shared';
import {
  createDatabaseBackup,
  listDatabaseBackups,
  pruneDatabaseBackups,
  type BackupProtection
} from '@supermarket/driver-db';
import type { NodeStorage } from './node-storage.ts';

/**
 * Respaldo operativo periódico (ADR-0030 D7).
 *
 * Es distinto del respaldo previo a migración de ADR-0029 D8: aquél protege
 * una actualización y conserva cinco copias; éste protege la operación diaria
 * —corrupción, borrado accidental, disco perdido— y conserva copias diarias y
 * semanales. Viven en familias separadas del mismo directorio protegido para
 * que la retención de una nunca borre las de la otra.
 *
 * La copia semanal no se vuelve a generar: se duplica el artefacto diario ya
 * sellado. Volver a hacer `vacuum into` produciría un segundo instante y el
 * doble de trabajo para la misma evidencia.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export type OperationalBackupPolicy = {
  /** Hora local del arranque de la copia diaria. */
  readonly hour: number;
  readonly dailyRetention: number;
  readonly weeklyRetention: number;
  /** Destino adicional fuera de la máquina —pendrive o carpeta compartida—. */
  readonly externalPath?: string;
};

export type OperationalBackupResult = {
  readonly dailyPath: string;
  readonly weeklyPath?: string;
  readonly externalPath?: string;
};

export const DEFAULT_OPERATIONAL_BACKUP_POLICY: OperationalBackupPolicy = {
  hour: 3,
  dailyRetention: 7,
  weeklyRetention: 4
};

type Environment = Readonly<Record<string, string | undefined>>;

const positive = (
  declared: string | undefined, fallback: number, code: string
): number => {
  if (declared === undefined || declared.trim() === '') return fallback;
  if (!/^[1-9]\d*$/.test(declared.trim())) {
    throw new ApplicationError(code, 'The operational backup policy value is invalid.');
  }
  return Number.parseInt(declared.trim(), 10);
};

export const readOperationalBackupPolicy = (
  environment: Environment = process.env
): OperationalBackupPolicy => {
  const declaredHour = environment.OPERATIONAL_BACKUP_HOUR?.trim();
  if (declaredHour !== undefined && declaredHour !== ''
    && !/^(?:[0-9]|1[0-9]|2[0-3])$/.test(declaredHour)) {
    throw new ApplicationError(
      'OPERATIONAL_BACKUP_HOUR_INVALID', 'The operational backup hour is invalid.'
    );
  }
  const external = environment.OPERATIONAL_BACKUP_EXTERNAL_PATH?.trim();
  return {
    hour: declaredHour === undefined || declaredHour === ''
      ? DEFAULT_OPERATIONAL_BACKUP_POLICY.hour
      : Number.parseInt(declaredHour, 10),
    dailyRetention: positive(
      environment.OPERATIONAL_BACKUP_DAILY_RETENTION,
      DEFAULT_OPERATIONAL_BACKUP_POLICY.dailyRetention,
      'OPERATIONAL_BACKUP_DAILY_RETENTION_INVALID'
    ),
    weeklyRetention: positive(
      environment.OPERATIONAL_BACKUP_WEEKLY_RETENTION,
      DEFAULT_OPERATIONAL_BACKUP_POLICY.weeklyRetention,
      'OPERATIONAL_BACKUP_WEEKLY_RETENTION_INVALID'
    ),
    ...(external ? { externalPath: external } : {})
  };
};

/** Las copias operativas no comparten directorio con las de migración. */
export const operationalBackupDirectory = (storage: NodeStorage): string =>
  join(storage.backupDirectory, 'operational');

export const dailyBackupPrefix = (databasePath: string): string =>
  `${basename(databasePath)}.daily.`;

export const weeklyBackupPrefix = (databasePath: string): string =>
  `${basename(databasePath)}.weekly.`;

/** Mínimo para producir el respaldo: la conexión viva y dónde publicarlo. */
export type OperationalBackupInput = {
  readonly sqlite: Parameters<typeof createDatabaseBackup>[0];
  readonly storage: NodeStorage;
  readonly policy: OperationalBackupPolicy;
  readonly protection?: BackupProtection;
  readonly now?: Date;
};

export const runOperationalBackup = (
  input: OperationalBackupInput
): OperationalBackupResult => {
  const { storage, policy } = input;
  const directory = operationalBackupDirectory(storage);
  const daily = dailyBackupPrefix(storage.databasePath);
  const weekly = weeklyBackupPrefix(storage.databasePath);
  const now = input.now ?? new Date();

  const dailyPath = createDatabaseBackup(input.sqlite, storage.databasePath, {
    directory,
    prefix: daily,
    ...(input.protection ? { protection: input.protection } : {})
  });
  pruneDatabaseBackups(directory, daily, policy.dailyRetention);

  const result: {
    dailyPath: string; weeklyPath?: string; externalPath?: string;
  } = { dailyPath };

  const [newestWeekly] = listDatabaseBackups(directory, weekly);
  if (newestWeekly === undefined || now.getTime() - backupStamp(newestWeekly) >= WEEK_MS) {
    const weeklyPath = join(directory, basename(dailyPath).replace(daily, weekly));
    copyFileSync(dailyPath, weeklyPath);
    pruneDatabaseBackups(directory, weekly, policy.weeklyRetention);
    result.weeklyPath = weeklyPath;
  }

  if (policy.externalPath !== undefined) {
    mkdirSync(policy.externalPath, { recursive: true });
    const externalPath = join(policy.externalPath, basename(dailyPath));
    copyFileSync(dailyPath, externalPath);
    result.externalPath = externalPath;
  }

  return result;
};

/**
 * Instante en que se tomó el respaldo. Se lee del propio nombre y no del
 * `mtime`: copiar el artefacto diario para publicarlo como semanal conserva el
 * nombre, no necesariamente la marca del archivo.
 */
const backupStamp = (path: string): number => {
  const stamp = /\.(\d{13})-/.exec(basename(path));
  return stamp ? Number.parseInt(stamp[1]!, 10) : 0;
};

/** Milisegundos hasta la próxima hora local declarada por la política. */
export const millisecondsUntilNextRun = (policy: OperationalBackupPolicy, now: Date): number => {
  const next = new Date(now);
  next.setHours(policy.hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setTime(next.getTime() + DAY_MS);
  return next.getTime() - now.getTime();
};

export type OperationalBackupSchedulerOptions = {
  readonly run: () => void;
  readonly policy: OperationalBackupPolicy;
  readonly onError: (error: unknown) => void;
  readonly now?: () => Date;
};

/**
 * Cadencia desatendida del servicio. Arranca en la próxima hora declarada y
 * repite cada día; un fallo se registra y no detiene la cadencia, porque un
 * disco lleno una noche no debe dejar al nodo sin respaldos para siempre.
 */
export class OperationalBackupScheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly options: OperationalBackupSchedulerOptions) {}

  start(): void {
    if (this.timer !== null) return;
    this.schedule(millisecondsUntilNextRun(
      this.options.policy, this.options.now?.() ?? new Date()
    ));
  }

  stop(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      try {
        this.options.run();
      } catch (error) {
        this.options.onError(error);
      }
      if (this.timer !== null) this.schedule(DAY_MS);
    }, delay);
    this.timer.unref();
  }
}
