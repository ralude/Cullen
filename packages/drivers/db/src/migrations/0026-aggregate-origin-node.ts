export const aggregateOriginNodeSql = `
alter table branches add column origin_node_id text;
alter table devices add column origin_node_id text;
alter table stock_counts add column origin_node_id text;
alter table purchase_receipts add column origin_node_id text;

update branches set origin_node_id = (
  select audit_log.origin_node_id from audit_log
  where audit_log.entity_id = branches.id and audit_log.action = 'BRANCH_CREATED'
  order by audit_log.occurred_at asc limit 1
);

update devices set origin_node_id = (
  select audit_log.origin_node_id from audit_log
  where audit_log.entity_id = devices.id and audit_log.action = 'DEVICE_DECLARED'
  order by audit_log.occurred_at asc limit 1
);

update stock_counts set origin_node_id = (
  select audit_log.origin_node_id from audit_log
  where audit_log.entity_id = stock_counts.id and audit_log.action = 'STOCK_COUNT_OPENED'
  order by audit_log.occurred_at asc limit 1
);

update purchase_receipts set origin_node_id = (
  select audit_log.origin_node_id from audit_log
  where audit_log.entity_id = purchase_receipts.id
    and audit_log.action in ('PURCHASE_RECEIPT_DRAFT_STARTED', 'PURCHASE_RECEIPT_DRAFT_CORRECTED')
  order by audit_log.occurred_at asc limit 1
);

create trigger branches_origin_node_immutable
before update on branches
when old.origin_node_id is not null and new.origin_node_id is not old.origin_node_id
begin
  select raise(abort, 'branch origin node is immutable');
end;

create trigger devices_origin_node_immutable
before update on devices
when old.origin_node_id is not null and new.origin_node_id is not old.origin_node_id
begin
  select raise(abort, 'device origin node is immutable');
end;

create trigger stock_counts_origin_node_immutable
before update on stock_counts
when old.origin_node_id is not null and new.origin_node_id is not old.origin_node_id
begin
  select raise(abort, 'stock count origin node is immutable');
end;

create trigger purchase_receipts_origin_node_immutable
before update on purchase_receipts
when old.origin_node_id is not null and new.origin_node_id is not old.origin_node_id
begin
  select raise(abort, 'purchase receipt origin node is immutable');
end;
`;
