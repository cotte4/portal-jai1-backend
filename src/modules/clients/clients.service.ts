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

  /**
   * Get signed URL for profile picture if user has one
   */
  private async getProfilePictureUrl(
    profilePicturePath: string | null,
  ): Promise<string | null> {
    if (!profilePicturePath) return null;
    try {
      return await this.supabase.getSignedUrl(
        this.PROFILE_PICTURES_BUCKET,
        profilePicturePath,
        3600, // 1 hour expiry
      );
    } catch (err) {
      this.logger.error('Failed to get profile picture signed URL', err);
      return null;
    }
  }

  /**
   * Parse E.164 phone number format back to separate country code and number.
   * E.164 format: +[country code][number] (e.g., +5491112345678, +12025551234)
   *
   * @param phone - Phone number in E.164 format
   * @returns Object with countryCode and number, or null if invalid/empty
   */
  private parseE164Phone(
    phone: string | null | undefined,
  ): { countryCode: string; number: string } | null {
    if (!phone) return null;

    // E.164 format: +[1-3 digit country code][subscriber number]
    // Common country codes: +1 (US/Canada), +54 (Argentina), +52 (Mexico), +34 (Spain), etc.
    // Use a regex that captures 1-3 digit country codes followed by the remaining number
    const match = phone.match(/^(\+\d{1,3})(\d+)$/);
    if (match) {
      return { countryCode: match[1], number: match[2] };
    }
    return null;
  }

  /**
   * Updates computed status fields (isReadyToPresent, isIncomplete) for a client profile.
   * Call this whenever documents are added/removed or profile completion status changes.
   *
   * A client is "ready to present" if:
   * 1. profileComplete = true
   * 2. isDraft = false
   * 3. Has at least one W2 document in their most recent tax case
   */
  async updateComputedStatusFields(clientProfileId: string): Promise<void> {
    try {
      // Get the client profile with their most recent tax case and documents
      const clientProfile = await this.prisma.clientProfile.findUnique({
        where: { id: clientProfileId },
        include: {
          taxCases: {
            orderBy: { taxYear: 'desc' },
            take: 1,
            include: {
              documents: {
                where: { type: 'w2' },
                select: { id: true },
              },
            },
          },
        },
      });

      if (!clientProfile) {
        this.logger.warn(`Client profile ${clientProfileId} not found for computed status update`);
        return;
      }

      const taxCase = clientProfile.taxCases[0];
      const hasW2 = taxCase?.documents && taxCase.documents.length > 0;

      // Calculate isReadyToPresent: profileComplete AND NOT isDraft AND has W2
      const isReadyToPresent =
        clientProfile.profileComplete &&
        !clientProfile.isDraft &&
        hasW2;

      // isIncomplete is the inverse of isReadyToPresent
      const isIncomplete = !isReadyToPresent;

      // Only update if values changed to avoid unnecessary writes
      if (
        clientProfile.isReadyToPresent !== isReadyToPresent ||
        clientProfile.isIncomplete !== isIncomplete
      ) {
        await this.prisma.clientProfile.update({
          where: { id: clientProfileId },
          data: {
            isReadyToPresent,
            isIncomplete,
          },
        });

        this.logger.log(
          `Updated computed status fields for client ${clientProfileId}: ` +
          `isReadyToPresent=${isReadyToPresent}, isIncomplete=${isIncomplete}`
        );
      }
    } catch (error) {
      // Log but don't throw - this is a background optimization task
      this.logger.error(
        `Failed to update computed status fields for client ${clientProfileId}:`,
        error
      );
    }
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
                adminStep: true,
                estimatedRefund: true,
                // Phase indicator fields
                taxesFiled: true,
                taxesFiledAt: true,
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

    // === Update computed status fields ===
    // Update isReadyToPresent and isIncomplete based on profile completion and documents
    await this.updateComputedStatusFields(result.profile.id);

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

          // Check if documentation is complete and auto-transition to "preparing" status
          // This handles the case where user uploads docs first, then submits declaration
          await this.progressAutomation.checkDocumentationCompleteAndTransition(
            result.taxCase.id,
            userId,
          );
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

    // Invalidate language cache if language was updated
    if (data.preferredLanguage !== undefined) {
      this.notificationsService.invalidateLanguageCache(userId);
    }

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
        user: {
          select: {
            phone: true,
          },
        },
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

    // Parse E.164 phone back to separate country code and number
    const parsedPhone = this.parseE164Phone(profile.user?.phone);

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
      // Phone number parsed from E.164 format
      phoneCountryCode: parsedPhone?.countryCode || null,
      phoneNumber: parsedPhone?.number || null,
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
   *
   * If user completed the calculator during onboarding, this method also syncs
   * the estimated refund from W2Estimate to TaxCase so it displays in Dashboard and Seguimiento.
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

    // Check if user has a W2 estimate from calculator
    const latestEstimate = await this.prisma.w2Estimate.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        estimatedRefund: true,
        id: true,
      },
    });

    // If estimate exists, sync it to TaxCase
    if (latestEstimate) {
      this.logger.log(`Found W2 estimate ${latestEstimate.id} for user ${userId}, syncing to TaxCase`);

      // Get or create TaxCase for current year
      const currentYear = new Date().getFullYear();
      let taxCase = await this.prisma.taxCase.findFirst({
        where: {
          clientProfileId: profile.id,
          taxYear: currentYear
        },
      });

      if (!taxCase) {
        // Create TaxCase if it doesn't exist
        taxCase = await this.prisma.taxCase.create({
          data: {
            clientProfileId: profile.id,
            taxYear: currentYear,
            estimatedRefund: latestEstimate.estimatedRefund,
          },
        });
        this.logger.log(`Created TaxCase with estimated refund for user ${userId}`);
      } else {
        // Update existing TaxCase with estimated refund
        await this.prisma.taxCase.update({
          where: { id: taxCase.id },
          data: { estimatedRefund: latestEstimate.estimatedRefund },
        });
        this.logger.log(`Updated TaxCase ${taxCase.id} with estimated refund for user ${userId}`);
      }
    }

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
                { taxCases: { some: { caseStatus: { not: 'taxes_filed' } } } },
                { taxCases: { some: { caseStatus: null } } },
              ],
            },
          ];
          delete where.taxCases;
        } else {
          where.OR = [
            { taxCases: { none: {} } }, // No tax cases
            { taxCases: { some: { caseStatus: { not: 'taxes_filed' } } } },
            { taxCases: { some: { caseStatus: null } } },
          ];
        }
      } else if (options.status === 'group_in_review') {
        // In Review: filed but not yet deposited (v2 status)
        where.taxCases = {
          some: {
            ...existingTaxCaseFilters,
            caseStatus: 'taxes_filed',
            federalStatusNew: { in: ['in_process', 'deposit_pending', 'check_in_transit'] },
          },
        };
      } else if (options.status === 'group_completed') {
        // Completed: deposited or approved (v2 status)
        where.taxCases = {
          some: {
            ...existingTaxCaseFilters,
            OR: [
              { federalStatusNew: 'taxes_completed' },
              { stateStatusNew: 'taxes_completed' },
            ],
          },
        };
      } else if (options.status === 'group_needs_attention') {
        // Needs Attention: issues or has problem (v2 status)
        where.taxCases = {
          some: {
            ...existingTaxCaseFilters,
            OR: [
              { federalStatusNew: 'issues' },
              { stateStatusNew: 'issues' },
              { hasProblem: true },
            ],
          },
        };
      } else if (options.status === 'ready_to_present') {
        // Ready to present: use computed database field
        where.isReadyToPresent = true;
      } else if (options.status === 'incomplete') {
        // Incomplete: use computed database field
        where.isIncomplete = true;
      }
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
    const results = hasMore ? clients.slice(0, -1) : clients;

    // BATCH ALARM CALCULATION - Process all clients at once to avoid N+1 problem
    // Step 1: Collect all tax cases that need alarm calculation
    const alarmsMap = new Map<string, StatusAlarm[]>();
    for (const client of results) {
      const taxCase = client.taxCases[0];
      if (taxCase) {
        // Step 2: Calculate alarms for this tax case
        const alarms = calculateAlarms(
          taxCase.federalStatusNew,
          taxCase.federalStatusNewChangedAt,
          taxCase.stateStatusNew,
          taxCase.stateStatusNewChangedAt,
        );
        // Step 3: Store in map with clientId as key
        alarmsMap.set(client.id, alarms);
      } else {
        alarmsMap.set(client.id, []);
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

        // Step 4: Retrieve pre-calculated alarms from map (no N+1!)
        const alarms: StatusAlarm[] = alarmsMap.get(client.id) || [];

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
          // STATUS SYSTEM (v2) - derived fields for backward compatibility
          // taxesFiled is derived from caseStatus === 'taxes_filed'
          // taxesFiledAt is derived from caseStatusChangedAt when taxes are filed
          // STATUS SYSTEM (v2)
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

    // Get profile picture URL if exists
    const profilePictureUrl = await this.getProfilePictureUrl(
      client.user.profilePicturePath,
    );

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
        profilePictureUrl,
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
          // STATUS SYSTEM (v2) - taxesFiled/taxesFiledAt now derived from caseStatus
          // STATUS SYSTEM (v2)
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

    // === DEBUG LOGGING: Log received status update ===
    this.logger.log(`[updateStatus] Received status update for client ${id}:`, {
      federalStatusNew: statusData.federalStatusNew,
      stateStatusNew: statusData.stateStatusNew,
      caseStatus: statusData.caseStatus,
      currentTaxCaseStatuses: {
        federalStatusNew: (taxCase as any).federalStatusNew,
        stateStatusNew: (taxCase as any).stateStatusNew,
        caseStatus: (taxCase as any).caseStatus,
      },
    });

    // Capture previous status BEFORE the update (for audit trail)
    const previousCaseStatus = (taxCase as any).caseStatus;
    const previousFederalStatusNew = (taxCase as any).federalStatusNew;
    const previousStateStatusNew = (taxCase as any).stateStatusNew;

    // Build previous status string for StatusHistory
    const previousStatusParts: string[] = [];
    if (previousCaseStatus) {
      previousStatusParts.push(`caseStatus: ${previousCaseStatus}`);
    }
    if (previousFederalStatusNew) {
      previousStatusParts.push(`federalStatus: ${previousFederalStatusNew}`);
    }
    if (previousStateStatusNew) {
      previousStatusParts.push(`stateStatus: ${previousStateStatusNew}`);
    }
    const previousStatusString = previousStatusParts.join(', ') || null;

    // Build update data dynamically
    const updateData: any = {
      statusUpdatedAt: new Date(),
    };

    const now = new Date();

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

    // ============= STATUS UPDATES =============
    // Update caseStatus field
    if (statusData.caseStatus) {
      updateData.caseStatus = statusData.caseStatus;
      if (statusData.caseStatus !== previousCaseStatus) {
        updateData.caseStatusChangedAt = now;
      }
      // When caseStatus changes to taxes_filed, also set taxesFiled flag (for referral code generation)
      // and auto-calculate estimated refund dates per engineer spec:
      // - Federal: filing date + 6 weeks
      // - State: filing date + 9 weeks
      if (statusData.caseStatus === 'taxes_filed' && !(taxCase as any).taxesFiled) {
        updateData.taxesFiled = true;
        updateData.taxesFiledAt = now;

        // Auto-calculate estimated dates if not already set
        if (!taxCase.federalEstimatedDate) {
          const federalEstDate = new Date(now);
          federalEstDate.setDate(federalEstDate.getDate() + 42); // 6 weeks = 42 days
          updateData.federalEstimatedDate = federalEstDate;
          this.logger.log(`Auto-calculated federalEstimatedDate: ${federalEstDate.toISOString()}`);
        }
        if (!taxCase.stateEstimatedDate) {
          const stateEstDate = new Date(now);
          stateEstDate.setDate(stateEstDate.getDate() + 63); // 9 weeks = 63 days
          updateData.stateEstimatedDate = stateEstDate;
          this.logger.log(`Auto-calculated stateEstimatedDate: ${stateEstDate.toISOString()}`);
        }
      }
    }

    // Update federalStatusNew field
    if (statusData.federalStatusNew) {
      updateData.federalStatusNew = statusData.federalStatusNew;
      if (statusData.federalStatusNew !== previousFederalStatusNew) {
        updateData.federalStatusNewChangedAt = now;
      }
    }

    // Update stateStatusNew field
    if (statusData.stateStatusNew) {
      updateData.stateStatusNew = statusData.stateStatusNew;
      if (statusData.stateStatusNew !== previousStateStatusNew) {
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
    if (updateData.caseStatus) {
      statusChanges.push(`caseStatus: ${updateData.caseStatus}`);
    }
    if (statusData.federalStatusNew) {
      statusChanges.push(`federalStatus: ${statusData.federalStatusNew}`);
    }
    if (statusData.stateStatusNew) {
      statusChanges.push(`stateStatus: ${statusData.stateStatusNew}`);
    }

    // Build the history comment - prepend override prefix if forced transition
    let historyComment = statusData.comment || '';
    if (isForceOverride) {
      const overridePrefix = `[ADMIN OVERRIDE] Razon: ${statusData.overrideReason}`;
      historyComment = historyComment
        ? `${overridePrefix} | ${historyComment}`
        : overridePrefix;
    }

    // AUTO-RESOLVE PROBLEMS when status progresses to positive states
    // Per engineer spec: Problems resolve implicitly when status changes forward
    const positiveProgressStatuses = [
      'deposit_pending',
      'check_in_transit',
      'taxes_sent',
      'taxes_completed',
    ];

    const federalProgressed =
      statusData.federalStatusNew &&
      positiveProgressStatuses.includes(statusData.federalStatusNew);
    const stateProgressed =
      statusData.stateStatusNew &&
      positiveProgressStatuses.includes(statusData.stateStatusNew);

    if (taxCase.hasProblem && (federalProgressed || stateProgressed)) {
      this.logger.log(
        `Auto-resolving problem for taxCase ${taxCase.id} due to positive status progression`,
      );
      updateData.hasProblem = false;
      updateData.problemResolvedAt = now;
      updateData.problemType = null;
      updateData.problemDescription = null;
      updateData.problemStep = null;

      // Notify client that issue was resolved
      try {
        await this.notificationsService.createFromTemplate(
          client.user.id,
          'status_change',
          'notifications.problem_resolved',
          {
            firstName: client.user.firstName || 'Cliente',
          },
        );
      } catch (err) {
        this.logger.error('Failed to send problem resolved notification', err);
      }
    }

    // === DEBUG LOGGING: Log final updateData before database transaction ===
    this.logger.log(`[updateStatus] Final updateData for taxCase ${taxCase.id}:`, {
      federalStatusNew: updateData.federalStatusNew,
      stateStatusNew: updateData.stateStatusNew,
      caseStatus: updateData.caseStatus,
      federalStatusNewChangedAt: updateData.federalStatusNewChangedAt,
      stateStatusNewChangedAt: updateData.stateStatusNewChangedAt,
      caseStatusChangedAt: updateData.caseStatusChangedAt,
      statusUpdatedAt: updateData.statusUpdatedAt,
      historyComment,
      statusChanges: statusChanges.join(', '),
    });

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

    // === DEBUG LOGGING: Log successful update ===
    this.logger.log(`[updateStatus] Successfully updated taxCase ${taxCase.id} in database`);

    // Notify for federal status change
    if (statusData.federalStatusNew && statusData.federalStatusNew !== previousFederalStatusNew) {
      await this.notifyFederalStatusChangeV2(
        client.user.id,
        client.user.email,
        client.user.firstName,
        statusData.federalStatusNew,
        statusData.federalActualRefund,
      );
    }

    // Notify for state status change
    if (statusData.stateStatusNew && statusData.stateStatusNew !== previousStateStatusNew) {
      await this.notifyStateStatusChangeV2(
        client.user.id,
        client.user.email,
        client.user.firstName,
        statusData.stateStatusNew,
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

    // Generate referral code when caseStatus changes to taxes_filed
    const isNewlyFiled =
      statusData.caseStatus === 'taxes_filed' && previousCaseStatus !== 'taxes_filed';
    if (isNewlyFiled && !client.user.referralCode) {
      try {
        const code = await this.referralsService.generateCode(client.user.id);
        this.logger.log(
          `Generated referral code ${code} for user ${client.user.id} (taxes marked as filed)`,
        );
        // Note: Referral status update removed - now triggered by taxes_completed status
      } catch (err) {
        this.logger.error('Failed to generate referral code', err);
        // Don't fail the status update if referral code generation fails
      }
    }

    // Mark referral as successful when federal or state status becomes taxes_completed
    const isFederalCompleted =
      statusData.federalStatusNew === 'taxes_completed' &&
      previousFederalStatusNew !== 'taxes_completed';
    const isStateCompleted =
      statusData.stateStatusNew === 'taxes_completed' &&
      previousStateStatusNew !== 'taxes_completed';

    if (isFederalCompleted || isStateCompleted) {
      try {
        await this.referralsService.markReferralSuccessful(
          client.user.id,
          taxCase.id,
        );
        this.logger.log(
          `Marked referral as successful for user ${client.user.id} (taxes_completed)`,
        );
      } catch (err) {
        this.logger.error('Failed to mark referral as successful on taxes_completed', err);
        // Don't fail status update if referral marking fails
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

  /**
   * Notify client about federal status change using v2 status values
   */
  private async notifyFederalStatusChangeV2(
    userId: string,
    email: string,
    firstName: string,
    status: string,
    refundAmount?: number,
  ) {
    // Map v2 status values to notification templates
    const templateMap: Record<string, string> = {
      in_process: 'notifications.status_federal_processing',
      deposit_pending: 'notifications.status_federal_deposit_pending',
      check_in_transit: 'notifications.status_federal_approved',
      issues: 'notifications.status_federal_rejected',
      taxes_sent: 'notifications.status_federal_approved',
      taxes_completed: 'notifications.status_federal_deposited',
    };

    const templateKey = templateMap[status];
    if (templateKey) {
      const variables: Record<string, string | number> = { firstName };

      if (status === 'taxes_completed' && refundAmount) {
        variables.amount = refundAmount.toLocaleString();
      }

      if (status === 'deposit_pending' || status === 'check_in_transit' || status === 'taxes_sent') {
        variables.estimatedDate = 'próximamente';
      }

      await this.notificationsService.createFromTemplate(
        userId,
        'status_change',
        templateKey,
        variables,
      );
    }
  }

  /**
   * Notify client about state status change using v2 status values
   */
  private async notifyStateStatusChangeV2(
    userId: string,
    email: string,
    firstName: string,
    status: string,
    refundAmount?: number,
  ) {
    // Map v2 status values to notification templates
    const templateMap: Record<string, string> = {
      in_process: 'notifications.status_state_processing',
      deposit_pending: 'notifications.status_state_deposit_pending',
      check_in_transit: 'notifications.status_state_approved',
      issues: 'notifications.status_state_rejected',
      taxes_sent: 'notifications.status_state_approved',
      taxes_completed: 'notifications.status_state_deposited',
    };

    const templateKey = templateMap[status];
    if (templateKey) {
      const variables: Record<string, string | number> = { firstName };

      if (status === 'taxes_completed' && refundAmount) {
        variables.amount = refundAmount.toLocaleString();
      }

      if (status === 'deposit_pending' || status === 'check_in_transit' || status === 'taxes_sent') {
        variables.estimatedDate = 'próximamente';
      }

      await this.notificationsService.createFromTemplate(
        userId,
        'status_change',
        templateKey,
        variables,
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

  /**
   * Client confirms receipt of federal or state refund.
   * Validates that the refund has a deposit date before allowing confirmation.
   */
  async confirmRefundReceived(userId: string, type: 'federal' | 'state') {
    // Get user's client profile and current tax case
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        clientProfile: {
          include: {
            taxCases: { orderBy: { taxYear: 'desc' }, take: 1 },
          },
        },
      },
    });

    if (!user?.clientProfile) {
      throw new NotFoundException('Client profile not found');
    }

    const taxCase = user.clientProfile.taxCases[0];
    if (!taxCase) {
      throw new NotFoundException('No tax case found');
    }

    // Validate based on type
    if (type === 'federal') {
      // Check if already confirmed
      if (taxCase.federalRefundReceived) {
        throw new BadRequestException('Federal refund already confirmed');
      }
      // Check if deposit date is set (meaning refund should have arrived)
      if (!taxCase.federalDepositDate) {
        throw new BadRequestException('Federal refund not yet deposited');
      }
      // Check if there's an actual refund amount
      if (!taxCase.federalActualRefund || Number(taxCase.federalActualRefund) <= 0) {
        throw new BadRequestException('No federal refund amount recorded');
      }
    } else {
      // State
      if (taxCase.stateRefundReceived) {
        throw new BadRequestException('State refund already confirmed');
      }
      if (!taxCase.stateDepositDate) {
        throw new BadRequestException('State refund not yet deposited');
      }
      if (!taxCase.stateActualRefund || Number(taxCase.stateActualRefund) <= 0) {
        throw new BadRequestException('No state refund amount recorded');
      }
    }

    // Update the confirmation fields
    const now = new Date();
    const updateData =
      type === 'federal'
        ? { federalRefundReceived: true, federalRefundReceivedAt: now }
        : { stateRefundReceived: true, stateRefundReceivedAt: now };

    await this.prisma.taxCase.update({
      where: { id: taxCase.id },
      data: updateData,
    });

    // Calculate fee information to return
    const refundAmount =
      type === 'federal'
        ? Number(taxCase.federalActualRefund)
        : Number(taxCase.stateActualRefund);
    const fee = refundAmount * 0.11; // 11% fee

    this.logger.log(
      `Client ${userId} confirmed ${type} refund receipt. Amount: $${refundAmount}, Fee: $${fee.toFixed(2)}`,
    );

    return {
      message: `${type === 'federal' ? 'Federal' : 'State'} refund receipt confirmed`,
      refundAmount,
      fee: Math.round(fee * 100) / 100, // Round to 2 decimal places
      confirmedAt: now.toISOString(),
    };
  }

  /**
   * Admin marks commission as paid for federal or state refund.
   */
  async markCommissionPaid(clientProfileId: string, type: 'federal' | 'state', adminId: string) {
    const client = await this.prisma.clientProfile.findUnique({
      where: { id: clientProfileId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        taxCases: { orderBy: { taxYear: 'desc' }, take: 1 },
      },
    });

    if (!client || !client.taxCases[0]) {
      throw new NotFoundException('Client or tax case not found');
    }

    const taxCase = client.taxCases[0];

    // Validate based on type
    if (type === 'federal') {
      if (!taxCase.federalRefundReceived) {
        throw new BadRequestException('Client has not confirmed federal refund receipt');
      }
      if (taxCase.federalCommissionPaid) {
        throw new BadRequestException('Federal commission already marked as paid');
      }
      if (!taxCase.federalActualRefund || Number(taxCase.federalActualRefund) <= 0) {
        throw new BadRequestException('No federal refund amount recorded');
      }
    } else {
      if (!taxCase.stateRefundReceived) {
        throw new BadRequestException('Client has not confirmed state refund receipt');
      }
      if (taxCase.stateCommissionPaid) {
        throw new BadRequestException('State commission already marked as paid');
      }
      if (!taxCase.stateActualRefund || Number(taxCase.stateActualRefund) <= 0) {
        throw new BadRequestException('No state refund amount recorded');
      }
    }

    // Update the commission paid fields
    const now = new Date();
    const updateData =
      type === 'federal'
        ? { federalCommissionPaid: true, federalCommissionPaidAt: now }
        : { stateCommissionPaid: true, stateCommissionPaidAt: now };

    // Also update legacy commissionPaid if both are now paid
    const willBothBePaid =
      (type === 'federal' && taxCase.stateCommissionPaid) ||
      (type === 'state' && taxCase.federalCommissionPaid) ||
      // Or if only one type has a refund
      (type === 'federal' && (!taxCase.stateActualRefund || Number(taxCase.stateActualRefund) === 0)) ||
      (type === 'state' && (!taxCase.federalActualRefund || Number(taxCase.federalActualRefund) === 0));

    if (willBothBePaid) {
      Object.assign(updateData, { commissionPaid: true });
    }

    await this.prisma.taxCase.update({
      where: { id: taxCase.id },
      data: updateData,
    });

    const refundAmount =
      type === 'federal'
        ? Number(taxCase.federalActualRefund)
        : Number(taxCase.stateActualRefund);
    const commissionAmount = refundAmount * 0.11;

    this.logger.log(
      `Admin ${adminId} marked ${type} commission as paid for client ${clientProfileId}. Amount: $${commissionAmount.toFixed(2)}`,
    );

    return {
      message: `${type === 'federal' ? 'Federal' : 'State'} commission marked as paid`,
      refundAmount,
      commissionAmount: Math.round(commissionAmount * 100) / 100,
      paidAt: now.toISOString(),
      clientName: `${client.user.firstName} ${client.user.lastName}`,
    };
  }

  /**
   * Get clients who have confirmed refund receipt but have unpaid commissions.
   */
  async getUnpaidCommissions(params: { cursor?: string; limit: number }) {
    const { cursor, limit } = params;

    // Find clients where:
    // - federalRefundReceived=true AND federalCommissionPaid=false, OR
    // - stateRefundReceived=true AND stateCommissionPaid=false
    const clients = await this.prisma.clientProfile.findMany({
      where: {
        taxCases: {
          some: {
            OR: [
              {
                federalRefundReceived: true,
                federalCommissionPaid: false,
                federalActualRefund: { gt: 0 },
              },
              {
                stateRefundReceived: true,
                stateCommissionPaid: false,
                stateActualRefund: { gt: 0 },
              },
            ],
          },
        },
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
          },
        },
        taxCases: {
          orderBy: { taxYear: 'desc' },
          take: 1,
          select: {
            id: true,
            taxYear: true,
            federalActualRefund: true,
            stateActualRefund: true,
            federalRefundReceived: true,
            stateRefundReceived: true,
            federalRefundReceivedAt: true,
            stateRefundReceivedAt: true,
            federalCommissionPaid: true,
            stateCommissionPaid: true,
            federalCommissionPaidAt: true,
            stateCommissionPaidAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });

    const hasMore = clients.length > limit;
    const clientsToReturn = hasMore ? clients.slice(0, limit) : clients;
    const nextCursor = hasMore ? clientsToReturn[clientsToReturn.length - 1].id : null;

    // Calculate totals
    let totalUnpaidFederal = 0;
    let totalUnpaidState = 0;

    const formattedClients = clientsToReturn.map((client) => {
      const taxCase = client.taxCases[0];
      const federalRefund = Number(taxCase?.federalActualRefund || 0);
      const stateRefund = Number(taxCase?.stateActualRefund || 0);
      const federalCommission = federalRefund * 0.11;
      const stateCommission = stateRefund * 0.11;

      // Track unpaid amounts
      const federalUnpaid = taxCase?.federalRefundReceived && !taxCase?.federalCommissionPaid;
      const stateUnpaid = taxCase?.stateRefundReceived && !taxCase?.stateCommissionPaid;

      if (federalUnpaid) totalUnpaidFederal += federalCommission;
      if (stateUnpaid) totalUnpaidState += stateCommission;

      return {
        id: client.id,
        userId: client.user.id,
        name: `${client.user.firstName} ${client.user.lastName}`,
        email: client.user.email,
        phone: client.user.phone,
        taxYear: taxCase?.taxYear,
        federal: {
          refundAmount: federalRefund,
          commission: Math.round(federalCommission * 100) / 100,
          refundReceived: taxCase?.federalRefundReceived || false,
          refundReceivedAt: taxCase?.federalRefundReceivedAt?.toISOString() || null,
          commissionPaid: taxCase?.federalCommissionPaid || false,
          commissionPaidAt: taxCase?.federalCommissionPaidAt?.toISOString() || null,
        },
        state: {
          refundAmount: stateRefund,
          commission: Math.round(stateCommission * 100) / 100,
          refundReceived: taxCase?.stateRefundReceived || false,
          refundReceivedAt: taxCase?.stateRefundReceivedAt?.toISOString() || null,
          commissionPaid: taxCase?.stateCommissionPaid || false,
          commissionPaidAt: taxCase?.stateCommissionPaidAt?.toISOString() || null,
        },
        totalUnpaidCommission: Math.round(
          ((federalUnpaid ? federalCommission : 0) + (stateUnpaid ? stateCommission : 0)) * 100
        ) / 100,
      };
    });

    return {
      clients: formattedClients,
      nextCursor,
      hasMore,
      totals: {
        unpaidFederalCommission: Math.round(totalUnpaidFederal * 100) / 100,
        unpaidStateCommission: Math.round(totalUnpaidState * 100) / 100,
        totalUnpaidCommission: Math.round((totalUnpaidFederal + totalUnpaidState) * 100) / 100,
        clientCount: formattedClients.length,
      },
    };
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
        // Note: Referral status update removed - now triggered by taxes_completed status
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
      await this.notificationsService.createFromTemplate(
        client.user.id,
        'problem_alert',
        'notifications.problem_set',
        {
          firstName: client.user.firstName,
          description: problemData.problemDescription || 'Hay un inconveniente con tu trámite',
        },
      );
      this.logger.log(`Problem notification sent to user ${client.user.id}`);
    }

    // Notify when problem is resolved
    if (!problemData.hasProblem && wasAlreadyProblem) {
      await this.notificationsService.createFromTemplate(
        client.user.id,
        'status_change',
        'notifications.problem_resolved',
        {
          firstName: client.user.firstName,
        },
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
    await this.notificationsService.createFromTemplate(
      client.user.id,
      'system',
      'notifications.admin_custom_message',
      {
        firstName: client.user.firstName,
        title: notifyData.title,
        message: notifyData.message,
      },
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
        // V2: Use caseStatus instead of taxesFiled
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
        // V2: Use caseStatus instead of taxesFiled
        where.taxCases = {
          some: { ...existingTaxCaseFilters, caseStatus: 'taxes_filed', federalStatusNew: { in: ['in_process', 'deposit_pending', 'check_in_transit'] } },
        };
      } else if (options.status === 'group_completed') {
        where.taxCases = {
          some: { ...existingTaxCaseFilters, OR: [{ federalStatusNew: 'taxes_completed' }, { stateStatusNew: 'taxes_completed' }] },
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
   * Get all client accounts with MASKED credentials for admin view
   * Returns name, email, and all credential fields (turbotax, IRS, state)
   * Passwords are masked with '••••••••' for security
   * Use getClientCredentials() to reveal individual client credentials with audit logging
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

    const MASKED = '••••••••';

    return {
      accounts: results.map((client) => ({
        id: client.id,
        name: `${client.user.firstName || ''} ${client.user.lastName || ''}`.trim(),
        email: client.user.email,
        // Show usernames/emails in plaintext, but mask all passwords
        turbotaxEmail: client.turbotaxEmail
          ? this.encryption.decrypt(client.turbotaxEmail)
          : null,
        turbotaxPassword: client.turbotaxPassword ? MASKED : null,
        irsUsername: client.irsUsername
          ? this.encryption.decrypt(client.irsUsername)
          : null,
        irsPassword: client.irsPassword ? MASKED : null,
        stateUsername: client.stateUsername
          ? this.encryption.decrypt(client.stateUsername)
          : null,
        statePassword: client.statePassword ? MASKED : null,
      })),
      nextCursor: hasMore ? results[results.length - 1]?.id : null,
      hasMore,
    };
  }

  /**
   * Get unmasked credentials for a SINGLE client (SECURITY: with audit logging)
   * This endpoint reveals sensitive credentials and logs the access for compliance
   *
   * @param clientId - Client profile ID to retrieve credentials for
   * @param adminUserId - Admin user ID performing the access (for audit log)
   * @param ipAddress - IP address of the admin (optional, for audit log)
   * @param userAgent - User agent of the admin (optional, for audit log)
   * @returns Unmasked credentials with access metadata
   */
  async getClientCredentials(
    clientId: string,
    adminUserId: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const client = await this.prisma.clientProfile.findUnique({
      where: { id: clientId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    if (!client) {
      throw new NotFoundException('Cliente no encontrado');
    }

    // Log credentials access for audit trail (CRITICAL for security compliance)
    await this.auditLogsService.log({
      action: AuditAction.CREDENTIALS_ACCESS,
      userId: adminUserId,
      targetUserId: client.userId,
      details: {
        clientId: client.id,
        clientName: `${client.user.firstName || ''} ${client.user.lastName || ''}`.trim(),
        accessedFields: {
          turbotax: !!(client.turbotaxEmail || client.turbotaxPassword),
          irs: !!(client.irsUsername || client.irsPassword),
          state: !!(client.stateUsername || client.statePassword),
        },
      },
      ipAddress,
      userAgent,
    });

    const now = new Date().toISOString();

    return {
      revealedAt: now,
      revealedBy: adminUserId,
      clientId: client.id,
      clientName: `${client.user.firstName || ''} ${client.user.lastName || ''}`.trim(),
      clientEmail: client.user.email,
      credentials: {
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
      },
    };
  }

  /**
   * Get payments summary for admin bank payments view
   * Returns clients with their federal/state refunds and calculated commissions
   * OPTIMIZED: Uses cursor pagination to prevent memory issues with large datasets
   */
  async getPaymentsSummary(options: { cursor?: string; limit: number }) {
    const COMMISSION_RATE = 0.11; // 11%

    // Fetch clients with pagination (limit + 1 to check if there's more)
    const clients = await this.prisma.clientProfile.findMany({
      take: options.limit + 1,
      cursor: options.cursor ? { id: options.cursor } : undefined,
      where: {
        taxCases: {
          some: {
            OR: [
              { federalActualRefund: { not: null } },
              { stateActualRefund: { not: null } },
            ],
          },
        },
      },
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

    const hasMore = clients.length > options.limit;
    const results = hasMore ? clients.slice(0, -1) : clients;

    // Map to payments data
    const paymentsData = results.map((client) => {
      const tc = client.taxCases[0];
      const federalTaxes = Number(tc?.federalActualRefund || 0);
      const stateTaxes = Number(tc?.stateActualRefund || 0);
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
        federalDepositDate: tc?.federalDepositDate,
        stateDepositDate: tc?.stateDepositDate,
        paymentReceived: tc?.paymentReceived,
        commissionPaid: tc?.commissionPaid,
      };
    });

    // Calculate totals using database aggregation (separate query for accuracy)
    const aggregates = await this.prisma.taxCase.aggregate({
      where: {
        clientProfile: {
          taxCases: {
            some: {
              OR: [
                { federalActualRefund: { not: null } },
                { stateActualRefund: { not: null } },
              ],
            },
          },
        },
      },
      _sum: {
        federalActualRefund: true,
        stateActualRefund: true,
      },
    });

    const totalFederal = Number(aggregates._sum.federalActualRefund || 0);
    const totalState = Number(aggregates._sum.stateActualRefund || 0);
    const totalTaxes = totalFederal + totalState;
    const totalFederalCommission = totalFederal * COMMISSION_RATE;
    const totalStateCommission = totalState * COMMISSION_RATE;
    const totalCommission = totalTaxes * COMMISSION_RATE;
    const totalClientReceives = totalTaxes - totalCommission;

    const totals = {
      federalTaxes: Math.round(totalFederal * 100) / 100,
      stateTaxes: Math.round(totalState * 100) / 100,
      totalTaxes: Math.round(totalTaxes * 100) / 100,
      federalCommission: Math.round(totalFederalCommission * 100) / 100,
      stateCommission: Math.round(totalStateCommission * 100) / 100,
      totalCommission: Math.round(totalCommission * 100) / 100,
      clientReceives: Math.round(totalClientReceives * 100) / 100,
    };

    return {
      clients: paymentsData,
      nextCursor: hasMore ? results[results.length - 1]?.id : null,
      hasMore,
      totals,
    };
  }

  /**
   * Get delays data for admin delays view
   * Shows timing metrics: documentation complete, filing, deposit dates, and calculated delays
   * OPTIMIZED: Uses cursor pagination and filters to prevent memory issues with large datasets
   */
  async getDelaysData(options: {
    cursor?: string;
    limit: number;
    dateFrom?: string;
    dateTo?: string;
    status?: string;
  }) {
    // Build where clause with filters (V2: use caseStatus instead of taxesFiled)
    const where: any = {
      taxCases: {
        some: {
          caseStatus: 'taxes_filed', // Only clients with filed taxes (V2)
        },
      },
    };

    // Add date range filter if provided (V2: use caseStatusChangedAt)
    if (options.dateFrom || options.dateTo) {
      where.taxCases.some.caseStatusChangedAt = {};
      if (options.dateFrom) {
        where.taxCases.some.caseStatusChangedAt.gte = new Date(options.dateFrom);
      }
      if (options.dateTo) {
        where.taxCases.some.caseStatusChangedAt.lte = new Date(options.dateTo);
      }
    }

    // Add status filter if provided (v2 status)
    if (options.status) {
      where.taxCases.some.OR = [
        { federalStatusNew: options.status },
        { stateStatusNew: options.status },
      ];
    }

    // Fetch clients with pagination (limit + 1 to check if there's more)
    const clients = await this.prisma.clientProfile.findMany({
      take: options.limit + 1,
      cursor: options.cursor ? { id: options.cursor } : undefined,
      where,
      include: {
        user: { select: { firstName: true, lastName: true } },
        taxCases: {
          where: { caseStatus: 'taxes_filed' },
          orderBy: { taxYear: 'desc' },
          take: 1,
          select: {
            id: true,
            caseStatus: true,
            caseStatusChangedAt: true,
            federalStatusNew: true,
            stateStatusNew: true,
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

    const hasMore = clients.length > options.limit;
    const results = hasMore ? clients.slice(0, -1) : clients;

    // Helper to calculate days between two dates
    const daysBetween = (start: Date | null, end: Date | null): number | null => {
      if (!start || !end) return null;
      const diffMs = end.getTime() - start.getTime();
      return Math.round(diffMs / (1000 * 60 * 60 * 24));
    };

    const delaysData = results
      .filter((client) => client.taxCases[0]) // Ensure tax case exists
      .map((client) => {
        const tc = client.taxCases[0];
        // V2: derive taxesFiledAt from caseStatusChangedAt when caseStatus is taxes_filed
        const taxesFiledAt = tc.caseStatusChangedAt ? new Date(tc.caseStatusChangedAt) : null;
        const federalDepositDate = tc.federalDepositDate ? new Date(tc.federalDepositDate) : null;
        const stateDepositDate = tc.stateDepositDate ? new Date(tc.stateDepositDate) : null;

        // Check if went through verification (via status or status history mention)
        // NOTE: irs_verification problem type removed - verification is now tracked via status
        const wentThroughVerification =
          tc.federalStatusNew === 'in_verification' ||
          tc.federalStatusNew === 'verification_in_progress' ||
          tc.stateStatusNew === 'in_verification' ||
          tc.stateStatusNew === 'verification_in_progress' ||
          tc.statusHistory.some(
            (h) =>
              h.newStatus?.toLowerCase().includes('verif') ||
              h.comment?.toLowerCase().includes('verif'),
          );

        // Documentation complete date - we use taxesFiledAt as the documentation was complete before filing
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
          federalStatus: tc.federalStatusNew,
          stateStatus: tc.stateStatusNew,
        };
      });

    return {
      clients: delaysData,
      nextCursor: hasMore ? results[results.length - 1]?.id : null,
      hasMore,
    };
  }

  /**
   * Get season summary stats for admin dashboard
   * Returns total clients, taxes completed %, projected earnings, and earnings to date
   * OPTIMIZED: Uses database aggregations instead of full-table scans
   */
  async getSeasonStats() {
    const COMMISSION_RATE = 0.11; // 11%

    // Use parallel aggregate queries for maximum performance
    const [
      totalClients,
      totalTaxCases,
      completedCases,
      depositedCases,
      actualRefundAggregates,
      projectedRefundResult,
    ] = await Promise.all([
      // Total clients count
      this.prisma.clientProfile.count(),

      // Total tax cases count
      this.prisma.taxCase.count(),

      // Count completed cases (v2 status = taxes_completed)
      this.prisma.taxCase.count({
        where: {
          OR: [
            { federalStatusNew: 'taxes_completed' },
            { stateStatusNew: 'taxes_completed' },
          ],
        },
      }),

      // Count cases with deposit dates
      this.prisma.taxCase.count({
        where: {
          OR: [
            { federalDepositDate: { not: null } },
            { stateDepositDate: { not: null } },
          ],
        },
      }),

      // Sum of actual refunds for deposited cases (earnings to date)
      this.prisma.taxCase.aggregate({
        where: {
          OR: [
            { federalDepositDate: { not: null } },
            { stateDepositDate: { not: null } },
          ],
        },
        _sum: {
          federalActualRefund: true,
          stateActualRefund: true,
        },
      }),

      // Sum of projected refunds for all cases (per-client: use estimatedRefund if available, else actual)
      // This raw query properly handles the per-row fallback logic
      this.prisma.$queryRaw<[{ projectedBase: number | null }]>`
        SELECT SUM(
          COALESCE(
            "estimatedRefund",
            COALESCE("federalActualRefund", 0) + COALESCE("stateActualRefund", 0)
          )
        ) as "projectedBase"
        FROM "TaxCase"
      `,
    ]);

    // Calculate completed count (max of status-based or date-based)
    const taxesCompletedCount = Math.max(completedCases, depositedCases);

    // Calculate earnings to date from deposited cases
    const actualFederal = Number(actualRefundAggregates._sum.federalActualRefund || 0);
    const actualState = Number(actualRefundAggregates._sum.stateActualRefund || 0);
    const earningsToDate = (actualFederal + actualState) * COMMISSION_RATE;

    // Calculate projected earnings from per-client projected refunds
    const projectedBase = Number(projectedRefundResult[0]?.projectedBase || 0);
    const projectedEarnings = projectedBase * COMMISSION_RATE;

    return {
      totalClients,
      taxesCompletedPercent:
        totalTaxCases > 0
          ? Math.round((taxesCompletedCount / totalTaxCases) * 100)
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

  /**
   * Reset W2 estimate for a client (admin only)
   * This allows the user to recalculate their W2 estimate
   * Deletes: W2Estimate record, associated Document, and storage file
   */
  async resetW2Estimate(clientProfileId: string, adminUserId: string) {
    const clientProfile = await this.prisma.clientProfile.findUnique({
      where: { id: clientProfileId },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        taxCases: {
          orderBy: { taxYear: 'desc' },
          take: 1,
          include: {
            documents: {
              where: { type: 'w2' },
            },
          },
        },
      },
    });

    if (!clientProfile) {
      throw new NotFoundException('Client profile not found');
    }

    const userId = clientProfile.user.id;
    const taxCase = clientProfile.taxCases[0];

    // Find all W2 estimates for this user
    const w2Estimates = await this.prisma.w2Estimate.findMany({
      where: { userId },
    });

    if (w2Estimates.length === 0 && (!taxCase?.documents || taxCase.documents.length === 0)) {
      throw new BadRequestException('No W2 estimate or document found for this client');
    }

    // Track what was deleted for audit log
    const deletedItems: string[] = [];

    // Delete W2 estimates and their storage files
    for (const estimate of w2Estimates) {
      if (estimate.w2StoragePath) {
        try {
          await this.supabase.deleteFile('documents', estimate.w2StoragePath);
          this.logger.log(`Deleted W2 storage file: ${estimate.w2StoragePath}`);
        } catch (err) {
          this.logger.warn(`Failed to delete W2 storage file: ${estimate.w2StoragePath}`, err);
        }
      }
      deletedItems.push(`W2Estimate:${estimate.id}`);
    }

    // Delete all W2 estimates for this user
    await this.prisma.w2Estimate.deleteMany({
      where: { userId },
    });
    this.logger.log(`Deleted ${w2Estimates.length} W2 estimate(s) for user ${userId}`);

    // Delete W2 documents and their storage files
    if (taxCase?.documents) {
      for (const doc of taxCase.documents) {
        if (doc.storagePath) {
          try {
            await this.supabase.deleteFile('documents', doc.storagePath);
            this.logger.log(`Deleted W2 document file: ${doc.storagePath}`);
          } catch (err) {
            this.logger.warn(`Failed to delete W2 document file: ${doc.storagePath}`, err);
          }
        }
        deletedItems.push(`Document:${doc.id}`);
      }

      // Delete W2 documents from database
      await this.prisma.document.deleteMany({
        where: {
          taxCaseId: taxCase.id,
          type: 'w2',
        },
      });
      this.logger.log(`Deleted ${taxCase.documents.length} W2 document(s) for tax case ${taxCase.id}`);
    }

    // Reset estimated refund on tax case
    if (taxCase) {
      await this.prisma.taxCase.update({
        where: { id: taxCase.id },
        data: { estimatedRefund: null },
      });
      this.logger.log(`Reset estimated refund for tax case ${taxCase.id}`);
    }

    // Update computed status fields
    await this.prisma.clientProfile.update({
      where: { id: clientProfileId },
      data: {
        isReadyToPresent: false,
        isIncomplete: true,
      },
    });

    // Audit log
    await this.auditLogsService.log({
      action: AuditAction.DOCUMENT_DELETE,
      userId: adminUserId,
      targetUserId: userId,
      details: {
        action: 'reset_w2_estimate',
        deletedItems,
        clientName: `${clientProfile.user.firstName} ${clientProfile.user.lastName}`,
      },
    });

    this.logger.log(`Admin ${adminUserId} reset W2 estimate for client ${clientProfileId}`);

    return {
      message: 'W2 estimate reset successfully. User can now recalculate.',
      deletedEstimates: w2Estimates.length,
      deletedDocuments: taxCase?.documents?.length || 0,
    };
  }
}
