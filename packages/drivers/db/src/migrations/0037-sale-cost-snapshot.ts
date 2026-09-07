/**
 * Snapshot de costo conocido al vender (ADR-0026 D4).
 *
 * Los cinco campos van juntos o ninguno: un costo sin procedencia no es un
 * snapshot verificable, y su ausencia es costo **desconocido**, distinto de
 * cero. Las ventas ya registradas quedan con `null` en los cinco, que es
 * exactamente lo que se sabe de ellas.
 *
 * `stock_availability_reference` gana el mismo costo publicado por el
 * coordinador, que es de donde la terminal lo toma al vender.
 */
export const saleCostSnapshotSql = `
  alter table sale_items add column cost_unit_minor_units integer;
  alter table sale_items add column cost_currency_code text;
  alter table sale_items add column cost_version integer;
  alter table sale_items add column cost_source text;
  alter table sale_items add column cost_observed_at integer;

  create trigger sale_items_cost_snapshot_complete_insert
  before insert on sale_items
  when (new.cost_unit_minor_units is null) != (new.cost_currency_code is null)
    or (new.cost_unit_minor_units is null) != (new.cost_version is null)
    or (new.cost_unit_minor_units is null) != (new.cost_source is null)
    or (new.cost_unit_minor_units is null) != (new.cost_observed_at is null)
    or (new.cost_unit_minor_units is not null and new.cost_unit_minor_units < 0)
    or (new.cost_version is not null and new.cost_version < 1)
  begin
    select raise(abort, 'sale item cost snapshot must be complete');
  end;

  alter table stock_availability_reference add column cost_unit_minor_units integer;
  alter table stock_availability_reference add column cost_currency_code text;

  create trigger stock_availability_reference_cost_complete_insert
  before insert on stock_availability_reference
  when (new.cost_unit_minor_units is null) != (new.cost_currency_code is null)
    or (new.cost_unit_minor_units is not null and new.cost_unit_minor_units < 0)
  begin
    select raise(abort, 'projected availability cost must be complete');
  end;

  create trigger stock_availability_reference_cost_complete_update
  before update on stock_availability_reference
  when (new.cost_unit_minor_units is null) != (new.cost_currency_code is null)
    or (new.cost_unit_minor_units is not null and new.cost_unit_minor_units < 0)
  begin
    select raise(abort, 'projected availability cost must be complete');
  end;
`;
