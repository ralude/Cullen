import { ApplicationError, err, ok, type AppError, type Result } from '@supermarket/shared';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';

export const AUTH_POLICY = {
  PIN_MIN_LENGTH: 6,
  PIN_MAX_LENGTH: 12,
  MAX_FAILURES: 5,
  FAILURE_WINDOW_MS: 15 * 60 * 1000,
  LOCKOUT_MS: 15 * 60 * 1000,
  IDLE_SESSION_MS: 30 * 60 * 1000,
  ABSOLUTE_SESSION_MS: 8 * 60 * 60 * 1000
} as const;

export type AuthenticationRecord = {
  readonly userId: string;
  readonly operatorCode: string;
  readonly displayName: string;
  readonly pinHash: string;
  readonly credentialVersion: number;
  readonly authorizationVersion: number;
  readonly isActive: boolean;
};

export type SessionPrincipal = {
  readonly actorId: string;
  readonly displayName: string;
  readonly roleCodes: readonly string[];
  readonly permissionCodes: readonly string[];
  readonly terminalId: string;
  readonly originNodeId: string;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
};

export type AuthenticationCompletion =
  | { readonly authenticated: true; readonly principal: SessionPrincipal }
  | { readonly authenticated: false };

/**
 * Estado de la concesión que el coordinador emitió para un operador.
 *
 * `governed: false` es el caso standalone: nadie publicó una concesión para ese
 * operador y su autorización local sigue intacta. Cuando existe, la concesión
 * es la autoridad de sus permisos en esta terminal y su vigencia se aplica
 * **además** de los límites de sesión de ADR-0011, conforme ADR-0026 D5.
 */
export type OperatorGrantState =
  | { readonly governed: false }
  | {
    readonly governed: true;
    /** Vigente y activa. Una concesión vencida o revocada no es utilizable. */
    readonly usable: boolean;
    readonly roleCodes: readonly string[];
    readonly permissionCodes: readonly string[];
    readonly expiresAt: Date;
  };

export interface AuthenticationStore {
  findByOperatorCode(operatorCode: string): Promise<AuthenticationRecord | null>;
  completeAttempt(input: {
    readonly userId: string;
    readonly credentialVersion: number;
    readonly pinVerified: boolean;
    readonly tokenHash?: string;
    readonly terminalId: string;
    readonly originNodeId: string;
    readonly now: Date;
    readonly idleExpiresAt?: Date;
    readonly absoluteExpiresAt?: Date;
  }): Promise<AuthenticationCompletion>;
  verifyAndTouchSession(tokenHash: string, now: Date): Promise<SessionPrincipal | null>;
  /**
   * Concesión vigente del operador, buscada por su código de negocio: el
   * `userId` del coordinador y el local no son el mismo identificador.
   */
  operatorGrantState(operatorCode: string, now: Date): Promise<OperatorGrantState>;
  revokeSession(tokenHash: string, now: Date): Promise<void>;
  provisionInitialAdmin(input: {
    readonly userId: string;
    readonly roleId: string;
    readonly operatorCode: string;
    readonly displayName: string;
    readonly pinHash: string;
    readonly permissions: readonly string[];
    readonly now: Date;
  }): Promise<boolean>;
}

export interface PinHasher {
  hash(pin: string): Promise<string>;
  verify(pin: string, encodedHash: string): Promise<boolean>;
  verifyDummy(pin: string): Promise<void>;
}

export interface SessionTokenService {
  generate(): { readonly raw: string; readonly hash: string };
  hash(raw: string): string;
}

const normalizeOperatorCode = (value: string): string => value.trim().toUpperCase();

const validPin = (pin: string): boolean => new RegExp(
  `^[0-9]{${AUTH_POLICY.PIN_MIN_LENGTH},${AUTH_POLICY.PIN_MAX_LENGTH}}$`
).test(pin);

export class AuthenticateOperator {
  constructor(
    private readonly store: AuthenticationStore,
    private readonly pinHasher: PinHasher,
    private readonly tokenService: SessionTokenService,
    private readonly clock: Clock
  ) {}

