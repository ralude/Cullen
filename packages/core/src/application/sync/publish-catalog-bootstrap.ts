import { ApplicationError, err, ok, type AppError, type Result } from '@supermarket/shared';
import {
  toCategoryPublication,
  toExchangeRatePublication,
  toPaymentMethodPublication,
  toOperationalPolicyPublication,
  toProductPublication,
  toStockAvailabilityPublication,
  toUnitOfMeasurePublication
} from '../catalog/reference-publications.js';
import type { ExecutionContext } from '../execution-context.js';
import { toBusinessEvents, type DomainEventLike, type JsonValue } from '../events/index.js';
import type {
  AuditWriter,
  AuthorizationService,
  CatalogReferenceSource,
  Clock,
  IdGenerator,
  OutboxStore,
  UnitOfWork
} from '../ports/index.js';
import { SYNC_PERMISSIONS } from './permissions.js';

export type CatalogBootstrapDto = {
  readonly categories: number;
  readonly unitsOfMeasure: number;
  readonly products: number;
  readonly paymentMethods: number;
  readonly operationalPolicies: number;
  readonly exchangeRates: number;
  readonly stockAvailability: number;
  readonly publishedAt: string;
};

/**
 * Publica el corte inicial de catálogo y métodos de pago para las terminales.
 *
 * No hay un mecanismo de carga aparte: el corte usa **los mismos contratos** de
 * estado completo que un cambio ordinario, y el estado de entrega por destino
 * lleva su progreso. Interrumpir el proceso deja publicaciones pendientes que
 * el worker retoma; interrumpirlo antes del commit no deja ninguna, porque la
 * lectura y el encolado comparten transacción.
 *
 * Un cambio ocurrido durante el corte se entrega después como publicación
 * normal, y la regla de versión del consumidor resuelve el solapamiento: no hay
 * huecos ni orden especial que respetar.
 *
 * Repetirlo es seguro: las publicaciones nuevas transportan el mismo estado y
 * el consumidor descarta las que no son posteriores a lo ya aplicado.
 */
export class PublishCatalogBootstrap {
  constructor(
    private readonly source: CatalogReferenceSource,
    private readonly outbox: OutboxStore,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly auditWriter?: AuditWriter
  ) {}

  async execute(
    input: { readonly reason: string },
    context: ExecutionContext
  ): Promise<Result<CatalogBootstrapDto, AppError>> {
    if (!await this.authorization.authorize(context, SYNC_PERMISSIONS.PUBLISH_REFERENCES)) {
      return err(new ApplicationError(
        'FORBIDDEN',
        'Actor is not authorized to publish reference bootstraps.'
      ));
    }
    if (input.reason.trim().length === 0) {
      return err(new ApplicationError(
        'SYNC_BOOTSTRAP_REASON_REQUIRED',
        'A bootstrap reason is required.'
      ));
    }

    const now = this.clock.now();
    return ok(await this.unitOfWork.execute(async () => {
      const [categories, units, paymentMethods, policies, exchangeRates, products, availability] = [
        await this.source.listCategories(),
        await this.source.listUnitsOfMeasure(),
        await this.source.listPaymentMethods(),
        await this.source.listOperationalPolicies(),
        await this.source.listExchangeRates(now),
        await this.source.listProducts(),
        await this.source.listStockAvailability()
      ];

      /**
       * El orden de encolado sitúa los maestros antes que los productos. No es
       * una garantía de entrega —la dependencia declarada por el contrato es la
       * que espera en el receptor— pero evita un ciclo de espera innecesario.
       */
      const publications: DomainEventLike[] = [
        ...categories.map(({ value, version }) => toCategoryPublication(value, {
          eventId: this.ids.generate(), occurredAt: now, version
        })),
        ...units.map(({ value, version }) => toUnitOfMeasurePublication(value, {
          eventId: this.ids.generate(), occurredAt: now, version
        })),
        ...paymentMethods.map(({ value, version }) => toPaymentMethodPublication(value, {
          eventId: this.ids.generate(), occurredAt: now, version
        })),
        ...policies.map((policy) => toOperationalPolicyPublication(policy, {
          eventId: this.ids.generate(), occurredAt: now
        })),
        ...exchangeRates.map(({ value, version }) => toExchangeRatePublication(value, {
          eventId: this.ids.generate(), occurredAt: now, version
        })),
        ...products.map((product) => toProductPublication(product, {
          eventId: this.ids.generate(), occurredAt: now
        })),
        /**
         * La disponibilidad va después de los productos porque declara su
         * dependencia sobre ellos; el receptor la espera igualmente.
         */
        ...availability.map((entry) => toStockAvailabilityPublication(entry, {
          eventId: this.ids.generate(), occurredAt: now
        }))
      ];

      await this.outbox.enqueue(toBusinessEvents(publications, context));
      await this.auditWriter?.append([{
        auditId: this.ids.generate(),
        actorId: context.actorId,
        actorRoleCodes: context.actorRoleCodes ?? [],
        action: 'SYNC_CATALOG_BOOTSTRAP_PUBLISHED',
        entityType: 'SyncReference',
        entityId: 'catalog',
        before: null,
        after: {
          categories: categories.length,
          unitsOfMeasure: units.length,
          paymentMethods: paymentMethods.length,
          operationalPolicies: policies.length,
          exchangeRates: exchangeRates.length,
          products: products.length,
          stockAvailability: availability.length
        } as unknown as JsonValue,
        reason: input.reason.trim(),
        terminalId: context.terminalId,
        originNodeId: context.originNodeId,
        occurredAt: now,
        correlationId: context.correlationId
      }]);

      return {
        categories: categories.length,
        unitsOfMeasure: units.length,
        paymentMethods: paymentMethods.length,
        operationalPolicies: policies.length,
        exchangeRates: exchangeRates.length,
        products: products.length,
        stockAvailability: availability.length,
        publishedAt: now.toISOString()
      };
    }));
  }
}
