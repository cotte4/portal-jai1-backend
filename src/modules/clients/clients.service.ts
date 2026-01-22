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
import {
  calculateAlarms,
  StatusAlarm,
  deriveCaseStatusFromOldSystem,
  mapOldToNewFederalStatus,
  mapOldToNewStateStatus,
  getCaseStatusLabel,
  getFederalStatusNewLabel,
  getStateStatusNewLabel,
  mapCaseStatusToClientDisplay,
  mapFederalStatusToClientDisplay,
  mapStateStatusToClientDisplay,
} from '../../common/utils/status-mapping.util';
import {
  isValidTransition,
  getValidNextStatuses,
  createInvalidTransitionError,
  StatusTransitionType,
} from '../../common/utils/status-transitions.util';
import * as ExcelJS from 'exceljs';
import { PassThrough } from 'stream';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);
  private readonly PROFILE_PICTURES_BUCKET = 'profile-pictures';
  private readonly BACKGROUND_TASK_TIMEOUT_MS = 30000; // 30 seconds
  private readonly EXPORT_TIMEOUT_MS = 300000; // 5 minutes
  private isExportInProgress = false;

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

  /**
   * Run a task in the background with proper error handling and timeout.
   * This prevents fire-and-forget async operations from causing unhandled promise rejections.
   *
   * @param taskName - Name of the task for logging purposes
   * @param task - Async function to execute
   * @param timeoutMs - Timeout in milliseconds (defaults to 30 seconds)
   */
  private runBackgroundTask(
    taskName: string,
    task: () => Promise<void>,
    timeoutMs: number = this.BACKGROUND_TASK_TIMEOUT_MS,
  ): void {
    setImmediate(() => {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`${taskName} timeout after ${timeoutMs}ms`)),
          timeoutMs,
        );
      });

      Promise.race([task(), timeoutPromise])
        .then(() => {
          this.logger.debug(
            `Background task '${taskName}' completed successfully`,
          );
        })
        .catch((error: Error) => {
          this.logger.error(`Background task '${taskName}' failed:`, {
            message: error.message || 'Unknown error',
            name: error.name || 'Error',
            // Limited stack trace to avoid log bloat
            stack: error.stack?.split('\n').slice(0, 3).join('\n'),
          });
        });
    });
  }

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
        preferredLanguage: true,
        clientProfile: {
          select: {
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
            taxCases: {
              select: {
                id: true,
                taxYear: true,
                bankName: true,
                bankRoutingNumber: true,
                bankAccountNumber: true,
                paymentMethod: true,
                workState: true,
                employerName: true,
                // Old status fields (for backward compatibility)
                federalStatus: true,
                stateStatus: true,
                adminStep: true,
                estimatedRefund: true,
                // Phase indicator fields
                taxesFiled: true,
                taxesFiledAt: true,
                preFilingStatus: true,
                // Problem tracking
                hasProblem: true,
                problemType: true,
                problemDescription: true,
                // Federal/state tracking (source of truth)
                federalActualRefund: true,
                stateActualRefund: true,
                federalDepositDate: true,
                stateDepositDate: true,
                federalEstimatedDate: true,
                stateEstimatedDate: true,
                federalStatusChangedAt: true,
                stateStatusChangedAt: true,
                statusUpdatedAt: true,
                // NEW STATUS SYSTEM (v2)
                caseStatus: true,
                caseStatusChangedAt: true,
                federalStatusNew: true,
                federalStatusNewChangedAt: true,
                stateStatusNew: true,
                stateStatusNewChangedAt: true,
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
            // Payment method for refund (bank_deposit or check)
            paymentMethod: user.clientProfile.taxCases[0]?.paymentMethod || 'bank_deposit',
            workState: user.clientProfile.taxCases[0]?.workState || null,
            employerName: user.clientProfile.taxCases[0]?.employerName || null,
            // TurboTax credentials (masked for security)
            turbotaxEmail: user.clientProfile.turbotaxEmail
              ? this.encryption.maskEmail(this.encryption.decrypt(user.clientProfile.turbotaxEmail))
              : null,
            turbotaxPassword: user.clientProfile.turbotaxPassword
              ? '••••••••'
              : null,
            profileComplete: user.clientProfile.profileComplete,
            isDraft: user.clientProfile.isDraft,
          }
        : null,
      taxCase: user.clientProfile?.taxCases[0]
        ? {
            ...user.clientProfile.taxCases[0],
            // Convert Decimal to number to prevent string concatenation in frontend
            federalActualRefund: user.clientProfile.taxCases[0].federalActualRefund
              ? Number(user.clientProfile.taxCases[0].federalActualRefund)
              : null,
            stateActualRefund: user.clientProfile.taxCases[0].stateActualRefund
              ? Number(user.clientProfile.taxCases[0].stateActualRefund)
              : null,
            estimatedRefund: user.clientProfile.taxCases[0].estimatedRefund
              ? Number(user.clientProfile.taxCases[0].estimatedRefund)
              : null,
          }
        : null,
    };
  }

  async completeProfile(userId: string, data: CompleteProfileDto) {
    this.logger.log(
      `Saving profile for user ${userId}, isDraft: ${data.is_draft}, paymentMethod: ${data.payment_method || 'bank_deposit'}`,
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

    // Validate bank fields if payment method is bank_deposit (default) and not a draft
    const paymentMethod = data.payment_method || 'bank_deposit';
    if (!data.is_draft && paymentMethod === 'bank_deposit') {
      if (!data.bank?.name || !data.bank?.routing_number || !data.bank?.account_number) {
        throw new BadRequestException(
          'Bank information is required for direct deposit. Please provide bank name, routing number, and account number.',
        );
      }
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
      // Determine payment method (default to bank_deposit)
      const paymentMethod = data.payment_method || 'bank_deposit';
      await tx.taxCase.update({
        where: { id: taxCase.id },
        data: {
          bankName: data.bank?.name,
          bankRoutingNumber: encryptedBankRouting,
          bankAccountNumber: encryptedBankAccount,
          workState: data.work_state,
          employerName: data.employer_name,
          paymentMethod: paymentMethod,
        },
      });

      return { profile, taxCase };
    });

    this.logger.log(
      `Profile saved successfully for user ${userId}, id: ${result.profile.id}`,
    );

    // === PROGRESS AUTOMATION: Emit event when profile is completed (not draft) ===
    // Run in background with timeout and proper error handling to avoid blocking the response
    if (!data.is_draft) {
      this.runBackgroundTask(
        'progress-automation-profile-completed',
        async () => {
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
        },
      );
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
      preferredLanguage?: string;
      address?: {
        street?: string;
        city?: string;
        state?: string;
        zip?: string;
      };
    },
  ) {
    this.logger.log(`Updating user info for ${userId}: fields=[${Object.keys(data).join(', ')}]`);

    // Use transaction to ensure atomicity
    const result = await this.prisma.$transaction(async (tx) => {
      // Update user fields (name, phone, language)
      const userUpdateData: any = {};
      if (data.phone !== undefined) userUpdateData.phone = data.phone;
      if (data.firstName !== undefined)
        userUpdateData.firstName = data.firstName;
      if (data.lastName !== undefined) userUpdateData.lastName = data.lastName;
      if (data.preferredLanguage !== undefined) {
        // Validate language
        const validLanguages = ['es', 'en', 'pt'];
        if (validLanguages.includes(data.preferredLanguage)) {
          userUpdateData.preferredLanguage = data.preferredLanguage;
        }
      }

      const user = await tx.user.update({
        where: { id: userId },
        data: userUpdateData,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          preferredLanguage: true,
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

  /**
   * Update sensitive profile fields (SSN, bank info, TurboTax credentials)
   * Only available for users who have already completed their profile
   */
  async updateSensitiveProfile(
    userId: string,
    data: {
      ssn?: string;
      bankName?: string;
      bankRoutingNumber?: string;
      bankAccountNumber?: string;
      turbotaxEmail?: string;
      turbotaxPassword?: string;
    },
  ) {
    this.logger.log(`Updating sensitive profile for user ${userId}`);

    // Verify user has a completed profile
    const profile = await this.prisma.clientProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        profileComplete: true,
        isDraft: true,
        ssn: true,
        turbotaxEmail: true,
        turbotaxPassword: true,
        taxCases: {
          select: {
            id: true,
            bankName: true,
            bankRoutingNumber: true,
            bankAccountNumber: true,
          },
          orderBy: { taxYear: 'desc' },
          take: 1,
        },
      },
    });

    if (!profile) {
      throw new BadRequestException('Profile not found. Please complete your profile first.');
    }

    if (!profile.profileComplete || profile.isDraft) {
      throw new BadRequestException('Profile must be completed before editing sensitive fields.');
    }

    const taxCase = profile.taxCases[0];
    if (!taxCase) {
      throw new BadRequestException('No tax case found. Please complete your profile first.');
    }

    // Prepare update data with encryption
    const profileUpdateData: any = {};
    const taxCaseUpdateData: any = {};
    const auditDetails: Record<string, any> = {};

    // Handle SSN change
    if (data.ssn !== undefined) {
      // Normalize SSN (remove dashes if present)
      const normalizedSSN = data.ssn.replace(/-/g, '');
      profileUpdateData.ssn = this.encryption.encrypt(normalizedSSN);
      auditDetails.ssnChanged = true;
    }

    // Handle TurboTax credentials
    if (data.turbotaxEmail !== undefined) {
      profileUpdateData.turbotaxEmail = data.turbotaxEmail
        ? this.encryption.encrypt(data.turbotaxEmail)
        : null;
      auditDetails.turbotaxEmailChanged = true;
    }

    if (data.turbotaxPassword !== undefined) {
      profileUpdateData.turbotaxPassword = data.turbotaxPassword
        ? this.encryption.encrypt(data.turbotaxPassword)
        : null;
      auditDetails.turbotaxPasswordChanged = true;
    }

    // Handle bank info changes (stored in TaxCase)
    if (data.bankName !== undefined) {
      taxCaseUpdateData.bankName = data.bankName || null;
      auditDetails.bankNameChanged = true;
    }

    if (data.bankRoutingNumber !== undefined) {
      taxCaseUpdateData.bankRoutingNumber = data.bankRoutingNumber
        ? this.encryption.encrypt(data.bankRoutingNumber)
        : null;
      auditDetails.bankRoutingChanged = true;
    }

    if (data.bankAccountNumber !== undefined) {
      taxCaseUpdateData.bankAccountNumber = data.bankAccountNumber
        ? this.encryption.encrypt(data.bankAccountNumber)
        : null;
      auditDetails.bankAccountChanged = true;
    }

    // Perform updates in transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Update ClientProfile if there are profile changes
      let updatedProfile = profile;
      if (Object.keys(profileUpdateData).length > 0) {
        updatedProfile = await tx.clientProfile.update({
          where: { id: profile.id },
          data: profileUpdateData,
          select: {
            id: true,
            ssn: true,
            turbotaxEmail: true,
            turbotaxPassword: true,
            profileComplete: true,
            isDraft: true,
            taxCases: {
              select: {
                id: true,
                bankName: true,
                bankRoutingNumber: true,
                bankAccountNumber: true,
              },
              orderBy: { taxYear: 'desc' },
              take: 1,
            },
          },
        });
      }

      // Update TaxCase if there are bank info changes
      let updatedTaxCase = taxCase;
      if (Object.keys(taxCaseUpdateData).length > 0) {
        updatedTaxCase = await tx.taxCase.update({
          where: { id: taxCase.id },
          data: taxCaseUpdateData,
          select: {
            id: true,
            bankName: true,
            bankRoutingNumber: true,
            bankAccountNumber: true,
          },
        });
      }

      return { profile: updatedProfile, taxCase: updatedTaxCase };
    });

    // Log audit events (run in background to not block response)
    this.runBackgroundTask('audit-sensitive-profile-update', async () => {
      // Log SSN change
      if (auditDetails.ssnChanged) {
        await this.auditLogsService.log({
          action: AuditAction.SSN_CHANGE,
          userId,
          targetUserId: userId,
          details: { timestamp: new Date().toISOString() },
        });
      }

      // Log bank info changes
      if (auditDetails.bankNameChanged || auditDetails.bankRoutingChanged || auditDetails.bankAccountChanged) {
        await this.auditLogsService.log({
          action: AuditAction.BANK_INFO_CHANGE,
          userId,
          targetUserId: userId,
          details: {
            fieldsChanged: Object.keys(auditDetails).filter(k => k.startsWith('bank')),
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Log TurboTax credential changes
      if (auditDetails.turbotaxEmailChanged || auditDetails.turbotaxPasswordChanged) {
        await this.auditLogsService.log({
          action: AuditAction.PROFILE_UPDATE,
          userId,
          targetUserId: userId,
          details: {
            fieldsChanged: ['turbotaxCredentials'],
            timestamp: new Date().toISOString(),
          },
        });
      }
    });

    this.logger.log(`Sensitive profile updated for user ${userId}`);

    // Return masked response
    const updatedTaxCase = result.taxCase;
    return {
      profile: {
        ssn: result.profile.ssn
          ? this.encryption.maskSSN(result.profile.ssn)
          : null,
        turbotaxEmail: result.profile.turbotaxEmail ? '****@****.***' : null,
        turbotaxPassword: result.profile.turbotaxPassword ? '********' : null,
      },
      bank: {
        name: updatedTaxCase.bankName,
        routingNumber: updatedTaxCase.bankRoutingNumber
          ? this.encryption.maskRoutingNumber(updatedTaxCase.bankRoutingNumber)
          : null,
        accountNumber: updatedTaxCase.bankAccountNumber
          ? this.encryption.maskBankAccount(updatedTaxCase.bankAccountNumber)
          : null,
      },
      message: 'Sensitive profile updated successfully',
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
            paymentMethod: true,
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
      // Payment method for refund (bank_deposit or check)
      paymentMethod: taxCase?.paymentMethod || 'bank_deposit',
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

  /**
   * Mark onboarding as complete for a user.
   * This creates a minimal ClientProfile with profileComplete=true if one doesn't exist,
   * or updates the existing profile to mark onboarding as complete.
   *
   * This is called when user skips the full profile form during onboarding
   * but should still be able to access the dashboard without seeing onboarding again.
   */
  async markOnboardingComplete(userId: string) {
    this.logger.log(`Marking onboarding complete for user ${userId}`);

    // Upsert profile - create if doesn't exist, or update if exists
    const profile = await this.prisma.clientProfile.upsert({
      where: { userId },
      update: {
        // Only update profileComplete if it's not already complete
        // This preserves all existing data
        profileComplete: true,
      },
      create: {
        userId,
        profileComplete: true,
        isDraft: true, // Still a draft until they fill full profile
      },
      select: {
        id: true,
        profileComplete: true,
        isDraft: true,
      },
    });

    this.logger.log(`Onboarding marked complete for user ${userId}, profile id: ${profile.id}`);

    return {
      success: true,
      profileComplete: profile.profileComplete,
      message: 'Onboarding marked as complete',
    };
  }

  async findAll(options: {
    status?: string;
    search?: string;
    cursor?: string;
    limit: number;
    // Advanced filters
    hasProblem?: boolean;
    federalStatus?: string;
    stateStatus?: string;
    caseStatus?: string;
    dateFrom?: string;
    dateTo?: string;
    // Sorting
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const where: any = {};

    // Advanced filter: Date range on profile createdAt
    if (options.dateFrom || options.dateTo) {
      where.createdAt = {};
      if (options.dateFrom) {
        const fromDate = new Date(options.dateFrom);
        // Validate date is valid
        if (!isNaN(fromDate.getTime())) {
          where.createdAt.gte = fromDate;
        }
      }
      if (options.dateTo) {
        const toDate = new Date(options.dateTo);
        // Validate date is valid
        if (!isNaN(toDate.getTime())) {
          // Add 1 day to include the entire "to" day
          toDate.setDate(toDate.getDate() + 1);
          where.createdAt.lt = toDate;
        }
      }
      // Remove empty createdAt if no valid dates
      if (Object.keys(where.createdAt).length === 0) {
        delete where.createdAt;
      }
    }

    // Advanced filter: Has Problem
    if (options.hasProblem !== undefined) {
      where.taxCases = {
        ...where.taxCases,
        some: {
          ...where.taxCases?.some,
          hasProblem: options.hasProblem,
        },
      };
    }

    // Advanced filter: Federal Status (v2)
    if (options.federalStatus) {
      where.taxCases = {
        ...where.taxCases,
        some: {
          ...where.taxCases?.some,
          federalStatusNew: options.federalStatus,
        },
      };
    }

    // Advanced filter: State Status (v2)
    if (options.stateStatus) {
      where.taxCases = {
        ...where.taxCases,
        some: {
          ...where.taxCases?.some,
          stateStatusNew: options.stateStatus,
        },
      };
    }

    // Advanced filter: Case Status
    if (options.caseStatus) {
      where.taxCases = {
        ...where.taxCases,
        some: {
          ...where.taxCases?.some,
          caseStatus: options.caseStatus,
        },
      };
    }

    // Handle different filter types using new status fields
    // IMPORTANT: Merge with existing taxCases filters from advanced filters
    if (options.status && options.status !== 'all') {
      const existingTaxCaseFilters = where.taxCases?.some || {};

      if (options.status === 'group_pending') {
        // Pending: not filed yet, pre-filing statuses
        // Note: This filter uses OR, so we need to handle it specially
        // If advanced filters are active, combine with AND
        if (Object.keys(existingTaxCaseFilters).length > 0) {
          where.AND = [
            { taxCases: { some: existingTaxCaseFilters } },
            {
              OR: [
                { taxCases: { none: {} } },
                { taxCases: { some: { taxesFiled: false } } },
              ],
            },
          ];
          delete where.taxCases;
        } else {
          where.OR = [
            { taxCases: { none: {} } }, // No tax cases
            { taxCases: { some: { taxesFiled: false } } },
          ];
        }
      } else if (options.status === 'group_in_review') {
        // In Review: filed but not yet deposited
        where.taxCases = {
          some: {
            ...existingTaxCaseFilters,
            taxesFiled: true,
            federalStatus: { in: ['processing', 'pending', 'filed'] },
          },
        };
      } else if (options.status === 'group_completed') {
        // Completed: deposited or approved
        where.taxCases = {
          some: {
            ...existingTaxCaseFilters,
            OR: [
              { federalStatus: 'deposited' },
              { stateStatus: 'deposited' },
            ],
          },
        };
      } else if (options.status === 'group_needs_attention') {
        // Needs Attention: rejected or has problem
        where.taxCases = {
          some: {
            ...existingTaxCaseFilters,
            OR: [
              { federalStatus: 'rejected' },
              { stateStatus: 'rejected' },
              { hasProblem: true },
            ],
          },
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

    // Build dynamic orderBy clause
    const sortOrder = options.sortOrder || 'desc';
    let orderBy: any = { createdAt: sortOrder }; // Default sort

    if (options.sortBy) {
      // Map frontend column names to Prisma fields
      const sortFieldMap: Record<string, any> = {
        createdAt: { createdAt: sortOrder },
        name: { user: { firstName: sortOrder } },
        email: { user: { email: sortOrder } },
        // For taxCase fields, we sort by the profile field and rely on post-processing
        // since Prisma doesn't support sorting by nested relation fields directly
      };
      orderBy = sortFieldMap[options.sortBy] || { createdAt: sortOrder };
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
          select: {
            id: true,
            taxesFiled: true,
            taxesFiledAt: true,
            preFilingStatus: true,
            federalStatus: true,
            stateStatus: true,
            federalLastComment: true,
            stateLastComment: true,
            federalActualRefund: true,
            stateActualRefund: true,
            federalLastReviewedAt: true,
            stateLastReviewedAt: true,
            paymentReceived: true,
            bankName: true,
            bankRoutingNumber: true,
            bankAccountNumber: true,
            hasProblem: true,
            // NEW STATUS SYSTEM (v2)
            caseStatus: true,
            caseStatusChangedAt: true,
            federalStatusNew: true,
            federalStatusNewChangedAt: true,
            stateStatusNew: true,
            stateStatusNewChangedAt: true,
            documents: {
              select: {
                type: true,
              },
            },
          },
        },
      },
      orderBy,
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

        // Compute last review date (most recent of federal/state)
        const federalReview = taxCase?.federalLastReviewedAt;
        const stateReview = taxCase?.stateLastReviewedAt;
        let lastReviewDate: Date | null = null;
        if (federalReview && stateReview) {
          lastReviewDate = federalReview > stateReview ? federalReview : stateReview;
        } else {
          lastReviewDate = federalReview || stateReview || null;
        }

        // Calculate alarms for this client (new status system)
        const alarms: StatusAlarm[] = taxCase
          ? calculateAlarms(
              taxCase.federalStatusNew,
              taxCase.federalStatusNewChangedAt,
              taxCase.stateStatusNew,
              taxCase.stateStatusNewChangedAt,
            )
          : [];

        return {
          id: client.id,
          user: {
            id: client.user.id,
            email: client.user.email,
            firstName: client.user.firstName,
            lastName: client.user.lastName,
          },
          // SSN (decrypted for admin view)
          ssn: client.ssn ? this.encryption.decrypt(client.ssn) : null,
          // Phase-based status fields (OLD SYSTEM - kept for backward compatibility)
          taxesFiled: taxCase?.taxesFiled || false,
          taxesFiledAt: taxCase?.taxesFiledAt || null,
          preFilingStatus: taxCase?.preFilingStatus || null,
          federalStatus: taxCase?.federalStatus || null,
          stateStatus: taxCase?.stateStatus || null,
          // NEW STATUS SYSTEM (v2)
          caseStatus: taxCase?.caseStatus || null,
          caseStatusChangedAt: taxCase?.caseStatusChangedAt || null,
          federalStatusNew: taxCase?.federalStatusNew || null,
          federalStatusNewChangedAt: taxCase?.federalStatusNewChangedAt || null,
          stateStatusNew: taxCase?.stateStatusNew || null,
          stateStatusNewChangedAt: taxCase?.stateStatusNewChangedAt || null,
          // Alarms
          alarms,
          hasAlarm: alarms.length > 0,
          hasCriticalAlarm: alarms.some(a => a.level === 'critical'),
          // Status tracking
          federalLastComment: taxCase?.federalLastComment || null,
          stateLastComment: taxCase?.stateLastComment || null,
          federalActualRefund: taxCase?.federalActualRefund ? Number(taxCase.federalActualRefund) : null,
          stateActualRefund: taxCase?.stateActualRefund ? Number(taxCase.stateActualRefund) : null,
          lastReviewDate,
          // Account credentials (decrypted for admin use)
          credentials: {
            turbotaxEmail: client.turbotaxEmail ? this.encryption.decrypt(client.turbotaxEmail) : null,
            turbotaxPassword: client.turbotaxPassword ? this.encryption.decrypt(client.turbotaxPassword) : null,
            irsUsername: client.irsUsername ? this.encryption.decrypt(client.irsUsername) : null,
            irsPassword: client.irsPassword ? this.encryption.decrypt(client.irsPassword) : null,
            stateUsername: client.stateUsername ? this.encryption.decrypt(client.stateUsername) : null,
            statePassword: client.statePassword ? this.encryption.decrypt(client.statePassword) : null,
          },
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
      taxCases: client.taxCases.map((tc) => {
        // Calculate alarms for this tax case
        const alarms = calculateAlarms(
          (tc as any).federalStatusNew,
          (tc as any).federalStatusNewChangedAt,
          (tc as any).stateStatusNew,
          (tc as any).stateStatusNewChangedAt,
        );

        return {
          id: tc.id,
          clientProfileId: tc.clientProfileId,
          taxYear: tc.taxYear,
          // Phase-based status fields (OLD SYSTEM - kept for backward compatibility)
          taxesFiled: (tc as any).taxesFiled || false,
          taxesFiledAt: (tc as any).taxesFiledAt,
          preFilingStatus: (tc as any).preFilingStatus,
          // Federal/State status (OLD)
          federalStatus: tc.federalStatus,
          stateStatus: tc.stateStatus,
          // NEW STATUS SYSTEM (v2)
          caseStatus: (tc as any).caseStatus,
          caseStatusChangedAt: (tc as any).caseStatusChangedAt,
          federalStatusNew: (tc as any).federalStatusNew,
          federalStatusNewChangedAt: (tc as any).federalStatusNewChangedAt,
          stateStatusNew: (tc as any).stateStatusNew,
          stateStatusNewChangedAt: (tc as any).stateStatusNewChangedAt,
          // Alarms
          alarms,
          hasAlarm: alarms.length > 0,
          hasCriticalAlarm: alarms.some(a => a.level === 'critical'),
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
          // Status tracking fields
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
        };
      }),
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

    // Capture previous status BEFORE the update (for audit trail)
    const previousFederalStatus = taxCase.federalStatus;
    const previousStateStatus = taxCase.stateStatus;
    const previousPreFilingStatus = taxCase.preFilingStatus;
    const previousTaxesFiled = (taxCase as any).taxesFiled;

    // Build previous status string for StatusHistory
    const previousStatusParts: string[] = [];
    if (previousTaxesFiled !== undefined) {
      previousStatusParts.push(`taxesFiled: ${previousTaxesFiled}`);
    }
    if (previousPreFilingStatus) {
      previousStatusParts.push(`preFiling: ${previousPreFilingStatus}`);
    }
    if (previousFederalStatus) {
      previousStatusParts.push(`federal: ${previousFederalStatus}`);
    }
    if (previousStateStatus) {
      previousStatusParts.push(`state: ${previousStateStatus}`);
    }
    const previousStatusString = previousStatusParts.join(', ') || null;

    // Get status values from DTO
    const federalStatus = statusData.federalStatus;
    const stateStatus = statusData.stateStatus;

    // Build update data dynamically
    const updateData: any = {
      statusUpdatedAt: new Date(),
    };

    const now = new Date();

    // Handle preFilingStatus
    if (statusData.preFilingStatus) {
      updateData.preFilingStatus = statusData.preFilingStatus;
    }

    // Handle taxesFiled flag (mark as filed)
    if (statusData.taxesFiled !== undefined) {
      updateData.taxesFiled = statusData.taxesFiled;
      if (statusData.taxesFiled && statusData.taxesFiledAt) {
        updateData.taxesFiledAt = new Date(statusData.taxesFiledAt);
      } else if (statusData.taxesFiled && !(taxCase as any).taxesFiledAt) {
        updateData.taxesFiledAt = now;
      }
      // When marking as filed, ensure preFilingStatus is documentation_complete
      if (statusData.taxesFiled) {
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

    // ============= STATUS TRANSITION VALIDATION =============
    // Capture previous new status values for validation
    const previousCaseStatus = (taxCase as any).caseStatus;
    const previousFederalStatusNew = (taxCase as any).federalStatusNew;
    const previousStateStatusNew = (taxCase as any).stateStatusNew;

    // Track if this is a forced override
    const isForceOverride = statusData.forceTransition === true && statusData.overrideReason;

    // Validate caseStatus transition
    if (statusData.caseStatus && statusData.caseStatus !== previousCaseStatus) {
      if (!isValidTransition('case', previousCaseStatus, statusData.caseStatus)) {
        if (!isForceOverride) {
          const error = createInvalidTransitionError('case', previousCaseStatus, statusData.caseStatus);
          throw new BadRequestException(error);
        }
      }
    }

    // Validate federalStatusNew transition
    if (statusData.federalStatusNew && statusData.federalStatusNew !== previousFederalStatusNew) {
      if (!isValidTransition('federal', previousFederalStatusNew, statusData.federalStatusNew)) {
        if (!isForceOverride) {
          const error = createInvalidTransitionError('federal', previousFederalStatusNew, statusData.federalStatusNew);
          throw new BadRequestException(error);
        }
      }
    }

    // Validate stateStatusNew transition
    if (statusData.stateStatusNew && statusData.stateStatusNew !== previousStateStatusNew) {
      if (!isValidTransition('state', previousStateStatusNew, statusData.stateStatusNew)) {
        if (!isForceOverride) {
          const error = createInvalidTransitionError('state', previousStateStatusNew, statusData.stateStatusNew);
          throw new BadRequestException(error);
        }
      }
    }

    // ============= NEW STATUS SYSTEM (v2) - DUAL WRITE =============
    // Update new caseStatus field
    if (statusData.caseStatus) {
      updateData.caseStatus = statusData.caseStatus;
      updateData.caseStatusChangedAt = now;
    } else {
      // Derive caseStatus from old system fields if not explicitly provided
      // This ensures new fields are always populated during transition
      const newCaseStatus = deriveCaseStatusFromOldSystem(
        statusData.taxesFiled !== undefined ? statusData.taxesFiled : (taxCase as any).taxesFiled,
        statusData.preFilingStatus || (taxCase as any).preFilingStatus,
        taxCase.hasProblem,
      );
      if (newCaseStatus && newCaseStatus !== (taxCase as any).caseStatus) {
        updateData.caseStatus = newCaseStatus;
        updateData.caseStatusChangedAt = now;
      }
    }

    // Update new federalStatusNew field
    if (statusData.federalStatusNew) {
      const prevFederalStatusNew = (taxCase as any).federalStatusNew;
      updateData.federalStatusNew = statusData.federalStatusNew;
      if (statusData.federalStatusNew !== prevFederalStatusNew) {
        updateData.federalStatusNewChangedAt = now;
      }
    } else if (federalStatus) {
      // Dual-write: map old federalStatus to new federalStatusNew
      const mappedFederalStatus = mapOldToNewFederalStatus(federalStatus);
      if (mappedFederalStatus && mappedFederalStatus !== (taxCase as any).federalStatusNew) {
        updateData.federalStatusNew = mappedFederalStatus;
        updateData.federalStatusNewChangedAt = now;
      }
    }

    // Update new stateStatusNew field
    if (statusData.stateStatusNew) {
      const prevStateStatusNew = (taxCase as any).stateStatusNew;
      updateData.stateStatusNew = statusData.stateStatusNew;
      if (statusData.stateStatusNew !== prevStateStatusNew) {
        updateData.stateStatusNewChangedAt = now;
      }
    } else if (stateStatus) {
      // Dual-write: map old stateStatus to new stateStatusNew
      const mappedStateStatus = mapOldToNewStateStatus(stateStatus);
      if (mappedStateStatus && mappedStateStatus !== (taxCase as any).stateStatusNew) {
        updateData.stateStatusNew = mappedStateStatus;
        updateData.stateStatusNewChangedAt = now;
      }
    }

    // Check if this is the first deposit date being set (referral completion trigger)
    const isFirstDepositDate =
      !taxCase.federalDepositDate &&
      !taxCase.stateDepositDate &&
      (statusData.federalDepositDate || statusData.stateDepositDate);

    // Build status change description for history
    const statusChanges: string[] = [];
    if (statusData.preFilingStatus) {
      statusChanges.push(`preFilingStatus: ${statusData.preFilingStatus}`);
    }
    if (federalStatus) {
      statusChanges.push(`federal: ${federalStatus}`);
    }
    if (stateStatus) {
      statusChanges.push(`state: ${stateStatus}`);
    }
    if (statusData.taxesFiled !== undefined) {
      statusChanges.push(`taxesFiled: ${statusData.taxesFiled}`);
    }
    // NEW STATUS SYSTEM (v2) - add to history log
    if (updateData.caseStatus) {
      statusChanges.push(`caseStatus: ${updateData.caseStatus}`);
    }
    if (statusData.federalStatusNew || updateData.federalStatusNew) {
      statusChanges.push(`federalStatusNew: ${statusData.federalStatusNew || updateData.federalStatusNew}`);
    }
    if (statusData.stateStatusNew || updateData.stateStatusNew) {
      statusChanges.push(`stateStatusNew: ${statusData.stateStatusNew || updateData.stateStatusNew}`);
    }

    // Build the history comment - prepend override prefix if forced transition
    let historyComment = statusData.comment || '';
    if (isForceOverride) {
      const overridePrefix = `[ADMIN OVERRIDE] Razon: ${statusData.overrideReason}`;
      historyComment = historyComment
        ? `${overridePrefix} | ${historyComment}`
        : overridePrefix;
    }

    await this.prisma.$transaction([
      this.prisma.taxCase.update({
        where: { id: taxCase.id },
        data: updateData,
      }),
      this.prisma.statusHistory.create({
        data: {
          taxCaseId: taxCase.id,
          previousStatus: previousStatusString,
          newStatus: statusChanges.join(', ') || 'status update',
          changedById,
          comment: historyComment || null,
        },
      }),
    ]);

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

    // Generate referral code when taxesFiled changes to true
    const isNewlyFiled =
      statusData.taxesFiled === true && !(taxCase as any).taxesFiled;
    if (isNewlyFiled && !client.user.referralCode) {
      try {
        const code = await this.referralsService.generateCode(client.user.id);
        this.logger.log(
          `Generated referral code ${code} for user ${client.user.id} (taxes marked as filed)`,
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

  /**
   * Get valid status transitions for a client's tax case
   * Returns the current statuses and their valid next transitions
   */
  async getValidTransitions(clientId: string) {
    const client = await this.prisma.clientProfile.findUnique({
      where: { id: clientId },
      include: {
        taxCases: {
          orderBy: { taxYear: 'desc' },
          take: 1,
          select: {
            id: true,
            caseStatus: true,
            federalStatusNew: true,
            stateStatusNew: true,
          },
        },
      },
    });

    if (!client || !client.taxCases[0]) {
      throw new NotFoundException('Client or tax case not found');
    }

    const taxCase = client.taxCases[0];

    return {
      taxCaseId: taxCase.id,
      caseStatus: {
        current: taxCase.caseStatus,
        validTransitions: getValidNextStatuses('case', taxCase.caseStatus),
      },
      federalStatusNew: {
        current: taxCase.federalStatusNew,
        validTransitions: getValidNextStatuses('federal', taxCase.federalStatusNew),
      },
      stateStatusNew: {
        current: taxCase.stateStatusNew,
        validTransitions: getValidNextStatuses('state', taxCase.stateStatusNew),
      },
    };
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
      throw new BadRequestException('Step must be between 1 and 5');
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
            { OR: [{ taxCases: { none: {} } }, { taxCases: { some: { taxesFiled: false } } }] },
          ];
          delete where.taxCases;
        } else {
          where.OR = [{ taxCases: { none: {} } }, { taxCases: { some: { taxesFiled: false } } }];
        }
      } else if (options.status === 'group_in_review') {
        where.taxCases = {
          some: { ...existingTaxCaseFilters, taxesFiled: true, federalStatus: { in: ['processing', 'pending', 'filed'] } },
        };
      } else if (options.status === 'group_completed') {
        where.taxCases = {
          some: { ...existingTaxCaseFilters, OR: [{ federalStatus: 'deposited' }, { stateStatus: 'deposited' }] },
        };
      } else if (options.status === 'group_needs_attention') {
        where.taxCases = {
          some: { ...existingTaxCaseFilters, OR: [{ federalStatus: 'rejected' }, { stateStatus: 'rejected' }, { hasProblem: true }] },
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
    // This is an async IIFE that runs the batch processing
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

            // Mask sensitive data for export (security fix: never export plaintext)
            const maskedSSN = client.ssn
              ? this.encryption.maskSSN(client.ssn) || ''
              : '';
            const decryptedStreet = client.addressStreet
              ? this.encryption.decrypt(client.addressStreet)
              : '';
            // Bank data is now stored per TaxCase (year-specific) - mask for security
            const maskedRouting = taxCase?.bankRoutingNumber
              ? this.encryption.maskRoutingNumber(taxCase.bankRoutingNumber) || ''
              : '';
            const maskedAccount = taxCase?.bankAccountNumber
              ? this.encryption.maskBankAccount(taxCase.bankAccountNumber) || ''
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
              ssn: maskedSSN,
              dob: client.dateOfBirth
                ? client.dateOfBirth.toISOString().split('T')[0]
                : '',
              address: fullAddress,
              workState: taxCase?.workState || '',
              employer: taxCase?.employerName || '',
              bank: taxCase?.bankName || '',
              routing: maskedRouting,
              account: maskedAccount,
              taxesFiled: (taxCase as any)?.taxesFiled ? 'Sí' : 'No',
              federalStatus: taxCase?.federalStatus || '',
              stateStatus: taxCase?.stateStatus || '',
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

      // Mask sensitive data for export (security fix: never export plaintext)
      const maskedSSN = client.ssn
        ? this.encryption.maskSSN(client.ssn) || ''
        : '';
      const decryptedStreet = client.addressStreet
        ? this.encryption.decrypt(client.addressStreet)
        : '';
      // Bank data is now stored per TaxCase (year-specific) - mask for security
      const maskedRouting = taxCase?.bankRoutingNumber
        ? this.encryption.maskRoutingNumber(taxCase.bankRoutingNumber) || ''
        : '';
      const maskedAccount = taxCase?.bankAccountNumber
        ? this.encryption.maskBankAccount(taxCase.bankAccountNumber) || ''
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
        ssn: maskedSSN,
        dob: client.dateOfBirth
          ? client.dateOfBirth.toISOString().split('T')[0]
          : '',
        address: fullAddress,
        workState: taxCase?.workState || '',
        employer: taxCase?.employerName || '',
        bank: taxCase?.bankName || '',
        routing: maskedRouting,
        account: maskedAccount,
        taxesFiled: (taxCase as any)?.taxesFiled ? 'Sí' : 'No',
        federalStatus: taxCase?.federalStatus || '',
        stateStatus: taxCase?.stateStatus || '',
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
   * Supports cursor-based pagination for large datasets
   */
  async getAllClientAccounts(options: { cursor?: string; limit: number }) {
    const clients = await this.prisma.clientProfile.findMany({
      take: options.limit + 1, // Fetch one extra to determine hasMore
      cursor: options.cursor ? { id: options.cursor } : undefined,
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const hasMore = clients.length > options.limit;
    const results = hasMore ? clients.slice(0, -1) : clients;

    return {
      accounts: results.map((client) => ({
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
      })),
      nextCursor: hasMore ? results[results.length - 1]?.id : null,
      hasMore,
    };
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
   * Get delays data for admin delays view
   * Shows timing metrics: documentation complete, filing, deposit dates, and calculated delays
   */
  async getDelaysData() {
    const clients = await this.prisma.clientProfile.findMany({
      include: {
        user: { select: { firstName: true, lastName: true } },
        taxCases: {
          orderBy: { taxYear: 'desc' },
          take: 1,
          select: {
            id: true,
            taxesFiled: true,
            taxesFiledAt: true,
            preFilingStatus: true,
            federalStatus: true,
            stateStatus: true,
            federalDepositDate: true,
            stateDepositDate: true,
            problemType: true,
            hasProblem: true,
            statusHistory: {
              select: { newStatus: true, comment: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Helper to calculate days between two dates
    const daysBetween = (start: Date | null, end: Date | null): number | null => {
      if (!start || !end) return null;
      const diffMs = end.getTime() - start.getTime();
      return Math.round(diffMs / (1000 * 60 * 60 * 24));
    };

    const delaysData = clients
      .filter((client) => client.taxCases[0]?.taxesFiled) // Only show clients with filed taxes
      .map((client) => {
        const tc = client.taxCases[0];
        const taxesFiledAt = tc.taxesFiledAt ? new Date(tc.taxesFiledAt) : null;
        const federalDepositDate = tc.federalDepositDate ? new Date(tc.federalDepositDate) : null;
        const stateDepositDate = tc.stateDepositDate ? new Date(tc.stateDepositDate) : null;

        // Check if went through verification (irs_verification problem or status history mention)
        const wentThroughVerification =
          tc.problemType === 'irs_verification' ||
          tc.statusHistory.some(
            (h) =>
              h.newStatus?.toLowerCase().includes('verif') ||
              h.comment?.toLowerCase().includes('verif'),
          );

        // Documentation complete date - we use updatedAt of profile as proxy
        // (Ideally we'd track when preFilingStatus became documentation_complete)
        // For now, we use taxesFiledAt as the documentation was complete before filing
        const documentationCompleteDate = taxesFiledAt; // Approximation

        return {
          id: client.id,
          name: `${client.user.firstName || ''} ${client.user.lastName || ''}`.trim() || 'Sin Nombre',
          documentationCompleteDate,
          taxesFiledAt,
          federalDepositDate,
          stateDepositDate,
          wentThroughVerification,
          federalDelayDays: daysBetween(taxesFiledAt, federalDepositDate),
          stateDelayDays: daysBetween(taxesFiledAt, stateDepositDate),
          federalStatus: tc.federalStatus,
          stateStatus: tc.stateStatus,
        };
      });

    return {
      clients: delaysData,
      clientCount: delaysData.length,
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
          federalStatus: true,
          stateStatus: true,
        },
      }),
    ]);

    let taxesCompletedCount = 0;
    let projectedEarnings = 0;
    let earningsToDate = 0;

    for (const tc of taxCases) {
      const isDeposited = tc.federalDepositDate || tc.stateDepositDate;
      const isCompleted = tc.federalStatus === 'deposited' || tc.stateStatus === 'deposited';
      if (isDeposited || isCompleted) {
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

  /**
   * Get all clients that have active alarms (NEW STATUS SYSTEM v2)
   * Used for alarm dashboard
   */
  async getClientsWithAlarms(): Promise<{
    clients: Array<{
      id: string;
      name: string;
      alarms: StatusAlarm[];
      federalStatusNew: string | null;
      stateStatusNew: string | null;
      federalStatusNewChangedAt: Date | null;
      stateStatusNewChangedAt: Date | null;
    }>;
    totalWithAlarms: number;
    totalCritical: number;
    totalWarning: number;
  }> {
    // Get all tax cases with the new status fields
    const taxCases = await this.prisma.taxCase.findMany({
      where: {
        OR: [
          { federalStatusNew: { not: null } },
          { stateStatusNew: { not: null } },
        ],
      },
      select: {
        id: true,
        federalStatusNew: true,
        federalStatusNewChangedAt: true,
        stateStatusNew: true,
        stateStatusNewChangedAt: true,
        clientProfile: {
          select: {
            id: true,
            user: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });

    // Calculate alarms for each client
    const clientsWithAlarms: Array<{
      id: string;
      name: string;
      alarms: StatusAlarm[];
      federalStatusNew: string | null;
      stateStatusNew: string | null;
      federalStatusNewChangedAt: Date | null;
      stateStatusNewChangedAt: Date | null;
    }> = [];

    let totalCritical = 0;
    let totalWarning = 0;

    for (const tc of taxCases) {
      const alarms = calculateAlarms(
        tc.federalStatusNew,
        tc.federalStatusNewChangedAt,
        tc.stateStatusNew,
        tc.stateStatusNewChangedAt,
      );

      if (alarms.length > 0) {
        const name = tc.clientProfile?.user
          ? `${tc.clientProfile.user.firstName || ''} ${tc.clientProfile.user.lastName || ''}`.trim()
          : 'Cliente';

        clientsWithAlarms.push({
          id: tc.clientProfile?.id || tc.id,
          name,
          alarms,
          federalStatusNew: tc.federalStatusNew,
          stateStatusNew: tc.stateStatusNew,
          federalStatusNewChangedAt: tc.federalStatusNewChangedAt,
          stateStatusNewChangedAt: tc.stateStatusNewChangedAt,
        });

        // Count alarm levels
        for (const alarm of alarms) {
          if (alarm.level === 'critical') totalCritical++;
          else totalWarning++;
        }
      }
    }

    // Sort by critical alarms first, then by days since status change
    clientsWithAlarms.sort((a, b) => {
      const aHasCritical = a.alarms.some(al => al.level === 'critical');
      const bHasCritical = b.alarms.some(al => al.level === 'critical');
      if (aHasCritical && !bHasCritical) return -1;
      if (!aHasCritical && bHasCritical) return 1;

      // Sort by max days
      const aMaxDays = Math.max(...a.alarms.map(al => al.daysSinceStatusChange));
      const bMaxDays = Math.max(...b.alarms.map(al => al.daysSinceStatusChange));
      return bMaxDays - aMaxDays;
    });

    return {
      clients: clientsWithAlarms,
      totalWithAlarms: clientsWithAlarms.length,
      totalCritical,
      totalWarning,
    };
  }
}
