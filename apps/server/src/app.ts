import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, {
  LogController,
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest
} from 'fastify';
import type {
  application,
  AuthenticateOperator,
  ExecutionContext,
  FiscalReportDto,
  PrintFiscalReportInput,
  RevokeSession,
  SessionPrincipal,
  VerifySession
} from '@supermarket/core';
import {
  createRedactionOptions,
  describeError,
  technicalLogContext
} from '@supermarket/driver-logging';
import { AppError, type ProblemDetails, type Result } from '@supermarket/shared';
import healthRoute from './routes/health.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerSystemRoutes } from './routes/system.ts';
import { registerFiscalReportRoutes } from './routes/fiscal-reports.ts';
import { registerCatalogRoutes } from './routes/catalog.ts';
import { registerCurrencyRoutes } from './routes/currency.ts';
import { registerSalesRoutes } from './routes/sales.ts';
import { registerCashRoutes } from './routes/cash.ts';
import { registerInventoryRoutes } from './routes/inventory.ts';
import { registerFiscalDocumentRoutes } from './routes/fiscal-documents.ts';
import { registerReportRoutes } from './routes/reports.ts';
import { registerSupplierRoutes } from './routes/suppliers.ts';
import { registerPurchaseReceiptRoutes } from './routes/purchase-receipts.ts';
import { registerStockCountRoutes } from './routes/stock-counts.ts';
import { registerConfigRoutes } from './routes/config.ts';
import { registerSyncRoutes } from './routes/sync.ts';
import { registerIdentityRoutes } from './routes/identity.ts';
import { sessionTokenOf } from './session-transport.ts';

type FiscalReportUseCase = {
  execute(
    input: PrintFiscalReportInput,
    context: ExecutionContext
  ): Promise<Result<FiscalReportDto, AppError>>;
};

