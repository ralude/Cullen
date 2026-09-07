/**
 * Permisos humanos de la operación LAN. La identidad de máquina del transporte
 * no concede ninguno de ellos: autenticar un nodo permite entregar hechos, no
 * administrar la confianza ni resolver una discrepancia.
 */
export const SYNC_PERMISSIONS = {
  MANAGE_NODE: 'sync.node.manage',
  REVIEW_RECEPTION: 'sync.reception.review',
  RESOLVE_DISCREPANCY: 'sync.discrepancy.resolve',
  RESUME_DELIVERY: 'sync.delivery.resume',
  PUBLISH_REFERENCES: 'sync.reference.publish'
} as const;
