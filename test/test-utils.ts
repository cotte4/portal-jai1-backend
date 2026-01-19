/**
 * Test Utilities
 *
 * Factory functions for creating test data and mock services.
 * This makes tests more readable and maintainable.
 */

import { UserRole } from '@prisma/client';

// ============= DATA FACTORIES =============

/**
 * Creates a mock User object with sensible defaults
 */
export function createMockUser(overrides: Partial<MockUser> = {}): MockUser {
  const id = overrides.id || 'test-user-id-' + Math.random().toString(36).substring(7);
  return {
    id,
    email: `test-${id}@example.com`,
    passwordHash: '$2b$10$hashedpassword', // bcrypt hash of "password123"
    role: UserRole.client,
    firstName: 'Test',
    lastName: 'User',
    phone: '+1234567890',
    profilePicturePath: null,
    googleId: null,
    isActive: true,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    resetToken: null,
    resetTokenExpiresAt: null,
    tokenVersion: 1,
    preferredLanguage: 'es',
    referralCode: null,
    referredByCode: null,
    referralCodeCreatedAt: null,
    emailVerified: false,
    verificationToken: null,
    verificationTokenExpiresAt: null,
    ...overrides,
  };
}

/**
 * Creates a mock Admin user
 */
export function createMockAdmin(overrides: Partial<MockUser> = {}): MockUser {
  return createMockUser({
    role: UserRole.admin,
    firstName: 'Admin',
    lastName: 'User',
    email: 'admin@example.com',
    ...overrides,
  });
}

/**
 * Creates a mock ClientProfile
 */
