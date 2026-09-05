export const singleOpenStockCountSql = `
create unique index stock_counts_single_open
on stock_counts(status)
where status = 'OPEN';
`;
