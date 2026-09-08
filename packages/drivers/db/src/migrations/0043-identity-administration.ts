/**
 * Habilita la administración de identidad en una base ya provisionada.
 *
 * Agregar constantes a `ADMIN_PERMISSIONS` no cambia los permisos persistidos y
 * repetir el bootstrap devuelve `AUTH_ALREADY_PROVISIONED`. ADR-0027 D4 fija la
 * transición: los tres permisos de identidad se conceden al rol `ADMIN` que creó
 * el aprovisionamiento inicial y a ningún otro destinatario, y la versión de
 * autorización de sus portadores avanza para revocar sus sesiones vivas.
 *
 * ADR-0027 D1 siembra además `CASHIER`, `SUPERVISOR`, `INVENTORY` y `MANAGER`
 * como punto de partida editable, sin asignarlos a ningún usuario: un rol sin
 * portadores no concede nada. Solo se siembran los permisos de un rol que no
 * tiene ninguno, para no reponer los que un administrador haya quitado.
 */

/**
 * UUIDv7 generado por la propia sentencia: milisegundos Unix en los 48 bits
 * altos, versión 7, variante RFC 4122 y relleno aleatorio. Conserva el orden
 * temporal de los identificadores del resto del sistema.
 */
const uuidV7 = `lower(printf(
  '%08x-%04x-7%03x-%s%s-%s',
  cast((julianday('now') - 2440587.5) * 86400000 as integer) >> 16,
  cast((julianday('now') - 2440587.5) * 86400000 as integer) & 65535,
  abs(random()) % 4096,
  substr('89ab', abs(random()) % 4 + 1, 1),
  substr(hex(randomblob(2)), 2, 3),
  hex(randomblob(6))
))`;

const seededRole = (code: string, name: string): string => `
  insert into identity_roles (id, code, name, is_active, is_assignable)
  select ${uuidV7}, '${code}', '${name}', 1, 1
  where not exists (select 1 from identity_roles where code = '${code}');
`;

const SEEDED_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  CASHIER: [
    'cash.shift.open', 'cash.shift.close', 'cash.shift.read', 'cash.movement.income',
    'fiscal.document.issue', 'sale.history.read'
  ],
  SUPERVISOR: [
    'cash.shift.open', 'cash.shift.close', 'cash.shift.read', 'cash.movement.income',
    'fiscal.document.issue', 'sale.history.read', 'sale.apply_discount', 'sale.void',
    'sale.return', 'cash.movement.withdrawal', 'cash.shift.close.difference',
    'cash.shift.read.any', 'fiscal.report.x', 'fiscal.report.z', 'reports.cash.read',
    'reports.sales.read'
  ],
  INVENTORY: [
    'inventory.purchase.receive', 'inventory.waste.register', 'inventory.adjust',
    'inventory.count.perform', 'inventory.count.read', 'inventory.kardex.read',
    'purchase_receipt.read', 'purchase_receipt.start', 'purchase_receipt.complete',
    'supplier.read', 'reports.inventory.read'
  ],
  MANAGER: [
    'catalog.product.create', 'catalog.product.update', 'catalog.price.update',
    'currency.rate.update', 'inventory.count.approve', 'purchase_receipt.reverse',
    'supplier.create', 'supplier.update', 'fiscal.reconcile',
    'config.cash_register.manage', 'config.payment_method.manage', 'reports.cash.read',
    'reports.sales.read', 'reports.inventory.read', 'reports.margin.read',
    'reports.fiscal.read'
  ]
};

const IDENTITY_PERMISSION_CODES: readonly string[] = [
  'identity.user.manage', 'identity.role.manage', 'identity.credential.reset'
];

const declaredPermissions: readonly string[] = [...new Set([
  ...IDENTITY_PERMISSION_CODES,
  ...Object.values(SEEDED_PERMISSIONS).flat()
])].sort();

const seededAssignments: readonly string[] = Object.entries(SEEDED_PERMISSIONS)
  .flatMap(([role, permissions]) => permissions.map(
    (permission) => `select '${role}' as role_code, '${permission}' as permission_code`
  ));

export const identityAdministrationSql = `
  insert or ignore into identity_permissions (code, name, is_active) values
    ${declaredPermissions.map((code) => `('${code}', '${code}', 1)`).join(',\n    ')};

  insert or ignore into identity_role_permissions (role_id, permission_code)
  select role.id, permission.code
  from identity_roles role
  join identity_permissions permission on permission.code in (
    ${IDENTITY_PERMISSION_CODES.map((code) => `'${code}'`).join(', ')}
  )
  where role.code = 'ADMIN';

  update identity_users
  set authorization_version = authorization_version + 1
  where id in (
    select user_role.user_id
    from identity_user_roles user_role
    join identity_roles role on role.id = user_role.role_id
    where role.code = 'ADMIN'
  );

  ${seededRole('CASHIER', 'Cajero')}
  ${seededRole('SUPERVISOR', 'Supervisor')}
  ${seededRole('INVENTORY', 'Inventario')}
  ${seededRole('MANAGER', 'Gerente')}

  insert or ignore into identity_role_permissions (role_id, permission_code)
  select role.id, seed.permission_code
  from (
    select id, code from identity_roles
    where code in ('CASHIER', 'SUPERVISOR', 'INVENTORY', 'MANAGER')
      and not exists (
        select 1 from identity_role_permissions assigned where assigned.role_id = identity_roles.id
      )
  ) role
  join (
    ${seededAssignments.join('\n    union all ')}
  ) seed on seed.role_code = role.code;
`;
