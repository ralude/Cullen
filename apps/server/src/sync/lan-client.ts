import { readFileSync } from 'node:fs';
import { ApplicationError } from '@supermarket/shared';
import type { SyncTransportConfiguration } from '@supermarket/driver-security';

type Environment = Readonly<Record<string, string | undefined>>;

const readPem = (variable: string, path: string): string => {
  try {
    const content = readFileSync(path, 'utf8');
    if (content.trim().length === 0) throw new Error('empty');
    return content;
  } catch (cause) {
    throw new ApplicationError(
      'SYNC_CLIENT_MATERIAL_UNREADABLE',
      `The TLS material referenced by ${variable} could not be read.`,
      { cause }
    );
  }
};

/**
 * Configuración del cliente de entrega hacia el coordinador. Falla cerrado:
 * sin destino, identidad y autoridades completas no se entrega, en lugar de
 * degradar a un transporte sin autenticación mutua. Devuelve `null` cuando el
 * nodo no declara coordinador, que es el modo standalone.
 */
export const readSyncClientConfiguration = (
  environment: Environment = process.env
): SyncTransportConfiguration | null => {
  const declared = [
    environment.SYNC_COORDINATOR_NODE_ID,
    environment.SYNC_COORDINATOR_HOST,
    environment.SYNC_COORDINATOR_PORT,
    environment.SYNC_CLIENT_TLS_KEY_PATH,
    environment.SYNC_CLIENT_TLS_CERT_PATH,
    environment.SYNC_CLIENT_TLS_CA_PATHS
  ];
  if (declared.every((value) => value === undefined || value.trim().length === 0)) return null;
  if (declared.some((value) => value === undefined || value.trim().length === 0)) {
    throw new ApplicationError(
      'SYNC_CLIENT_CONFIGURATION_INCOMPLETE',
      'The LAN sync client requires destination, identity and trusted authorities.'
    );
  }

  const port = Number.parseInt(environment.SYNC_COORDINATOR_PORT as string, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ApplicationError(
      'SYNC_CLIENT_PORT_INVALID',
      'The coordinator port is invalid.'
    );
  }

  const caPaths = (environment.SYNC_CLIENT_TLS_CA_PATHS as string)
    .split(',')
    .map((path) => path.trim())
    .filter((path) => path.length > 0);
  if (caPaths.length === 0) {
    throw new ApplicationError(
      'SYNC_CLIENT_CONFIGURATION_INCOMPLETE',
      'The LAN sync client requires at least one trusted authority.'
    );
  }

  const timeout = environment.SYNC_CLIENT_TIMEOUT_MS === undefined
    ? undefined
    : Number.parseInt(environment.SYNC_CLIENT_TIMEOUT_MS, 10);
  if (timeout !== undefined && (!Number.isInteger(timeout) || timeout < 1)) {
    throw new ApplicationError(
      'SYNC_CLIENT_TIMEOUT_INVALID',
      'The configured delivery timeout is invalid.'
    );
  }

  return {
    host: environment.SYNC_COORDINATOR_HOST as string,
    port,
    destinationNodeId: environment.SYNC_COORDINATOR_NODE_ID as string,
    key: readPem('SYNC_CLIENT_TLS_KEY_PATH', environment.SYNC_CLIENT_TLS_KEY_PATH as string),
    cert: readPem('SYNC_CLIENT_TLS_CERT_PATH', environment.SYNC_CLIENT_TLS_CERT_PATH as string),
    ca: caPaths.map((path) => readPem('SYNC_CLIENT_TLS_CA_PATHS', path)),
    ...(timeout === undefined ? {} : { timeoutMilliseconds: timeout })
  };
};

/** Intervalo del worker; un valor inválido no degrada silenciosamente a otro. */
export const readSyncWorkerInterval = (environment: Environment = process.env): number => {
  const raw = environment.SYNC_WORKER_INTERVAL_MS;
  if (raw === undefined || raw.trim().length === 0) return 5_000;
  const interval = Number.parseInt(raw, 10);
  if (!Number.isInteger(interval) || interval < 250 || interval > 600_000) {
    throw new ApplicationError(
      'SYNC_WORKER_INTERVAL_INVALID',
      'The configured sync worker interval is invalid.'
    );
  }
  return interval;
};
