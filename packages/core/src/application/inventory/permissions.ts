export const INVENTORY_PERMISSIONS = {
  RECEIVE_PURCHASE: 'inventory.purchase.receive',
  REGISTER_WASTE: 'inventory.waste.register',
  REGISTER_ADJUSTMENT: 'inventory.adjust',
  PERFORM_COUNT: 'inventory.count.perform',
  APPROVE_COUNT: 'inventory.count.approve',
  READ_COUNT: 'inventory.count.read'
} as const;
