export const operatorGrantsAndAvailabilitySql = `
  create table identity_operator_grant_version (
    user_id text primary key references identity_users(id),
    version integer not null check (version > 0),
    issued_at integer not null,
    expires_at integer not null,
    check (expires_at > issued_at)
  );

  create trigger identity_operator_grant_version_monotonic
  before update of version on identity_operator_grant_version
  when new.version <= old.version
  begin
    select raise(abort, 'operator grant version must advance');
  end;

  create table identity_operator_grant (
    user_id text primary key,
    operator_code text not null collate nocase,
    display_name text not null,
    role_codes text not null,
    permission_codes text not null,
    is_active integer not null check (is_active in (0, 1)),
    version integer not null check (version > 0),
    expires_at integer not null,
    published_by text not null,
    published_at integer not null,
    applied_at integer not null
  );

  create index identity_operator_grant_code_idx
    on identity_operator_grant (operator_code);

  create trigger identity_operator_grant_projection_monotonic
  before update of version on identity_operator_grant
  when new.version <= old.version
  begin
    select raise(abort, 'projected operator grant version must advance');
  end;

  create table stock_availability_reference (
    product_id text primary key,
    quantity_scaled integer not null check (quantity_scaled >= 0),
    quantity_scale integer not null check (quantity_scale >= 0),
    version integer not null check (version >= 0),
    published_by text not null,
    published_at integer not null,
    applied_at integer not null
  );

  create trigger stock_availability_reference_version_monotonic
  before update of version on stock_availability_reference
  when new.version <= old.version
  begin
    select raise(abort, 'projected stock availability version must advance');
  end;
`;
