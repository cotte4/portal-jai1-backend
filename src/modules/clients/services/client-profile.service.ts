import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../../config/prisma.service';
import { SupabaseService } from '../../../config/supabase.service';
import { EncryptionService } from '../../../common/services';
import { NotificationsService } from '../../notifications/notifications.service';
import { ProgressAutomationService } from '../../progress/progress-automation.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CompleteProfileDto } from '../dto/complete-profile.dto';
import { UpdateUserInfoDto } from '../dto/update-user-info.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ClientProfileService {
  private readonly logger = new Logger(ClientProfileService.name);
  private readonly PROFILE_PICTURES_BUCKET = 'profile-pictures';
  private readonly BACKGROUND_TASK_TIMEOUT_MS = 30000; // 30 seconds

  constructor(
    private prisma: PrismaService,
    private supabase: SupabaseService,
    private encryption: EncryptionService,
    private notificationsService: NotificationsService,
    private progressAutomation: ProgressAutomationService,
    private auditLogsService: AuditLogsService,
  ) {}

  /**
   * Run a task in the background with proper error handling and timeout.
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
   * Known country codes supported by the application.
   */
  private readonly KNOWN_COUNTRY_CODES = [
    '+598', '+595', '+593', '+591',
    '+54', '+58', '+57', '+56', '+55', '+52', '+51',
    '+1',
  ];

  /**
   * Parse E.164 phone number format back to separate country code and number.
   */
  private parseE164Phone(
    phone: string | null | undefined,
  ): { countryCode: string; number: string } | null {
    if (!phone || !phone.startsWith('+')) return null;

    for (const code of this.KNOWN_COUNTRY_CODES) {
      if (phone.startsWith(code)) {
        const number = phone.slice(code.length);
        if (number.length > 0) {
          return { countryCode: code, number };
        }
      }
    }

    // Fallback: try regex for unknown codes
    for (let digits = 3; digits >= 1; digits--) {
      const regex = new RegExp(`^(\\+\\d{${digits}})(\\d+)$`);
      const match = phone.match(regex);
      if (match && match[2].length >= 6) {
        return { countryCode: match[1], number: match[2] };
      }
    }

    return null;
  }

  /**
   * Updates computed status fields (isReadyToPresent, isIncomplete) for a client profile.
   */
  async updateComputedStatusFields(clientProfileId: string): Promise<void> {
    try {
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

      const isReadyToPresent =
        clientProfile.profileComplete &&
        !clientProfile.isDraft &&
        hasW2;

      const isIncomplete = !isReadyToPresent;

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
      this.logger.error(
        `Failed to update computed status fields for client ${clientProfileId}:`,
        error
      );
    }
  }

  async getProfile(userId: string) {
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
                taxesFiled: true,
                taxesFiledAt: true,
                hasProblem: true,
                problemType: true,
                problemDescription: true,
                federalActualRefund: true,
                stateActualRefund: true,
                federalDepositDate: true,
                stateDepositDate: true,
                federalEstimatedDate: true,
                stateEstimatedDate: true,
                federalStatusChangedAt: true,
                stateStatusChangedAt: true,
                statusUpdatedAt: true,
                caseStatus: true,
                caseStatusChangedAt: true,
                federalStatusNew: true,
                federalStatusNewChangedAt: true,
                stateStatusNew: true,
                stateStatusNewChangedAt: true,
                federalLastComment: true,
                stateLastComment: true,
                federalCommissionRate: true,
                stateCommissionRate: true,
                federalRefundReceived: true,
                stateRefundReceived: true,
                federalRefundReceivedAt: true,
                stateRefundReceivedAt: true,
                commissionPaid: true,
                federalCommissionPaid: true,
                stateCommissionPaid: true,
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
          3600,
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
            ssn: user.clientProfile.ssn
              ? this.encryption.maskSSN(user.clientProfile.ssn)
              : null,
            dateOfBirth: user.clientProfile.dateOfBirth,
            address: {
              street: user.clientProfile.addressStreet
                ? this.encryption.decrypt(user.clientProfile.addressStreet)
                : null,
              city: user.clientProfile.addressCity,
              state: user.clientProfile.addressState,
              zip: user.clientProfile.addressZip,
            },
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
            paymentMethod: user.clientProfile.taxCases[0]?.paymentMethod || 'bank_deposit',
            workState: user.clientProfile.taxCases[0]?.workState || null,
            employerName: user.clientProfile.taxCases[0]?.employerName || null,
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
            federalActualRefund: user.clientProfile.taxCases[0].federalActualRefund
              ? Number(user.clientProfile.taxCases[0].federalActualRefund)
              : null,
            stateActualRefund: user.clientProfile.taxCases[0].stateActualRefund
              ? Number(user.clientProfile.taxCases[0].stateActualRefund)
              : null,
            estimatedRefund: user.clientProfile.taxCases[0].estimatedRefund
              ? Number(user.clientProfile.taxCases[0].estimatedRefund)
              : null,
            federalCommissionRate: Number(user.clientProfile.taxCases[0].federalCommissionRate || 0.11),
            stateCommissionRate: Number(user.clientProfile.taxCases[0].stateCommissionRate || 0.11),
          }
        : null,
    };
  }

  async completeProfile(userId: string, data: CompleteProfileDto) {
    this.logger.log(
      `Saving profile for user ${userId}, isDraft: ${data.is_draft}, paymentMethod: ${data.payment_method || 'bank_deposit'}`,
    );

    const existingProfile = await this.prisma.clientProfile.findUnique({
      where: { userId },
    });

    if (existingProfile?.profileComplete && !existingProfile?.isDraft) {
      throw new BadRequestException(
        'Profile already submitted. Contact support to make changes.',
      );
    }

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

    const result = await this.prisma.$transaction(async (tx) => {
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

    await this.updateComputedStatusFields(result.profile.id);

    if (!data.is_draft) {
      this.runBackgroundTask(
        'progress-automation-profile-completed',
        async () => {
          const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { firstName: true, lastName: true },
          });
          const clientName = user
            ? `${user.firstName || ''} ${user.lastName || ''}`.trim()
            : 'Unknown';

          await this.progressAutomation.processEvent({
            type: 'PROFILE_COMPLETED',
            userId,
            taxCaseId: result.taxCase.id,
            metadata: { clientName },
          });
          this.logger.log(`Emitted PROFILE_COMPLETED event for user ${userId}`);

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
    data: UpdateUserInfoDto,
  ) {
    this.logger.log(`Updating user info for ${userId}: fields=[${Object.keys(data).join(', ')}]`);

    const result = await this.prisma.$transaction(async (tx) => {
      const userUpdateData: any = {};
      if (data.phone !== undefined) userUpdateData.phone = data.phone;
      if (data.firstName !== undefined)
        userUpdateData.firstName = data.firstName;
      if (data.lastName !== undefined) userUpdateData.lastName = data.lastName;
      if (data.preferredLanguage !== undefined) {
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

      let address: {
        street: string | null;
        city: string | null;
        state: string | null;
        zip: string | null;
      } | null = null;
      let dateOfBirth: Date | null = null;

      if (data.address || data.dateOfBirth) {
        const profileUpdateData: any = {};

        if (data.address) {
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

        if (data.dateOfBirth) {
          profileUpdateData.dateOfBirth = new Date(data.dateOfBirth);
        }

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

    const profileUpdateData: any = {};
    const taxCaseUpdateData: any = {};
    const auditDetails: Record<string, any> = {};

    if (data.ssn !== undefined) {
      const normalizedSSN = data.ssn.replace(/-/g, '');
      profileUpdateData.ssn = this.encryption.encrypt(normalizedSSN);
      auditDetails.ssnChanged = true;
    }

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

    const result = await this.prisma.$transaction(async (tx) => {
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

    // Log audit events in background
    this.runBackgroundTask('audit-sensitive-profile-update', async () => {
      if (auditDetails.ssnChanged) {
        await this.auditLogsService.log({
          action: AuditAction.SSN_CHANGE,
          userId,
          targetUserId: userId,
          details: { timestamp: new Date().toISOString() },
        });
      }

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
    const parsedPhone = this.parseE164Phone(profile.user?.phone);

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
      bank: {
        name: taxCase?.bankName || null,
        routingNumber: taxCase?.bankRoutingNumber
          ? this.encryption.decrypt(taxCase.bankRoutingNumber)
          : null,
        accountNumber: taxCase?.bankAccountNumber
          ? this.encryption.decrypt(taxCase.bankAccountNumber)
          : null,
      },
      paymentMethod: taxCase?.paymentMethod || 'bank_deposit',
      workState: taxCase?.workState || null,
      employerName: taxCase?.employerName || null,
      turbotaxEmail: profile.turbotaxEmail
        ? this.encryption.decrypt(profile.turbotaxEmail)
        : null,
      turbotaxPassword: profile.turbotaxPassword ? '********' : null,
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
   */
  async markOnboardingComplete(userId: string) {
    this.logger.log(`Marking onboarding complete for user ${userId}`);

    const profile = await this.prisma.clientProfile.upsert({
      where: { userId },
      update: {
        profileComplete: true,
      },
      create: {
        userId,
        profileComplete: true,
        isDraft: true,
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

      const currentYear = new Date().getFullYear();
      let taxCase = await this.prisma.taxCase.findFirst({
        where: {
          clientProfileId: profile.id,
          taxYear: currentYear
        },
      });

      if (!taxCase) {
        taxCase = await this.prisma.taxCase.create({
          data: {
            clientProfileId: profile.id,
            taxYear: currentYear,
            estimatedRefund: latestEstimate.estimatedRefund,
          },
        });
        this.logger.log(`Created TaxCase with estimated refund for user ${userId}`);
      } else {
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

  /**
   * Upload profile picture to Supabase and save path to database
   */
  async uploadProfilePicture(
    userId: string,
    file: Buffer,
    mimeType: string,
  ): Promise<{ profilePictureUrl: string }> {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(mimeType)) {
      throw new BadRequestException(
        'Invalid file type. Allowed: JPEG, PNG, WebP, GIF',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { profilePicturePath: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const oldPicturePath = user.profilePicturePath;

    const extension = mimeType.split('/')[1];
    const fileName = `${userId}/${uuidv4()}.${extension}`;

    await this.supabase.uploadFile(
      this.PROFILE_PICTURES_BUCKET,
      fileName,
      file,
      mimeType,
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: { profilePicturePath: fileName },
    });

    const profilePictureUrl = await this.supabase.getSignedUrl(
      this.PROFILE_PICTURES_BUCKET,
      fileName,
      3600,
    );

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

    try {
      await this.supabase.deleteFile(
        this.PROFILE_PICTURES_BUCKET,
        user.profilePicturePath,
      );
    } catch (err) {
      this.logger.error('Failed to delete profile picture from storage', err);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { profilePicturePath: null },
    });

    this.logger.log(`Profile picture deleted for user ${userId}`);

    return { message: 'Profile picture deleted successfully' };
  }
}
