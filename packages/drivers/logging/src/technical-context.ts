export type TechnicalLogContextInput = {
  readonly service: string;
  readonly module: string;
  readonly correlationId: string;
  readonly operation: string;
  readonly actorId?: string;
  readonly terminalId?: string;
  readonly originNodeId?: string;
  readonly errorCode?: string;
};

/** Campos transversales estables de ADR-0006; `null` significa no aplicable. */
export const technicalLogContext = (input: TechnicalLogContextInput) => ({
  service: input.service,
  module: input.module,
  correlationId: input.correlationId,
  actorId: input.actorId ?? null,
  terminalId: input.terminalId ?? null,
  originNodeId: input.originNodeId ?? null,
  operation: input.operation,
  errorCode: input.errorCode ?? null
});
