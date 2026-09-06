import { ApplicationError, err, ok, type AppError, type Result } from '@supermarket/shared';
import type { ExecutionContext } from '../execution-context.js';
import type { AuthorizationService, ShiftRepository } from '../ports/index.js';
import type { ShiftDto } from './dtos.js';
import { toShiftDto } from './mappers.js';
import { CASH_PERMISSIONS } from './permissions.js';

/**
 * Lectura de arqueo de un turno del nodo (9B.12). Un turno propio —el que
 * abrió el actor— solo exige `cash.shift.read`; un turno ajeno o cerrado que
 * el actor no abrió exige además `cash.shift.read.any`. Presenta esperado,
 * declarado y diferencia ya calculados; el renderer no recalcula.
 */
export class GetShift {
  constructor(
    private readonly repository: ShiftRepository,
    private readonly authorization: AuthorizationService
  ) {}

  async execute(shiftId: string, context: ExecutionContext): Promise<Result<ShiftDto, AppError>> {
    if (!(await this.authorization.authorize(context, CASH_PERMISSIONS.READ_SHIFT))) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to read shifts.'));
    }
    const shift = await this.repository.findById(shiftId);
    if (shift === null || shift.originNodeId !== context.originNodeId) {
      return err(new ApplicationError('SHIFT_NOT_FOUND', 'Shift was not found.'));
    }
    if (shift.openedBy !== context.actorId
      && !(await this.authorization.authorize(context, CASH_PERMISSIONS.READ_SHIFT_ANY))) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to read another operator\'s shift.'));
    }
    return ok(toShiftDto(shift));
  }
}
