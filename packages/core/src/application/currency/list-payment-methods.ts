import { ApplicationError, ok, type Result, type AppError } from '@supermarket/shared';
import type {
  FinancialTransactionTaxPolicy, FinancialTransactionTaxPolicyProvider, PaymentMethodRepository
} from '../ports/index.js';
import type { PaymentMethodDto } from './dtos.js';

/**
 * Lista los métodos de pago activos para que la interfaz los ofrezca como
 * selector, con la moneda de liquidación que cada uno ya declara y la tasa de
 * IGTF que ese método cobra.
 *
 * La tasa se publica por método —0 cuando no está gravado— para que la pantalla
 * marque el método y precargue el bruto sin leer la política ni interpretar sus
 * listas de elegibilidad. El nodo sigue siendo la autoridad: recalcula el
 * impuesto del lote recibido. Ver la enmienda de ADR-0031 del 2026-09-11.
 */
export class ListPaymentMethods {
  constructor(
    private readonly repository: PaymentMethodRepository,
    private readonly taxPolicyProvider: FinancialTransactionTaxPolicyProvider
  ) {}

  async execute(): Promise<Result<readonly PaymentMethodDto[], AppError>> {
    const methods = await this.repository.findAll();
    const policy = await this.activePolicy();
    return ok(methods
      .filter((method) => method.isActive)
      .map((method) => ({
        code: method.code, name: method.name, kind: method.kind, currencyCode: method.currencyCode,
        financialTransactionTaxBasisPoints:
          policy !== null &&
          policy.eligiblePaymentMethodCodes.includes(method.code) &&
          policy.eligibleCurrencies.includes(method.currencyCode)
            ? policy.rate.basisPoints
            : 0
      })));
  }

  /**
   * Un nodo sin política activa no cobra IGTF con ningún método. Solo se
   * absorbe ese caso: cualquier otro fallo sale, porque publicar «no gravado»
   * cuando el almacenamiento falló ocultaría el problema en la caja.
   */
  private async activePolicy(): Promise<FinancialTransactionTaxPolicy | null> {
    try {
      return await this.taxPolicyProvider.getPolicy();
    } catch (error) {
      if (error instanceof ApplicationError && error.code === 'POLICY_NOT_CONFIGURED') return null;
      throw error;
    }
  }
}
