/**
 * Completa la referencia informativa de inventario para operaciones LAN.
 * Las columnas quedan nullable para conservar `StockAvailabilityPublished.v1`;
 * v2 las escribe juntas y reemplaza el conjunto completo de lotes.
 */
export const stockAvailabilityBatchesSql = `
  alter table stock_availability_reference add column stock_item_id text;
  alter table stock_availability_reference add column unit_code text;
  alter table stock_availability_reference add column tracks_batches integer
    check (tracks_batches in (0, 1));

  create unique index stock_availability_reference_item_unique
    on stock_availability_reference(stock_item_id)
    where stock_item_id is not null;

  create trigger stock_availability_reference_metadata_complete_insert
  before insert on stock_availability_reference
  when (new.stock_item_id is null) != (new.unit_code is null)
    or (new.stock_item_id is null) != (new.tracks_batches is null)
  begin
    select raise(abort, 'projected availability metadata must be complete');
  end;

  create trigger stock_availability_reference_metadata_complete_update
  before update on stock_availability_reference
  when (new.stock_item_id is null) != (new.unit_code is null)
    or (new.stock_item_id is null) != (new.tracks_batches is null)
  begin
    select raise(abort, 'projected availability metadata must be complete');
  end;

  create table stock_batch_availability_reference (
    product_id text not null,
    batch_id text not null,
    lot_number text not null,
    expires_at integer,
    quantity_scaled integer not null check (quantity_scaled >= 0),
    primary key (product_id, batch_id),
    unique (product_id, lot_number),
    foreign key (product_id) references stock_availability_reference(product_id)
      on delete cascade
  );
`;
