/** Conserva la versión de disponibilidad observada al congelar cada diferencia. */
export const stockCountAvailabilityVersionSql = `
  alter table stock_count_differences
    add column stock_availability_version integer not null default 1
    check (stock_availability_version >= 1);
`;