  async execute(input: {
    readonly operatorCode: string;
    readonly pin: string;
    readonly terminalId: string;
    readonly originNodeId: string;
  }): Promise<Result<{ readonly token: string; readonly principal: SessionPrincipal }, AppError>> {
    const operatorCode = normalizeOperatorCode(input.operatorCode);
    if (operatorCode.length === 0 || !validPin(input.pin)) {
      await this.pinHasher.verifyDummy(input.pin);
      return err(new ApplicationError('AUTHENTICATION_FAILED', 'Authentication failed.'));
    }

    const record = await this.store.findByOperatorCode(operatorCode);
    if (record === null || !record.isActive) {
      await this.pinHasher.verifyDummy(input.pin);
      return err(new ApplicationError('AUTHENTICATION_FAILED', 'Authentication failed.'));
    }

    const pinVerified = await this.pinHasher.verify(input.pin, record.pinHash);
    const now = this.clock.now();

    /**
     * Una concesión vencida o revocada deniega la sesión nueva aunque el PIN
     * sea correcto (ADR-0026 D5). La comprobación va **después** de verificar
     * el PIN para que su código propio no revele qué operadores existen, y el
     * intento se cierra sin token: no se abre sesión ni queda el fallo contado
     * como PIN incorrecto.
     */
    const grant = pinVerified
      ? await this.store.operatorGrantState(operatorCode, now)
      : { governed: false } as const;
    if (grant.governed && !grant.usable) {
      return err(new ApplicationError(
        'AUTH_GRANT_UNAVAILABLE',
        'The operator grant issued by the coordinator is expired or revoked.'
      ));
    }

    const token = pinVerified ? this.tokenService.generate() : undefined;
    const completion = await this.store.completeAttempt({
      userId: record.userId,
      credentialVersion: record.credentialVersion,
      pinVerified,
      ...(token ? { tokenHash: token.hash } : {}),
      terminalId: input.terminalId,
      originNodeId: input.originNodeId,
      now,
      ...(token ? {
        idleExpiresAt: new Date(now.getTime() + AUTH_POLICY.IDLE_SESSION_MS),
        absoluteExpiresAt: new Date(now.getTime() + AUTH_POLICY.ABSOLUTE_SESSION_MS)
      } : {})
    });

    if (!completion.authenticated || token === undefined) {
      return err(new ApplicationError('AUTHENTICATION_FAILED', 'Authentication failed.'));
    }
    return ok({ token: token.raw, principal: completion.principal });
  }
}

export class VerifySession {
  constructor(
    private readonly store: AuthenticationStore,
    private readonly tokenService: SessionTokenService,
    private readonly clock: Clock
  ) {}

  async execute(rawToken: string): Promise<Result<SessionPrincipal, AppError>> {
    if (rawToken.length === 0) return err(new ApplicationError('UNAUTHORIZED', 'Session is invalid.'));
    const principal = await this.store.verifyAndTouchSession(
      this.tokenService.hash(rawToken),
      this.clock.now()
    );
    return principal
      ? ok(principal)
      : err(new ApplicationError('UNAUTHORIZED', 'Session is invalid.'));
  }
}

export class RevokeSession {
  constructor(
    private readonly store: AuthenticationStore,
    private readonly tokenService: SessionTokenService,
    private readonly clock: Clock
  ) {}

  async execute(rawToken: string): Promise<void> {
    if (rawToken.length > 0) {
      await this.store.revokeSession(this.tokenService.hash(rawToken), this.clock.now());
    }
  }
}

export class ProvisionInitialAdmin {
  constructor(
    private readonly store: AuthenticationStore,
    private readonly pinHasher: PinHasher,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock
  ) {}

  async execute(input: {
    readonly operatorCode: string;
    readonly displayName: string;
    readonly pin: string;
    readonly permissions: readonly string[];
  }): Promise<Result<{ readonly userId: string }, AppError>> {
    const operatorCode = normalizeOperatorCode(input.operatorCode);
    if (operatorCode.length === 0 || input.displayName.trim().length === 0 || !validPin(input.pin)) {
      return err(new ApplicationError('AUTH_PROVISION_INPUT_INVALID', 'Admin provisioning input is invalid.'));
    }
    const pinHash = await this.pinHasher.hash(input.pin);
    const userId = this.idGenerator.generate();
    const created = await this.store.provisionInitialAdmin({
      userId,
      roleId: this.idGenerator.generate(),
      operatorCode,
      displayName: input.displayName.trim(),
      pinHash,
      permissions: [...new Set(input.permissions)],
      now: this.clock.now()
    });
    return created
      ? ok({ userId })
      : err(new ApplicationError('AUTH_ALREADY_PROVISIONED', 'An operator already exists.'));
  }
}

