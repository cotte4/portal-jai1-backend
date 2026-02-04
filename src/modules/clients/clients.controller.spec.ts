import { Test, TestingModule } from '@nestjs/testing';
import { ClientsController } from './clients.controller';
import {
  ClientProfileService,
  ClientQueryService,
  ClientStatusService,
  ClientAdminService,
  ClientExportService,
  ClientReportingService,
} from './services';
import { CompleteProfileDto } from './dto/complete-profile.dto';
import { UpdateStatusDto, SetProblemDto, SendNotificationDto } from './dto/admin-update.dto';

/**
 * Clients Controller Unit Tests
 *
 * Tests the ClientsController's routing and request handling for:
 * - Client profile management
 * - Admin client management
 * - Status updates
 * - Problem management
 */

describe('ClientsController', () => {
  let controller: ClientsController;
  let profileService: jest.Mocked<ClientProfileService>;
  let queryService: jest.Mocked<ClientQueryService>;
  let statusService: jest.Mocked<ClientStatusService>;
  let adminService: jest.Mocked<ClientAdminService>;
  let exportService: jest.Mocked<ClientExportService>;
  let reportingService: jest.Mocked<ClientReportingService>;

  // Mock user objects
  const mockClientUser = {
    id: 'client-123',
    email: 'client@example.com',
    role: 'client',
  };

  const mockAdminUser = {
    id: 'admin-123',
    email: 'admin@example.com',
    role: 'admin',
  };

  // Mock profile data
  const mockProfile = {
    id: 'profile-123',
    userId: 'client-123',
    user: {
      id: 'client-123',
      email: 'client@example.com',
      firstName: 'Test',
      lastName: 'Client',
    },
    taxCase: {
      id: 'case-123',
      preFilingStatus: 'profile_complete',
    },
  };

  // Mock client list
  const mockClientList = {
    clients: [mockProfile],
    nextCursor: null,
    hasMore: false,
  };

  beforeEach(async () => {
    const mockProfileService = {
      getProfile: jest.fn(),
      completeProfile: jest.fn(),
      getDraft: jest.fn(),
      updateUserInfo: jest.fn(),
      uploadProfilePicture: jest.fn(),
      deleteProfilePicture: jest.fn(),
      updateSensitiveProfile: jest.fn(),
      markOnboardingComplete: jest.fn(),
      updateComputedStatusFields: jest.fn(),
    };

    const mockQueryService = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      getAllClientAccounts: jest.fn(),
      getClientCredentials: jest.fn(),
    };

    const mockStatusService = {
      update: jest.fn(),
      updateStatus: jest.fn(),
      getValidTransitions: jest.fn(),
      confirmRefundReceived: jest.fn(),
    };

    const mockAdminService = {
      markPaid: jest.fn(),
      markCommissionPaid: jest.fn(),
      getUnpaidCommissions: jest.fn(),
      updateAdminStep: jest.fn(),
      setProblem: jest.fn(),
      sendClientNotification: jest.fn(),
      remove: jest.fn(),
    };

    const mockExportService = {
      exportToExcelStream: jest.fn(),
      exportToExcel: jest.fn(),
    };

    const mockReportingService = {
      getPaymentsSummary: jest.fn(),
      getDelaysData: jest.fn(),
      getSeasonStats: jest.fn(),
      getClientsWithAlarms: jest.fn(),
      resetW2Estimate: jest.fn(),
      getW2EstimateForClient: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClientsController],
      providers: [
        { provide: ClientProfileService, useValue: mockProfileService },
        { provide: ClientQueryService, useValue: mockQueryService },
        { provide: ClientStatusService, useValue: mockStatusService },
        { provide: ClientAdminService, useValue: mockAdminService },
        { provide: ClientExportService, useValue: mockExportService },
        { provide: ClientReportingService, useValue: mockReportingService },
      ],
    }).compile();

    controller = module.get<ClientsController>(ClientsController);
    profileService = module.get(ClientProfileService);
    queryService = module.get(ClientQueryService);
    statusService = module.get(ClientStatusService);
    adminService = module.get(ClientAdminService);
    exportService = module.get(ClientExportService);
    reportingService = module.get(ClientReportingService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ============= CLIENT ENDPOINTS =============

  describe('GET /profile', () => {
    it('should return client profile', async () => {
      profileService.getProfile.mockResolvedValue(mockProfile);

      const result = await controller.getProfile(mockClientUser);

      expect(profileService.getProfile).toHaveBeenCalledWith(mockClientUser.id);
      expect(result).toEqual(mockProfile);
    });
  });

  describe('POST /profile/complete', () => {
    const completeProfileDto: CompleteProfileDto = {
      ssn: '123-45-6789',
      date_of_birth: '1990-01-01',
      address_street: '123 Main St',
      address_city: 'New York',
      address_state: 'NY',
      address_zip: '10001',
    };

    it('should complete client profile', async () => {
      const completedProfile = { ...mockProfile, profileComplete: true };
      profileService.completeProfile.mockResolvedValue(completedProfile);

      const result = await controller.completeProfile(mockClientUser, completeProfileDto);

      expect(profileService.completeProfile).toHaveBeenCalledWith(mockClientUser.id, completeProfileDto);
      expect(result).toEqual(completedProfile);
    });
  });

  describe('GET /profile/draft', () => {
    it('should return profile draft', async () => {
      const draftProfile = { ...mockProfile, isDraft: true };
      profileService.getDraft.mockResolvedValue(draftProfile);

      const result = await controller.getDraft(mockClientUser);

      expect(profileService.getDraft).toHaveBeenCalledWith(mockClientUser.id);
      expect(result).toEqual(draftProfile);
    });
  });

  describe('PATCH /profile/user-info', () => {
    it('should update user info', async () => {
      const updateData = {
        phone: '+1987654321',
        firstName: 'Updated',
      };
      const updatedProfile = { ...mockProfile, user: { ...mockProfile.user, ...updateData } };
      profileService.updateUserInfo.mockResolvedValue(updatedProfile);

      const result = await controller.updateUserInfo(mockClientUser, updateData);

      expect(profileService.updateUserInfo).toHaveBeenCalledWith(mockClientUser.id, updateData);
      expect(result).toEqual(updatedProfile);
    });
  });

  describe('POST /profile/picture', () => {
    it('should upload profile picture', async () => {
      const mockFile = {
        buffer: Buffer.from('test'),
        mimetype: 'image/jpeg',
      } as Express.Multer.File;
      const response = { profilePictureUrl: 'https://storage.example.com/picture.jpg' };
      profileService.uploadProfilePicture.mockResolvedValue(response);

      const result = await controller.uploadProfilePicture(mockClientUser, mockFile);

      expect(profileService.uploadProfilePicture).toHaveBeenCalledWith(
        mockClientUser.id,
        mockFile.buffer,
        mockFile.mimetype,
      );
      expect(result).toEqual(response);
    });
  });

  describe('DELETE /profile/picture', () => {
    it('should delete profile picture', async () => {
      const response = { message: 'Profile picture deleted' };
      profileService.deleteProfilePicture.mockResolvedValue(response);

      const result = await controller.deleteProfilePicture(mockClientUser);

      expect(profileService.deleteProfilePicture).toHaveBeenCalledWith(mockClientUser.id);
      expect(result).toEqual(response);
    });
  });

  // ============= ADMIN ENDPOINTS =============

  describe('GET /admin/stats/season', () => {
    it('should return season stats', async () => {
      const stats = {
        totalClients: 100,
        completedCases: 50,
        pendingCases: 30,
        revenue: 50000,
      };
      reportingService.getSeasonStats.mockResolvedValue(stats);

      const result = await controller.getSeasonStats();

      expect(reportingService.getSeasonStats).toHaveBeenCalled();
      expect(result).toEqual(stats);
    });
  });

  describe('GET /admin/accounts', () => {
    it('should return all client accounts with pagination', async () => {
      queryService.getAllClientAccounts.mockResolvedValue(mockClientList);

      const result = await controller.getAllClientAccounts('cursor-123', '50');

      expect(queryService.getAllClientAccounts).toHaveBeenCalledWith({
        cursor: 'cursor-123',
        limit: 50,
      });
      expect(result).toEqual(mockClientList);
    });

    it('should use default limit when not provided', async () => {
      queryService.getAllClientAccounts.mockResolvedValue(mockClientList);

      await controller.getAllClientAccounts(undefined, undefined);

      expect(queryService.getAllClientAccounts).toHaveBeenCalledWith({
        cursor: undefined,
        limit: 50,
      });
    });

    it('should cap limit at maximum value', async () => {
      queryService.getAllClientAccounts.mockResolvedValue(mockClientList);

      await controller.getAllClientAccounts(undefined, '1000');

      expect(queryService.getAllClientAccounts).toHaveBeenCalledWith({
        cursor: undefined,
        limit: 500, // MAX_LIMIT
      });
    });
  });

  describe('GET /admin/clients', () => {
    it('should return filtered client list', async () => {
      queryService.findAll.mockResolvedValue(mockClientList);

      const result = await controller.findAll(
        'pending',
        'test',
        'cursor',
        '20',
        'false',
        'accepted',
        undefined,
        undefined,
        undefined,
        undefined,
        'createdAt',
        'desc',
      );

      expect(queryService.findAll).toHaveBeenCalledWith({
        status: 'pending',
        search: 'test',
        cursor: 'cursor',
        limit: 20,
        hasProblem: false,
        federalStatus: 'accepted',
        stateStatus: undefined,
        caseStatus: undefined,
        dateFrom: undefined,
        dateTo: undefined,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });
      expect(result).toEqual(mockClientList);
    });

    it('should parse hasProblem boolean correctly', async () => {
      queryService.findAll.mockResolvedValue(mockClientList);

      await controller.findAll(
        undefined,
        undefined,
        undefined,
        undefined,
        'true',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );

      expect(queryService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ hasProblem: true }),
      );
    });
  });

  describe('GET /admin/clients/:id', () => {
    it('should return single client detail', async () => {
      queryService.findOne.mockResolvedValue(mockProfile);

      const result = await controller.findOne('client-123');

      expect(queryService.findOne).toHaveBeenCalledWith('client-123');
      expect(result).toEqual(mockProfile);
    });
  });

  describe('PATCH /admin/clients/:id/status', () => {
    const updateStatusDto: UpdateStatusDto = {
      federalStatus: 'accepted',
      stateStatus: 'pending',
    };

    it('should update client status', async () => {
      const updatedProfile = {
        ...mockProfile,
        taxCase: { ...mockProfile.taxCase, federalStatus: 'accepted' },
      };
      statusService.updateStatus.mockResolvedValue(updatedProfile);

      const result = await controller.updateStatus('client-123', updateStatusDto, mockAdminUser);

      expect(statusService.updateStatus).toHaveBeenCalledWith(
        'client-123',
        updateStatusDto,
        mockAdminUser.id,
      );
      expect(result).toEqual(updatedProfile);
    });
  });

  describe('DELETE /admin/clients/:id', () => {
    it('should remove client', async () => {
      const response = { message: 'Client deleted successfully' };
      adminService.remove.mockResolvedValue(response);

      const result = await controller.remove('client-123');

      expect(adminService.remove).toHaveBeenCalledWith('client-123');
      expect(result).toEqual(response);
    });
  });

  describe('POST /admin/clients/:id/mark-paid', () => {
    it('should mark client as paid', async () => {
      const response = { message: 'Payment marked' };
      adminService.markPaid.mockResolvedValue(response);

      const result = await controller.markPaid('client-123');

      expect(adminService.markPaid).toHaveBeenCalledWith('client-123');
      expect(result).toEqual(response);
    });
  });

  describe('PATCH /admin/clients/:id/problem', () => {
    const setProblemDto: SetProblemDto = {
      problemType: 'missing_documents',
      problemDescription: 'W2 form is missing',
    };

    it('should set problem on client case', async () => {
      const response = { message: 'Problem set successfully' };
      adminService.setProblem.mockResolvedValue(response);

      const result = await controller.setProblem('client-123', setProblemDto);

      expect(adminService.setProblem).toHaveBeenCalledWith('client-123', setProblemDto);
      expect(result).toEqual(response);
    });
  });

  describe('POST /admin/clients/:id/notify', () => {
    const notifyDto: SendNotificationDto = {
      message: 'Your documents have been reviewed',
    };

    it('should send notification to client', async () => {
      const response = { message: 'Notification sent' };
      adminService.sendClientNotification.mockResolvedValue(response);

      const result = await controller.sendClientNotification('client-123', notifyDto);

      expect(adminService.sendClientNotification).toHaveBeenCalledWith('client-123', notifyDto);
      expect(result).toEqual(response);
    });
  });
});
