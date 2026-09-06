import type {
  AuditReportEntryDto,
  AuditReportInput,
  CashClosureReportEntryDto,
  CashClosureReportInput,
  FiscalOperationReportEntryDto,
  FiscalOperationsReportInput,
  InventoryReportEntryDto,
  InventoryReportInput,
  MarginReportEntryDto,
  MarginReportInput,
  SalesReportEntryDto,
  SalesReportInput
} from '../reporting/dtos.js';
import type { ResolvedReportQuery } from '../reporting/row-limit.js';

export interface CashClosureReportRepository {
  findCashClosures(
    query: ResolvedReportQuery<CashClosureReportInput>
  ): Promise<readonly CashClosureReportEntryDto[]>;
}

export interface AuditReportRepository {
  findAuditEntries(
    query: ResolvedReportQuery<AuditReportInput>
  ): Promise<readonly AuditReportEntryDto[]>;
}

export interface FiscalOperationsReportRepository {
  findFiscalOperations(
    query: ResolvedReportQuery<FiscalOperationsReportInput>
  ): Promise<readonly FiscalOperationReportEntryDto[]>;
}

export interface MarginReportRepository {
  findMargins(query: ResolvedReportQuery<MarginReportInput>): Promise<readonly MarginReportEntryDto[]>;
}

export interface SalesReportRepository {
  findSalesSummary(
    query: ResolvedReportQuery<SalesReportInput>
  ): Promise<readonly SalesReportEntryDto[]>;
}

export interface InventoryReportRepository {
  findInventorySnapshot(
    query: ResolvedReportQuery<InventoryReportInput>
  ): Promise<readonly InventoryReportEntryDto[]>;
}
