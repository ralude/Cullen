import { describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from './connection.js';
import { applyMigrations, migrations } from './migrations.js';
import { SqliteAuthenticationStore } from './authentication-store.js';

const IDENTITY_PERMISSIONS = [
  'identity.credential.reset', 'identity.role.manage', 'identity.user.manage'
];

/**
 * ADR-0027 D4: una base provisionada antes de 11.02 recibe los permisos de
 * identidad sin repetir el bootstrap, sin tocar credenciales y sin conceder
 * nada a otro destinatario.
 */
describe('identity administration transition', () => {
  const provisionedBeforeIdentityAdministration = (): DatabaseHandle => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite, migrations.filter((migration) => migration.version < 43));
    handle.sqlite.exec(`
      insert into identity_users (
        id, operator_code, display_name, is_active, authorization_version, created_at
      ) values ('user-admin', 'OP001', 'Operador', 1, 1, 1756684800000);
      insert into identity_credentials (user_id, pin_hash, version, updated_at)
      values ('user-admin', 'scrypt$16384$8$1$c2FsdA$a2V5', 1, 1756684800000);
      insert into identity_roles (id, code, name, is_active, is_assignable)
      values ('role-admin', 'ADMIN', 'Administrador', 1, 1);
      insert into identity_permissions (code, name, is_active) values ('sale.void', 'sale.void', 1);
      insert into identity_role_permissions (role_id, permission_code)
      values ('role-admin', 'sale.void');
      insert into identity_user_roles (user_id, role_id) values ('user-admin', 'role-admin');
      insert into identity_users (
        id, operator_code, display_name, is_active, authorization_version, created_at
      ) values ('user-cashier', 'OP002', 'Cajero', 1, 4, 1756684800000);
    `);
    return handle;
  };

  const permissionsOf = (handle: DatabaseHandle, roleCode: string): readonly string[] =>
    handle.sqlite.prepare(`
      select permission_code from identity_role_permissions assigned
      join identity_roles role on role.id = assigned.role_id
      where role.code = ? order by permission_code
    `).pluck().all(roleCode) as string[];

  it('grants the identity permissions to the provisioned administrator only', () => {
    const handle = provisionedBeforeIdentityAdministration();
    try {
      expect(applyMigrations(handle.sqlite)).toEqual([43]);

      const store = new SqliteAuthenticationStore(handle);
      for (const permission of IDENTITY_PERMISSIONS) {
        expect(store.hasPermission('user-admin', permission), permission).toBe(true);
        expect(store.hasPermission('user-cashier', permission), permission).toBe(false);
      }
      expect(permissionsOf(handle, 'ADMIN')).toEqual([...IDENTITY_PERMISSIONS, 'sale.void'].sort());
    } finally {
      handle.close();
    }
  });

  it('revokes the live sessions of the administrator and leaves the rest untouched', () => {
    const handle = provisionedBeforeIdentityAdministration();
    try {
      applyMigrations(handle.sqlite);

      const versions = handle.sqlite.prepare(
        'select id, authorization_version from identity_users order by id'
      ).all() as readonly { readonly id: string; readonly authorization_version: number }[];
      expect(versions).toEqual([
        { id: 'user-admin', authorization_version: 2 },
        { id: 'user-cashier', authorization_version: 4 }
      ]);
      expect(handle.sqlite.prepare(
        'select pin_hash, version from identity_credentials where user_id = ?'
      ).get('user-admin')).toEqual({ pin_hash: 'scrypt$16384$8$1$c2FsdA$a2V5', version: 1 });
    } finally {
      handle.close();
    }
  });

  it('seeds the four operational roles with editable permissions and no members', () => {
    const handle = provisionedBeforeIdentityAdministration();
    try {
      applyMigrations(handle.sqlite);

      const seeded = handle.sqlite.prepare(
        "select code, id from identity_roles where code <> 'ADMIN' order by code"
      ).all() as readonly { readonly code: string; readonly id: string }[];
      expect(seeded.map((role) => role.code)).toEqual([
        'CASHIER', 'INVENTORY', 'MANAGER', 'SUPERVISOR'
      ]);
      for (const role of seeded) {
        expect(role.id, role.code).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
        );
      }
      expect(permissionsOf(handle, 'CASHIER')).toEqual([
        'cash.movement.income', 'cash.shift.close', 'cash.shift.open', 'cash.shift.read',
        'fiscal.document.issue', 'sale.history.read'
      ]);
      expect(permissionsOf(handle, 'MANAGER')).toContain('catalog.price.update');
      expect(permissionsOf(handle, 'INVENTORY')).not.toContain('inventory.count.approve');
      /** Un rol sembrado no concede nada hasta que alguien lo lleve. */
      expect(handle.sqlite.prepare('select count(*) from identity_user_roles').pluck().get())
        .toBe(1);
    } finally {
      handle.close();
    }
  });

  it('does not repeat the transition when the migrations run again', () => {
    const handle = provisionedBeforeIdentityAdministration();
    try {
      applyMigrations(handle.sqlite);
      const before = handle.sqlite.prepare(
        'select role_id, permission_code from identity_role_permissions order by role_id, permission_code'
      ).all();

      expect(applyMigrations(handle.sqlite)).toEqual([]);

      expect(handle.sqlite.prepare(
        'select role_id, permission_code from identity_role_permissions order by role_id, permission_code'
      ).all()).toEqual(before);
      expect(handle.sqlite.prepare(
        'select authorization_version from identity_users where id = ?'
      ).pluck().get('user-admin')).toBe(2);
    } finally {
      handle.close();
    }
  });

  it('provisions a new database over the seeded catalogue', () => {
    const handle = openDatabase(':memory:');
    try {
      applyMigrations(handle.sqlite);
      const store = new SqliteAuthenticationStore(handle);

      expect(handle.sqlite.prepare('select count(*) from identity_users').pluck().get()).toBe(0);
      expect(handle.sqlite.prepare(
        "select count(*) from identity_roles where code = 'CASHIER'"
      ).pluck().get()).toBe(1);
      expect(store).toBeDefined();
    } finally {
      handle.close();
    }
  });
});