export function createMockClientProfile(overrides: Partial<MockClientProfile> = {}): MockClientProfile {
  const id = overrides.id || 'test-profile-id-' + Math.random().toString(36).substring(7);
  return {
    id,
    userId: 'test-user-id',
    ssn: null,
    dateOfBirth: null,
    addressStreet: null,
    addressCity: null,
    addressState: null,
    addressZip: null,
    addressCountry: 'USA',
    turbotaxEmail: null,
    turbotaxPassword: null,
    irsUsername: null,
    irsPassword: null,
    stateUsername: null,
    statePassword: null,
    profileComplete: false,
    isDraft: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Creates a mock TaxCase
 */
export function createMockTaxCase(overrides: Partial<MockTaxCase> = {}): MockTaxCase {
  const id = overrides.id || 'test-taxcase-id-' + Math.random().toString(36).substring(7);
  return {
    id,
    clientProfileId: 'test-profile-id',
    taxYear: 2025,
    taxesFiled: false,
    taxesFiledAt: null,
    preFilingStatus: 'awaiting_registration',
    federalStatus: null,
    stateStatus: null,
    estimatedRefund: null,
    federalEstimatedDate: null,
    stateEstimatedDate: null,
    federalActualRefund: null,
    stateActualRefund: null,
    federalDepositDate: null,
    stateDepositDate: null,
    paymentReceived: false,
    commissionPaid: false,
    workState: null,
    employerName: null,
    bankName: null,
    bankRoutingNumber: null,
    bankAccountNumber: null,
    statusUpdatedAt: new Date(),
    adminStep: null,
    hasProblem: false,
    problemStep: null,
    problemType: null,
    problemDescription: null,
    problemResolvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Creates a mock Referral
 */
export function createMockReferral(overrides: Partial<MockReferral> = {}): MockReferral {
  return {
    id: 'test-referral-id',
    referrerId: 'referrer-user-id',
    referredUserId: 'referred-user-id',
    referralCode: 'TEST123',
    status: 'pending',
    taxCaseId: null,
    completedAt: null,
    referredDiscount: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ============= SERVICE MOCKS =============

/**
 * Creates a mock UsersService with all methods as jest.fn()
 */
export function createMockUsersService() {
  return {
    findByEmail: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    updateLastLogin: jest.fn(),
    setResetToken: jest.fn(),
    findByResetToken: jest.fn(),
    updatePassword: jest.fn(),
    updateGoogleId: jest.fn(),
    incrementTokenVersion: jest.fn(),
    createRefreshToken: jest.fn(),
    findRefreshTokenByHash: jest.fn(),
    revokeRefreshToken: jest.fn(),
    revokeAllUserRefreshTokens: jest.fn(),
    // Email verification methods
    setVerificationToken: jest.fn(),
    findByVerificationToken: jest.fn(),
    markEmailVerified: jest.fn(),
  };
}

/**
 * Creates a mock ReferralsService
 */
export function createMockReferralsService() {
  return {
    validateCode: jest.fn(),
    createReferral: jest.fn(),
    getMyCode: jest.fn(),
    getMyReferrals: jest.fn(),
    getMyDiscount: jest.fn(),
    getLeaderboard: jest.fn(),
  };
}

/**
 * Creates a mock JwtService
 */
export function createMockJwtService() {
  return {
    sign: jest.fn().mockReturnValue('mock-jwt-token'),
    verify: jest.fn(),
    decode: jest.fn(),
  };
}

/**
 * Creates a mock ConfigService
 */
export function createMockConfigService(config: Record<string, any> = {}) {
  const defaultConfig = {
    JWT_SECRET: 'test-secret',
    JWT_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '7d',
    FRONTEND_URL: 'http://localhost:4200',
    ...config,
  };
  return {
    get: jest.fn((key: string) => defaultConfig[key]),
    getOrThrow: jest.fn((key: string) => {
      if (!(key in defaultConfig)) {
        throw new Error(`Config key ${key} not found`);
      }
      return defaultConfig[key];
    }),
  };
}

/**
 * Creates a mock EmailService
 */
export function createMockEmailService() {
  return {
    sendPasswordResetEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendNotificationEmail: jest.fn().mockResolvedValue(true),
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
  };
}

/**
 * Creates a mock NotificationsService
 */
export function createMockNotificationsService() {
  return {
    create: jest.fn().mockResolvedValue({ id: 'mock-notification-id' }),
    createFromTemplate: jest.fn().mockResolvedValue({ id: 'mock-notification-id' }),
    findAllForUser: jest.fn().mockResolvedValue([]),
    markAsRead: jest.fn().mockResolvedValue(undefined),
    markAllAsRead: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * Creates a mock AuditLogsService
 */
export function createMockAuditLogsService() {
  return {
    log: jest.fn().mockResolvedValue(undefined),
    findMany: jest.fn().mockResolvedValue([]),
  };
}

/**
 * Creates a mock SupabaseService
 */
export function createMockSupabaseService() {
  return {
    getSignedUrl: jest.fn().mockResolvedValue('https://mock-signed-url.com/file'),
    uploadFile: jest.fn().mockResolvedValue({ path: 'mock/path/file.pdf' }),
    deleteFile: jest.fn().mockResolvedValue(undefined),
  };
}

// ============= TYPE DEFINITIONS =============

export interface MockUser {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  phone: string | null;
  profilePicturePath: string | null;
  googleId: string | null;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  resetToken: string | null;
  resetTokenExpiresAt: Date | null;
  tokenVersion: number;
  preferredLanguage: string;
  referralCode: string | null;
  referredByCode: string | null;
  referralCodeCreatedAt: Date | null;
  // Email verification fields
  emailVerified: boolean;
  verificationToken: string | null;
  verificationTokenExpiresAt: Date | null;
}

export interface MockClientProfile {
  id: string;
  userId: string;
  ssn: string | null;
  dateOfBirth: Date | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZip: string | null;
  addressCountry: string | null;
  turbotaxEmail: string | null;
  turbotaxPassword: string | null;
  irsUsername: string | null;
  irsPassword: string | null;
  stateUsername: string | null;
  statePassword: string | null;
  profileComplete: boolean;
  isDraft: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockTaxCase {
  id: string;
  clientProfileId: string;
  taxYear: number;
  taxesFiled: boolean;
  taxesFiledAt: Date | null;
  preFilingStatus: string;
  federalStatus: string | null;
  stateStatus: string | null;
  estimatedRefund: any;
  federalEstimatedDate: Date | null;
  stateEstimatedDate: Date | null;
  federalActualRefund: any;
  stateActualRefund: any;
  federalDepositDate: Date | null;
  stateDepositDate: Date | null;
  paymentReceived: boolean;
  commissionPaid: boolean;
  workState: string | null;
  employerName: string | null;
  bankName: string | null;
  bankRoutingNumber: string | null;
  bankAccountNumber: string | null;
  statusUpdatedAt: Date;
  adminStep: number | null;
  hasProblem: boolean;
  problemStep: number | null;
  problemType: string | null;
  problemDescription: string | null;
  problemResolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockReferral {
  id: string;
  referrerId: string;
  referredUserId: string;
  referralCode: string;
  status: string;
  taxCaseId: string | null;
  completedAt: Date | null;
  referredDiscount: any;
  createdAt: Date;
  updatedAt: Date;
}

// ============= CONTROLLER MOCK FACTORIES =============

/**
 * Creates a mock AuthService for controller testing
 */
export function createMockAuthService() {
  return {
    register: jest.fn(),
    login: jest.fn(),
    logout: jest.fn(),
    refreshTokens: jest.fn(),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
    changePassword: jest.fn(),
    googleLogin: jest.fn(),
    createOAuthCode: jest.fn(),
    exchangeOAuthCode: jest.fn(),
  };
}

/**
 * Creates a mock ClientsService for controller testing
 */
export function createMockClientsService() {
  return {
    getProfile: jest.fn(),
    completeProfile: jest.fn(),
    getDraft: jest.fn(),
    updateUserInfo: jest.fn(),
    uploadProfilePicture: jest.fn(),
    deleteProfilePicture: jest.fn(),
    getSeasonStats: jest.fn(),
    getAllClientAccounts: jest.fn(),
    getPaymentsSummary: jest.fn(),
    getDelaysData: jest.fn(),
    getClientsWithAlarms: jest.fn(),
    findAll: jest.fn(),
    exportToExcelStream: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    updateStatus: jest.fn(),
    remove: jest.fn(),
    markPaid: jest.fn(),
    setProblem: jest.fn(),
    sendClientNotification: jest.fn(),
  };
}

/**
 * Creates a mock DocumentsService for controller testing
 */
export function createMockDocumentsService() {
  return {
    upload: jest.fn(),
    findByUserId: jest.fn(),
    findByClientId: jest.fn(),
    getDownloadUrl: jest.fn(),
    remove: jest.fn(),
  };
}

/**
 * Creates a mock TicketsService for controller testing
 */
export function createMockTicketsService() {
  return {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    addMessage: jest.fn(),
    updateStatus: jest.fn(),
    deleteTicket: jest.fn(),
    deleteMessage: jest.fn(),
    markMessagesAsRead: jest.fn(),
  };
}

// ============= ASSERTION HELPERS =============

/**
 * Asserts that a mock function was called with specific arguments
 * More readable than expect(mock).toHaveBeenCalledWith()
 */
export function expectCalledWith(mock: jest.Mock, ...args: any[]) {
  expect(mock).toHaveBeenCalledWith(...args);
}

/**
 * Asserts that a mock function was never called
 */
export function expectNotCalled(mock: jest.Mock) {
  expect(mock).not.toHaveBeenCalled();
}

/**
 * Asserts that an async function throws a specific error
 */
export async function expectThrowsAsync(fn: () => Promise<any>, errorType: any, message?: string) {
  let thrown = false;
  try {
    await fn();
  } catch (error) {
    thrown = true;
    expect(error).toBeInstanceOf(errorType);
    if (message) {
      expect((error as Error).message).toContain(message);
    }
  }
  if (!thrown) {
    throw new Error('Expected function to throw, but it did not');
  }
}
