/**
 * Consolidación comercial del coordinador.
 *
 * Son proyecciones de **lectura** de lo que ocurrió en las terminales, con
 * prefijo propio: el coordinador no importa los agregados ajenos ni vuelve a
 * ejecutar sus efectos, y sus tablas operativas (`sales`, `shifts`,
 * `cash_movements`, `fiscal_documents`) siguen siendo solo suyas. Mezclarlas
 * duplicaría totales.
 *
 * Cada fila conserva la terminal y el nodo de origen del hecho, y su versión,
 * para que una reentrega no duplique y un hecho atrasado no retroceda nada.
 */
export const commercialProjectionSql = `
  create table sync_sale_projection (
    sale_id text primary key,
    origin_node_id text not null,
    terminal_id text not null,
    shift_id text not null,
    total_minor_units integer not null,
    paid_total_minor_units integer not null,
    currency_code text not null,
    item_count integer not null check (item_count >= 0),
    version integer not null check (version > 0),
    occurred_at integer not null,
    returned_at integer,
    return_refund_minor_units integer,
    return_currency_code text,
    check ((returned_at is null) = (return_refund_minor_units is null)),
    check ((returned_at is null) = (return_currency_code is null))
  );

  create index sync_sale_projection_terminal_idx
    on sync_sale_projection (terminal_id, occurred_at);

  create trigger sync_sale_projection_version_monotonic
  before update of version on sync_sale_projection
  when new.version < old.version
  begin
    select raise(abort, 'projected sale version must not regress');
  end;

  create table sync_shift_projection (
    shift_id text primary key,
    origin_node_id text not null,
    terminal_id text not null,
    cash_register_id text not null,
    status text not null check (status in ('OPEN', 'CLOSED')),
    opened_by text not null,
    closed_by text,
    version integer not null check (version > 0),
    opened_at integer not null,
    closed_at integer,
    check ((status = 'CLOSED') = (closed_at is not null)),
    check ((status = 'CLOSED') = (closed_by is not null))
  );

  create table sync_shift_balance_projection (
    shift_id text not null references sync_shift_projection(shift_id),
    payment_method_code text not null,
    phase text not null check (phase in ('OPENING', 'CLOSING')),
    expected_minor_units integer,
    declared_minor_units integer not null,
    difference_minor_units integer,
    currency_code text not null,
    primary key (shift_id, payment_method_code, phase)
  );

  create table sync_cash_movement_projection (
    movement_id text primary key,
    shift_id text not null,
    origin_node_id text not null,
    movement_type text not null check (movement_type in (
      'OPENING_FLOAT', 'INCOME', 'WITHDRAWAL', 'SALE_PAYMENT', 'SALE_REFUND'
    )),
    payment_method_code text not null,
    amount_minor_units integer not null,
    currency_code text not null,
    registered_by text not null,
    source_id text,
    occurred_at integer not null
  );

  create index sync_cash_movement_projection_shift_idx
    on sync_cash_movement_projection (shift_id, occurred_at);

  create table sync_fiscal_projection (
    entry_id text primary key,
    origin_node_id text not null,
    kind text not null check (kind in (
      'DOCUMENT_ISSUED', 'DOCUMENT_FAILED', 'X_REPORT', 'Z_REPORT'
    )),
    reference_id text,
    fiscal_number text,
    error_code text,
    /** Rótulo conservado del original: una proyección no certifica nada. */
    simulation_label text not null default 'SIMULACION',
    dispatch_state text,
    command_effect text,
    fiscal_commit text,
    print_delivery text,
    version integer not null check (version > 0),
    occurred_at integer not null
  );

  create index sync_fiscal_projection_reference_idx
    on sync_fiscal_projection (reference_id);
`;