export type ServerDependencies = {
  readonly authenticateOperator: AuthenticateOperator;
  readonly verifySession: VerifySession;
  readonly revokeSession: RevokeSession;
  readonly nodeIdentity: { readonly terminalId: string; readonly originNodeId: string };
  readonly simulatedReportsEnabled: boolean;
  readonly catalog: {
    readonly createProduct: application.CreateProduct;
    readonly updateProduct: application.UpdateProduct;
    readonly updatePrice: application.UpdatePrice;
    readonly findProductByBarcode: application.FindProductByBarcode;
  };
  readonly catalogReads?: {
    readonly listProducts: application.ListProducts;
    readonly getPriceHistory: application.GetPriceHistory;
  };
  readonly masterData?: {
    readonly listCategories: application.ListCategories;
    readonly listUnitsOfMeasure: application.ListUnitsOfMeasure;
    readonly listPaymentMethods: application.ListPaymentMethods;
    readonly listCashRegisters: application.ListCashRegisters;
  };
  readonly currency: {
    readonly updateExchangeRate: application.UpdateExchangeRate;
    readonly getCurrentExchangeRate: application.GetCurrentExchangeRate;
    readonly getExchangeRateHistory: application.GetExchangeRateHistory;
    readonly getSuggestedExchangeRate: application.GetSuggestedExchangeRate;
    readonly calculateMixedPaymentTotals: application.CalculateMixedPaymentTotals;
  };
  readonly sales: {
    readonly startSale: application.StartSale;
    readonly getSale: application.GetSale;
    readonly addItemToSale: application.AddItemToSale;
    readonly removeItemFromSale: application.RemoveItemFromSale;
    readonly applyDiscountToSale: application.ApplyDiscountToSale;
    readonly registerMixedPayment: application.RegisterMixedPayment;
    readonly completeSale: application.CompleteSale;
    readonly voidSale: application.VoidSale;
    readonly returnSale: application.ReturnSale;
    readonly setSaleRecipient: application.SetSaleRecipient;
    readonly getSaleHistory: application.GetSaleHistory;
    readonly issueSaleInvoice: application.IssueSaleInvoice;
  };
  readonly cash: {
    readonly openShift: application.OpenShift;
    readonly getOpenShift: application.GetOpenShift;
    readonly getShift: application.GetShift;
    readonly registerCashMovement: application.RegisterCashMovement;
    readonly closeShift: application.CloseShift;
  };
  readonly inventory: {
    readonly receivePurchase: application.ReceivePurchase;
    readonly registerStockAdjustment: application.RegisterStockAdjustment;
    readonly getKardex: application.GetKardex;
  };
  readonly stockCounts: {
    readonly open: application.OpenStockCount;
    readonly recordLine: application.RecordStockCountLine;
    readonly close: application.CloseStockCount;
    readonly approve: application.ApproveStockCount;
    readonly reject: application.RejectStockCount;
    readonly get: application.GetStockCount;
    readonly list: application.ListStockCounts;
  };
  readonly config: {
    readonly branches: {
      readonly create: application.CreateBranch;
      readonly update: application.UpdateBranch;
      readonly changeStatus: application.ChangeBranchStatus;
      readonly get: application.GetBranch;
      readonly list: application.ListBranches;
    };
    readonly devices: {
      readonly declare: application.DeclareDevice;
      readonly update: application.UpdateDevice;
      readonly changeStatus: application.ChangeDeviceStatus;
      readonly list: application.ListDevices;
    };
    readonly operational: {
      readonly list: application.ListOperationalMasterData;
      readonly saveCategory: application.SaveCategory;
      readonly saveUnit: application.SaveUnit;
      readonly savePaymentMethod: application.SavePaymentMethod;
      readonly createCashRegister: application.CreateCashRegister;
      readonly activateDiscountPolicy: application.ActivateDiscountPolicy;
      readonly activateTaxPolicy: application.ActivateFinancialTransactionTaxPolicy;
    };
  };
  readonly suppliers: {
    readonly create: application.CreateSupplier;
    readonly get: application.GetSupplier;
    readonly list: application.ListSuppliers;
    readonly update: application.UpdateSupplier;
    readonly changeStatus: application.ChangeSupplierStatus;
    readonly correctTaxIdentity: application.CorrectSupplierTaxIdentity;
  };
  readonly purchaseReceipts: {
    readonly start: application.StartPurchaseReceipt;
    readonly complete: application.CompletePurchaseReceipt;
    readonly reverse: application.ReversePurchaseReceipt;
    readonly get: application.GetPurchaseReceipt;
  };
  readonly fiscalDocuments: {
    readonly issue: application.IssueFiscalDocument;
    readonly get: application.GetFiscalDocument;
    readonly reconcile: application.ReconcileFiscalState;
  };
  readonly reports?: {
    readonly getCashClosureReport: application.GetCashClosureReport;
    readonly getAuditReport: application.GetAuditReport;
    readonly getFiscalOperationsReport: application.GetFiscalOperationsReport;
    readonly getMarginReport: application.GetMarginReport;
    readonly getSalesReport: application.GetSalesReport;
    readonly getInventoryReport: application.GetInventoryReport;
  };
  readonly fiscalReports?: {
    readonly printX: FiscalReportUseCase;
    readonly printZ: FiscalReportUseCase;
  };
  readonly sync?: {
    readonly registerNode: application.RegisterSyncNode;
    readonly revokeNode: application.RevokeSyncNode;
    readonly listNodes: application.ListSyncNodes;
    readonly publishCatalogBootstrap: application.PublishCatalogBootstrap;
    readonly publishOperatorGrants: application.PublishOperatorGrants;
    readonly listCoordinatedOperations: application.ListCoordinatedOperations;
    readonly getStatus: application.GetSyncStatus;
    readonly getOperationalDiagnostics: application.GetOperationalDiagnostics;
    readonly listPaused: application.ListPausedDeliveries;
    readonly resumeDelivery: application.ResumeSyncDelivery;
    readonly listDiscrepancies: application.ListSyncDiscrepancies;
    readonly retryDiscrepancy: application.RetrySyncDiscrepancy;
    readonly resolveDiscrepancy: application.ResolveSyncDiscrepancy;
  };
  /**
   * Administración de identidad y credenciales locales. El nodo la compone
   * siempre: los comandos de operadores y roles fallan cerrado en una terminal
   * (ADR-0027 D5) y el enrolamiento es local por definición (ADR-0028).
   */
  readonly identity: {
    readonly directory: application.GetIdentityDirectory;
    readonly createOperator: application.CreateOperator;
    readonly updateOperator: application.UpdateOperator;
    readonly changeOperatorStatus: application.ChangeOperatorStatus;
    readonly assignOperatorRoles: application.AssignOperatorRoles;
    readonly createRole: application.CreateRole;
    readonly updateRolePermissions: application.UpdateRolePermissions;
    readonly changeRoleStatus: application.ChangeRoleStatus;
    readonly expireCredential: application.ExpireOperatorCredential;
    readonly authorizeEnrollment: application.AuthorizeCredentialEnrollment;
    readonly completeEnrollment: application.CompleteCredentialEnrollment;
    readonly changeOwnPin: application.ChangeOwnPin;
  };
  readonly close?: () => void | Promise<void>;
};

const principals = new WeakMap<FastifyRequest, SessionPrincipal>();
const correlations = new WeakMap<FastifyRequest, string>();
const publicErrorCodes = new WeakMap<FastifyRequest, string>();

const correlationId = (request: FastifyRequest): string => correlations.get(request) ?? request.id;

