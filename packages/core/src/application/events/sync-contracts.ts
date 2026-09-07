import { SYNC_LIMITS_V1, type JsonObject, type JsonValue } from '@supermarket/shared';

/**
 * Catálogo cerrado de contratos de integración por `(eventType, contractVersion)`.
 * No hay downgrade, upcaster genérico ni aceptación por un cast de TypeScript:
 * un cambio de forma exige publicar una versión nueva.
 */
export type SyncContractDirection = 'TERMINAL_TO_COORDINATOR' | 'COORDINATOR_TO_TERMINAL';

/**
 * Consumidores implementados del receptor. Cada uno confirma su efecto y su
 * progreso en la misma transacción; recibir un hecho no equivale a aplicarlo.
 */
export const SYNC_CONSUMERS_V1 = [
  'INVENTORY_AUTHORITY',
  'CATALOG_REFERENCE',
  'COMMERCIAL_PROJECTION'
] as const;
export type SyncConsumerId = (typeof SYNC_CONSUMERS_V1)[number];

/** Nombres de los consumidores, para no depender de su posición en la lista. */
export const SYNC_CONSUMERS = {
  inventoryAuthority: 'INVENTORY_AUTHORITY',
  catalogReference: 'CATALOG_REFERENCE',
  commercialProjection: 'COMMERCIAL_PROJECTION'
} as const satisfies Record<string, SyncConsumerId>;

export type SyncAggregateRef = {
  readonly aggregateType: string;
  readonly aggregateId: string;
};

type ObjectFields = { readonly [key: string]: ValueSpec };

export type ValueSpec =
  | { readonly kind: 'identifier'; readonly nullable?: true }
  | { readonly kind: 'text'; readonly nullable?: true; readonly maxLength?: number }
  | { readonly kind: 'currency' }
  | { readonly kind: 'integer'; readonly min?: number }
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  | { readonly kind: 'money' }
  | { readonly kind: 'taxRate' }
  | { readonly kind: 'object'; readonly fields: ObjectFields; readonly nullable?: true }
  | { readonly kind: 'array'; readonly item: ValueSpec };

const identifier = (nullable?: true): ValueSpec =>
  nullable ? { kind: 'identifier', nullable } : { kind: 'identifier' };
const text = (nullable?: true): ValueSpec =>
  nullable ? { kind: 'text', nullable } : { kind: 'text' };
const integer = (min?: number): ValueSpec =>
  min === undefined ? { kind: 'integer' } : { kind: 'integer', min };
const money: ValueSpec = { kind: 'money' };
const object = (fields: ObjectFields, nullable?: true): ValueSpec =>
  nullable ? { kind: 'object', fields, nullable } : { kind: 'object', fields };
const array = (item: ValueSpec): ValueSpec => ({ kind: 'array', item });

const isPlainObject = (value: JsonValue): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isIdentifier = (value: JsonValue): boolean => typeof value === 'string' &&
  value.trim().length > 0 && value.length <= SYNC_LIMITS_V1.maxIdentifierLength;

const matchesObject = (fields: ObjectFields, value: JsonValue): boolean => {
  if (!isPlainObject(value)) return false;
  const declared = Object.keys(fields);
  if (Object.keys(value).length !== declared.length) return false;
  return declared.every((key) =>
    Object.prototype.hasOwnProperty.call(value, key) &&
    matchesSpec(fields[key] as ValueSpec, value[key] as JsonValue));
};

