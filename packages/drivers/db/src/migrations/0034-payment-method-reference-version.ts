/** Versión monotónica para distribuir métodos de pago como estado completo. */
export const paymentMethodReferenceVersionSql = `
alter table payment_methods add column version integer not null default 1;

create trigger payment_methods_version_monotonic
before update on payment_methods
when new.version < old.version
begin
  select raise(abort, 'payment method version must not decrease');
end;
`;