const statusFor = (code: string): number => {
  if (code === 'UNAUTHORIZED' || code === 'AUTHENTICATION_FAILED') return 401;
  if (code === 'FORBIDDEN') return 403;
  if (code.endsWith('_NOT_FOUND') || code === 'RESOURCE_NOT_FOUND') return 404;
  if (code.includes('CONFLICT') || code.includes('ALREADY_') || code.endsWith('_INVALID_STATE')) {
    return 409;
  }
  if (code === 'SUPPLIER_NOT_ACTIVE') return 409;
  /**
   * La identidad rechaza por conflicto de estado, no por entrada inválida: el
   * código ya está tomado, el invariante no admite el cambio, el nodo no es
   * dueño o el ticket de enrolamiento ya no es utilizable.
   */
  if (code === 'IDENTITY_LAST_ADMINISTRATOR' || code === 'IDENTITY_NOT_OWNED_BY_NODE') return 409;
  if (code === 'IDENTITY_ENROLLMENT_EXPIRED' || code === 'IDENTITY_ENROLLMENT_CONSUMED') return 409;
  if (code === 'IDENTITY_ENROLLMENT_NODE_MISMATCH') return 409;
  if (code === 'AUTH_PIN_CHANGE_REQUIRED') return 403;
  if (code.endsWith('_TAKEN') || code.endsWith('_IN_USE')) return 409;
  if (code === 'PURCHASE_RECEIPT_SOURCE_DUPLICATED' || code === 'PURCHASE_RECEIPT_NOT_DRAFT') return 409;
  if (code === 'SHIFT_HAS_OPEN_SALES') return 409;
  if (code === 'POLICY_NOT_CONFIGURED') return 409;
  if (code === 'DATABASE_BUSY' || code === 'NETWORK_UNAVAILABLE') return 503;
  return 400;
};

export const sendProblem = (
  reply: FastifyReply,
  request: FastifyRequest,
  code: string,
  title: string,
  status = statusFor(code)
): FastifyReply => {
  publicErrorCodes.set(request, code);
  const body: ProblemDetails = {
    type: `urn:supermarket:problem:${code.toLowerCase()}`,
    title,
    status,
    code,
    correlationId: correlationId(request)
  };
  return reply.code(status).type('application/problem+json').send(body);
};

/**
 * Resuelve el principal de la sesión y aplica aquí —una sola vez, no ruta por
 * ruta— la restricción de credencial marcada para cambio (ADR-0027 D3). Solo
 * cambiar el PIN y cerrar sesión declaran `allowsPinChangeOnly`.
 */
export const requirePrincipal = async (
  request: FastifyRequest,
  reply: FastifyReply,
  dependencies: ServerDependencies,
  options: { readonly allowsPinChangeOnly?: boolean } = {}
): Promise<SessionPrincipal | null> => {
  const result = await dependencies.verifySession.execute(
    sessionTokenOf(request.headers.cookie)
  );
  if (!result.ok) {
    sendProblem(reply, request, 'UNAUTHORIZED', 'Session is invalid.', 401);
    return null;
  }
  principals.set(request, result.value);
  if (result.value.credentialMustChange && options.allowsPinChangeOnly !== true) {
    sendProblem(
      reply, request, 'AUTH_PIN_CHANGE_REQUIRED', 'The operator must change the PIN first.', 403
    );
    return null;
  }
  return result.value;
};

export const createExecutionContext = (
  request: FastifyRequest,
  principal: SessionPrincipal,
  dependencies: ServerDependencies
): ExecutionContext => {
  const idempotencyKey = request.headers['idempotency-key'];
  return {
    actorId: principal.actorId,
    actorRoleCodes: principal.roleCodes,
    terminalId: dependencies.nodeIdentity.terminalId,
    originNodeId: dependencies.nodeIdentity.originNodeId,
    correlationId: correlationId(request),
    ...(typeof idempotencyKey === 'string' ? { idempotencyKey } : {})
  };
};

/**
 * Sirve la interfaz empaquetada desde el propio nodo, bajo `/app`.
 *
 * El renderer llama a `/api/v1/...` con rutas relativas y la sesión viaja en
 * una cookie `SameSite=Strict` con `Path=/api/v1`. Cargado desde `file://`, ese
 * origen no existe y ninguna llamada llega con credenciales, así que la terminal
 * instalada solo funciona si la interfaz comparte origen con su API. Una base
 * URL absoluta no resolvería lo mismo: exigiría CORS con credenciales y una
 * cookie `SameSite=None; Secure`, es decir TLS, en una conexión de loopback.
 *
 * En desarrollo no se registra nada: `electron-vite` sirve el renderer y
 * proxifica `/api` hacia este nodo.
 */
