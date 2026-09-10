import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InventoryReportResponse, KardexDto, ProductResponse } from '@supermarket/shared';
import type { OperationApi } from './api-client.js';
import { InventoryScreen } from './operation-screens.js';
import { click, mount, select, settle, submit, type, unmountAll } from './testing/dom.js';

/**
 * Cada operación de inventario escribe su propio motivo.
 *
 * Las tres compartían una sola variable: el ajuste, la recepción simple y la
 * recepción documentada. Escribir el motivo en una lo dejaba escrito en las
 * otras, y la recepción documentada ni siquiera tenía campo propio —enviaba lo
 * que hubiera quedado en otro formulario, o nada—.
 *
 * No es cosmético: una recepción `COMPLETED` es inmutable y lleva efectos de
 * costo. Su motivo queda en la auditoría tal como se envió.
 */
afterEach(() => { unmountAll(); });

const product: ProductResponse = {
  id: 'product-rice', name: 'Arroz blanco 1 kg', description: 'Arroz blanco 1 kg',
  categoryId: 'category-1', unitCode: 'UN', unitScale: 0, barcodes: ['DEMOARROZ001'],
  price: { amountMinorUnits: 180, currencyCode: 'USD' }, taxRateBasisPoints: 1600,
  isActive: true, version: 1
} as unknown as ProductResponse;

const supplier = {
  id: 'supplier-1', code: 'PRV-001', legalName: 'Distribuidora Andina',
  tradeName: 'Andina', status: 'ACTIVE'
};

const kardex: KardexDto = {
  id: 'stock-1', productId: 'product-rice', unitCode: 'UN', quantityScale: 0,
  currentBalanceScaled: 18, batches: [], movements: []
} as unknown as KardexDto;

const overview = [{
  stockItemId: 'stock-1', productId: 'product-rice', batchId: null, lotNumber: null,
  unitCode: 'UN', quantityScale: 0, onHandScaled: 18, expiresAt: null, expiryStatus: 'NONE'
}] as unknown as readonly InventoryReportResponse[];

const inventoryApi = (overrides: Partial<OperationApi> = {}): OperationApi => ({
  listProducts: vi.fn(async () => [product]),
  listSuppliers: vi.fn(async () => [supplier]),
  getInventoryReport: vi.fn(async () => overview),
  getKardex: vi.fn(async () => kardex),
  registerStockAdjustment: vi.fn(async () => kardex),
  receivePurchase: vi.fn(async () => kardex),
  startPurchaseReceipt: vi.fn(async () => ({ id: 'receipt-1' })),
  completePurchaseReceipt: vi.fn(async () => ({ id: 'receipt-1' })),
  ...overrides
} as unknown as OperationApi);

const PERMISSIONS = [
  'inventory.kardex.read', 'reports.inventory.read', 'inventory.purchase.receive',
  'inventory.adjust', 'purchase_receipt.start', 'purchase_receipt.complete'
];
const capabilities = { fiscalMode: 'SIMULATION' as const, simulatedReportsEnabled: false };

/** Abre la ficha de un producto: los formularios de escritura cuelgan de ella. */
const openProduct = async (api: OperationApi) => {
  const screen = await mount(
    <InventoryScreen api={api} capabilities={capabilities} permissionCodes={PERMISSIONS} />
  );
  await settle();
  await select(screen.get<HTMLSelectElement>('select'), 'product-rice');
  await settle();
  await click(screen.button('Consultar kardex'));
  await settle();
  return screen;
};

const reasonInputs = (screen: Awaited<ReturnType<typeof openProduct>>) =>
  screen.all<HTMLInputElement>('.reason-field input');

describe('motivo de cada operación de inventario', () => {
  it('da un campo propio a cada operación que escribe', async () => {
    const screen = await openProduct(inventoryApi());

    /** Recepción simple, recepción documentada y ajuste: tres, no uno. */
    expect(reasonInputs(screen).length).toBe(3);
  });

  it('escribir el motivo de una no lo escribe en las otras', async () => {
    const screen = await openProduct(inventoryApi());
    const [first, second, third] = reasonInputs(screen);

    await type(first!, 'Compra a proveedor');

    expect(second!.value).toBe('');
    expect(third!.value).toBe('');
  });

  it('elegir una sugerencia tampoco se filtra al formulario vecino', async () => {
    const screen = await openProduct(inventoryApi());

    await click(screen.button('Merma por daño'));

    const written = reasonInputs(screen).filter((input) => input.value !== '');
    expect(written).toHaveLength(1);
    expect(written[0]?.value).toBe('Merma por daño');
  });

  it('la recepción documentada manda su propio motivo, no el que quedó al lado', async () => {
    const api = inventoryApi();
    const screen = await openProduct(api);
    const [receipt, documented] = reasonInputs(screen);

    await type(receipt!, 'Motivo de la recepción simple');
    await type(documented!, 'Factura 00123 de Andina');
    await submit(documented!.closest('form')!);

    expect(api.startPurchaseReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'Factura 00123 de Andina' }),
      expect.any(String)
    );
    expect(api.completePurchaseReceipt).toHaveBeenCalledWith(
      'receipt-1',
      { reason: 'Factura 00123 de Andina' },
      expect.any(String)
    );
  });
});
