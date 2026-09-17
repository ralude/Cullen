import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { LogController, type FastifyError, type FastifyInstance } from 'fastify';
import {
  createRedactionOptions,
  describeError,
  technicalLogContext
} from '@supermarket/driver-logging';
import { AppError } from '@supermarket/shared';
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
import {
  correlationOf,
  principalOf,
  publicErrorCodeOf,
  rememberCorrelation,
  sendProblem
} from './http-context.ts';
import type { ServerDependencies } from './server-dependencies.ts';

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
    rememberCorrelation(request, value);
    reply.header('x-correlation-id', value);
  });

  app.addHook('onResponse', async (request, reply) => {
    const principal = principalOf(request);
    const errorCode = publicErrorCodeOf(request);
    request.log.info({
      ...technicalLogContext({
      service: 'supermarket-server',
      module: 'http',
      correlationId: correlationOf(request),
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
        correlationId: correlationOf(request),
        operation: `${request.method} ${request.routeOptions.url ?? 'unmatched'}`,
        ...(dependencies ? {
          terminalId: dependencies.nodeIdentity.terminalId,
          originNodeId: dependencies.nodeIdentity.originNodeId
        } : {}),
        ...(principalOf(request) ? { actorId: principalOf(request)!.actorId } : {}),
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
