import {
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../config/prisma.service';
import { EncryptionService } from '../../../common/services';
import * as ExcelJS from 'exceljs';
import { PassThrough } from 'stream';

@Injectable()
export class ClientExportService {
  private readonly logger = new Logger(ClientExportService.name);
  private readonly EXPORT_TIMEOUT_MS = 300000; // 5 minutes
  private isExportInProgress = false;

  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
  ) {}

  /**
   * Build Prisma where clause for export filters (reused from findAll logic)
   */
  private buildExportWhereClause(options: {
    status?: string;
    search?: string;
    hasProblem?: boolean;
    federalStatus?: string;
    stateStatus?: string;
    caseStatus?: string;
    dateFrom?: string;
    dateTo?: string;
  }): any {
    const where: any = {};

    // Date range filter
    if (options.dateFrom || options.dateTo) {
      where.createdAt = {};
      if (options.dateFrom) {
        const fromDate = new Date(options.dateFrom);
        if (!isNaN(fromDate.getTime())) {
          where.createdAt.gte = fromDate;
        }
      }
      if (options.dateTo) {
        const toDate = new Date(options.dateTo);
        if (!isNaN(toDate.getTime())) {
          toDate.setDate(toDate.getDate() + 1);
          where.createdAt.lt = toDate;
        }
      }
      if (Object.keys(where.createdAt).length === 0) {
        delete where.createdAt;
      }
    }

    // Has Problem filter
    if (options.hasProblem !== undefined) {
      where.taxCases = {
        ...where.taxCases,
        some: { ...where.taxCases?.some, hasProblem: options.hasProblem },
      };
    }

    // Federal Status filter
    if (options.federalStatus) {
      where.taxCases = {
        ...where.taxCases,
        some: { ...where.taxCases?.some, federalStatusNew: options.federalStatus },
      };
    }

    // State Status filter
    if (options.stateStatus) {
      where.taxCases = {
        ...where.taxCases,
        some: { ...where.taxCases?.some, stateStatusNew: options.stateStatus },
      };
    }

    // Case Status filter
    if (options.caseStatus) {
      where.taxCases = {
        ...where.taxCases,
        some: { ...where.taxCases?.some, caseStatus: options.caseStatus },
      };
    }

    // Group status filters
    if (options.status && options.status !== 'all') {
      const existingTaxCaseFilters = where.taxCases?.some || {};

      if (options.status === 'group_pending') {
        if (Object.keys(existingTaxCaseFilters).length > 0) {
          where.AND = [
            { taxCases: { some: existingTaxCaseFilters } },
            { OR: [{ taxCases: { none: {} } }, { taxCases: { some: { caseStatus: { not: 'taxes_filed' } } } }, { taxCases: { some: { caseStatus: null } } }] },
          ];
          delete where.taxCases;
        } else {
          where.OR = [{ taxCases: { none: {} } }, { taxCases: { some: { caseStatus: { not: 'taxes_filed' } } } }, { taxCases: { some: { caseStatus: null } } }];
        }
      } else if (options.status === 'group_in_review') {
        where.taxCases = {
          some: { ...existingTaxCaseFilters, caseStatus: 'taxes_filed', federalStatusNew: { in: ['taxes_en_proceso', 'cheque_en_camino', 'deposito_directo'] } },
        };
      } else if (options.status === 'group_completed') {
        where.taxCases = {
          some: { ...existingTaxCaseFilters, OR: [{ federalStatusNew: 'taxes_completados' }, { stateStatusNew: 'taxes_completados' }] },
        };
      } else if (options.status === 'group_needs_attention') {
        where.taxCases = {
          some: { ...existingTaxCaseFilters, OR: [{ federalStatusNew: 'issues' }, { stateStatusNew: 'issues' }, { hasProblem: true }] },
        };
      }
    }

    // Search filter
    if (options.search) {
      const searchCondition = {
        OR: [
          { email: { contains: options.search, mode: 'insensitive' } },
          { firstName: { contains: options.search, mode: 'insensitive' } },
          { lastName: { contains: options.search, mode: 'insensitive' } },
        ],
      };
      if (where.OR) {
        where.AND = [{ OR: where.OR }, { user: searchCondition }];
        delete where.OR;
      } else {
        where.user = searchCondition;
      }
    }

    return where;
  }

  /**
   * Export clients to Excel using streaming to handle large datasets.
   * Processes clients in batches to avoid memory issues and timeouts.
   * Returns a PassThrough stream that can be piped to the response.
   * @param filters - Optional filters to apply (same as findAll)
   */
  async exportToExcelStream(filters?: {
    status?: string;
    search?: string;
    hasProblem?: boolean;
    federalStatus?: string;
    stateStatus?: string;
    caseStatus?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<PassThrough> {
    // Prevent concurrent exports (mutex pattern)
    if (this.isExportInProgress) {
      throw new BadRequestException(
        'Export already in progress. Please wait.',
      );
    }

    this.isExportInProgress = true;
    const BATCH_SIZE = 500;
    const stream = new PassThrough();

    // Build where clause from filters
    const where = filters ? this.buildExportWhereClause(filters) : {};

    // Create streaming workbook writer
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream,
      useStyles: true,
      useSharedStrings: false, // Faster for large files
    });

    const worksheet = workbook.addWorksheet('Clientes');

    // Define columns
    worksheet.columns = [
      { header: 'Nombre', key: 'name', width: 25 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Teléfono', key: 'phone', width: 15 },
      { header: 'SSN', key: 'ssn', width: 15 },
      { header: 'Fecha Nacimiento', key: 'dob', width: 15 },
      { header: 'Dirección', key: 'address', width: 40 },
      { header: 'Estado Trabajo', key: 'workState', width: 12 },
      { header: 'Empleador', key: 'employer', width: 25 },
      { header: 'Banco', key: 'bank', width: 20 },
      { header: 'Routing #', key: 'routing', width: 12 },
      { header: 'Account #', key: 'account', width: 15 },
      { header: 'Taxes Filed', key: 'taxesFiled', width: 12 },
      { header: 'Federal Status', key: 'federalStatus', width: 15 },
      { header: 'State Status', key: 'stateStatus', width: 15 },
      { header: 'Reembolso Est.', key: 'estimatedRefund', width: 15 },
      { header: 'Pago Recibido', key: 'paymentReceived', width: 12 },
      { header: 'Fecha Registro', key: 'createdAt', width: 15 },
    ];

    // Style header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '1D345D' },
    };
    await headerRow.commit();

    // Set up export timeout to prevent hanging forever
    const exportTimeout = setTimeout(() => {
      this.logger.error(
        `Excel export timeout after ${this.EXPORT_TIMEOUT_MS}ms`,
      );
      this.isExportInProgress = false;
      stream.destroy(new Error('Export timeout exceeded'));
    }, this.EXPORT_TIMEOUT_MS);

    // Process clients in batches using cursor-based pagination
    (async () => {
      try {
        let cursor: string | undefined;
        let processedCount = 0;

        while (true) {
          // Fetch a batch of clients with filters applied
          const clients = await this.prisma.clientProfile.findMany({
            where,
            take: BATCH_SIZE,
            skip: cursor ? 1 : 0, // Skip the cursor record itself
            cursor: cursor ? { id: cursor } : undefined,
            include: {
              user: true,
              taxCases: {
                orderBy: { taxYear: 'desc' },
                take: 1,
              },
            },
            orderBy: { id: 'asc' }, // Consistent ordering for cursor pagination
          });

          // No more clients to process
          if (clients.length === 0) {
            break;
          }

          // Process each client in the batch
          for (const client of clients) {
            const taxCase = client.taxCases[0];

            // Decrypt sensitive data for admin export (full values needed for operations)
            const decryptedSSN = client.ssn
              ? this.encryption.decrypt(client.ssn) || ''
              : '';
            const decryptedStreet = client.addressStreet
              ? this.encryption.decrypt(client.addressStreet)
              : '';
            const decryptedRouting = taxCase?.bankRoutingNumber
              ? this.encryption.decrypt(taxCase.bankRoutingNumber) || ''
              : '';
            const decryptedAccount = taxCase?.bankAccountNumber
              ? this.encryption.decrypt(taxCase.bankAccountNumber) || ''
              : '';

            const fullAddress = [
              decryptedStreet,
              client.addressCity,
              client.addressState,
              client.addressZip,
            ]
              .filter(Boolean)
              .join(', ');

            // Add row and commit immediately (streaming)
            const row = worksheet.addRow({
              name: `${client.user.firstName || ''} ${client.user.lastName || ''}`.trim(),
              email: client.user.email,
              phone: client.user.phone || '',
              ssn: decryptedSSN,
              dob: client.dateOfBirth
                ? client.dateOfBirth.toISOString().split('T')[0]
                : '',
              address: fullAddress,
              workState: taxCase?.workState || '',
              employer: taxCase?.employerName || '',
              bank: taxCase?.bankName || '',
              routing: decryptedRouting,
              account: decryptedAccount,
              taxesFiled: (taxCase as any)?.caseStatus === 'taxes_filed' ? 'Sí' : 'No',
              federalStatus: (taxCase as any)?.federalStatusNew || '',
              stateStatus: (taxCase as any)?.stateStatusNew || '',
              estimatedRefund: taxCase?.estimatedRefund?.toString() || '',
              paymentReceived: taxCase?.paymentReceived ? 'Sí' : 'No',
              createdAt: client.createdAt.toISOString().split('T')[0],
            });
            await row.commit();
          }

          processedCount += clients.length;
          this.logger.debug(
            `Excel export: processed ${processedCount} clients`,
          );

          // Set cursor for next batch
          cursor = clients[clients.length - 1].id;

          // If we got fewer records than batch size, we're done
          if (clients.length < BATCH_SIZE) {
            break;
          }
        }

        // Commit worksheet and workbook
        await worksheet.commit();
        await workbook.commit();

        this.logger.log(
          `Excel export completed: ${processedCount} clients exported`,
        );
      } catch (error) {
        this.logger.error('Excel export failed:', error);
        stream.destroy(error as Error);
      } finally {
        clearTimeout(exportTimeout);
        this.isExportInProgress = false;
      }
    })();

    return stream;
  }

  /**
   * Legacy synchronous export method (kept for backward compatibility with small datasets)
   * @deprecated Use exportToExcelStream() for large datasets
   */
  async exportToExcel(): Promise<Buffer> {
    // Get all clients with their data
    const clients = await this.prisma.clientProfile.findMany({
      include: {
        user: true,
        taxCases: {
          orderBy: { taxYear: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Create workbook and worksheet
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Portal JAI1';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Clientes', {
      headerFooter: { firstHeader: 'Portal JAI1 - Lista de Clientes' },
    });

    // Define columns
    worksheet.columns = [
      { header: 'Nombre', key: 'name', width: 25 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Teléfono', key: 'phone', width: 15 },
      { header: 'SSN', key: 'ssn', width: 15 },
      { header: 'Fecha Nacimiento', key: 'dob', width: 15 },
      { header: 'Dirección', key: 'address', width: 40 },
      { header: 'Estado Trabajo', key: 'workState', width: 12 },
      { header: 'Empleador', key: 'employer', width: 25 },
      { header: 'Banco', key: 'bank', width: 20 },
      { header: 'Routing #', key: 'routing', width: 12 },
      { header: 'Account #', key: 'account', width: 15 },
      { header: 'Taxes Filed', key: 'taxesFiled', width: 12 },
      { header: 'Federal Status', key: 'federalStatus', width: 15 },
      { header: 'State Status', key: 'stateStatus', width: 15 },
      { header: 'Reembolso Est.', key: 'estimatedRefund', width: 15 },
      { header: 'Pago Recibido', key: 'paymentReceived', width: 12 },
      { header: 'Fecha Registro', key: 'createdAt', width: 15 },
    ];

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '1D345D' },
    };
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };

    // Add data rows
    for (const client of clients) {
      const taxCase = client.taxCases[0];

      // Decrypt sensitive data for admin export (full values needed for operations)
      const decryptedSSN = client.ssn
        ? this.encryption.decrypt(client.ssn) || ''
        : '';
      const decryptedStreet = client.addressStreet
        ? this.encryption.decrypt(client.addressStreet)
        : '';
      const decryptedRouting = taxCase?.bankRoutingNumber
        ? this.encryption.decrypt(taxCase.bankRoutingNumber) || ''
        : '';
      const decryptedAccount = taxCase?.bankAccountNumber
        ? this.encryption.decrypt(taxCase.bankAccountNumber) || ''
        : '';

      const fullAddress = [
        decryptedStreet,
        client.addressCity,
        client.addressState,
        client.addressZip,
      ]
        .filter(Boolean)
        .join(', ');

      worksheet.addRow({
        name: `${client.user.firstName} ${client.user.lastName}`,
        email: client.user.email,
        phone: client.user.phone || '',
        ssn: decryptedSSN,
        dob: client.dateOfBirth
          ? client.dateOfBirth.toISOString().split('T')[0]
          : '',
        address: fullAddress,
        workState: taxCase?.workState || '',
        employer: taxCase?.employerName || '',
        bank: taxCase?.bankName || '',
        routing: decryptedRouting,
        account: decryptedAccount,
        taxesFiled: (taxCase as any)?.caseStatus === 'taxes_filed' ? 'Sí' : 'No',
        federalStatus: (taxCase as any)?.federalStatusNew || '',
        stateStatus: (taxCase as any)?.stateStatusNew || '',
        estimatedRefund: taxCase?.estimatedRefund?.toString() || '',
        paymentReceived: taxCase?.paymentReceived ? 'Sí' : 'No',
        createdAt: client.createdAt.toISOString().split('T')[0],
      });
    }

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
