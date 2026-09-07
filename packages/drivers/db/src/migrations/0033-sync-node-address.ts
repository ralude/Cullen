/**
 * Direccion de red de un nodo destino (10.03, corte 0).
 *
 * El coordinador necesita saber donde escucha cada terminal para entregarle
 * las referencias. La direccion vive junto a la confianza en lugar de en una
 * configuracion paralela: un nodo revocado o sin direccion deja de ser destino
 * sin tocar variables de entorno.
 *
 * Es opcional: un nodo sin direccion simplemente no recibe entregas. Retirarla
 * detiene las entregas nuevas y **no** convierte pendientes en publicados,
 * porque las filas de `sync_delivery` permanecen con su estado.
 */
export const syncNodeAddressSql = `
alter table sync_node add column address_host text;
alter table sync_node add column address_port integer;

create trigger sync_node_address_complete
before update on sync_node
when (new.address_host is null) is not (new.address_port is null)
begin
  select raise(abort, 'sync node address requires host and port together');
end;

create trigger sync_node_address_complete_insert
before insert on sync_node
when (new.address_host is null) is not (new.address_port is null)
begin
  select raise(abort, 'sync node address requires host and port together');
end;
`;
