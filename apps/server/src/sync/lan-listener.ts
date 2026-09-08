import { readFileSync } from 'node:fs';
import { ApplicationError } from '@supermarket/shared';
import type { SyncTransportDependencies } from './sync-app.ts';

export type SyncListenerConfiguration = {
  readonly host: string;
  readonly port: number;
  readonly https: {
    readonly key: string;
    readonly cert: string;
    readonly ca: readonly string[];
  };
};

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * Lectura del material TLS. Por omisión lee el archivo tal cual; el arranque
 * real inyecta la lectura protegida, que abre el sobre en memoria cuando el
 * material está sellado (ADR-0029 D7.3). El secreto no se copia a disco en
 * claro para poder usarlo.
 */
export type MaterialReader = (path: string) => string;


const readPem = (variable: string, path: string, readMaterial: MaterialReader): string => {
  try {
    const content = readMaterial(path);
    if (content.trim().length === 0) throw new Error('empty');
    return content;
  } catch (cause) {
    throw new ApplicationError(
      'SYNC_LISTENER_MATERIAL_UNREADABLE',
      `The TLS material referenced by ${variable} could not be read.`,
      { cause }
    );
  }
};

/**
 * Configuración del listener técnico de LAN. Falla cerrado: sin material TLS
 * completo y sin nodos de confianza no se escucha, en lugar de degradar a un
 * transporte sin autenticar. Devuelve `null` cuando el nodo no declara ninguna
 * escucha LAN, que es el modo standalone.
 */
export const readSyncListenerConfiguration = (
  environment: Environment = process.env,
  readMaterial: MaterialReader = (path) => readFileSync(path, 'utf8')
): SyncListenerConfiguration | null => {
  const declared = [
    environment.SYNC_LISTENER_PORT,
    environment.SYNC_LISTENER_TLS_KEY_PATH,
    environment.SYNC_LISTENER_TLS_CERT_PATH,
    environment.SYNC_LISTENER_TLS_CLIENT_CA_PATHS
  ];
  if (declared.every((value) => value === undefined || value.trim().length === 0)) return null;
  if (declared.some((value) => value === undefined || value.trim().length === 0)) {
    throw new ApplicationError(
      'SYNC_LISTENER_CONFIGURATION_INCOMPLETE',
      'The LAN sync listener requires port, key, certificate and trusted client authorities.'
    );
  }

  const port = Number.parseInt(environment.SYNC_LISTENER_PORT as string, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ApplicationError(
      'SYNC_LISTENER_PORT_INVALID',
      'The LAN sync listener port is invalid.'
    );
  }

  const caPaths = (environment.SYNC_LISTENER_TLS_CLIENT_CA_PATHS as string)
    .split(',')
    .map((path) => path.trim())
    .filter((path) => path.length > 0);
  if (caPaths.length === 0) {
    throw new ApplicationError(
      'SYNC_LISTENER_CONFIGURATION_INCOMPLETE',
      'The LAN sync listener requires at least one trusted client authority.'
    );
  }

  return {
    host: environment.SYNC_LISTENER_HOST ?? '0.0.0.0',
    port,
    https: {
      key: readPem(
        'SYNC_LISTENER_TLS_KEY_PATH',
        environment.SYNC_LISTENER_TLS_KEY_PATH as string,
        readMaterial
      ),
      cert: readPem(
        'SYNC_LISTENER_TLS_CERT_PATH',
        environment.SYNC_LISTENER_TLS_CERT_PATH as string,
        readMaterial
      ),
      ca: caPaths.map((path) => readPem('SYNC_LISTENER_TLS_CLIENT_CA_PATHS', path, readMaterial))
    }
  };
};

export const toTransportDependencies = (
  reception: Omit<SyncTransportDependencies, 'https'>,
  configuration: SyncListenerConfiguration
): SyncTransportDependencies => ({ ...reception, https: configuration.https });
