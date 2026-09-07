/**
 * Estado de entrega por destino (10.03, corte 4; presupuesto de ciclo 10.04).
 *
 * `outbox_event` conserva el payload una sola vez y su historia local.
 * `sync_delivery` agrega claim, generacion, intento, retry y resultado
 * independientes por `(event_id, destination_node_id)`: el ACK de una terminal
 * no confirma a su vecina y una terminal desconectada no bloquea a la otra.
 *
 * `cycle_attempts` es el presupuesto de envios del ciclo, separado de
 * `attempts`, que sigue siendo la generacion monotonica del claim. Al agotarse
 * el ciclo la fila queda `PAUSED` de forma durable: reconectar o reiniciar no
 * abre otro ciclo, y solo una reanudacion autorizada la vuelve a habilitar.
 *
 * Forward-only y sin backfill: una publicacion historica local no se
 * reinterpreta como entrega de red ni como ACK de un destino.
 */
export const syncDeliveryByDestinationSql = `
create table sync_delivery (
  event_id text not null references outbox_event(event_id),
  destination_node_id text not null,
  status text not null check (
    status in ('PENDING', 'PROCESSING', 'PUBLISHED', 'BLOCKED', 'PAUSED')
  ),
  attempts integer not null default 0 check (attempts >= 0),
  cycle_attempts integer not null default 0 check (cycle_attempts >= 0),
  next_attempt_at integer not null,
  lease_until integer,
  last_error text,
  published_at integer,
  paused_at integer,
  resumed_at integer,
  resumed_by text,
  created_at integer not null,
  primary key (event_id, destination_node_id)
);

create index sync_delivery_queue
  on sync_delivery(destination_node_id, status, next_attempt_at, lease_until);

create index sync_delivery_event on sync_delivery(event_id, status);
`;
