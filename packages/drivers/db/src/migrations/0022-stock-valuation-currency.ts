export const stockValuationCurrencySql = `
alter table stock_items add column valuation_currency_code text
  check (
    valuation_currency_code is null or
    (length(valuation_currency_code) = 3 and valuation_currency_code = upper(valuation_currency_code))
  );

drop trigger stock_items_immutable_update;

update stock_items
set valuation_currency_code = (
  select min(stock_movements.cost_currency_code)
  from stock_movements
  where stock_movements.stock_item_id = stock_items.id
    and stock_movements.cost_currency_code is not null
)
where (
  select count(distinct stock_movements.cost_currency_code)
  from stock_movements
  where stock_movements.stock_item_id = stock_items.id
    and stock_movements.cost_currency_code is not null
) = 1;

create trigger stock_items_immutable_update
before update on stock_items
when
  new.id is not old.id or
  new.product_id is not old.product_id or
  new.unit_code is not old.unit_code or
  new.quantity_scale is not old.quantity_scale or
  new.tracks_batches is not old.tracks_batches or
  old.valuation_currency_code is not null or
  new.valuation_currency_code is null
begin
  select raise(abort, 'stock item configuration is immutable');
end;
`;
