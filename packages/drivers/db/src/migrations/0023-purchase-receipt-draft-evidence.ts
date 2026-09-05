export const purchaseReceiptDraftEvidenceSql = `
drop trigger purchase_receipt_lines_immutable_update;
drop trigger purchase_receipt_lines_immutable_delete;

alter table purchase_receipt_lines rename to purchase_receipt_lines_legacy;

create table purchase_receipt_lines (
  id text primary key not null,
  receipt_id text not null,
  product_id text not null,
  stock_item_id text not null,
  unit_code text not null,
  tracks_batches integer not null check (tracks_batches in (0, 1)),
  quantity_scaled integer not null check (quantity_scaled > 0),
  quantity_scale integer not null check (quantity_scale >= 0),
  batch_id text,
  batch_lot_number text,
  batch_expires_at integer,
  purchase_unit_cost_minor_units integer not null check (purchase_unit_cost_minor_units >= 0),
  purchase_currency_code text not null,
  valuation_unit_cost_minor_units integer not null check (valuation_unit_cost_minor_units >= 0),
  valuation_currency_code text not null,
  exchange_rate_id text,
  exchange_rate_base_currency text,
  exchange_rate_quote_currency text,
  exchange_rate_value integer,
  exchange_rate_scale integer,
  exchange_rate_source text,
  exchange_rate_valid_from integer,
  exchange_rate_valid_until integer,
  exchange_rate_registered_by text,
  foreign key (receipt_id) references purchase_receipts(id),
  check (
    (batch_id is null and batch_lot_number is null and batch_expires_at is null) or
    (batch_id is not null and batch_lot_number is not null)
  )
);

insert into purchase_receipt_lines (
  id, receipt_id, product_id, stock_item_id, unit_code, tracks_batches,
  quantity_scaled, quantity_scale, batch_id, batch_lot_number, batch_expires_at,
  purchase_unit_cost_minor_units, purchase_currency_code,
  valuation_unit_cost_minor_units, valuation_currency_code,
  exchange_rate_id, exchange_rate_base_currency, exchange_rate_quote_currency,
  exchange_rate_value, exchange_rate_scale, exchange_rate_source,
  exchange_rate_valid_from, exchange_rate_valid_until, exchange_rate_registered_by
)
select
  legacy.id, legacy.receipt_id, legacy.product_id, legacy.stock_item_id,
  item.unit_code, item.tracks_batches,
  legacy.quantity_scaled, legacy.quantity_scale, legacy.batch_id,
  batch.lot_number, batch.expires_at,
  legacy.purchase_unit_cost_minor_units, legacy.purchase_currency_code,
  legacy.valuation_unit_cost_minor_units, legacy.valuation_currency_code,
  legacy.exchange_rate_id, legacy.exchange_rate_base_currency,
  legacy.exchange_rate_quote_currency, legacy.exchange_rate_value,
  legacy.exchange_rate_scale, legacy.exchange_rate_source,
  legacy.exchange_rate_valid_from, legacy.exchange_rate_valid_until,
  legacy.exchange_rate_registered_by
from purchase_receipt_lines_legacy legacy
join stock_items item on item.id = legacy.stock_item_id
left join stock_batches batch on batch.id = legacy.batch_id;

drop table purchase_receipt_lines_legacy;

create index purchase_receipt_lines_receipt_idx on purchase_receipt_lines(receipt_id);
create trigger purchase_receipt_lines_immutable_update before update on purchase_receipt_lines begin
  select raise(abort, 'purchase receipt lines are immutable');
end;
create trigger purchase_receipt_lines_immutable_delete before delete on purchase_receipt_lines begin
  select raise(abort, 'purchase receipt lines are immutable');
end;
`;
