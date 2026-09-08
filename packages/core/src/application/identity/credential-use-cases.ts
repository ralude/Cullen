import {
  ApplicationError,
  err,
  ok,
  type AppError,
  type Result
} from '@supermarket/shared';
import type { ExecutionContext } from '../execution-context.js';
import type {
  AuditEntry,
  AuditWriter,
  AuthorizationService,
  Clock,
  CredentialEnrollmentStore,
  EnrollmentConsumption,
  IdGenerator,
  UnitOfWork
} from '../ports/index.js';
import { AUTH_POLICY, type PinHasher, type SessionTokenService } from './authentication.js';
import { IDENTITY_PERMISSIONS } from './permissions.js';

/** Vigencia del ticket de enrolamiento (ADR-0028 D3). */
export const ENROLLMENT_TTL_MS = 15 * 60 * 1000;

const validPin = (pin: string): boolean => new RegExp(
  `^[0-9]{${AUTH_POLICY.PIN_MIN_LENGTH},${AUTH_POLICY.PIN_MAX_LENGTH}}$`
).test(pin);

const pinPolicyError = (): AppError => new ApplicationError(
  'AUTH_PIN_POLICY_VIOLATION',
  'The PIN does not satisfy the credential policy.'
);

const requireReason = (reason: string): string | null => {
  const normalized = reason.trim();
  return normalized.length === 0 || normalized.length > 500 ? null : normalized;
};

export type AuthorizeCredentialEnrollmentInput = {
  readonly operatorCode: string;
  readonly reason: string;
};

export type CredentialEnrollmentTicketDto = {
  readonly enrollmentId: string;
  readonly operatorCode: string;
  readonly displayName: string;
  /** Valor en claro entregado una sola vez; la base solo guarda su hash. */
  readonly enrollmentToken: string;
  readonly expiresAt: Date;
  readonly replacesCredential: boolean;
};

export type CompleteCredentialEnrollmentInput = {
  readonly enrollmentToken: string;
  readonly pin: string;
};

/**
 * Autoriza que un operador materialice su credencial **en este nodo**
 * ([ADR-0028](../../../../../docs/architecture/adr/0028-enrolamiento-local-de-credenciales.md)).
 *
 * No es administración de identidad: la credencial es local por definición, así
 * que este comando funciona también en una terminal, donde la autoridad sobre
 * quién es el operador la aporta la concesión del coordinador.
 */
export class AuthorizeCredentialEnrollment {
  constructor(
    private readonly store: CredentialEnrollmentStore,
    private readonly authorization: AuthorizationService,
    private readonly tokenService: SessionTokenService,
    private readonly auditWriter: AuditWriter,
    private readonly unitOfWork: UnitOfWork,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock
  ) {}

  async execute(
    input: AuthorizeCredentialEnrollmentInput,
    context: ExecutionContext
  ): Promise<Result<CredentialEnrollmentTicketDto, AppError>> {
    if (!(await this.authorization.authorize(context, IDENTITY_PERMISSIONS.RESET_CREDENTIAL))) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to enroll credentials.'));
    }
    const reason = requireReason(input.reason);
    if (reason === null) {
      return err(new ApplicationError('IDENTITY_INPUT_INVALID', 'The reason is required.'));
    }
    const now = this.clock.now();
    const operator = await this.store.enrollableOperator(input.operatorCode.trim(), now);
    if (operator === null) {
      /**
       * Un operador desconocido y uno cuya concesión venció comparten
       * respuesta: conocer un código no revela si existe en otro nodo.
       */
      return err(new ApplicationError('IDENTITY_OPERATOR_NOT_FOUND', 'The operator was not found.'));
    }