/** Valida un valor recibido sin coerciones: nada se completa ni se convierte. */
export const matchesSpec = (spec: ValueSpec, value: JsonValue): boolean => {
  switch (spec.kind) {
    case 'identifier':
      return (spec.nullable === true && value === null) || isIdentifier(value);
    case 'text':
      return (spec.nullable === true && value === null) || (typeof value === 'string' &&
        value.length <= (spec.maxLength ?? SYNC_LIMITS_V1.maxTextLength));
    case 'currency':
      return typeof value === 'string' && /^[A-Z]{3}$/.test(value);
    case 'integer':
      return Number.isSafeInteger(value) &&
        (spec.min === undefined || (value as number) >= spec.min);
    case 'enum':
      return typeof value === 'string' && spec.values.includes(value);
    case 'money':
      return matchesObject({ minorUnits: integer(), currencyCode: { kind: 'currency' } }, value);
    case 'taxRate':
      return matchesObject({ basisPoints: integer(0) }, value);
    case 'object':
      return (spec.nullable === true && value === null) || matchesObject(spec.fields, value);
    case 'array':
      return Array.isArray(value) && value.length <= SYNC_LIMITS_V1.maxArrayLength &&
        value.every((entry) => matchesSpec(spec.item, entry));
    default:
      return false;
  }
};

/** Cota explícita de anidamiento del payload, independiente del contrato. */
export const withinDepth = (value: JsonValue, remaining: number): boolean => {
  if (remaining < 0) return false;
  if (Array.isArray(value)) return value.every((entry) => withinDepth(entry, remaining - 1));
  if (isPlainObject(value)) {
    return Object.values(value).every((entry) => withinDepth(entry as JsonValue, remaining - 1));
  }
  return true;
};

export type SyncEventContractV1 = {
  readonly eventType: string;
  /**
   * Versión del contrato. El catálogo se indexa por `(eventType,
   * contractVersion)`: una versión nueva se **añade**, nunca reemplaza a la
   * anterior, para que un emisor que todavía publica v1 siga siendo aceptado.
   */
  readonly contractVersion: number;
  readonly aggregateType: string;
  readonly direction: SyncContractDirection;
  readonly fields: ObjectFields;
  /** Campo del payload que repite el nodo de origen, si el contrato lo transporta. */
  readonly payloadOriginField: string | null;
  /** Campo del payload que declara la terminal, si el contrato la transporta. */
  readonly payloadTerminalField: string | null;
  /** Consumidor previsto en el destino, en prosa de negocio. */
  readonly intendedConsumer: string;
  /**
   * Consumidores implementados que reciben trabajo durable al aceptar el
   * hecho. Un contrato sin consumidor implementado declara una lista vacía:
   * la custodia no se presenta como aplicación.
   */
  readonly consumers: readonly SyncConsumerId[];
  /**
   * Dependencias declaradas del hecho. Recibe también la identidad del agregado
   * del sobre, porque una referencia puede depender de otro agregado
   * identificado por ella misma sin repetir ese ID dentro del payload.
   */
  readonly dependencies: (
    payload: JsonObject,
    aggregateId: string
  ) => readonly SyncAggregateRef[];
};

const evidence = object({
  dispatchState: { kind: 'enum', values: ['NOT_STARTED', 'STARTED', 'RESULT_RECEIVED'] },
  commandEffect: { kind: 'enum', values: ['APPLIED', 'NOT_APPLIED', 'REJECTED', 'UNKNOWN'] },
  fiscalCommit: { kind: 'enum', values: ['COMMITTED', 'NOT_COMMITTED', 'UNKNOWN'] },
  printDelivery: { kind: 'enum', values: ['COMPLETE', 'INCOMPLETE', 'UNKNOWN'] }
});

const noDependencies = (): readonly SyncAggregateRef[] => [];

const reference = (
  aggregateType: string,
  payload: JsonObject,
  field: string
): readonly SyncAggregateRef[] => {
  const aggregateId = payload[field];
  return typeof aggregateId === 'string' && aggregateId.length > 0
    ? [{ aggregateType, aggregateId }]
    : [];
};

const activityFlag: ValueSpec = { kind: 'enum', values: ['ACTIVE', 'INACTIVE'] };

/**
 * Catálogo cerrado de contratos. `SaleReturned` pertenece a `SaleReturn` y los
 * reportes X/Z a `FiscalDay`: referenciar otro agregado no cambia la identidad
 * del hecho ni concede autoridad sobre el agregado ajeno.
 *
 * Los contratos `*Published` distribuyen referencias operativas hacia las
 * terminales con el estado vigente completo del maestro. Su orden y su
 * idempotencia dependen de `aggregateVersion`, no de un campo del payload.
 */
