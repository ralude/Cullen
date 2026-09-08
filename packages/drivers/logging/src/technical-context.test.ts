import { describe, expect, it } from 'vitest';
import { technicalLogContext } from './technical-context.js';

describe('contexto transversal del log técnico', () => {
  it('conserva la misma forma aunque no haya operador ni error', () => {
    expect(technicalLogContext({
      service: 'server', module: 'http', correlationId: 'correlation-001', operation: 'GET /health'
    })).toEqual({
      service: 'server',
      module: 'http',
      correlationId: 'correlation-001',
      actorId: null,
      terminalId: null,
      originNodeId: null,
      operation: 'GET /health',
      errorCode: null
    });
  });
});
