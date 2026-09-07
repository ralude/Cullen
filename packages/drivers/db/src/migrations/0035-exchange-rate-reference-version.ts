export const exchangeRateReferenceVersionSql = `
  alter table exchange_rates
    add column version integer not null default 1 check (version > 0);

  update exchange_rates as current
  set version = (
    select count(*) from exchange_rates as prior
    where prior.base_currency = current.base_currency
      and prior.quote_currency = current.quote_currency
      and (
        prior.valid_from < current.valid_from
        or (prior.valid_from = current.valid_from and prior.id <= current.id)
      )
  );

  create unique index exchange_rates_pair_version
    on exchange_rates (base_currency, quote_currency, version);

  create trigger exchange_rates_version_immutable
  before update of version on exchange_rates
  when new.version != old.version
  begin
    select raise(abort, 'exchange rate version is immutable');
  end;
`;
