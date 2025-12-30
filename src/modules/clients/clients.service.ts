import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { EncryptionService, EmailService } from '../../common/services';
import { NotificationsService } from '../notifications/notifications.service';
import { CompleteProfileDto } from './dto/complete-profile.dto';
import * as ExcelJS from 'exceljs';

@Injectable()
export class ClientsService {
  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    private emailService: EmailService,
    private notificationsService: NotificationsService,
  ) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        clientProfile: {
          include: {
            taxCases: {
              orderBy: { taxYear: 'desc' },
              take: 1,
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        first_name: user.firstName,
        last_name: user.lastName,
        phone: user.phone,
      },
      profile: user.clientProfile
        ? {
            // SSN masked for client view
            ssn: user.clientProfile.ssn
              ? this.encryption.maskSSN(user.clientProfile.ssn)
              : null,
            date_of_birth: user.clientProfile.dateOfBirth,
            address: {
              // Decrypt address for display
              street: user.clientProfile.addressStreet
                ? this.encryption.decrypt(user.clientProfile.addressStreet)
                : null,
              city: user.clientProfile.addressCity,
              state: user.clientProfile.addressState,
              zip: user.clientProfile.addressZip,
            },
            bank: {
              name: user.clientProfile.bankName,
              routing_number: user.clientProfile.bankRoutingNumber,
              account_number: user.clientProfile.bankAccountNumber,
            },
            profile_complete: user.clientProfile.profileComplete,
            is_draft: user.clientProfile.isDraft,
          }
        : null,
      tax_case: user.clientProfile?.taxCases[0] || null,
    };
  }

  async completeProfile(userId: string, data: CompleteProfileDto) {
    // Encrypt sensitive data before saving
    const encryptedSSN = data.ssn ? this.encryption.encrypt(data.ssn) : null;
    const encryptedStreet = data.address?.street
      ? this.encryption.encrypt(data.address.street)
      : null;
    const encryptedTurbotaxPassword = data.turbotax_password
      ? this.encryption.encrypt(data.turbotax_password)
      : null;

    const profile = await this.prisma.clientProfile.upsert({
      where: { userId },
      update: {
        ssn: encryptedSSN,
        dateOfBirth: data.date_of_birth ? new Date(data.date_of_birth) : null,
        addressStreet: encryptedStreet,
        addressCity: data.address?.city,
        addressState: data.address?.state,
        addressZip: data.address?.zip,
        bankName: data.bank?.name,
        bankRoutingNumber: data.bank?.routing_number,
        bankAccountNumber: data.bank?.account_number,
        workState: data.work_state,
        employerName: data.employer_name,
        turbotaxEmail: data.turbotax_email,
        turbotaxPassword: encryptedTurbotaxPassword,
        isDraft: data.is_draft ?? false,
        profileComplete: !data.is_draft,
      },
      create: {
        userId,
        ssn: encryptedSSN,
        dateOfBirth: data.date_of_birth ? new Date(data.date_of_birth) : null,
        addressStreet: encryptedStreet,
        addressCity: data.address?.city,
        addressState: data.address?.state,
        addressZip: data.address?.zip,
        bankName: data.bank?.name,
        bankRoutingNumber: data.bank?.routing_number,
        bankAccountNumber: data.bank?.account_number,
        workState: data.work_state,
        employerName: data.employer_name,
        turbotaxEmail: data.turbotax_email,
        turbotaxPassword: encryptedTurbotaxPassword,
        isDraft: data.is_draft ?? false,
        profileComplete: !data.is_draft,
      },
    });

    return {
      profile: {
        ...profile,
        ssn: profile.ssn ? this.encryption.maskSSN(profile.ssn) : null,
      },
      message: 'Profile saved successfully',
    };
  }

  async getDraft(userId: string) {
    const profile = await this.prisma.clientProfile.findUnique({
      where: { userId },
    });

    if (!profile) return null;

    // Decrypt for editing
    return {
      ...profile,
      ssn: profile.ssn ? this.encryption.decrypt(profile.ssn) : null,
      addressStreet: profile.addressStreet
        ? this.encryption.decrypt(profile.addressStreet)
        : null,
      // Don't return turbotax password, even decrypted
      turbotaxPassword: profile.turbotaxPassword ? '********' : null,
    };
  }

  async findAll(options: {
    status?: string;
    search?: string;
    cursor?: string;
    limit: number;
  }) {
    const where: any = {};

    if (options.status) {
      where.taxCases = {
        some: { internalStatus: options.status },
      };
    }

    if (options.search) {
      where.user = {
        OR: [
          { email: { contains: options.search, mode: 'insensitive' } },
          { firstName: { contains: options.search, mode: 'insensitive' } },
          { lastName: { contains: options.search, mode: 'insensitive' } },
        ],
      };
    }

    const clients = await this.prisma.clientProfile.findMany({
      where,
      take: options.limit + 1,
      cursor: options.cursor ? { id: options.cursor } : undefined,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        taxCases: {
          orderBy: { taxYear: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const hasMore = clients.length > options.limit;
    const results = hasMore ? clients.slice(0, -1) : clients;

    return {
      clients: results.map((client) => ({
        id: client.id,
        user: {
          email: client.user.email,
          first_name: client.user.firstName,
          last_name: client.user.lastName,
        },
        internal_status: client.taxCases[0]?.internalStatus || null,
        client_status: client.taxCases[0]?.clientStatus || null,
        payment_received: client.taxCases[0]?.paymentReceived || false,
        created_at: client.createdAt,
      })),
      next_cursor: hasMore ? results[results.length - 1].id : null,
      has_more: hasMore,
    };
  }

  async findOne(id: string) {
    const client = await this.prisma.clientProfile.findUnique({
      where: { id },
      include: {
        user: true,
        taxCases: {
          include: {
            documents: true,
            statusHistory: {
              include: { changedBy: true },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }

    // Admin sees full SSN decrypted
    return {
      ...client,
      ssn: client.ssn ? this.encryption.decrypt(client.ssn) : null,
      addressStreet: client.addressStreet
        ? this.encryption.decrypt(client.addressStreet)
        : null,
      turbotaxPassword: client.turbotaxPassword
        ? this.encryption.decrypt(client.turbotaxPassword)
        : null,
    };
  }

  async update(id: string, data: any) {
    // Encrypt sensitive fields if they're being updated
    const updateData = { ...data };

    if (data.ssn) {
      updateData.ssn = this.encryption.encrypt(data.ssn);
    }
    if (data.addressStreet) {
      updateData.addressStreet = this.encryption.encrypt(data.addressStreet);
    }
    if (data.turbotaxPassword) {
      updateData.turbotaxPassword = this.encryption.encrypt(data.turbotaxPassword);
    }

    return this.prisma.clientProfile.update({
      where: { id },
      data: updateData,
    });
  }

  async updateStatus(id: string, statusData: any, changedById: string) {
    const client = await this.prisma.clientProfile.findUnique({
      where: { id },
      include: {
        user: true,
        taxCases: { orderBy: { taxYear: 'desc' }, take: 1 },
      },
    });

    if (!client || !client.taxCases[0]) {
      throw new NotFoundException('Client or tax case not found');
    }

    const taxCase = client.taxCases[0];
    const previousClientStatus = taxCase.clientStatus;

    await this.prisma.$transaction([
      this.prisma.taxCase.update({
        where: { id: taxCase.id },
        data: {
          internalStatus: statusData.internal_status,
          clientStatus: statusData.client_status,
          statusUpdatedAt: new Date(),
        },
      }),
      this.prisma.statusHistory.create({
        data: {
          taxCaseId: taxCase.id,
          previousStatus: taxCase.internalStatus,
          newStatus: statusData.internal_status,
          changedById,
          comment: statusData.comment,
        },
      }),
    ]);

    // Status labels for notifications
    const statusLabels: Record<string, string> = {
      esperando_datos: 'Necesitamos tus datos y documentos',
      cuenta_en_revision: 'Estamos revisando tu información',
      taxes_en_proceso: '¡Estamos trabajando en tu declaración!',
      taxes_en_camino: 'Tu reembolso está en camino',
      taxes_depositados: '¡Reembolso depositado en tu cuenta!',
      pago_realizado: 'Gracias por tu pago',
      en_verificacion: 'El IRS está verificando tu caso',
      taxes_finalizados: '¡Proceso completado!',
    };

    const newStatusLabel = statusLabels[statusData.client_status] || statusData.client_status;

    // Create in-app notification
    await this.notificationsService.create(
      client.user.id,
      'status_change',
      'Tu trámite ha sido actualizado',
      newStatusLabel,
    );

    // Send email notification (don't await to avoid blocking response)
    this.emailService.sendStatusChangeEmail(
      client.user.email,
      client.user.firstName,
      previousClientStatus,
      statusData.client_status,
      statusData.comment || '',
    );

    return { message: 'Status updated successfully' };
  }

  async remove(id: string) {
    await this.prisma.clientProfile.delete({
      where: { id },
    });
    return { message: 'Client deleted successfully' };
  }

  async markPaid(id: string) {
    const client = await this.prisma.clientProfile.findUnique({
      where: { id },
      include: { taxCases: { orderBy: { taxYear: 'desc' }, take: 1 } },
    });

    if (!client || !client.taxCases[0]) {
      throw new NotFoundException('Client or tax case not found');
    }

    await this.prisma.taxCase.update({
      where: { id: client.taxCases[0].id },
      data: { paymentReceived: true },
    });

    return { message: 'Payment marked as received' };
  }

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
      { header: 'Estado Interno', key: 'internalStatus', width: 20 },
      { header: 'Estado Cliente', key: 'clientStatus', width: 20 },
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

      // Decrypt sensitive data for admin export
      const decryptedSSN = client.ssn
        ? this.encryption.decrypt(client.ssn)
        : '';
      const decryptedStreet = client.addressStreet
        ? this.encryption.decrypt(client.addressStreet)
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
        workState: client.workState || '',
        employer: client.employerName || '',
        bank: client.bankName || '',
        routing: client.bankRoutingNumber || '',
        account: client.bankAccountNumber || '',
        internalStatus: taxCase?.internalStatus || '',
        clientStatus: taxCase?.clientStatus || '',
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
