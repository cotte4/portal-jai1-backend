import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { EncryptionService, EmailService } from '../../common/services';
import { NotificationsService } from '../notifications/notifications.service';
import { ProgressAutomationService } from '../progress/progress-automation.service';
import { ReferralsService } from '../referrals/referrals.service';
import { CompleteProfileDto } from './dto/complete-profile.dto';
import * as ExcelJS from 'exceljs';

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    private emailService: EmailService,
    private notificationsService: NotificationsService,
    private progressAutomation: ProgressAutomationService,
    private referralsService: ReferralsService,
  ) {}

  async getProfile(userId: string) {
    // Optimized: Use select instead of include for better query performance
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        clientProfile: {
          select: {
            ssn: true,
            dateOfBirth: true,
            addressStreet: true,
            addressCity: true,
            addressState: true,
            addressZip: true,
            profileComplete: true,
            isDraft: true,
            taxCases: {
              select: {
                id: true,
                taxYear: true,
                bankName: true,
                bankRoutingNumber: true,
                bankAccountNumber: true,
                workState: true,
                employerName: true,
                internalStatus: true,
                clientStatus: true,
                federalStatus: true,
                stateStatus: true,
                adminStep: true,
                estimatedRefund: true,
                actualRefund: true,
              },
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
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
      },
      profile: user.clientProfile
        ? {
            // SSN masked for client view
            ssn: user.clientProfile.ssn
              ? this.encryption.maskSSN(user.clientProfile.ssn)
              : null,
            dateOfBirth: user.clientProfile.dateOfBirth,
            address: {
              // Decrypt address for display
              street: user.clientProfile.addressStreet
                ? this.encryption.decrypt(user.clientProfile.addressStreet)
                : null,
              city: user.clientProfile.addressCity,
              state: user.clientProfile.addressState,
              zip: user.clientProfile.addressZip,
            },
            // Bank data is now stored per TaxCase (year-specific)
            bank: user.clientProfile.taxCases[0]
              ? {
                  name: user.clientProfile.taxCases[0].bankName,
                  routingNumber: user.clientProfile.taxCases[0].bankRoutingNumber
                    ? this.encryption.maskRoutingNumber(user.clientProfile.taxCases[0].bankRoutingNumber)
                    : null,
                  accountNumber: user.clientProfile.taxCases[0].bankAccountNumber
                    ? this.encryption.maskBankAccount(user.clientProfile.taxCases[0].bankAccountNumber)
                    : null,
                }
              : { name: null, routingNumber: null, accountNumber: null },
            workState: user.clientProfile.taxCases[0]?.workState || null,
            employerName: user.clientProfile.taxCases[0]?.employerName || null,
            profileComplete: user.clientProfile.profileComplete,
            isDraft: user.clientProfile.isDraft,
          }
        : null,
      taxCase: user.clientProfile?.taxCases[0] || null,
    };
  }

  async completeProfile(userId: string, data: CompleteProfileDto) {
    this.logger.log(`Saving profile for user ${userId}, isDraft: ${data.is_draft}`);

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
    const encryptedTurbotaxEmail = data.turbotax_email
      ? this.encryption.encrypt(data.turbotax_email)
      : null;
    const encryptedTurbotaxPassword = data.turbotax_password
      ? this.encryption.encrypt(data.turbotax_password)
      : null;
    const encryptedBankRouting = data.bank?.routing_number
      ? this.encryption.encrypt(data.bank.routing_number)
      : null;
    const encryptedBankAccount = data.bank?.account_number
      ? this.encryption.encrypt(data.bank.account_number)
      : null;

    // Use transaction to ensure both user and profile are updated
    const result = await this.prisma.$transaction(async (tx) => {
      // Update user's phone if provided
      if (data.phone !== undefined) {
        await tx.user.update({
          where: { id: userId },
          data: { phone: data.phone },
        });
        this.logger.log(`Updated phone for user ${userId}`);
      }

      const profile = await tx.clientProfile.upsert({
        where: { userId },
        update: {
          ssn: encryptedSSN,
          dateOfBirth: data.date_of_birth ? new Date(data.date_of_birth) : null,
          addressStreet: encryptedStreet,
          addressCity: data.address?.city,
          addressState: data.address?.state,
          addressZip: data.address?.zip,
          turbotaxEmail: encryptedTurbotaxEmail,
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
          turbotaxEmail: encryptedTurbotaxEmail,
          turbotaxPassword: encryptedTurbotaxPassword,
          isDraft: data.is_draft ?? false,
          profileComplete: !data.is_draft,
        },
      });

      // Get or create TaxCase for this year to store bank/employer data
      let taxCase = await tx.taxCase.findFirst({
        where: { clientProfileId: profile.id },
        orderBy: { taxYear: 'desc' },
      });

      if (!taxCase) {
        taxCase = await tx.taxCase.create({
          data: {
            clientProfileId: profile.id,
            taxYear: new Date().getFullYear(),
          },
        });
      }

      // Update TaxCase with bank/employer data (year-specific)
      await tx.taxCase.update({
        where: { id: taxCase.id },
        data: {
          bankName: data.bank?.name,
          bankRoutingNumber: encryptedBankRouting,
          bankAccountNumber: encryptedBankAccount,
          workState: data.work_state,
          employerName: data.employer_name,
        },
      });

      return { profile, taxCase };
    });

    this.logger.log(`Profile saved successfully for user ${userId}, id: ${result.profile.id}`);

    // === PROGRESS AUTOMATION: Emit event when profile is completed (not draft) ===
    if (!data.is_draft) {
      try {
        // Get client name for notification
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { firstName: true, lastName: true },
        });
        const clientName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : 'Unknown';

        // Emit profile completed event (taxCase already created in transaction)
        await this.progressAutomation.processEvent({
          type: 'PROFILE_COMPLETED',
          userId,
          taxCaseId: result.taxCase.id,
          metadata: { clientName },
        });
        this.logger.log(`Emitted PROFILE_COMPLETED event for user ${userId}`);
      } catch (error) {
        // Don't fail profile save if automation fails
        this.logger.error('Progress automation error (non-fatal):', error);
      }
    }

    return {
      profile: {
        ...result.profile,
        ssn: result.profile.ssn ? this.encryption.maskSSN(result.profile.ssn) : null,
      },
      message: 'Profile saved successfully',
    };
  }

  /**
   * Update user info (phone, name, dateOfBirth, address) - separate from full profile completion
   */
  async updateUserInfo(userId: string, data: {
    phone?: string;
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string;
    address?: {
      street?: string;
      city?: string;
      state?: string;
      zip?: string;
    };
  }) {
    this.logger.log(`Updating user info for ${userId}`, data);

    // Use transaction to ensure atomicity
    const result = await this.prisma.$transaction(async (tx) => {
      // Update user fields (name, phone)
      const userUpdateData: any = {};
      if (data.phone !== undefined) userUpdateData.phone = data.phone;
      if (data.firstName !== undefined) userUpdateData.firstName = data.firstName;
      if (data.lastName !== undefined) userUpdateData.lastName = data.lastName;

      const user = await tx.user.update({
        where: { id: userId },
        data: userUpdateData,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
        },
      });

      // Update address and dateOfBirth in clientProfile if provided
      let address: { street: string | null; city: string | null; state: string | null; zip: string | null } | null = null;
      let dateOfBirth: Date | null = null;

      if (data.address || data.dateOfBirth) {
        const profileUpdateData: any = {};

        // Handle address - treat empty strings as clearing the field
        if (data.address) {
          // For street: encrypt if non-empty, set to null if empty string, skip if undefined
          if (data.address.street !== undefined) {
            profileUpdateData.addressStreet = data.address.street
              ? this.encryption.encrypt(data.address.street)
              : null;
          }
          if (data.address.city !== undefined) {
            profileUpdateData.addressCity = data.address.city || null;
          }
          if (data.address.state !== undefined) {
            profileUpdateData.addressState = data.address.state || null;
          }
          if (data.address.zip !== undefined) {
            profileUpdateData.addressZip = data.address.zip || null;
          }
        }

        // Handle dateOfBirth
        if (data.dateOfBirth) {
          profileUpdateData.dateOfBirth = new Date(data.dateOfBirth);
        }

        // Only upsert if we have data to update
        if (Object.keys(profileUpdateData).length > 0) {
          const profile = await tx.clientProfile.upsert({
            where: { userId },
            update: profileUpdateData,
            create: {
              userId,
              ...profileUpdateData,
            },
            select: {
              addressStreet: true,
              addressCity: true,
              addressState: true,
              addressZip: true,
              dateOfBirth: true,
            },
          });

          address = {
            street: profile.addressStreet ? this.encryption.decrypt(profile.addressStreet) : null,
            city: profile.addressCity,
            state: profile.addressState,
            zip: profile.addressZip,
          };

          dateOfBirth = profile.dateOfBirth;
        }
      }

      return { user, address, dateOfBirth };
    });

    this.logger.log(`User info updated for ${userId}`);

    return {
      user: {
        id: result.user.id,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        phone: result.user.phone,
      },
      address: result.address,
      dateOfBirth: result.dateOfBirth,
      message: 'User info updated successfully',
    };
  }

  async getDraft(userId: string) {
    // Optimized: Use select instead of include for better query performance
    const profile = await this.prisma.clientProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        userId: true,
        ssn: true,
        dateOfBirth: true,
        addressStreet: true,
        addressCity: true,
        addressState: true,
        addressZip: true,
        turbotaxEmail: true,
        turbotaxPassword: true,
        profileComplete: true,
        isDraft: true,
        createdAt: true,
        updatedAt: true,
        taxCases: {
          select: {
            bankName: true,
            bankRoutingNumber: true,
            bankAccountNumber: true,
            workState: true,
            employerName: true,
          },
          orderBy: { taxYear: 'desc' },
          take: 1,
        },
      },
    });

    if (!profile) return null;

    const taxCase = profile.taxCases[0];

    // Return formatted response with decrypted data for editing
    return {
      id: profile.id,
      userId: profile.userId,
      ssn: profile.ssn ? this.encryption.decrypt(profile.ssn) : null,
      dateOfBirth: profile.dateOfBirth,
      address: {
        street: profile.addressStreet
          ? this.encryption.decrypt(profile.addressStreet)
          : null,
        city: profile.addressCity,
        state: profile.addressState,
        zip: profile.addressZip,
      },
      // Bank data is now stored per TaxCase (year-specific)
      bank: {
        name: taxCase?.bankName || null,
        routingNumber: taxCase?.bankRoutingNumber
          ? this.encryption.decrypt(taxCase.bankRoutingNumber)
          : null,
        accountNumber: taxCase?.bankAccountNumber
          ? this.encryption.decrypt(taxCase.bankAccountNumber)
          : null,
      },
      workState: taxCase?.workState || null,
      employerName: taxCase?.employerName || null,
      turbotaxEmail: profile.turbotaxEmail
        ? this.encryption.decrypt(profile.turbotaxEmail)
        : null,
      turbotaxPassword: profile.turbotaxPassword ? '********' : null,
      profileComplete: profile.profileComplete,
      isDraft: profile.isDraft,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
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
          include: {
            documents: {
              select: {
                type: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const hasMore = clients.length > options.limit;
    const results = hasMore ? clients.slice(0, -1) : clients;

    return {
      clients: results.map((client) => {
        // Get the most recent tax case
        const taxCase = client.taxCases[0];

        // Calculate missing items
        const missingItems: string[] = [];

        // Check for missing SSN
        if (!client.ssn) {
          missingItems.push('SSN');
        }

        // Check for missing date of birth
        if (!client.dateOfBirth) {
          missingItems.push('Fecha Nac.');
        }

        // Check for missing address
        if (!client.addressStreet || !client.addressCity || !client.addressState || !client.addressZip) {
          missingItems.push('Dirección');
        }

        // Check for missing bank info (now stored in TaxCase)
        if (!taxCase?.bankName || !taxCase?.bankRoutingNumber || !taxCase?.bankAccountNumber) {
          missingItems.push('Banco');
        }

        // Check for missing W2 document
        const hasW2 = taxCase?.documents?.some(d => d.type === 'w2') || false;
        if (!hasW2) {
          missingItems.push('W2');
        }

        // Check for missing payment proof
        const hasPaymentProof = taxCase?.documents?.some(d => d.type === 'payment_proof') || false;
        if (!hasPaymentProof) {
          missingItems.push('Comprobante');
        }

        // Determine if ready to present (profile complete + has W2)
        const isReadyToPresent = client.profileComplete && !client.isDraft && hasW2;

        return {
          id: client.id,
          user: {
            id: client.user.id,
            email: client.user.email,
            firstName: client.user.firstName,
            lastName: client.user.lastName,
          },
          internalStatus: taxCase?.internalStatus || null,
          clientStatus: taxCase?.clientStatus || null,
          paymentReceived: taxCase?.paymentReceived || false,
          profileComplete: client.profileComplete,
          isDraft: client.isDraft,
          missingItems,
          isReadyToPresent,
          createdAt: client.createdAt,
        };
      }),
      nextCursor: hasMore ? results[results.length - 1].id : null,
      hasMore: hasMore,
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
        // Bank/employer data is now stored per TaxCase (year-specific)
        bank: client.taxCases[0]
          ? {
              name: client.taxCases[0].bankName,
              routingNumber: client.taxCases[0].bankRoutingNumber
                ? this.encryption.decrypt(client.taxCases[0].bankRoutingNumber)
                : null,
              accountNumber: client.taxCases[0].bankAccountNumber
                ? this.encryption.decrypt(client.taxCases[0].bankAccountNumber)
                : null,
            }
          : { name: null, routingNumber: null, accountNumber: null },
        workState: client.taxCases[0]?.workState || null,
        employerName: client.taxCases[0]?.employerName || null,
        turbotaxEmail: client.turbotaxEmail
          ? this.encryption.decrypt(client.turbotaxEmail)
          : null,
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
        // Separate federal/state fields
        federalEstimatedDate: tc.federalEstimatedDate,
        stateEstimatedDate: tc.stateEstimatedDate,
        federalActualRefund: tc.federalActualRefund,
        stateActualRefund: tc.stateActualRefund,
        federalDepositDate: tc.federalDepositDate,
        stateDepositDate: tc.stateDepositDate,
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
    // Separate ClientProfile data from TaxCase data (bank/employer)
    const profileData = { ...data };
    const taxCaseData: any = {};

    // Remove bank/employer fields from profile data (they go to TaxCase)
    delete profileData.bankName;
    delete profileData.bankRoutingNumber;
    delete profileData.bankAccountNumber;
    delete profileData.workState;
    delete profileData.employerName;

    // Encrypt profile sensitive fields
    if (data.ssn) {
      profileData.ssn = this.encryption.encrypt(data.ssn);
    }
    if (data.addressStreet) {
      profileData.addressStreet = this.encryption.encrypt(data.addressStreet);
    }
    if (data.turbotaxEmail) {
      profileData.turbotaxEmail = this.encryption.encrypt(data.turbotaxEmail);
    }
    if (data.turbotaxPassword) {
      profileData.turbotaxPassword = this.encryption.encrypt(data.turbotaxPassword);
    }

    // Prepare TaxCase bank/employer data
    if (data.bankName !== undefined) taxCaseData.bankName = data.bankName;
    if (data.bankRoutingNumber) {
      taxCaseData.bankRoutingNumber = this.encryption.encrypt(data.bankRoutingNumber);
    }
    if (data.bankAccountNumber) {
      taxCaseData.bankAccountNumber = this.encryption.encrypt(data.bankAccountNumber);
    }
    if (data.workState !== undefined) taxCaseData.workState = data.workState;
    if (data.employerName !== undefined) taxCaseData.employerName = data.employerName;

    // Update in transaction if we have both profile and taxCase updates
    const hasTaxCaseUpdates = Object.keys(taxCaseData).length > 0;

    if (hasTaxCaseUpdates) {
      return this.prisma.$transaction(async (tx) => {
        const profile = await tx.clientProfile.update({
          where: { id },
          data: profileData,
        });

        // Get or create TaxCase for this profile
        let taxCase = await tx.taxCase.findFirst({
          where: { clientProfileId: id },
          orderBy: { taxYear: 'desc' },
        });

        if (!taxCase) {
          taxCase = await tx.taxCase.create({
            data: {
              clientProfileId: id,
              taxYear: new Date().getFullYear(),
              ...taxCaseData,
            },
          });
        } else {
          taxCase = await tx.taxCase.update({
            where: { id: taxCase.id },
            data: taxCaseData,
          });
        }

        return { ...profile, taxCase };
      });
    }

    return this.prisma.clientProfile.update({
      where: { id },
      data: profileData,
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
    const previousFederalStatus = taxCase.federalStatus;
    const previousStateStatus = taxCase.stateStatus;

    // Support both camelCase (from frontend) and snake_case
    const internalStatus = statusData.internalStatus || statusData.internal_status;
    const clientStatus = statusData.clientStatus || statusData.client_status;
    const federalStatus = statusData.federalStatus || statusData.federal_status;
    const stateStatus = statusData.stateStatus || statusData.state_status;

    // Build update data dynamically
    const updateData: any = {
      statusUpdatedAt: new Date(),
    };

    if (internalStatus) updateData.internalStatus = internalStatus;
    if (clientStatus) updateData.clientStatus = clientStatus;
    if (federalStatus) updateData.federalStatus = federalStatus;
    if (stateStatus) updateData.stateStatus = stateStatus;

    // Handle federal-specific fields
    if (statusData.federalEstimatedDate) {
      updateData.federalEstimatedDate = new Date(statusData.federalEstimatedDate);
    }
    if (statusData.federalActualRefund !== undefined) {
      updateData.federalActualRefund = statusData.federalActualRefund;
    }
    if (statusData.federalDepositDate) {
      updateData.federalDepositDate = new Date(statusData.federalDepositDate);
    }

    // Handle state-specific fields
    if (statusData.stateEstimatedDate) {
      updateData.stateEstimatedDate = new Date(statusData.stateEstimatedDate);
    }
    if (statusData.stateActualRefund !== undefined) {
      updateData.stateActualRefund = statusData.stateActualRefund;
    }
    if (statusData.stateDepositDate) {
      updateData.stateDepositDate = new Date(statusData.stateDepositDate);
    }

    // Check if this is the first deposit date being set (referral completion trigger)
    const isFirstDepositDate =
      !taxCase.federalDepositDate &&
      !taxCase.stateDepositDate &&
      (statusData.federalDepositDate || statusData.stateDepositDate);

    await this.prisma.$transaction([
      this.prisma.taxCase.update({
        where: { id: taxCase.id },
        data: updateData,
      }),
      this.prisma.statusHistory.create({
        data: {
          taxCaseId: taxCase.id,
          previousStatus: taxCase.internalStatus,
          newStatus: internalStatus || taxCase.internalStatus,
          changedById,
          comment: statusData.comment,
        },
      }),
    ]);

    // Status labels for client status notifications
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

    // Notify for client status change
    if (clientStatus && clientStatus !== previousClientStatus) {
      const newStatusLabel = statusLabels[clientStatus] || clientStatus;

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
    }

    // Notify for federal status change
    if (federalStatus && federalStatus !== previousFederalStatus) {
      await this.notifyFederalStatusChange(client.user.id, client.user.email, client.user.firstName, federalStatus, statusData.federalActualRefund);
    }

    // Notify for state status change
    if (stateStatus && stateStatus !== previousStateStatus) {
      await this.notifyStateStatusChange(client.user.id, client.user.email, client.user.firstName, stateStatus, statusData.stateActualRefund);
    }

    // Mark referral as successful when first deposit date is set (referral completion trigger)
    if (isFirstDepositDate) {
      try {
        await this.referralsService.markReferralSuccessful(client.user.id, taxCase.id);
        this.logger.log(`Marked referral as successful for user ${client.user.id}`);
      } catch (err) {
        this.logger.error('Failed to mark referral as successful', err);
        // Don't fail status update if referral marking fails
      }
    }

    return { message: 'Status updated successfully' };
  }

  private async notifyFederalStatusChange(userId: string, email: string, firstName: string, status: string, refundAmount?: number) {
    const notifications: Record<string, { title: string; message: string }> = {
      processing: {
        title: 'Declaración Federal en Proceso',
        message: 'El IRS está procesando tu declaración federal.',
      },
      approved: {
        title: '¡Declaración Federal Aprobada!',
        message: 'Tu declaración federal ha sido aprobada por el IRS. Pronto recibirás tu reembolso.',
      },
      rejected: {
        title: 'Declaración Federal Rechazada',
        message: 'Tu declaración federal fue rechazada por el IRS. Contacta a soporte para más información.',
      },
      deposited: {
        title: '¡Reembolso Federal Depositado!',
        message: refundAmount
          ? `Tu reembolso federal de $${refundAmount.toLocaleString()} ha sido depositado en tu cuenta.`
          : 'Tu reembolso federal ha sido depositado en tu cuenta.',
      },
    };

    const notification = notifications[status];
    if (notification) {
      await this.notificationsService.create(
        userId,
        'status_change',
        notification.title,
        notification.message,
      );
    }
  }

  private async notifyStateStatusChange(userId: string, email: string, firstName: string, status: string, refundAmount?: number) {
    const notifications: Record<string, { title: string; message: string }> = {
      processing: {
        title: 'Declaración Estatal en Proceso',
        message: 'El estado está procesando tu declaración estatal.',
      },
      approved: {
        title: '¡Declaración Estatal Aprobada!',
        message: 'Tu declaración estatal ha sido aprobada. Pronto recibirás tu reembolso.',
      },
      rejected: {
        title: 'Declaración Estatal Rechazada',
        message: 'Tu declaración estatal fue rechazada. Contacta a soporte para más información.',
      },
      deposited: {
        title: '¡Reembolso Estatal Depositado!',
        message: refundAmount
          ? `Tu reembolso estatal de $${refundAmount.toLocaleString()} ha sido depositado en tu cuenta.`
          : 'Tu reembolso estatal ha sido depositado en tu cuenta.',
      },
    };

    const notification = notifications[status];
    if (notification) {
      await this.notificationsService.create(
        userId,
        'status_change',
        notification.title,
        notification.message,
      );
    }
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
        user: {
          select: { id: true, referralCode: true },
        },
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

    // Generate referral code when step >= 3 (tax form submitted) if user doesn't have one
    if (step >= 3 && !client.user.referralCode) {
      try {
        const code = await this.referralsService.generateCode(client.user.id);
        this.logger.log(`Generated referral code ${code} for user ${client.user.id}`);

        // Also update referral status if this user was referred
        await this.referralsService.updateReferralOnTaxFormSubmit(client.user.id);
      } catch (err) {
        this.logger.error('Failed to generate referral code', err);
        // Don't fail the step update if referral code generation fails
      }
    }

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
      // Bank data is now stored per TaxCase (year-specific)
      const decryptedRouting = taxCase?.bankRoutingNumber
        ? this.encryption.decrypt(taxCase.bankRoutingNumber)
        : '';
      const decryptedAccount = taxCase?.bankAccountNumber
        ? this.encryption.decrypt(taxCase.bankAccountNumber)
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