export const SYNC_EVENT_CONTRACTS_V1: readonly SyncEventContractV1[] = [{
  eventType: 'ProductCreated',
  contractVersion: 1,
  aggregateType: 'Product',
  direction: 'COORDINATOR_TO_TERMINAL',
  fields: {
    name: text(),
    description: text(),
    price: money,
    taxRate: { kind: 'taxRate' }
  },
  payloadOriginField: null,
  payloadTerminalField: null,
  intendedConsumer: 'catalogo local de cada terminal',
  consumers: [],
  dependencies: noDependencies
}, {
  eventType: 'PriceChanged',
  contractVersion: 1,
  aggregateType: 'Product',
  direction: 'COORDINATOR_TO_TERMINAL',
  fields: {
    previousPrice: money,
    price: money,
    changedBy: identifier(),
    reason: text(true)
  },
  payloadOriginField: null,
  payloadTerminalField: null,
  intendedConsumer: 'catalogo local de cada terminal',
  consumers: [],
  dependencies: noDependencies
}, {
  eventType: 'CategoryPublished',
  contractVersion: 1,
  aggregateType: 'Category',
  direction: 'COORDINATOR_TO_TERMINAL',
  fields: {
    name: text(),
    isActive: activityFlag
  },
  payloadOriginField: null,
  payloadTerminalField: null,
  intendedConsumer: 'proyeccion de catalogo de cada terminal',
  consumers: ['CATALOG_REFERENCE'],
  dependencies: noDependencies
}, {
  eventType: 'UnitOfMeasurePublished',
  contractVersion: 1,
  aggregateType: 'UnitOfMeasure',
  direction: 'COORDINATOR_TO_TERMINAL',
  fields: {
    code: identifier(),
    name: text(),
    quantityScale: integer(0),
    isActive: activityFlag
  },
  payloadOriginField: null,
  payloadTerminalField: null,
  intendedConsumer: 'proyeccion de catalogo de cada terminal',
  consumers: ['CATALOG_REFERENCE'],
  dependencies: noDependencies
}, {
  eventType: 'DiscountPolicyPublished',
  contractVersion: 1,
  aggregateType: 'OperationalPolicy',
  direction: 'COORDINATOR_TO_TERMINAL',
  fields: { policyId: identifier(), maximumBasisPoints: integer(0) },
  payloadOriginField: null,
  payloadTerminalField: null,
  intendedConsumer: 'politica de descuento de cada terminal',
  consumers: ['CATALOG_REFERENCE'],
  dependencies: noDependencies
}, {
  eventType: 'FinancialTransactionTaxPolicyPublished',
  contractVersion: 1,
  aggregateType: 'OperationalPolicy',
  direction: 'COORDINATOR_TO_TERMINAL',
  fields: {
    policyId: identifier(),
    rateBasisPoints: integer(0),
    eligiblePaymentMethodCodes: array(identifier()),
    eligibleCurrencies: array({ kind: 'currency' })
  },
  payloadOriginField: null,
  payloadTerminalField: null,
  intendedConsumer: 'politica IGTF de cada terminal',
  consumers: ['CATALOG_REFERENCE'],
  dependencies: noDependencies
}, {
  eventType: 'ExchangeRateUpdated',
  contractVersion: 1,
  aggregateType: 'ExchangeRate',
  direction: 'COORDINATOR_TO_TERMINAL',
  fields: {
    rateId: identifier(),
    baseCurrency: { kind: 'currency' },
    quoteCurrency: { kind: 'currency' },
    rateValue: integer(1),
    rateScale: integer(0),
    source: text(),
    validFrom: text(),
    validUntil: text(true),
    registeredBy: identifier()
  },
  payloadOriginField: null,
  payloadTerminalField: null,
  intendedConsumer: 'tasas confirmadas de cada terminal',
  consumers: ['CATALOG_REFERENCE'],
  dependencies: noDependencies
}, {
  eventType: 'PaymentMethodPublished',
  contractVersion: 1,
  aggregateType: 'PaymentMethod',
  direction: 'COORDINATOR_TO_TERMINAL',
  fields: {
    name: text(),
    kind: {
      kind: 'enum',
      values: ['CASH', 'CARD', 'MOBILE_PAYMENT', 'BANK_TRANSFER', 'OTHER']
    },
    currencyCode: { kind: 'currency' },
    isActive: activityFlag
  },
  payloadOriginField: null,
  payloadTerminalField: null,
  intendedConsumer: 'metodos de pago de cada terminal',
  consumers: ['CATALOG_REFERENCE'],
  dependencies: noDependencies
}, {
  eventType: 'OperatorGrantPublished',
  contractVersion: 1,
  aggregateType: 'OperatorGrant',
  direction: 'COORDINATOR_TO_TERMINAL',
  /**
   * Concesión de autorización, nunca credenciales: ADR-0026 D5 prohíbe
   * sincronizar PINs, tokens, sesiones o secretos. El instante de emisión es
   * `occurredAt` del sobre y no se repite; `expiresAt` viaja explícito porque
   * es la declaración de vigencia del coordinador.
   */
  fields: {
    operatorCode: identifier(),
    displayName: text(),
    roleCodes: array(identifier()),
    permissionCodes: array(identifier()),
    isActive: activityFlag,
    expiresAt: text()
  },
  payloadOriginField: null,
  payloadTerminalField: null,
  intendedConsumer: 'concesiones de operador de cada terminal',
  consumers: ['CATALOG_REFERENCE'],
  dependencies: noDependencies
}, {
  eventType: 'StockAvailabilityPublished',
  contractVersion: 1,
  aggregateType: 'StockAvailability',
  direction: 'COORDINATOR_TO_TERMINAL',
  /**
   * Saldo observado en el coordinador, informativo. No reserva existencias, no
   * habilita ni bloquea una venta y no se suma a ningún saldo local: la
   * terminal lo proyecta en una tabla propia junto a su antigüedad.
   */
  fields: {
    quantityScaled: integer(0),
    quantityScale: integer(0),
    /**
     * Costo unitario promedio observado, con el que la terminal congela el
     * costo al vender. `null` es costo desconocido, no cero.
     */
    unitCost: object({ minorUnits: integer(0), currencyCode: { kind: 'currency' } }, true)
  },
  payloadOriginField: null,
  payloadTerminalField: null,
  intendedConsumer: 'disponibilidad informativa de cada terminal',
  consumers: ['CATALOG_REFERENCE'],
  /** Un saldo de un producto que la terminal no conoce no es utilizable. */
  dependencies: (_payload, aggregateId) => [{ aggregateType: 'Product', aggregateId }]
}, {
  eventType: 'ProductPublished',
  contractVersion: 1,
  aggregateType: 'Product',
  direction: 'COORDINATOR_TO_TERMINAL',
  fields: {
    name: text(),
    description: text(),
    categoryId: identifier(),
    unitId: identifier(),
    unitCode: identifier(),
    barcodes: array(object({
      barcodeId: identifier(),
      code: identifier(),
      isActive: activityFlag
    })),
    price: money,
    taxRate: { kind: 'taxRate' },
    isActive: activityFlag
  },
  payloadOriginField: null,
  payloadTerminalField: null,
  intendedConsumer: 'proyeccion de catalogo de cada terminal',
  consumers: ['CATALOG_REFERENCE'],
  /**
   * La escala de cantidad vive en la unidad, no en el producto: la dependencia
   * garantiza que el maestro esté aplicado antes de que el producto lo use.
   */
  dependencies: (payload) => [
    ...reference('Category', payload, 'categoryId'),
    ...reference('UnitOfMeasure', payload, 'unitId')
  ]
}, {
  eventType: 'SaleCompleted',
  contractVersion: 1,
  aggregateType: 'Sale',
  direction: 'TERMINAL_TO_COORDINATOR',
  fields: {
    shiftId: identifier(),
    terminalId: identifier(),
    total: money,
    paidTotal: money,
    payments: array(object({
      paymentId: identifier(),
      methodCode: identifier(),
      currencyCode: { kind: 'currency' },
      amountMinorUnits: integer()
    })),
    items: array(object({
      itemId: identifier(),
      productId: identifier(),
      quantityScaled: integer(),
      quantityScale: integer(0)
    }))
  },
  payloadOriginField: null,
  payloadTerminalField: 'terminalId',
  intendedConsumer: 'caja e inventario autoritativos del coordinador',
  consumers: ['INVENTORY_AUTHORITY', 'COMMERCIAL_PROJECTION'],
  dependencies: (payload) => reference('Shift', payload, 'shiftId')
}, {
  /**
   * Versión 2: añade el snapshot de costo por línea, con su procedencia
   * (ADR-0026 D4). La v1 sigue siendo válida y se conserva intacta con sus
   * fixtures; un hecho v1 se aplica con costo desconocido, no con el promedio
   * que el coordinador tenga al recibirlo.
   */
  eventType: 'SaleCompleted',
  contractVersion: 2,
  aggregateType: 'Sale',
  direction: 'TERMINAL_TO_COORDINATOR',
  fields: {
    shiftId: identifier(),
    terminalId: identifier(),
    total: money,
    paidTotal: money,
    payments: array(object({
      paymentId: identifier(),
      methodCode: identifier(),
      currencyCode: { kind: 'currency' },
      amountMinorUnits: integer()
    })),
    items: array(object({
      itemId: identifier(),
      productId: identifier(),
      quantityScaled: integer(),
      quantityScale: integer(0),
      /** `null` es costo desconocido explícito, no cero. */
      costSnapshot: object({
        unitCost: money,
        version: integer(1),
        source: identifier(),
        observedAt: text()
      }, true)
    }))
  },
  payloadOriginField: null,
  payloadTerminalField: 'terminalId',
  intendedConsumer: 'caja e inventario autoritativos del coordinador',
  consumers: ['INVENTORY_AUTHORITY', 'COMMERCIAL_PROJECTION'],
  dependencies: (payload) => reference('Shift', payload, 'shiftId')
}, {
  eventType: 'SaleReturned',
  contractVersion: 1,
  aggregateType: 'SaleReturn',
  direction: 'TERMINAL_TO_COORDINATOR',
  fields: {
    saleId: identifier(),
    originalDocumentId: identifier(),
    creditNoteId: identifier(),
    shiftId: identifier(),
    refundMinorUnits: integer(),
    currencyCode: { kind: 'currency' },
    paymentMethodCode: identifier(),
    lineCount: integer(0)
  },
  payloadOriginField: null,
  payloadTerminalField: null,
  intendedConsumer: 'consolidacion comercial del coordinador',
  consumers: ['COMMERCIAL_PROJECTION'],
  dependencies: (payload) => reference('Sale', payload, 'saleId')
}, {
  eventType: 'ShiftOpened',
  contractVersion: 1,
  aggregateType: 'Shift',
  direction: 'TERMINAL_TO_COORDINATOR',
  fields: {
    cashRegisterId: identifier(),
    terminalId: identifier(),
    originNodeId: identifier(),
    openedBy: identifier(),
    openingBalances: array(object({ paymentMethodCode: identifier(), amount: money }))
  },
  payloadOriginField: 'originNodeId',
  payloadTerminalField: 'terminalId',
  intendedConsumer: 'proyeccion de caja del coordinador',
  consumers: ['COMMERCIAL_PROJECTION'],
  dependencies: noDependencies
}, {
  eventType: 'CashMovementRegistered',
  contractVersion: 1,
  aggregateType: 'Shift',
  direction: 'TERMINAL_TO_COORDINATOR',
  fields: {
    movementId: identifier(),
    movementType: {
      kind: 'enum',
      values: ['OPENING_FLOAT', 'INCOME', 'WITHDRAWAL', 'SALE_PAYMENT', 'SALE_REFUND']
    },
    paymentMethodCode: identifier(),
    amount: money,
    reason: text(),
    registeredBy: identifier(),
    reference: object({ sourceId: identifier(), sourceEventId: identifier() }, true)
  },
  payloadOriginField: null,
  payloadTerminalField: null,
  intendedConsumer: 'proyeccion de caja del coordinador',
  consumers: ['COMMERCIAL_PROJECTION'],
  /**
   * Un movimiento de caja es un hecho **del turno** que referencia una venta,
   * no un hecho que dependa de ella: la referencia viaja en el payload y se
   * proyecta tal cual. Declararla como dependencia crearía un ciclo, porque la
   * venta sí depende de su turno y el movimiento pertenece a ese mismo turno.
   */
  dependencies: noDependencies
}, {
  eventType: 'ShiftClosed',
  contractVersion: 1,
  aggregateType: 'Shift',
  direction: 'TERMINAL_TO_COORDINATOR',
  fields: {
    closedBy: identifier(),
    balances: array(object({
      paymentMethodCode: identifier(),
      expected: money,
      declared: money,
      difference: money
    }))
  },
  payloadOriginField: null,
  payloadTerminalField: null,
  intendedConsumer: 'cierre consolidado de caja del coordinador',
  consumers: ['COMMERCIAL_PROJECTION'],
  dependencies: noDependencies
}, {
  eventType: 'FiscalDocumentIssued',
  contractVersion: 1,
  aggregateType: 'FiscalDocument',
  direction: 'TERMINAL_TO_COORDINATOR',
  fields: { fiscalNumber: identifier(), referenceId: identifier(), evidence },
  payloadOriginField: null,
  payloadTerminalField: null,
  intendedConsumer: 'consolidacion fiscal del coordinador',
  consumers: ['COMMERCIAL_PROJECTION'],
  dependencies: (payload) => reference('Sale', payload, 'referenceId')
}, {
  eventType: 'FiscalDocumentFailed',
  contractVersion: 1,
  aggregateType: 'FiscalDocument',
  direction: 'TERMINAL_TO_COORDINATOR',
  fields: { errorCode: text(true) },
  payloadOriginField: null,
  payloadTerminalField: null,
  intendedConsumer: 'consolidacion fiscal del coordinador',
  consumers: ['COMMERCIAL_PROJECTION'],
  dependencies: noDependencies
}, {
  eventType: 'FiscalXReportIssued',
  contractVersion: 1,
  aggregateType: 'FiscalDay',
  direction: 'TERMINAL_TO_COORDINATOR',
  fields: { reportId: identifier(), reportNumber: identifier(), evidence },
  payloadOriginField: null,
  payloadTerminalField: null,
  intendedConsumer: 'consolidacion fiscal del coordinador',
  consumers: ['COMMERCIAL_PROJECTION'],
  dependencies: noDependencies
}, {
  eventType: 'FiscalZReportIssued',
  contractVersion: 1,
  aggregateType: 'FiscalDay',
  direction: 'TERMINAL_TO_COORDINATOR',
  fields: { reportId: identifier(), reportNumber: identifier(), evidence },
  payloadOriginField: null,
  payloadTerminalField: null,
  intendedConsumer: 'consolidacion fiscal del coordinador',
  consumers: ['COMMERCIAL_PROJECTION'],
  dependencies: noDependencies
}];

/**
 * Busca un contrato. Sin `contractVersion` devuelve la versión más alta
 * publicada del tipo, que es la que emiten los productores; con ella devuelve
 * exactamente esa, para que el receptor valide contra el contrato declarado.
 */
export const findSyncContract = (
  eventType: string,
  contractVersion?: number
): SyncEventContractV1 | undefined => {
  const candidates = SYNC_EVENT_CONTRACTS_V1
    .filter((contract) => contract.eventType === eventType);
  if (contractVersion !== undefined) {
    return candidates.find((contract) => contract.contractVersion === contractVersion);
  }
  return candidates.reduce<SyncEventContractV1 | undefined>(
    (highest, contract) =>
      highest === undefined || contract.contractVersion > highest.contractVersion
        ? contract
        : highest,
    undefined
  );
};

export const SYNC_INTEGRATION_EVENT_TYPES: readonly string[] =
  [...new Set(SYNC_EVENT_CONTRACTS_V1.map(({ eventType }) => eventType))];
