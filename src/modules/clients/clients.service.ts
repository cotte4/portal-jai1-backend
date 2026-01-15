import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { SupabaseService } from '../../config/supabase.service';
import { EncryptionService, EmailService } from '../../common/services';
import { NotificationsService } from '../notifications/notifications.service';
import { ProgressAutomationService } from '../progress/progress-automation.service';
import { ReferralsService } from '../referrals/referrals.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompleteProfileDto } from './dto/complete-profile.dto';
import {
  UpdateStatusDto,
  SetProblemDto,
  SendNotificationDto,
} from './dto/admin-update.dto';
import * as ExcelJS from 'exceljs';
import { PassThrough } from 'stream';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);
  private readonly PROFILE_PICTURES_BUCKET = 'profile-pictures';

  constructor(
    private prisma: PrismaService,
    private supabase: SupabaseService,
    private encryption: EncryptionService,
    private emailService: EmailService,
    private notificationsService: NotificationsService,
    private progressAutomation: ProgressAutomationService,
    private referralsService: ReferralsService,
    private auditLogsService: AuditLogsService,
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
        profilePicturePath: true,
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
                // Federal/state tracking (source of truth)
                federalActualRefund: true,
                stateActualRefund: true,
                federalDepositDate: true,
                stateDepositDate: true,
                federalEstimatedDate: true,
                stateEstimatedDate: true,
                statusUpdatedAt: true,
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

    // Generate signed URL for profile picture if exists
    let profilePictureUrl: string | null = null;
    if (user.profilePicturePath) {
      try {
        profilePictureUrl = await this.supabase.getSignedUrl(
          this.PROFILE_PICTURES_BUCKET,
          user.profilePicturePath,
          3600, // 1 hour expiry
        );
      } catch (err) {
        this.logger.error('Failed to get profile picture signed URL', err);
      }
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        profilePictureUrl,
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
                  routingNumber: user.clientProfile.taxCases[0]
                    .bankRoutingNumber
                    ? this.encryption.maskRoutingNumber(
                        user.clientProfile.taxCases[0].bankRoutingNumber,
                      )
                    : null,
                  accountNumber: user.clientProfile.taxCases[0]
                    .bankAccountNumber
                    ? this.encryption.maskBankAccount(
                        user.clientProfile.taxCases[0].bankAccountNumber,
                      )
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
    this.logger.log(
      `Saving profile for user ${userId}, isDraft: ${data.is_draft}`,
    );

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

    this.logger.log(
      `Profile saved successfully for user ${userId}, id: ${result.profile.id}`,
    );

    // === PROGRESS AUTOMATION: Emit event when profile is completed (not draft) ===
    // Run in background (fire-and-forget) to avoid blocking the response
    if (!data.is_draft) {
      // Use setImmediate to run after current event loop, don't await
      setImmediate(async () => {
        try {
          // Get client name for notification
          const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { firstName: true, lastName: true },
          });
          const clientName = user
            ? `${user.firstName || ''} ${user.lastName || ''}`.trim()
            : 'Unknown';

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
      });
    }

    return {
      profile: {
        ...result.profile,
        ssn: result.profile.ssn
          ? this.encryption.maskSSN(result.profile.ssn)
          : null,
      },
      message: 'Profile saved successfully',
    };
  }

  /**
   * Update user info (phone, name, dateOfBirth, address) - separate from full profile completion
   */
  async updateUserInfo(
    userId: string,
    data: {
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
    },
  ) {
    this.logger.log(`Updating user info for ${userId}`, data);

    // Use transaction to ensure atomicity
    const result = await this.prisma.$transaction(async (tx) => {
      // Update user fields (name, phone)
      const userUpdateData: any = {};
      if (data.phone !== undefined) userUpdateData.phone = data.phone;
      if (data.firstName !== undefined)
        userUpdateData.firstName = data.firstName;
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
      let address: {
        street: string | null;
        city: string | null;
        state: string | null;
        zip: string | null;
      } | null = null;
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
            street: profile.addressStreet
              ? this.encryption.decrypt(profile.addressStreet)
              : null,
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

    // Handle different filter types
    if (options.status && options.status !== 'all') {
      // Group filters (map to multiple statuses)
      if (options.status === 'group_pending') {
        // Pending: null status, esperando_datos, revision_de_registro
        where.OR = [
          { taxCases: { none: {} } }, // No tax cases = no status
          { taxCases: { some: { internalStatus: null } } },
          { taxCases: { some: { internalStatus: 'esperando_datos' } } },
          { taxCases: { some: { internalStatus: 'revision_de_registro' } } },
        ];
      } else if (options.status === 'group_in_review') {
        // In Review: en_proceso, en_verificacion, resolviendo_verificacion
        where.taxCases = {
          some: {
            internalStatus: {
              in: ['en_proceso', 'en_verificacion', 'resolviendo_verificacion'],
            },
          },
        };
      } else if (options.status === 'group_completed') {
        // Completed: proceso_finalizado, cheque_en_camino, esperando_pago_comision
        where.taxCases = {
          some: {
            internalStatus: {
              in: [
                'proceso_finalizado',
                'cheque_en_camino',
                'esperando_pago_comision',
              ],
            },
          },
        };
      } else if (options.status === 'group_needs_attention') {
        // Needs Attention: falta_documentacion, inconvenientes
        where.taxCases = {
          some: {
            internalStatus: { in: ['falta_documentacion', 'inconvenientes'] },
          },
        };
      } else if (options.status === 'sin_asignar') {
        // No status assigned (null internalStatus)
        where.OR = [
          { taxCases: { none: {} } },
          { taxCases: { some: { internalStatus: null } } },
        ];
      } else if (
        options.status !== 'ready_to_present' &&
        options.status !== 'incomplete'
      ) {
        // Single status filter (direct match for individual statuses)
        where.taxCases = {
          some: { internalStatus: options.status },
        };
      }
      // Note: ready_to_present and incomplete are computed filters handled post-query
    }

    if (options.search) {
      // Combine search with existing where conditions
      const searchCondition = {
        OR: [
          { email: { contains: options.search, mode: 'insensitive' } },
          { firstName: { contains: options.search, mode: 'insensitive' } },
          { lastName: { contains: options.search, mode: 'insensitive' } },
        ],
      };

      // If we already have OR conditions (from group filters), we need to handle differently
      if (where.OR) {
        // Wrap existing OR in AND with search
        where.AND = [{ OR: where.OR }, { user: searchCondition }];
        delete where.OR;
      } else {
        where.user = searchCondition;
      }
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
    let results = hasMore ? clients.slice(0, -1) : clients;

    // Post-query filtering for computed filters (ready_to_present, incomplete)
    // These require checking document presence which can't be done efficiently in Prisma query
    if (
      options.status === 'ready_to_present' ||
      options.status === 'incomplete'
    ) {
      // For these filters, we need to fetch more and filter post-query
      // This is less efficient but necessary for computed fields
      const mappedResults = results.map((client) => {
        const taxCase = client.taxCases[0];
        const hasW2 = taxCase?.documents?.some((d) => d.type === 'w2') || false;
        const isReadyToPresent =
          client.profileComplete && !client.isDraft && hasW2;
        return { client, isReadyToPresent };
      });

      if (options.status === 'ready_to_present') {
        results = mappedResults
          .filter((r) => r.isReadyToPresent)
          .map((r) => r.client);
      } else {
        results = mappedResults
          .filter((r) => !r.isReadyToPresent)
          .map((r) => r.client);
      }
    }

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
        if (
          !client.addressStreet ||
          !client.addressCity ||
          !client.addressState ||
          !client.addressZip
        ) {
          missingItems.push('Dirección');
        }

        // Check for missing bank info (now stored in TaxCase)
        if (
          !taxCase?.bankName ||
          !taxCase?.bankRoutingNumber ||
          !taxCase?.bankAccountNumber
        ) {
          missingItems.push('Banco');
        }

        // Check for missing W2 document
        const hasW2 = taxCase?.documents?.some((d) => d.type === 'w2') || false;
        if (!hasW2) {
          missingItems.push('W2');
        }

        // Check for missing payment proof
        const hasPaymentProof =
          taxCase?.documents?.some((d) => d.type === 'payment_proof') || false;
        if (!hasPaymentProof) {
          missingItems.push('Comprobante');
        }

        // Determine if ready to present (profile complete + has W2)
        const isReadyToPresent =
          client.profileComplete && !client.isDraft && hasW2;

        return {
          id: client.id,
          user: {
            id: client.user.id,
            email: client.user.email,
            firstName: client.user.firstName,
            lastName: client.user.lastName,
          },
          // DEPRECATED: Keep for backward compatibility
          internalStatus: taxCase?.internalStatus || null,
          clientStatus: taxCase?.clientStatus || null,
          // NEW: Phase-based status fields
          taxesFiled: (taxCase as any)?.taxesFiled || false,
          preFilingStatus: (taxCase as any)?.preFilingStatus || null,
          federalStatus: taxCase?.federalStatus || null,
          stateStatus: taxCase?.stateStatus || null,
          // NEW: Status tracking
          federalLastComment: (taxCase as any)?.federalLastComment || null,
          stateLastComment: (taxCase as any)?.stateLastComment || null,
          federalActualRefund: taxCase?.federalActualRefund ? Number(taxCase.federalActualRefund) : null,
          stateActualRefund: taxCase?.stateActualRefund ? Number(taxCase.stateActualRefund) : null,
          paymentReceived: taxCase?.paymentReceived || false,
          profileComplete: client.profileComplete,
          isDraft: client.isDraft,
          missingItems,
          isReadyToPresent,
          createdAt: client.createdAt,
        };
      }),
      nextCursor: hasMore ? results[results.length - 1]?.id : null,
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
        // IRS credentials (decrypted for admin view)
        irsUsername: client.irsUsername
          ? this.encryption.decrypt(client.irsUsername)
          : null,
        irsPassword: client.irsPassword
          ? this.encryption.decrypt(client.irsPassword)
          : null,
        // State credentials (decrypted for admin view)
        stateUsername: client.stateUsername
          ? this.encryption.decrypt(client.stateUsername)
          : null,
        statePassword: client.statePassword
          ? this.encryption.decrypt(client.statePassword)
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
        // DEPRECATED: Keep for backward compatibility
        internalStatus: tc.internalStatus,
        clientStatus: tc.clientStatus,
        // NEW: Phase-based status fields
        taxesFiled: (tc as any).taxesFiled || false,
        taxesFiledAt: (tc as any).taxesFiledAt,
        preFilingStatus: (tc as any).preFilingStatus,
        // Federal/State status
        federalStatus: tc.federalStatus,
        stateStatus: tc.stateStatus,
        estimatedRefund: tc.estimatedRefund,
        // Computed from federal + state (for backward compatibility in API response)
        actualRefund:
          tc.federalActualRefund || tc.stateActualRefund
            ? Number(tc.federalActualRefund || 0) +
              Number(tc.stateActualRefund || 0)
            : null,
        // Computed: first available deposit date
        refundDepositDate: tc.federalDepositDate || tc.stateDepositDate || null,
        // Separate federal/state fields (SOURCE OF TRUTH)
        federalEstimatedDate: tc.federalEstimatedDate,
        stateEstimatedDate: tc.stateEstimatedDate,
        federalActualRefund: tc.federalActualRefund,
        stateActualRefund: tc.stateActualRefund,
        federalDepositDate: tc.federalDepositDate,
        stateDepositDate: tc.stateDepositDate,
        // NEW: Status tracking fields
        federalLastComment: (tc as any).federalLastComment,
        federalStatusChangedAt: (tc as any).federalStatusChangedAt,
        federalLastReviewedAt: (tc as any).federalLastReviewedAt,
        stateLastComment: (tc as any).stateLastComment,
        stateStatusChangedAt: (tc as any).stateStatusChangedAt,
        stateLastReviewedAt: (tc as any).stateLastReviewedAt,
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
      profileData.turbotaxPassword = this.encryption.encrypt(
        data.turbotaxPassword,
      );
    }
    // IRS credentials (encrypted)
    if (data.irsUsername) {
      profileData.irsUsername = this.encryption.encrypt(data.irsUsername);
    }
    if (data.irsPassword) {
      profileData.irsPassword = this.encryption.encrypt(data.irsPassword);
    }
    // State credentials (encrypted)
    if (data.stateUsername) {
      profileData.stateUsername = this.encryption.encrypt(data.stateUsername);
    }
    if (data.statePassword) {
      profileData.statePassword = this.encryption.encrypt(data.statePassword);
    }

    // Prepare TaxCase bank/employer data
    if (data.bankName !== undefined) taxCaseData.bankName = data.bankName;
    if (data.bankRoutingNumber) {
      taxCaseData.bankRoutingNumber = this.encryption.encrypt(
        data.bankRoutingNumber,
      );
    }
    if (data.bankAccountNumber) {
      taxCaseData.bankAccountNumber = this.encryption.encrypt(
        data.bankAccountNumber,
      );
    }
    if (data.workState !== undefined) taxCaseData.workState = data.workState;
    if (data.employerName !== undefined)
      taxCaseData.employerName = data.employerName;

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

  async updateStatus(
    id: string,
    statusData: UpdateStatusDto,
    changedById: string,
  ) {
    // Auto-sync mapping: InternalStatus → ClientStatus (DEPRECATED - for backward compatibility)
    const internalToClientStatusMap: Record<string, string> = {
      revision_de_registro: 'cuenta_en_revision',
      esperando_datos: 'esperando_datos',
      falta_documentacion: 'cuenta_en_revision',
      en_proceso: 'taxes_en_proceso',
      en_verificacion: 'en_verificacion',
      resolviendo_verificacion: 'en_verificacion',
      inconvenientes: 'cuenta_en_revision',
      cheque_en_camino: 'taxes_en_camino',
      esperando_pago_comision: 'pago_realizado',
      proceso_finalizado: 'taxes_finalizados',
    };

    // NEW: Dual-write mapping: PreFilingStatus → InternalStatus (for backward compatibility)
    const preFilingToInternalMap: Record<string, string> = {
      awaiting_registration: 'revision_de_registro',
      awaiting_documents: 'esperando_datos',
      documentation_complete: 'esperando_datos', // Closest match
    };

    // NEW: Dual-write mapping: InternalStatus → PreFilingStatus + taxesFiled
    const internalToPreFilingMap: Record<string, { preFilingStatus: string; taxesFiled: boolean }> = {
      revision_de_registro: { preFilingStatus: 'awaiting_registration', taxesFiled: false },
      esperando_datos: { preFilingStatus: 'awaiting_documents', taxesFiled: false },
      falta_documentacion: { preFilingStatus: 'awaiting_documents', taxesFiled: false },
      en_proceso: { preFilingStatus: 'documentation_complete', taxesFiled: true },
      en_verificacion: { preFilingStatus: 'documentation_complete', taxesFiled: true },
      resolviendo_verificacion: { preFilingStatus: 'documentation_complete', taxesFiled: true },
      inconvenientes: { preFilingStatus: 'documentation_complete', taxesFiled: true },
      cheque_en_camino: { preFilingStatus: 'documentation_complete', taxesFiled: true },
      esperando_pago_comision: { preFilingStatus: 'documentation_complete', taxesFiled: true },
      proceso_finalizado: { preFilingStatus: 'documentation_complete', taxesFiled: true },
    };

    const client = await this.prisma.clientProfile.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            referralCode: true,
          },
        },
        taxCases: { orderBy: { taxYear: 'desc' }, take: 1 },
      },
    });

    if (!client || !client.taxCases[0]) {
      throw new NotFoundException('Client or tax case not found');
    }

    const taxCase = client.taxCases[0];
    const previousInternalStatus = taxCase.internalStatus;
    const previousClientStatus = taxCase.clientStatus;
    const previousFederalStatus = taxCase.federalStatus;
    const previousStateStatus = taxCase.stateStatus;
    // NEW: Track previous values of new fields for dual-write logic
    const previousTaxesFiled = (taxCase as any).taxesFiled ?? false;
    const previousPreFilingStatus = (taxCase as any).preFilingStatus;

    // Get status values from DTO
    const internalStatus = statusData.internalStatus;
    let clientStatus = statusData.clientStatus;
    const federalStatus = statusData.federalStatus;
    const stateStatus = statusData.stateStatus;

    // Auto-sync: If internalStatus is provided and clientStatus is not, derive it from the mapping
    if (internalStatus && !clientStatus) {
      const mappedClientStatus = internalToClientStatusMap[internalStatus];
      if (mappedClientStatus) {
        clientStatus = mappedClientStatus as any; // Cast to ClientStatus
        this.logger.log(
          `Auto-synced clientStatus to '${clientStatus}' from internalStatus '${internalStatus}'`,
        );
      }
    }

    // Build update data dynamically
    const updateData: any = {
      statusUpdatedAt: new Date(),
    };

    const now = new Date();

    // Handle OLD fields (internalStatus, clientStatus) - DEPRECATED but still supported
    if (internalStatus) {
      updateData.internalStatus = internalStatus;

      // DUAL-WRITE: Also update new fields based on internalStatus
      const mapping = internalToPreFilingMap[internalStatus];
      if (mapping) {
        updateData.preFilingStatus = mapping.preFilingStatus;
        if (mapping.taxesFiled && !taxCase.taxesFiled) {
          updateData.taxesFiled = true;
          updateData.taxesFiledAt = now;
        }
      }
    }
    if (clientStatus) updateData.clientStatus = clientStatus;

    // Handle NEW fields (preFilingStatus, taxesFiled) - Phase B dual-write
    if (statusData.preFilingStatus) {
      updateData.preFilingStatus = statusData.preFilingStatus;

      // DUAL-WRITE: Also update old internalStatus for backward compatibility
      const mappedInternal = preFilingToInternalMap[statusData.preFilingStatus];
      if (mappedInternal && !internalStatus) {
        updateData.internalStatus = mappedInternal;
        const mappedClient = internalToClientStatusMap[mappedInternal];
        if (mappedClient && !clientStatus) {
          updateData.clientStatus = mappedClient;
        }
      }
    }

    // Handle taxesFiled flag (mark as filed)
    if (statusData.taxesFiled !== undefined) {
      updateData.taxesFiled = statusData.taxesFiled;
      if (statusData.taxesFiled && statusData.taxesFiledAt) {
        updateData.taxesFiledAt = new Date(statusData.taxesFiledAt);
      } else if (statusData.taxesFiled && !taxCase.taxesFiledAt) {
        updateData.taxesFiledAt = now;
      }

      // DUAL-WRITE: When marking as filed, update old internalStatus to en_proceso
      if (statusData.taxesFiled && !internalStatus) {
        updateData.internalStatus = 'en_proceso';
        updateData.clientStatus = 'taxes_en_proceso';
        updateData.preFilingStatus = 'documentation_complete';
      }
    }

    // Handle federal/state status
    if (federalStatus) {
      updateData.federalStatus = federalStatus;
      // Track status change date
      if (federalStatus !== previousFederalStatus) {
        updateData.federalStatusChangedAt = now;
      } else {
        updateData.federalLastReviewedAt = now;
      }
    }
    if (stateStatus) {
      updateData.stateStatus = stateStatus;
      // Track status change date
      if (stateStatus !== previousStateStatus) {
        updateData.stateStatusChangedAt = now;
      } else {
        updateData.stateLastReviewedAt = now;
      }
    }

    // Handle federal/state comments
    if (statusData.federalComment) {
      updateData.federalLastComment = statusData.federalComment;
    }
    if (statusData.stateComment) {
      updateData.stateLastComment = statusData.stateComment;
    }

    // Handle federal-specific fields
    if (statusData.federalEstimatedDate) {
      updateData.federalEstimatedDate = new Date(
        statusData.federalEstimatedDate,
      );
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

      // TODO: Re-enable when needed
      // Send email notification (don't await to avoid blocking response)
      // this.emailService.sendStatusChangeEmail(
      //   client.user.email,
      //   client.user.firstName,
      //   previousClientStatus,
      //   clientStatus,
      //   statusData.comment || '',
      // ).catch((err) => {
      //   this.logger.error(`Failed to send status change email to ${client.user.email}`, err);
      // });
    }

    // Notify for federal status change
    if (federalStatus && federalStatus !== previousFederalStatus) {
      await this.notifyFederalStatusChange(
        client.user.id,
        client.user.email,
        client.user.firstName,
        federalStatus,
        statusData.federalActualRefund,
      );
    }

    // Notify for state status change
    if (stateStatus && stateStatus !== previousStateStatus) {
      await this.notifyStateStatusChange(
        client.user.id,
        client.user.email,
        client.user.firstName,
        stateStatus,
        statusData.stateActualRefund,
      );
    }

    // Mark referral as successful when first deposit date is set (referral completion trigger)
    if (isFirstDepositDate) {
      try {
        await this.referralsService.markReferralSuccessful(
          client.user.id,
          taxCase.id,
        );
        this.logger.log(
          `Marked referral as successful for user ${client.user.id}`,
        );
      } catch (err) {
        this.logger.error('Failed to mark referral as successful', err);
        // Don't fail status update if referral marking fails
      }
    }

    // Generate referral code when internalStatus changes to EN_PROCESO (replaces old adminStep >= 3 trigger)
    const isNewEnProceso =
      internalStatus === 'en_proceso' &&
      previousInternalStatus !== 'en_proceso';
    if (isNewEnProceso && !client.user.referralCode) {
      try {
        const code = await this.referralsService.generateCode(client.user.id);
        this.logger.log(
          `Generated referral code ${code} for user ${client.user.id} (status changed to EN_PROCESO)`,
        );

        // Also update referral status if this user was referred
        await this.referralsService.updateReferralOnTaxFormSubmit(
          client.user.id,
        );
      } catch (err) {
        this.logger.error('Failed to generate referral code', err);
        // Don't fail the status update if referral code generation fails
      }
    }

    // Audit log - refund updates (keep forever for financial tracking)
    if (
      statusData.federalActualRefund !== undefined ||
      statusData.stateActualRefund !== undefined
    ) {
      this.auditLogsService.log({
        action: AuditAction.REFUND_UPDATE,
        userId: changedById,
        targetUserId: client.user.id,
        details: {
          taxCaseId: taxCase.id,
          taxYear: taxCase.taxYear,
          federalActualRefund: statusData.federalActualRefund,
          stateActualRefund: statusData.stateActualRefund,
          previousFederalRefund: taxCase.federalActualRefund,
          previousStateRefund: taxCase.stateActualRefund,
        },
      });
    }

    return { message: 'Status updated successfully' };
  }

  private async notifyFederalStatusChange(
    userId: string,
    email: string,
    firstName: string,
    status: string,
    refundAmount?: number,
  ) {
    const notifications: Record<string, { title: string; message: string }> = {
      processing: {
        title: 'Declaración Federal en Proceso',
        message: 'El IRS está procesando tu declaración federal.',
      },
      approved: {
        title: '¡Declaración Federal Aprobada!',
        message:
          'Tu declaración federal ha sido aprobada por el IRS. Pronto recibirás tu reembolso.',
      },
      rejected: {
        title: 'Declaración Federal Rechazada',
        message:
          'Tu declaración federal fue rechazada por el IRS. Contacta a soporte para más información.',
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

  private async notifyStateStatusChange(
    userId: string,
    email: string,
    firstName: string,
    status: string,
    refundAmount?: number,
  ) {
    const notifications: Record<string, { title: string; message: string }> = {
      processing: {
        title: 'Declaración Estatal en Proceso',
        message: 'El estado está procesando tu declaración estatal.',
      },
      approved: {
        title: '¡Declaración Estatal Aprobada!',
        message:
          'Tu declaración estatal ha sido aprobada. Pronto recibirás tu reembolso.',
      },
      rejected: {
        title: 'Declaración Estatal Rechazada',
        message:
          'Tu declaración estatal fue rechazada. Contacta a soporte para más información.',
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
    // Fetch all documents and user profile picture BEFORE cascade delete
    const client = await this.prisma.clientProfile.findUnique({
      where: { id },
      include: {
        user: {
          select: { profilePicturePath: true },
        },
        taxCases: {
          include: {
            documents: {
              select: { storagePath: true },
            },
          },
        },
      },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }

    // Collect all document storage paths
    const storagePaths: string[] = [];
    for (const taxCase of client.taxCases) {
      for (const doc of taxCase.documents) {
        if (doc.storagePath) {
          storagePaths.push(doc.storagePath);
        }
      }
    }

    // Delete document S3 files first (before cascade delete removes the metadata)
    const DOCUMENTS_BUCKET = 'documents';
    for (const storagePath of storagePaths) {
      try {
        await this.supabase.deleteFile(DOCUMENTS_BUCKET, storagePath);
        this.logger.log(`Deleted S3 document file: ${storagePath}`);
      } catch (err) {
        // Log but don't fail the deletion - orphaned files can be cleaned up later
        this.logger.error(`Failed to delete S3 document file ${storagePath}: ${err}`);
      }
    }

    // Delete profile picture from S3 if it exists
    let profilePictureDeleted = false;
    if (client.user?.profilePicturePath) {
      try {
        await this.supabase.deleteFile(
          this.PROFILE_PICTURES_BUCKET,
          client.user.profilePicturePath,
        );
        this.logger.log(`Deleted S3 profile picture: ${client.user.profilePicturePath}`);
        profilePictureDeleted = true;
      } catch (err) {
        // Log but don't fail the deletion - orphaned files can be cleaned up later
        this.logger.error(
          `Failed to delete S3 profile picture ${client.user.profilePicturePath}: ${err}`,
        );
      }
    }

    // Now delete the client (cascade will handle database records)
    await this.prisma.clientProfile.delete({
      where: { id },
    });

    this.logger.log(
      `Client ${id} deleted successfully. Cleaned up ${storagePaths.length} document files${profilePictureDeleted ? ' and 1 profile picture' : ''}.`,
    );
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
        this.logger.log(
          `Generated referral code ${code} for user ${client.user.id}`,
        );

        // Also update referral status if this user was referred
        await this.referralsService.updateReferralOnTaxFormSubmit(
          client.user.id,
        );
      } catch (err) {
        this.logger.error('Failed to generate referral code', err);
        // Don't fail the step update if referral code generation fails
      }
    }

    return { message: 'Admin step updated successfully', step };
  }

  async setProblem(id: string, problemData: SetProblemDto) {
    const client = await this.prisma.clientProfile.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, firstName: true } },
        taxCases: { orderBy: { taxYear: 'desc' }, take: 1 },
      },
    });

    if (!client || !client.taxCases[0]) {
      throw new NotFoundException('Client or tax case not found');
    }

    const taxCase = client.taxCases[0];
    const wasAlreadyProblem = taxCase.hasProblem;

    const updateData: any = {
      hasProblem: problemData.hasProblem,
    };

    if (problemData.hasProblem) {
      updateData.problemStep = taxCase.adminStep || 1;
      updateData.problemType = problemData.problemType || null;
      updateData.problemDescription = problemData.problemDescription || null;
      updateData.problemResolvedAt = null;
    } else {
      // Clear all problem fields on resolution
      updateData.problemResolvedAt = new Date();
      updateData.problemStep = null;
      updateData.problemType = null;
      updateData.problemDescription = null;
    }

    await this.prisma.taxCase.update({
      where: { id: taxCase.id },
      data: updateData,
    });

    // Auto-notify client when problem is marked (not when resolved, and not if already had problem)
    if (problemData.hasProblem && !wasAlreadyProblem) {
      await this.notificationsService.create(
        client.user.id,
        'problem_alert',
        'Necesitamos tu ayuda',
        'Hay un inconveniente con tu trámite. Por favor contacta a soporte para resolverlo.',
      );
      this.logger.log(`Problem notification sent to user ${client.user.id}`);
    }

    // Notify when problem is resolved
    if (!problemData.hasProblem && wasAlreadyProblem) {
      await this.notificationsService.create(
        client.user.id,
        'status_change',
        'Inconveniente resuelto',
        '¡El inconveniente con tu trámite ha sido resuelto! Tu proceso continúa normalmente.',
      );
      this.logger.log(
        `Problem resolved notification sent to user ${client.user.id}`,
      );
    }

    return {
      message: problemData.hasProblem
        ? 'Problem marked on case'
        : 'Problem resolved',
      hasProblem: problemData.hasProblem,
    };
  }

  async sendClientNotification(id: string, notifyData: SendNotificationDto) {
    const client = await this.prisma.clientProfile.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }

    // Rate limiting: max 5 admin notifications per client per hour
    // Count all admin-triggered notification types to prevent bypass via different types
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentNotifications = await this.prisma.notification.count({
      where: {
        userId: client.user.id,
        type: { in: ['system', 'status_change', 'problem_alert'] },
        createdAt: { gte: oneHourAgo },
      },
    });

    const RATE_LIMIT = 5;
    if (recentNotifications >= RATE_LIMIT) {
      throw new BadRequestException(
        `Rate limit exceeded: maximum ${RATE_LIMIT} notifications per client per hour. Please wait before sending another notification.`,
      );
    }

    // Create in-app notification
    await this.notificationsService.create(
      client.user.id,
      'system',
      notifyData.title,
      notifyData.message,
    );

    // Send email if requested
    let emailSent = false;
    if (notifyData.sendEmail) {
      try {
        emailSent = await this.emailService.sendNotificationEmail(
          client.user.email,
          client.user.firstName || 'Cliente',
          notifyData.title,
          notifyData.message,
        );
        if (emailSent) {
          this.logger.log(`Notification email sent to ${client.user.email}`);
        } else {
          this.logger.warn(
            `Email not sent to ${client.user.email} (service not configured or failed)`,
          );
        }
      } catch (err) {
        this.logger.error(
          `Failed to send notification email to ${client.user.email}`,
          err,
        );
        // Don't throw - in-app notification was still created successfully
      }
    }

    return {
      message: 'Notification sent successfully',
      emailSent,
    };
  }

  /**
   * Export clients to Excel using streaming to handle large datasets.
   * Processes clients in batches to avoid memory issues and timeouts.
   * Returns a PassThrough stream that can be piped to the response.
   */
  async exportToExcelStream(): Promise<PassThrough> {
    const BATCH_SIZE = 500;
    const stream = new PassThrough();

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
      { header: 'Estado Interno', key: 'internalStatus', width: 20 },
      { header: 'Estado Cliente', key: 'clientStatus', width: 20 },
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

    // Process clients in batches using cursor-based pagination
    // This is an async IIFE that runs the batch processing
    (async () => {
      try {
        let cursor: string | undefined;
        let processedCount = 0;

        while (true) {
          // Fetch a batch of clients
          const clients = await this.prisma.clientProfile.findMany({
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
              internalStatus: taxCase?.internalStatus || '',
              clientStatus: taxCase?.clientStatus || '',
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

  /**
   * Upload profile picture to Supabase and save path to database
   */
  async uploadProfilePicture(
    userId: string,
    file: Buffer,
    mimeType: string,
  ): Promise<{ profilePictureUrl: string }> {
    // Validate mime type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(mimeType)) {
      throw new BadRequestException(
        'Invalid file type. Allowed: JPEG, PNG, WebP, GIF',
      );
    }

    // Get user to check if they already have a profile picture
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { profilePicturePath: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Store old path for cleanup AFTER successful upload
    const oldPicturePath = user.profilePicturePath;

    // Generate new file path
    const extension = mimeType.split('/')[1];
    const fileName = `${userId}/${uuidv4()}.${extension}`;

    // Upload NEW file to Supabase FIRST (before deleting old one)
    await this.supabase.uploadFile(
      this.PROFILE_PICTURES_BUCKET,
      fileName,
      file,
      mimeType,
    );

    // Update user with new profile picture path
    await this.prisma.user.update({
      where: { id: userId },
      data: { profilePicturePath: fileName },
    });

    // Get signed URL for the new picture
    const profilePictureUrl = await this.supabase.getSignedUrl(
      this.PROFILE_PICTURES_BUCKET,
      fileName,
      3600,
    );

    // NOW delete old profile picture (cleanup - after successful upload)
    if (oldPicturePath) {
      try {
        await this.supabase.deleteFile(
          this.PROFILE_PICTURES_BUCKET,
          oldPicturePath,
        );
        this.logger.log(`Deleted old profile picture: ${oldPicturePath}`);
      } catch (err) {
        this.logger.error(
          'Failed to delete old profile picture (orphaned file)',
          err,
        );
        // Continue - old file is orphaned but new upload succeeded
      }
    }

    this.logger.log(`Profile picture uploaded for user ${userId}: ${fileName}`);

    return { profilePictureUrl };
  }

  /**
   * Delete profile picture from Supabase and remove path from database
   */
  async deleteProfilePicture(userId: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { profilePicturePath: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.profilePicturePath) {
      return { message: 'No profile picture to delete' };
    }

    // Delete from Supabase
    try {
      await this.supabase.deleteFile(
        this.PROFILE_PICTURES_BUCKET,
        user.profilePicturePath,
      );
    } catch (err) {
      this.logger.error('Failed to delete profile picture from storage', err);
      // Continue to remove from database even if storage delete fails
    }

    // Remove path from database
    await this.prisma.user.update({
      where: { id: userId },
      data: { profilePicturePath: null },
    });

    this.logger.log(`Profile picture deleted for user ${userId}`);

    return { message: 'Profile picture deleted successfully' };
  }

  /**
   * Get all client accounts with decrypted credentials for admin view
   * Returns name, email, and all credential fields (turbotax, IRS, state)
   */
  async getAllClientAccounts() {
    const clients = await this.prisma.clientProfile.findMany({
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return clients.map((client) => ({
      id: client.id,
      name: `${client.user.firstName || ''} ${client.user.lastName || ''}`.trim(),
      email: client.user.email,
      turbotaxEmail: client.turbotaxEmail
        ? this.encryption.decrypt(client.turbotaxEmail)
        : null,
      turbotaxPassword: client.turbotaxPassword
        ? this.encryption.decrypt(client.turbotaxPassword)
        : null,
      irsUsername: client.irsUsername
        ? this.encryption.decrypt(client.irsUsername)
        : null,
      irsPassword: client.irsPassword
        ? this.encryption.decrypt(client.irsPassword)
        : null,
      stateUsername: client.stateUsername
        ? this.encryption.decrypt(client.stateUsername)
        : null,
      statePassword: client.statePassword
        ? this.encryption.decrypt(client.statePassword)
        : null,
    }));
  }

  /**
   * Get payments summary for admin bank payments view
   * Returns all clients with their federal/state refunds and calculated commissions
   */
  async getPaymentsSummary() {
    const COMMISSION_RATE = 0.11; // 11%

    const clients = await this.prisma.clientProfile.findMany({
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        taxCases: {
          orderBy: { taxYear: 'desc' },
          take: 1,
          select: {
            federalActualRefund: true,
            stateActualRefund: true,
            federalDepositDate: true,
            stateDepositDate: true,
            paymentReceived: true,
            commissionPaid: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Filter to only include clients with at least one refund amount
    const paymentsData = clients
      .filter((client) => {
        const tc = client.taxCases[0];
        return tc && (tc.federalActualRefund || tc.stateActualRefund);
      })
      .map((client) => {
        const tc = client.taxCases[0];
        const federalTaxes = Number(tc.federalActualRefund || 0);
        const stateTaxes = Number(tc.stateActualRefund || 0);
        const totalTaxes = federalTaxes + stateTaxes;
        const federalCommission = Math.round(federalTaxes * COMMISSION_RATE * 100) / 100;
        const stateCommission = Math.round(stateTaxes * COMMISSION_RATE * 100) / 100;
        const totalCommission = Math.round(totalTaxes * COMMISSION_RATE * 100) / 100;
        const clientReceives = Math.round((totalTaxes - totalCommission) * 100) / 100;

        return {
          id: client.id,
          name: `${client.user.firstName || ''} ${client.user.lastName || ''}`.trim() || 'Sin Nombre',
          email: client.user.email,
          federalTaxes,
          stateTaxes,
          totalTaxes,
          federalCommission,
          stateCommission,
          totalCommission,
          clientReceives,
          federalDepositDate: tc.federalDepositDate,
          stateDepositDate: tc.stateDepositDate,
          paymentReceived: tc.paymentReceived,
          commissionPaid: tc.commissionPaid,
        };
      });

    // Calculate totals
    const totals = paymentsData.reduce(
      (acc, client) => ({
        federalTaxes: acc.federalTaxes + client.federalTaxes,
        stateTaxes: acc.stateTaxes + client.stateTaxes,
        totalTaxes: acc.totalTaxes + client.totalTaxes,
        federalCommission: acc.federalCommission + client.federalCommission,
        stateCommission: acc.stateCommission + client.stateCommission,
        totalCommission: acc.totalCommission + client.totalCommission,
        clientReceives: acc.clientReceives + client.clientReceives,
      }),
      {
        federalTaxes: 0,
        stateTaxes: 0,
        totalTaxes: 0,
        federalCommission: 0,
        stateCommission: 0,
        totalCommission: 0,
        clientReceives: 0,
      },
    );

    // Round totals
    Object.keys(totals).forEach((key) => {
      totals[key as keyof typeof totals] = Math.round(totals[key as keyof typeof totals] * 100) / 100;
    });

    return {
      clients: paymentsData,
      totals,
      clientCount: paymentsData.length,
    };
  }

  /**
   * Get season summary stats for admin dashboard
   * Returns total clients, taxes completed %, projected earnings, and earnings to date
   */
  async getSeasonStats() {
    const COMMISSION_RATE = 0.11; // 11%

    const [totalClients, taxCases] = await Promise.all([
      this.prisma.clientProfile.count(),
      this.prisma.taxCase.findMany({
        select: {
          federalActualRefund: true,
          stateActualRefund: true,
          federalDepositDate: true,
          stateDepositDate: true,
          estimatedRefund: true,
          internalStatus: true,
        },
      }),
    ]);

    let taxesCompletedCount = 0;
    let projectedEarnings = 0;
    let earningsToDate = 0;

    for (const tc of taxCases) {
      const isDeposited = tc.federalDepositDate || tc.stateDepositDate;
      if (isDeposited || tc.internalStatus === 'proceso_finalizado') {
        taxesCompletedCount++;
      }

      const actualRefund =
        Number(tc.federalActualRefund || 0) + Number(tc.stateActualRefund || 0);
      if (isDeposited && actualRefund > 0) {
        earningsToDate += actualRefund * COMMISSION_RATE;
      }

      const estimatedRefund = Number(tc.estimatedRefund || 0) || actualRefund;
      if (estimatedRefund > 0) {
        projectedEarnings += estimatedRefund * COMMISSION_RATE;
      }
    }

    return {
      totalClients,
      taxesCompletedPercent:
        taxCases.length > 0
          ? Math.round((taxesCompletedCount / taxCases.length) * 100)
          : 0,
      projectedEarnings: Math.round(projectedEarnings * 100) / 100,
      earningsToDate: Math.round(earningsToDate * 100) / 100,
    };
  }
}
