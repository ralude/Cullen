import { ApplicationError, err, ok, type AppError, type Result } from '@supermarket/shared';
import type { JsonValue } from '../events/index.js';
import type {
  AggregateAuthorityRegistry,
  AuditWriter,
  Clock,
  IdGenerator,
  SyncSenderContext,
  UnitOfWork
} from '../ports/index.js';

/**
 * Tipos cuya alta puede delegarse a una terminal ya autorizada: los agregados
 * que crea por su propia competencia. Catálogo, tasas, stock, compras y conteos
 * quedan fuera; su autoridad no se concede por reconectar.
 */
export const DELEGATED_AUTHORITY_TYPES = [
  'Sale',
  'SaleReturn',
  'Shift',
  'FiscalDocument',
  'FiscalDay'
] as const;

export type RegisterOwnedAggregateInput = {
  readonly aggregateType: string;
  readonly aggregateId: string;
  /** Huella acotada de la evidencia local de creación; no transporta payload. */
  readonly evidenceFingerprint: string;
};

export type AggregateAuthorityReceiptV1 = {
  readonly protocolVersion: 1;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly status: 'REGISTERED' | 'ALREADY_REGISTERED' | 'REJECTED';
  readonly ownerNodeId: string | null;
  readonly code?: string;
};

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_:-]{1,127}$/;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

const rejected = (
  input: RegisterOwnedAggregateInput,
  code: string
): AggregateAuthorityReceiptV1 => ({
  protocolVersion: 1,
  aggregateType: input.aggregateType,
  aggregateId: input.aggregateId,
  status: 'REJECTED',
  ownerNodeId: null,
  code
});

/**
 * Alta técnica y auditable del dueño de un agregado creado offline por una
 * terminal previamente autorizada. Es una operación separada del evento
 * comercial y anterior a su entrega: registrar el agregado no valida su
 * contenido. Una contradicción con el dueño o la evidencia registrados no
 * reasigna autoridad, y una reentrega idéntica devuelve el mismo resultado.
 */
export class RegisterOwnedAggregate {
  constructor(
    private readonly authorities: AggregateAuthorityRegistry,
    private readonly clock: Clock,
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly auditWriter?: AuditWriter
  ) {}

  async execute(
    input: unknown,
    sender: SyncSenderContext
  ): Promise<Result<AggregateAuthorityReceiptV1, AppError>> {
    const request = parse(input);
    if (!request) {
      return err(new ApplicationError(
        'SYNC_AUTHORITY_REQUEST_INVALID',
        'The aggregate authority request is invalid.'
      ));
    }
    if (!(DELEGATED_AUTHORITY_TYPES as readonly string[]).includes(request.aggregateType)) {
      return ok(rejected(request, 'SYNC_AUTHORITY_TYPE_NOT_DELEGATED'));
    }
    /**
     * El alta delegada existe para agregados propios de una terminal. El
     * coordinador no la solicita: aceptarla le permitiría registrarse como
     * dueño de una venta o un turno en el registro de una terminal.
     */
    if (sender.coordinatorNodeId !== null && sender.verifiedNodeId === sender.coordinatorNodeId) {
      return ok(rejected(request, 'SYNC_AUTHORITY_DELEGATION_NOT_ALLOWED'));
    }

    const now = this.clock.now();
    const outcome = await this.unitOfWork.execute(async () => {
      const registration = await this.authorities.register({
        aggregateType: request.aggregateType,
        aggregateId: request.aggregateId,
        ownerNodeId: sender.verifiedNodeId,
        source: 'DELEGATED',
        evidenceFingerprint: request.evidenceFingerprint,
        registeredAt: now,
        registeredBy: sender.verifiedNodeId
      });
      if (registration.outcome === 'REGISTERED') {
        await this.auditWriter?.append([{
          auditId: this.ids.generate(),
          actorId: sender.verifiedNodeId,
          actorRoleCodes: [],
          action: 'SYNC_AGGREGATE_AUTHORITY_DELEGATED',
          entityType: request.aggregateType,
          entityId: request.aggregateId,
          before: null,
          after: {
            ownerNodeId: sender.verifiedNodeId,
            evidenceFingerprint: request.evidenceFingerprint
          } as unknown as JsonValue,
          reason: 'Alta delegada de un agregado creado sin conexión.',
          terminalId: sender.verifiedTerminalId ?? sender.verifiedNodeId,
          originNodeId: sender.verifiedNodeId,
          occurredAt: now,
          correlationId: request.evidenceFingerprint
        }]);
      }
      return registration;
    });

    if (outcome.outcome === 'CONFLICT') {
      return ok(rejected(request, 'SYNC_AUTHORITY_CONFLICT'));
    }
    return ok({
      protocolVersion: 1,
      aggregateType: request.aggregateType,
      aggregateId: request.aggregateId,
      status: outcome.outcome,
      ownerNodeId: outcome.ownerNodeId
    });
  }
}

const parse = (input: unknown): RegisterOwnedAggregateInput | null => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const candidate = input as Record<string, unknown>;
  const fields = ['aggregateType', 'aggregateId', 'evidenceFingerprint'];
  if (Object.keys(candidate).length !== fields.length) return null;
  const { aggregateType, aggregateId, evidenceFingerprint } = candidate;
  if (typeof aggregateType !== 'string' || !IDENTIFIER_PATTERN.test(aggregateType)) return null;
  if (typeof aggregateId !== 'string' || !IDENTIFIER_PATTERN.test(aggregateId)) return null;
  if (typeof evidenceFingerprint !== 'string' ||
    !FINGERPRINT_PATTERN.test(evidenceFingerprint)) return null;
  return { aggregateType, aggregateId, evidenceFingerprint };
};