const registerRendererAssets = (app: FastifyInstance): void => {
  const root = process.env.RENDERER_DIST_PATH?.trim();
  if (!root) return;
  const resolved = resolve(root);
  if (!existsSync(join(resolved, 'index.html'))) {
    app.log.warn({ root: resolved }, 'Renderer bundle not found; /app stays unavailable');
    return;
  }
  void app.register(async (scope) => {
    /**
     * Los estáticos resuelven sus propios fallos dentro de este contexto: una
     * ruta que intenta salir del paquete no es un fallo del nodo, así que
     * responde «no encontrado» en lugar de escalar a error interno y registrar
     * una traza. El manejador global sigue gobernando el resto de la API.
     */
    scope.setErrorHandler((_error, request, reply) => {
      sendProblem(reply, request, 'RESOURCE_NOT_FOUND', 'Resource was not found.');
    });
    await scope.register(fastifyStatic, { root: resolved, prefix: '/app/', index: 'index.html' });
  });
  app.get('/app', async (_request, reply) => reply.redirect('/app/', 308));
};

/**
 * Destino alternativo del logger técnico. Existe para que una prueba observe la
 * salida real del logger compuesto, en lugar de inspeccionar su configuración.
 */
export type ServerLogDestination = { write(chunk: string): void };

export const buildApp = (
  dependencies?: ServerDependencies,
  options?: { readonly logDestination?: ServerLogDestination }
): FastifyInstance => {
  const app = Fastify({
    ajv: { customOptions: { removeAdditional: false } },
    logController: new LogController({ disableRequestLogging: true }),
    logger: {
      ...createRedactionOptions(),
      ...(options?.logDestination ? { stream: options.logDestination } : {})
    }
  });

  app.addHook('onRequest', async (request, reply) => {
    const supplied = request.headers['x-correlation-id'];
    const value = typeof supplied === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(supplied)
      ? supplied
      : randomUUID();
    correlations.set(request, value);
    reply.header('x-correlation-id', value);
  });

  app.addHook('onResponse', async (request, reply) => {
    const principal = principals.get(request);
    const errorCode = publicErrorCodes.get(request);
    request.log.info({
      ...technicalLogContext({
      service: 'supermarket-server',
      module: 'http',
      correlationId: correlationId(request),
      ...(dependencies ? {
        terminalId: dependencies.nodeIdentity.terminalId,
        originNodeId: dependencies.nodeIdentity.originNodeId
      } : {}),
      ...(principal ? { actorId: principal.actorId } : {}),
      operation: `${request.method} ${request.routeOptions.url ?? 'unmatched'}`,
      ...(errorCode ? { errorCode } : {})
      }),
      statusCode: reply.statusCode,
    }, 'HTTP request completed');
  });

  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if ('validation' in error && error.validation) {
      sendProblem(reply, request, 'HTTP_VALIDATION_FAILED', 'Request validation failed.', 400);
      return;
    }
    if (error instanceof AppError) {
      sendProblem(reply, request, error.code, error.message);
      return;
    }
    /**
     * Un fallo no previsto se registra descrito, nunca crudo: la cadena de
     * `cause` de un error de infraestructura puede arrastrar la entrada de la
     * petición. El stack queda en el log técnico y no en la respuesta.
     */
    request.log.error({
      ...technicalLogContext({
        service: 'supermarket-server',
        module: 'http',
        correlationId: correlationId(request),
        operation: `${request.method} ${request.routeOptions.url ?? 'unmatched'}`,
        ...(dependencies ? {
          terminalId: dependencies.nodeIdentity.terminalId,
          originNodeId: dependencies.nodeIdentity.originNodeId
        } : {}),
        ...(principals.get(request) ? { actorId: principals.get(request)!.actorId } : {}),
        errorCode: 'INTERNAL_ERROR'
      }),
      error: describeError(error),
    }, 'Unhandled request error');
    sendProblem(reply, request, 'INTERNAL_ERROR', 'Unexpected server error.', 500);
  });

  app.register(healthRoute);
  registerRendererAssets(app);
  if (dependencies) {
    registerAuthRoutes(app, dependencies);
    registerSystemRoutes(app, dependencies);
    registerCatalogRoutes(app, dependencies);
    registerCurrencyRoutes(app, dependencies);
    registerSalesRoutes(app, dependencies);
    registerCashRoutes(app, dependencies);
    registerInventoryRoutes(app, dependencies);
    registerStockCountRoutes(app, dependencies);
    registerConfigRoutes(app, dependencies);
    registerSyncRoutes(app, dependencies);
    registerIdentityRoutes(app, dependencies);
    registerSupplierRoutes(app, dependencies);
    registerPurchaseReceiptRoutes(app, dependencies);
    registerFiscalDocumentRoutes(app, dependencies);
    registerReportRoutes(app, dependencies);
    if (dependencies.simulatedReportsEnabled && dependencies.fiscalReports) {
      registerFiscalReportRoutes(app, dependencies);
    }
    if (dependencies.close) app.addHook('onClose', dependencies.close);
  }

  return app;
};
