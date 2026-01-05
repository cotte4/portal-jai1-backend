import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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
      taxCase: user.clientProfile?.taxCases[0] || null,
    };
  }

  async completeProfile(userId: string, data: CompleteProfileDto) {
    // Check if profile is already completed (not a draft)
    const existingProfile = await this.prisma.clientProfile.findUnique({
      where: { userId },
    });

    if (existingProfile?.profileComplete && !existingProfile?.isDraft) {
      throw new BadRequestException(
        'Profile already submitted. Contact support to make changes.',
      );
    }

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
          id: client.user.id,
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
          orderBy: { taxYear: 'desc' },
        },
      },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }

    // Collect all documents from all tax cases
    const allDocuments = client.taxCases.flatMap((tc) => tc.documents);

    // Collect all status history from all tax cases
    const allStatusHistory = client.taxCases.flatMap((tc) =>
      tc.statusHistory.map((sh) => ({
        id: sh.id,
        taxCaseId: sh.taxCaseId,
        previousStatus: sh.previousStatus,
        newStatus: sh.newStatus,
        changedById: sh.changedById,
        comment: sh.comment,
        createdAt: sh.createdAt,
        changedBy: sh.changedBy,
      })),
    );

    // Return structure matching frontend AdminClientDetail interface
    return {
      id: client.id,
      user: {
        id: client.user.id,
        email: client.user.email,
        role: client.user.role,
        firstName: client.user.firstName,
        lastName: client.user.lastName,
        phone: client.user.phone,
        isActive: client.user.isActive,
        lastLoginAt: client.user.lastLoginAt,
        createdAt: client.user.createdAt,
        updatedAt: client.user.updatedAt,
      },
      profile: {
        id: client.id,
        userId: client.userId,
        ssn: client.ssn ? this.encryption.decrypt(client.ssn) : null,
        dateOfBirth: client.dateOfBirth,
        address: {
          street: client.addressStreet
            ? this.encryption.decrypt(client.addressStreet)
            : null,
          city: client.addressCity,
          state: client.addressState,
          zip: client.addressZip,
        },
        bank: {
          name: client.bankName,
          routingNumber: client.bankRoutingNumber,
          accountNumber: client.bankAccountNumber,
        },
        workState: client.workState,
        employerName: client.employerName,
        turbotaxEmail: client.turbotaxEmail,
        turbotaxPassword: client.turbotaxPassword
          ? this.encryption.decrypt(client.turbotaxPassword)
          : null,
        profileComplete: client.profileComplete,
        isDraft: client.isDraft,
        createdAt: client.createdAt,
        updatedAt: client.updatedAt,
      },
      taxCases: client.taxCases.map((tc) => ({
        id: tc.id,
        clientProfileId: tc.clientProfileId,
        taxYear: tc.taxYear,
        internalStatus: tc.internalStatus,
        clientStatus: tc.clientStatus,
        federalStatus: tc.federalStatus,
        stateStatus: tc.stateStatus,
        estimatedRefund: tc.estimatedRefund,
        actualRefund: tc.actualRefund,
        refundDepositDate: tc.refundDepositDate,
        paymentReceived: tc.paymentReceived,
        commissionPaid: tc.commissionPaid,
        statusUpdatedAt: tc.statusUpdatedAt,
        adminStep: tc.adminStep,
        hasProblem: tc.hasProblem,
        problemStep: tc.problemStep,
        problemType: tc.problemType,
        problemDescription: tc.problemDescription,
        problemResolvedAt: tc.problemResolvedAt,
        createdAt: tc.createdAt,
        updatedAt: tc.updatedAt,
      })),
      documents: allDocuments,
      statusHistory: allStatusHistory,
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

    // Support both camelCase (from frontend) and snake_case
    const internalStatus = statusData.internalStatus || statusData.internal_status;
    const clientStatus = statusData.clientStatus || statusData.client_status;

    await this.prisma.$transaction([
      this.prisma.taxCase.update({
        where: { id: taxCase.id },
        data: {
          internalStatus: internalStatus,
          clientStatus: clientStatus,
          statusUpdatedAt: new Date(),
        },
      }),
      this.prisma.statusHistory.create({
        data: {
          taxCaseId: taxCase.id,
          previousStatus: taxCase.internalStatus,
          newStatus: internalStatus,
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

    const newStatusLabel = statusLabels[clientStatus] || clientStatus;

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
      clientStatus,
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

  async updateAdminStep(id: string, step: number, changedById: string) {
    if (step < 1 || step > 5) {
      throw new NotFoundException('Step must be between 1 and 5');
    }

    const client = await this.prisma.clientProfile.findUnique({
      where: { id },
      include: {
        taxCases: { orderBy: { taxYear: 'desc' }, take: 1 },
      },
    });

    if (!client || !client.taxCases[0]) {
      throw new NotFoundException('Client or tax case not found');
    }

    const taxCase = client.taxCases[0];

    await this.prisma.$transaction([
      this.prisma.taxCase.update({
        where: { id: taxCase.id },
        data: { adminStep: step },
      }),
      this.prisma.statusHistory.create({
        data: {
          taxCaseId: taxCase.id,
          previousStatus: `step:${taxCase.adminStep || 1}`,
          newStatus: `step:${step}`,
          changedById,
          comment: `Admin step changed to ${step}`,
        },
      }),
    ]);

    return { message: 'Admin step updated successfully', step };
  }

  async setProblem(
    id: string,
    problemData: {
      hasProblem: boolean;
      problemType?: string;
      problemDescription?: string;
    },
  ) {
    const client = await this.prisma.clientProfile.findUnique({
      where: { id },
      include: {
        taxCases: { orderBy: { taxYear: 'desc' }, take: 1 },
      },
    });

    if (!client || !client.taxCases[0]) {
      throw new NotFoundException('Client or tax case not found');
    }

    const taxCase = client.taxCases[0];

    const updateData: any = {
      hasProblem: problemData.hasProblem,
    };

    if (problemData.hasProblem) {
      updateData.problemStep = taxCase.adminStep || 1;
      updateData.problemType = problemData.problemType || null;
      updateData.problemDescription = problemData.problemDescription || null;
      updateData.problemResolvedAt = null;
    } else {
      updateData.problemResolvedAt = new Date();
      updateData.problemType = null;
      updateData.problemDescription = null;
    }

    await this.prisma.taxCase.update({
      where: { id: taxCase.id },
      data: updateData,
    });

    return {
      message: problemData.hasProblem
        ? 'Problem marked on case'
        : 'Problem resolved',
      hasProblem: problemData.hasProblem,
    };
  }

  async sendClientNotification(
    id: string,
    notifyData: {
      title: string;
      message: string;
      sendEmail?: boolean;
    },
  ) {
    const client = await this.prisma.clientProfile.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }

    // Create in-app notification
    await this.notificationsService.create(
      client.user.id,
      'system',
      notifyData.title,
      notifyData.message,
    );

    // Send email if requested
    if (notifyData.sendEmail) {
      await this.emailService.sendNotificationEmail(
        client.user.email,
        client.user.firstName,
        notifyData.title,
        notifyData.message,
      );
    }

    return {
      message: 'Notification sent successfully',
      emailSent: notifyData.sendEmail || false,
    };
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
