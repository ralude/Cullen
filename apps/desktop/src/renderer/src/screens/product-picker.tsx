import { useEffect, useMemo, useState } from 'react';
import type { ProductResponse } from '@supermarket/shared';
import type { OperationApi } from '../api-client.js';

/**
 * Filtra el catálogo por nombre o barcode, con la misma regla que aplica
 * `ListProducts` en el nodo. Vive aquí porque el listado ya viaja completo y
 * volver a pedirlo por cada tecla no aporta nada en una estación local.
 */
export const filterProducts = (
  products: readonly ProductResponse[],
  query: string
): readonly ProductResponse[] => {
  const normalized = query.trim().toLocaleLowerCase('es-VE');
  if (!normalized) return products;
  return products.filter((product) =>
    product.name.toLocaleLowerCase('es-VE').includes(normalized)
    || product.barcodes.some((barcode) => barcode.toLocaleLowerCase('es-VE').includes(normalized)));
};

/** Nombre del producto, o su identificador cuando el catálogo aún no respondió. */
export const productLabel = (
  products: readonly ProductResponse[], productId: string
): string => products.find((product) => product.id === productId)?.name ?? productId;

/**
 * Catálogo cargado una sola vez por pantalla. Sirve para dos cosas que hasta
 * ahora obligaban a conocer un UUID: elegir un producto por su nombre y
 * mostrar nombres donde el nodo solo devuelve identificadores.
 */
export const useProductCatalog = (api: OperationApi): readonly ProductResponse[] => {
  const [products, setProducts] = useState<readonly ProductResponse[]>([]);
  useEffect(() => {
    void api.listProducts().then(setProducts).catch(() => undefined);
  }, [api]);
  return products;
};

export type ProductPickerProps = {
  readonly products: readonly ProductResponse[];
  readonly value: string;
  readonly onChange: (productId: string) => void;
  /** Texto del campo de selección; la búsqueda siempre se rotula igual. */
  readonly label?: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
};

/**
 * Selección de producto por nombre o barcode. Reproduce el patrón que ya usa
 * el selector de proveedores —un campo de búsqueda y una lista acotada— para
 * que el operador nunca tenga que escribir el identificador del producto, que
 * ninguna pantalla le muestra.
 */
export const ProductPicker = ({
  products, value, onChange, label = 'Producto', required = false, disabled = false
}: ProductPickerProps): React.JSX.Element => {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => filterProducts(products, query), [products, query]);
  return (
    <>
      <label>Buscar producto
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Nombre o barcode"
          disabled={disabled}
        />
      </label>
      <label>{label}
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          disabled={disabled}
        >
          <option value="">
            {products.length === 0 ? 'Catálogo no disponible' : 'Selecciona un producto'}
          </option>
          {visible.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}{product.barcodes[0] ? ' — ' + product.barcodes[0] : ''}
            </option>
          ))}
        </select>
      </label>
    </>
  );
};
