/**
 * Version monotonica de los maestros distribuidos como referencia (10.03,
 * corte 0).
 *
 * Sin una version por agregado, dos cambios consecutivos de una categoria o de
 * una unidad producirian publicaciones indistinguibles y el consumidor de la
 * terminal descartaria la segunda por no ser mayor que la aplicada.
 *
 * Las filas existentes arrancan en 1 y cada guardado del maestro la
 * incrementa. Los triggers impiden que retroceda: una version que baja
 * reabriria un cambio ya aplicado en las terminales.
 */
export const referenceMasterVersionSql = `
alter table categories add column version integer not null default 1;
alter table units_of_measure add column version integer not null default 1;

create trigger categories_version_monotonic
before update on categories
when new.version < old.version
begin
  select raise(abort, 'category version must not decrease');
end;

create trigger units_of_measure_version_monotonic
before update on units_of_measure
when new.version < old.version
begin
  select raise(abort, 'unit of measure version must not decrease');
end;
`;
