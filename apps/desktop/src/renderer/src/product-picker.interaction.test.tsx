import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InventoryReportResponse, KardexDto, ProductResponse } from '@supermarket/shared';
import type { OperationApi } from './api-client.js';
import { InventoryScreen } from './operation-screens.js';
import { filterProducts, productLabel } from './screens/product-picker.js';
import { click, mount, select, settle, type, unmountAll } from './testing/dom.js';

afterEach(() => { unmountAll(); });

const product = (id: string, name: string, barcode: string): ProductResponse => ({
  id, name, description: name, categoryId: 'category-1', unitCode: 'UN', unitScale: 0,
  barcodes: [barcode], price: { amountMinorUnits: 180, currencyCode: 'USD' },
  taxRateBasisPoints: 1600, isActive: true, version: 1
} as unknown as ProductResponse);

const CATALOG = [
  product('product-rice', 'Arroz blanco 1 kg', 'DEMOARROZ001'),
  product('product-coffee', 'Café molido 250 g', 'DEMOCAFE001')
];

const overview = (): readonly InventoryReportResponse[] => [{
  stockItemId: 'stock-1', productId: 'product-rice', batchId: null, lotNumber: null,
  unitCode: 'UN', quantityScale: 0, onHandScaled: 18, expiresAt: null, expiryStatus: 'NONE'
} as unknown as InventoryReportResponse];

const kardex = (productId: string): KardexDto => ({
  id: 'stock-1', productId, unitCode: 'UN', quantityScale: 0, currentBalanceScaled: 18,
  batches: [], movements: []
} as unknown as KardexDto);

const inventoryApi = (overrides: Partial<OperationApi> = {}): OperationApi => ({
  listProducts: vi.fn(async () => CATALOG),
  listSuppliers: vi.fn(async () => []),
  getInventoryReport: vi.fn(async () => overview()),
  getKardex: vi.fn(async (productId: string) => kardex(productId)),
  ...overrides
} as unknown as OperationApi);

const PERMISSIONS = ['inventory.kardex.read', 'reports.inventory.read'];
const capabilities = { fiscalMode: 'SIMULATION' as const, simulatedReportsEnabled: false };

describe('selección de producto sin conocer su identificador', () => {
  it('filtra el catálogo por nombre o barcode', () => {
    expect(filterProducts(CATALOG, '').map((item) => item.id)).toEqual(
      ['product-rice', 'product-coffee']
    );
    expect(filterProducts(CATALOG, 'arroz').map((item) => item.id)).toEqual(['product-rice']);
    expect(filterProducts(CATALOG, 'DEMOCAFE').map((item) => item.id)).toEqual(['product-coffee']);
    expect(filterProducts(CATALOG, 'inexistente')).toEqual([]);
  });

  it('nombra el producto y degrada al identificador cuando no está en el catálogo', () => {
    expect(productLabel(CATALOG, 'product-rice')).toBe('Arroz blanco 1 kg');
    expect(productLabel(CATALOG, 'product-unknown')).toBe('product-unknown');
    expect(productLabel([], 'product-rice')).toBe('product-rice');
  });

  it('consulta el kardex eligiendo el producto por su nombre', async () => {
    const getKardex = vi.fn(async (productId: string) => kardex(productId));
    const screen = await mount(
      <InventoryScreen api={inventoryApi({ getKardex })} capabilities={capabilities}
        permissionCodes={PERMISSIONS} />
    );

    // El buscador acota la lista y el selector entrega el identificador al nodo.
    await type(screen.get<HTMLInputElement>('input[placeholder="Nombre o barcode"]'), 'café');
    await settle();
    const picker = screen.get<HTMLSelectElement>('select');
    expect([...picker.options].map((option) => option.textContent)).toEqual([
      'Selecciona un producto', 'Café molido 250 g — DEMOCAFE001'
    ]);

    await select(picker, 'product-coffee');
    await settle();
    await click(screen.button('Consultar kardex'));
    await settle();

    expect(getKardex).toHaveBeenCalledWith('product-coffee', expect.anything());
  });

  it('lista la existencia con nombres y salta al kardex desde la fila', async () => {
    const getKardex = vi.fn(async (productId: string) => kardex(productId));
    const screen = await mount(
      <InventoryScreen api={inventoryApi({ getKardex })} capabilities={capabilities}
        permissionCodes={PERMISSIONS} />
    );

    // La tabla ya no expone el UUID como si fuera el nombre del producto.
    expect(screen.text()).toContain('Arroz blanco 1 kg');
    expect(screen.text()).not.toContain('product-rice');

    await click(screen.button('Ver kardex'));
    await settle();

    expect(getKardex).toHaveBeenCalledWith('product-rice', expect.anything());
    expect(screen.text()).toContain('Saldo actual');
  });
});