    const enrollmentId = this.idGenerator.generate();
    const token = this.tokenService.generate();
    const expiresAt = new Date(now.getTime() + ENROLLMENT_TTL_MS);
    await this.unitOfWork.execute(async () => {
      await this.store.authorizeEnrollment({
        enrollmentId,
        tokenHash: token.hash,
        operatorCode: operator.operatorCode,
        originNodeId: context.originNodeId,
        terminalId: context.terminalId,
        authorizedBy: context.actorId,
        reason,
        authorizedAt: now,
        expiresAt
      });
      await this.auditWriter.append([{
        auditId: this.idGenerator.generate(),
        actorId: context.actorId,
        actorRoleCodes: context.actorRoleCodes ?? [],
        action: 'IDENTITY_CREDENTIAL_ENROLLMENT_AUTHORIZED',
        entityType: 'Credential',
        entityId: operator.operatorCode,
        before: { hasLocalCredential: operator.hasLocalCredential },
        after: { expiresAt: expiresAt.toISOString() },
        reason,
        terminalId: context.terminalId,
        originNodeId: context.originNodeId,
        occurredAt: now,
        correlationId: context.correlationId
      }]);
    });

    return ok({
      enrollmentId,
      operatorCode: operator.operatorCode,
      displayName: operator.displayName,
      enrollmentToken: token.raw,
      expiresAt,
      replacesCredential: operator.hasLocalCredential
    });
  }
}

/**
 * Consume el ticket y materializa la credencial. No exige sesión: el operador
 * todavía no puede iniciar una. La autoridad es el ticket, que ya nació de una
 * decisión autorizada y auditada.
 */
export class CompleteCredentialEnrollment {
  constructor(
    private readonly store: CredentialEnrollmentStore,
    private readonly pinHasher: PinHasher,
    private readonly tokenService: SessionTokenService,
    private readonly auditWriter: AuditWriter,
    private readonly unitOfWork: UnitOfWork,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock
  ) {}

  async execute(
    input: CompleteCredentialEnrollmentInput,
    context: {
      readonly terminalId: string;
      readonly originNodeId: string;
      readonly correlationId: string;
    }
  ): Promise<Result<{ readonly operatorCode: string }, AppError>> {
    if (!validPin(input.pin)) return err(pinPolicyError());
    if (input.enrollmentToken.length === 0) {
      return err(new ApplicationError('IDENTITY_ENROLLMENT_NOT_FOUND', 'The enrollment was not found.'));
    }
    const now = this.clock.now();
    const pinHash = await this.pinHasher.hash(input.pin);

    return this.unitOfWork.execute(async () => {
      const outcome = await this.store.consumeEnrollment({
        tokenHash: this.tokenService.hash(input.enrollmentToken),
        pinHash,
        originNodeId: context.originNodeId,
        terminalId: context.terminalId,
        newUserId: this.idGenerator.generate(),
        now
      });
      if (outcome.status !== 'APPLIED') {
        return err(new ApplicationError(
          ENROLLMENT_FAILURES[outcome.status],
          'The credential enrollment is not usable.'
        ));
      }
      await this.auditWriter.append([{
        auditId: this.idGenerator.generate(),
        actorId: outcome.userId,
        actorRoleCodes: [],
        action: 'IDENTITY_CREDENTIAL_ENROLLED',
        entityType: 'Credential',
        entityId: outcome.operatorCode,
        before: { hadLocalCredential: outcome.replacedCredential },
        after: { createdLocalOperator: outcome.createdLocalOperator },
        reason: 'Credential enrolled on this node.',
        terminalId: context.terminalId,
        originNodeId: context.originNodeId,
        occurredAt: now,
        correlationId: context.correlationId
      }]);
      return ok({ operatorCode: outcome.operatorCode });
    });
  }
}

const ENROLLMENT_FAILURES: Readonly<
  Record<Exclude<EnrollmentConsumption['status'], 'APPLIED'>, string>
> = {
  NOT_FOUND: 'IDENTITY_ENROLLMENT_NOT_FOUND',
  EXPIRED: 'IDENTITY_ENROLLMENT_EXPIRED',
  CONSUMED: 'IDENTITY_ENROLLMENT_CONSUMED',
  NODE_MISMATCH: 'IDENTITY_ENROLLMENT_NODE_MISMATCH',
  OPERATOR_NOT_ENROLLABLE: 'IDENTITY_OPERATOR_NOT_FOUND'
};

