import { createSecurityRuntime } from '../runtime.ts';

/**
 * Proceso hijo de la carrera del último administrador.
 *
 * Compone el nodo real —`createSecurityRuntime` sobre el mismo archivo SQLite—
 * y ejecuta un único comando de identidad cuando el padre libera la barrera.
 * No contiene reglas: su valor es ser un proceso operativo distinto, con su
 * propia conexión, disputando la transacción contra otro igual.
 */
type Command =
  | { readonly kind: 'DEACTIVATE'; readonly userId: string }
  | { readonly kind: 'CLEAR_ROLES'; readonly userId: string };

const [databasePath, terminalId, actorId, kind, userId] = process.argv.slice(2) as [
  string, string, string, Command['kind'], string
];

const send = (message: Record<string, unknown>): void => {
  process.send?.({ pid: process.pid, ...message });
};

const barrier = new Promise<void>((resolve) => {
  process.once('message', (message) => {
    if ((message as { readonly go?: boolean }).go === true) resolve();
  });
});

/**
 * Abrir el nodo puede fallar por sí mismo —por ejemplo si otro proceso ya es
 * dueño del archivo—: ese código también es un resultado que el padre observa.
 */
let runtime;
try {
  runtime = createSecurityRuntime(
    databasePath, { terminalId, originNodeId: 'node-001' }, {}, null
  );
} catch (error) {
  send({
    done: true,
    ok: false,
    code: error instanceof Error && 'code' in error ? String(error.code) : 'UNEXPECTED'
  });
  process.exit(1);
}

const context = {
  actorId,
  actorRoleCodes: [],
  terminalId,
  originNodeId: 'node-001',
  correlationId: `race-${process.pid}`
};

try {
  send({ ready: true });
  await barrier;
  send({ attempted: true });
  const result = kind === 'DEACTIVATE'
    ? await runtime.dependencies.identity.changeOperatorStatus.execute(
      { userId, isActive: false, reason: 'Carrera del último administrador' }, context
    )
    : await runtime.dependencies.identity.assignOperatorRoles.execute(
      { userId, roleIds: [], reason: 'Carrera del último administrador' }, context
    );
  send({ done: true, ok: result.ok, code: result.ok ? null : result.error.code });
} catch (error) {
  send({
    done: true,
    ok: false,
    code: error instanceof Error && 'code' in error ? String(error.code) : 'UNEXPECTED'
  });
} finally {
  runtime.handle.close();
  process.exit(0);
}
