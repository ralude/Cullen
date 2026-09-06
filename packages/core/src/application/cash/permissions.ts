export const CASH_PERMISSIONS = {
  OPEN_SHIFT: 'cash.shift.open',
  REGISTER_INCOME: 'cash.movement.income',
  REGISTER_WITHDRAWAL: 'cash.movement.withdrawal',
  CLOSE_SHIFT: 'cash.shift.close',
  CLOSE_SHIFT_WITH_DIFFERENCE: 'cash.shift.close.difference',
  READ_SHIFT: 'cash.shift.read',
  READ_SHIFT_ANY: 'cash.shift.read.any'
} as const;
