/**
 * Superficie pública mínima para pruebas de sistema de otros workspaces.
 * Mantiene la composición real del nodo sin obligarlos a importar internos.
 */
export { buildApp } from './app.ts';
export { ADMIN_PERMISSIONS, createSecurityRuntime } from './runtime.ts';
export type { SecurityRuntime } from './runtime.ts';
