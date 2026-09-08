import { fork, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { ADMIN_PERMISSIONS, createSecurityRuntime } from './runtime.ts';

/**
 * Protección del último administrador entre procesos reales.
 *
 * La cobertura de 11.02 intercala dos comandos sobre una misma conexión, lo que
 * demuestra la postcondición pero no la serialización del motor. Aquí cada
 * intento vive en su propio proceso, con su propia conexión al mismo archivo, y
 * ambos disputan la transacción tras una barrera explícita.
 *
 * El nodo impide por diseño que dos procesos sean dueños del mismo archivo
 * (`DATABASE_NODE_LOCKED`), y esa garantía se prueba abajo. Para poder ejercer
 * la protección que hay **debajo** de ella —`BEGIN IMMEDIATE` y la
 * postcondición— la carrera retira deliberadamente el archivo de propiedad
 * entre una apertura y la otra. Es lo único que la prueba subvierte: ambos
 * procesos usan el mismo composition root que el servidor.
 */
const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = join(SERVER_ROOT, 'src/testing/last-administrator-worker.ts');
/** `tsx` es la dependencia con la que este paquete arranca su propio proceso. */
const CHILD = { execArgv: ['--import', 'tsx'], cwd: SERVER_ROOT };

type WorkerOutcome = {
  readonly pid: number;
  readonly ready: boolean;
  readonly attempted: boolean;
  readonly ok: boolean;
  readonly code: string | null;
};

describe('carrera del último administrador entre procesos', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  const databaseFile = (): string => {
    const directory = mkdtempSync(join(tmpdir(), 'cullen-race-'));
    directories.push(directory);
    return join(directory, 'node.sqlite');
  };

  /** Deja el nodo con `administrators` administradores efectivos y devuelve sus ids. */
  const seed = async (
    databasePath: string, administrators: number
  ): Promise<readonly string[]> => {
    const runtime = createSecurityRuntime(
      databasePath, { terminalId: 'terminal-001', originNodeId: 'node-001' }, {}, null
    );
    try {
      const provisioned = await runtime.provisionInitialAdmin.execute({
        operatorCode: 'OP001', displayName: 'Administrador', pin: '827364',
        permissions: ADMIN_PERMISSIONS
      });
      expect(provisioned.ok).toBe(true);
      const first = runtime.handle.sqlite.prepare(
        "select id from identity_users where operator_code = 'OP001'"
      ).pluck().get() as string;
      const roleId = runtime.handle.sqlite.prepare(
        "select id from identity_roles where code = 'ADMIN'"
      ).pluck().get() as string;
      const context = {
        actorId: first, actorRoleCodes: ['ADMIN'], terminalId: 'terminal-001',
        originNodeId: 'node-001', correlationId: 'seed'
      };
      const ids = [first];
      for (let index = 1; index < administrators; index += 1) {
        const created = await runtime.dependencies.identity.createOperator.execute({
          operatorCode: `OP00${index + 1}`, displayName: `Administrador ${index + 1}`,
          roleIds: [roleId], reason: 'Segundo administrador para la carrera'
        }, context);
        expect(created.ok, created.ok ? '' : created.error.code).toBe(true);
        if (created.ok) ids.push(created.value.userId);
      }
      return ids;
    } finally {
      runtime.handle.close();
    }
  };

  const collect = (child: ChildProcess): {
    readonly ready: Promise<void>;
    readonly outcome: Promise<WorkerOutcome>;
    readonly ended: Promise<void>;
  } => {
    const state: { -readonly [K in keyof WorkerOutcome]: WorkerOutcome[K] } = {
      pid: child.pid ?? 0, ready: false, attempted: false, ok: false, code: 'NO_ANSWER'
    };
    let markReady = (): void => undefined;
    const ready = new Promise<void>((resolve) => { markReady = resolve; });
    const outcome = new Promise<WorkerOutcome>((resolve, reject) => {
      child.on('message', (message) => {
        const payload = message as Partial<WorkerOutcome> & { readonly done?: boolean };
        if (payload.ready) { state.ready = true; markReady(); }
        if (payload.attempted) state.attempted = true;
        if (payload.done) {
          state.ok = payload.ok ?? false;
          state.code = payload.code ?? null;
          resolve({ ...state });
        }
      });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (!state.attempted) reject(new Error(`El proceso hijo terminó con ${String(code)}`));
      });
    });
    /** El hijo suelta el archivo al salir: leerlo antes sería disputarle la propiedad. */
    const ended = new Promise<void>((resolve) => { child.on('exit', () => resolve()); });
    return { ready, outcome, ended };
  };

  /**
   * Ejecuta la carrera: abre el primer proceso, retira el archivo de propiedad,
   * abre el segundo y solo entonces libera la barrera para ambos.
   */
  const race = async (
    databasePath: string,
    commands: readonly [readonly string[], readonly string[]]
  ): Promise<readonly WorkerOutcome[]> => {
    const spawn = (args: readonly string[]): ChildProcess => fork(
      WORKER, [databasePath, 'terminal-001', ...args],
      { ...CHILD, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] }
    );

    const first = spawn(commands[0]);
    const firstMessages = collect(first);
    await firstMessages.ready;
    /** Único artificio: sin esto el segundo proceso sería rechazado como dueño. */
    unlinkSync(`${databasePath}.owner`);

    const second = spawn(commands[1]);
    const secondMessages = collect(second);
    await secondMessages.ready;

    first.send({ go: true });
    second.send({ go: true });
    const outcomes = await Promise.all([firstMessages.outcome, secondMessages.outcome]);
    await Promise.all([firstMessages.ended, secondMessages.ended]);
    /** Antivacuidad: dos procesos distintos, distintos del que corre la prueba. */
    expect(new Set(outcomes.map((outcome) => outcome.pid)).size).toBe(2);
    for (const outcome of outcomes) {
      expect(outcome.pid).not.toBe(process.pid);
      expect(outcome.ready && outcome.attempted).toBe(true);
    }
    return outcomes;
  };

  const inspect = (databasePath: string): {
    readonly administrators: number;
    readonly rejections: number;
  } => {
    const runtime = createSecurityRuntime(
      databasePath, { terminalId: 'terminal-001', originNodeId: 'node-001' }, {}, null
    );
    try {
      return {
        administrators: runtime.handle.sqlite.prepare(`
          select count(distinct u.id) from identity_users u
            join identity_user_roles ur on ur.user_id = u.id
            join identity_roles r on r.id = ur.role_id
            join identity_role_permissions rp on rp.role_id = r.id
          where u.is_active = 1 and r.is_active = 1 and rp.permission_code = 'identity.user.manage'
        `).pluck().get() as number,
        rejections: runtime.handle.sqlite.prepare(
          "select count(*) from audit_log where action like '%_REJECTED'"
        ).pluck().get() as number
      };
    } finally {
      runtime.handle.close();
    }
  };

  it('no deja que dos procesos sean dueños del mismo archivo', async () => {
    const databasePath = databaseFile();
    await seed(databasePath, 1);
    const owner = createSecurityRuntime(
      databasePath, { terminalId: 'terminal-001', originNodeId: 'node-001' }, {}, null
    );
    try {
      const intruder = fork(
        WORKER, [databasePath, 'terminal-002', 'ghost', 'DEACTIVATE', 'ghost'],
        { ...CHILD, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }
      );
      const refusal = await new Promise<{ code: string | null; exit: number | null }>((done) => {
        let code: string | null = null;
        intruder.on('message', (message) => {
          code = (message as { readonly code?: string | null }).code ?? null;
        });
        intruder.on('exit', (exit) => done({ code, exit }));
      });
      /** El intruso no llega a operar: el nodo le niega la propiedad del archivo. */
      expect(refusal.code).toBe('DATABASE_NODE_LOCKED');
      expect(refusal.exit).not.toBe(0);
    } finally {
      owner.handle.close();
    }
  }, 60_000);

  it('rechaza en ambos procesos el cambio que dejaría el nodo sin administración', async () => {
    const databasePath = databaseFile();
    const [administrator] = await seed(databasePath, 1);

    /** Los dos caminos convergen en la misma postcondición: ninguno puede ganar. */
    const outcomes = await race(databasePath, [
      [administrator!, 'DEACTIVATE', administrator!],
      [administrator!, 'CLEAR_ROLES', administrator!]
    ]);

    for (const outcome of outcomes) {
      expect(outcome.ok).toBe(false);
      expect(outcome.code).toBe('IDENTITY_LAST_ADMINISTRATOR');
    }
    const state = inspect(databasePath);
    expect(state.administrators).toBe(1);
    expect(state.rejections).toBe(2);
  }, 60_000);

  it('confirma como mucho el cambio válido cuando dos procesos se disputan el último', async () => {
    const databasePath = databaseFile();
    const [first, second] = await seed(databasePath, 2);

    /** Cada proceso retira al otro administrador: solo uno puede confirmar. */
    const outcomes = await race(databasePath, [
      [first!, 'DEACTIVATE', second!],
      [second!, 'DEACTIVATE', first!]
    ]);

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    const refused = outcomes.find((outcome) => !outcome.ok)!;
    /**
     * El perdedor falla cerrado por una de dos razones honestas: llegó a la
     * postcondición y la violó, o el ganador ya había retirado la
     * administración de su actor y ni siquiera fue autorizado.
     */
    expect(['IDENTITY_LAST_ADMINISTRATOR', 'FORBIDDEN']).toContain(refused.code);
    expect(inspect(databasePath).administrators).toBe(1);
  }, 60_000);
});