/**
 * Caduca la credencial vigente de un operador (ADR-0027 D3, camino 1): el
 * operador sigue ingresando con su PIN actual, pero la sesión resultante solo
 * puede cambiarlo.
 */
export class ExpireOperatorCredential {
  constructor(
    private readonly store: CredentialEnrollmentStore,
    private readonly authorization: AuthorizationService,
    private readonly auditWriter: AuditWriter,
    private readonly unitOfWork: UnitOfWork,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock
  ) {}

  async execute(
    input: { readonly userId: string; readonly reason: string },
    context: ExecutionContext
  ): Promise<Result<{ readonly userId: string }, AppError>> {
    if (!(await this.authorization.authorize(context, IDENTITY_PERMISSIONS.MANAGE_USERS))) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to manage operators.'));
    }
    const reason = requireReason(input.reason);
    if (reason === null) {
      return err(new ApplicationError('IDENTITY_INPUT_INVALID', 'The reason is required.'));
    }
    const now = this.clock.now();
    return this.unitOfWork.execute(async () => {
      if (!await this.store.expireCredential({ userId: input.userId })) {
        return err(new ApplicationError(
          'IDENTITY_CREDENTIAL_NOT_FOUND',
          'The operator has no local credential.'
        ));
      }
      await this.auditWriter.append([this.entry(context, input.userId, reason, now)]);
      return ok({ userId: input.userId });
    });
  }

  private entry(
    context: ExecutionContext, userId: string, reason: string, now: Date
  ): AuditEntry {
    return {
      auditId: this.idGenerator.generate(),
      actorId: context.actorId,
      actorRoleCodes: context.actorRoleCodes ?? [],
      action: 'IDENTITY_CREDENTIAL_EXPIRED',
      entityType: 'Credential',
      entityId: userId,
      before: { mustChange: false },
      after: { mustChange: true },
      reason,
      terminalId: context.terminalId,
      originNodeId: context.originNodeId,
      occurredAt: now,
      correlationId: context.correlationId
    };
  }
}

/**
 * Cambio del PIN propio presentando el actual. Exige sesión válida y ningún
 * permiso: es la única operación que una sesión con cambio obligatorio puede
 * ejecutar además de cerrar sesión.
 */
export class ChangeOwnPin {
  constructor(
    private readonly store: CredentialEnrollmentStore,
    private readonly pinHasher: PinHasher,
    private readonly auditWriter: AuditWriter,
    private readonly unitOfWork: UnitOfWork,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock
  ) {}

  async execute(
    input: { readonly currentPin: string; readonly newPin: string },
    context: ExecutionContext
  ): Promise<Result<{ readonly userId: string }, AppError>> {
    if (!validPin(input.newPin)) return err(pinPolicyError());
    const credential = await this.store.credentialOf(context.actorId);
    if (credential === null) {
      return err(new ApplicationError(
        'IDENTITY_CREDENTIAL_NOT_FOUND',
        'The operator has no local credential.'
      ));
    }
    if (!await this.pinHasher.verify(input.currentPin, credential.pinHash)) {
      return err(new ApplicationError('AUTHENTICATION_FAILED', 'Authentication failed.'));
    }
    const now = this.clock.now();
    const pinHash = await this.pinHasher.hash(input.newPin);
    return this.unitOfWork.execute(async () => {
      if (!await this.store.replaceOwnCredential({ userId: context.actorId, pinHash, now })) {
        return err(new ApplicationError(
          'IDENTITY_CREDENTIAL_NOT_FOUND',
          'The operator has no local credential.'
        ));
      }
      await this.auditWriter.append([{
        auditId: this.idGenerator.generate(),
        actorId: context.actorId,
        actorRoleCodes: context.actorRoleCodes ?? [],
        action: 'IDENTITY_PIN_CHANGED',
        entityType: 'Credential',
        entityId: context.actorId,
        before: null,
        after: null,
        reason: 'Operator changed their own PIN.',
        terminalId: context.terminalId,
        originNodeId: context.originNodeId,
        occurredAt: now,
        correlationId: context.correlationId
      }]);
      return ok({ userId: context.actorId });
    });
  }
}
