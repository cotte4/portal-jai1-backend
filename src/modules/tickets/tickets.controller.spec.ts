import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateStatusDto } from './dto/update-status.dto';

/**
 * Tickets Controller Unit Tests
 *
 * Tests the TicketsController's routing and request handling for:
 * - Ticket creation
 * - Ticket listing and filtering
 * - Message management
 * - Status updates
 */

describe('TicketsController', () => {
  let controller: TicketsController;
  let ticketsService: jest.Mocked<TicketsService>;

  // Mock users
  const mockClientUser = {
    id: 'client-123',
    email: 'client@example.com',
    role: 'client' as const,
  };

  const mockAdminUser = {
    id: 'admin-123',
    email: 'admin@example.com',
    role: 'admin' as const,
  };

  // Mock ticket data
  const mockTicket = {
    id: 'ticket-123',
    userId: 'client-123',
    subject: 'Help with documents',
    status: 'open',
    messages: [
      {
        id: 'msg-1',
        content: 'I need help uploading my W2',
        senderId: 'client-123',
        createdAt: new Date(),
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockTicketsList = [mockTicket];

  beforeEach(async () => {
    const mockTicketsService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      addMessage: jest.fn(),
      updateStatus: jest.fn(),
      deleteTicket: jest.fn(),
      deleteMessage: jest.fn(),
      markMessagesAsRead: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TicketsController],
      providers: [
        { provide: TicketsService, useValue: mockTicketsService },
      ],
    }).compile();

    controller = module.get<TicketsController>(TicketsController);
    ticketsService = module.get(TicketsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /tickets', () => {
    const createTicketDto: CreateTicketDto = {
      subject: 'Help with documents',
      message: 'I need help uploading my W2',
    };

    it('should create a new ticket', async () => {
      ticketsService.create.mockResolvedValue(mockTicket);

      const result = await controller.create(mockClientUser, createTicketDto);

      expect(ticketsService.create).toHaveBeenCalledWith(mockClientUser.id, createTicketDto);
      expect(result).toEqual(mockTicket);
    });
  });

  describe('GET /tickets', () => {
    it('should return all tickets for admin', async () => {
      ticketsService.findAll.mockResolvedValue(mockTicketsList);

      const result = await controller.findAll(mockAdminUser, undefined, undefined);

      expect(ticketsService.findAll).toHaveBeenCalledWith({ status: undefined, userId: undefined });
      expect(result).toEqual(mockTicketsList);
    });

    it('should return only own tickets for client', async () => {
      ticketsService.findAll.mockResolvedValue(mockTicketsList);

      const result = await controller.findAll(mockClientUser, undefined, undefined);

      expect(ticketsService.findAll).toHaveBeenCalledWith({ status: undefined, userId: mockClientUser.id });
      expect(result).toEqual(mockTicketsList);
    });

    it('should filter tickets by status', async () => {
      ticketsService.findAll.mockResolvedValue(mockTicketsList);

      const result = await controller.findAll(mockAdminUser, 'open', undefined);

      expect(ticketsService.findAll).toHaveBeenCalledWith({ status: 'open', userId: undefined });
      expect(result).toEqual(mockTicketsList);
    });

    it('should allow admin to filter by user_id', async () => {
      ticketsService.findAll.mockResolvedValue(mockTicketsList);

      const result = await controller.findAll(mockAdminUser, undefined, 'client-456');

      expect(ticketsService.findAll).toHaveBeenCalledWith({ status: undefined, userId: 'client-456' });
    });

    it('should throw BadRequestException for invalid status', async () => {
      await expect(
        controller.findAll(mockAdminUser, 'invalid_status', undefined),
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept valid status values', async () => {
      ticketsService.findAll.mockResolvedValue([]);

      for (const status of ['open', 'in_progress', 'closed']) {
        await expect(
          controller.findAll(mockAdminUser, status, undefined),
        ).resolves.not.toThrow();
      }
    });
  });

  describe('GET /tickets/:id', () => {
    it('should return ticket by id', async () => {
      ticketsService.findOne.mockResolvedValue(mockTicket);

      const result = await controller.findOne(mockClientUser, 'ticket-123');

      expect(ticketsService.findOne).toHaveBeenCalledWith(
        'ticket-123',
        mockClientUser.id,
        mockClientUser.role,
      );
      expect(result).toEqual(mockTicket);
    });
  });

  describe('POST /tickets/:id/messages', () => {
    const createMessageDto: CreateMessageDto = {
      content: 'Thanks for your help!',
    };

    it('should add message to ticket', async () => {
      const updatedTicket = {
        ...mockTicket,
        messages: [
          ...mockTicket.messages,
          {
            id: 'msg-2',
            content: 'Thanks for your help!',
            senderId: 'client-123',
            createdAt: new Date(),
          },
        ],
      };
      ticketsService.addMessage.mockResolvedValue(updatedTicket);

      const result = await controller.addMessage(mockClientUser, 'ticket-123', createMessageDto);

      expect(ticketsService.addMessage).toHaveBeenCalledWith(
        'ticket-123',
        mockClientUser.id,
        mockClientUser.role,
        createMessageDto,
      );
      expect(result.messages).toHaveLength(2);
    });
  });

  describe('PATCH /tickets/:id/status', () => {
    const updateStatusDto: UpdateStatusDto = {
      status: 'in_progress',
    };

    it('should update ticket status (admin only)', async () => {
      const updatedTicket = { ...mockTicket, status: 'in_progress' };
      ticketsService.updateStatus.mockResolvedValue(updatedTicket);

      const result = await controller.updateStatus('ticket-123', updateStatusDto);

      expect(ticketsService.updateStatus).toHaveBeenCalledWith('ticket-123', updateStatusDto);
      expect(result.status).toBe('in_progress');
    });
  });

  describe('DELETE /tickets/:id', () => {
    it('should delete ticket', async () => {
      const response = { message: 'Ticket deleted successfully' };
      ticketsService.deleteTicket.mockResolvedValue(response);

      const result = await controller.deleteTicket(mockClientUser, 'ticket-123');

      expect(ticketsService.deleteTicket).toHaveBeenCalledWith(
        'ticket-123',
        mockClientUser.id,
        mockClientUser.role,
      );
      expect(result).toEqual(response);
    });
  });

  describe('DELETE /tickets/:id/messages/:messageId', () => {
    it('should delete message from ticket (admin only)', async () => {
      const response = { message: 'Message deleted successfully' };
      ticketsService.deleteMessage.mockResolvedValue(response);

      const result = await controller.deleteMessage(mockAdminUser, 'ticket-123', 'msg-1');

      expect(ticketsService.deleteMessage).toHaveBeenCalledWith(
        'ticket-123',
        'msg-1',
        mockAdminUser.id,
        mockAdminUser.role,
      );
      expect(result).toEqual(response);
    });
  });

  describe('PATCH /tickets/:id/messages/read', () => {
    it('should mark messages as read', async () => {
      const response = { markedCount: 3 };
      ticketsService.markMessagesAsRead.mockResolvedValue(response);

      const result = await controller.markMessagesAsRead(mockClientUser, 'ticket-123');

      expect(ticketsService.markMessagesAsRead).toHaveBeenCalledWith(
        'ticket-123',
        mockClientUser.id,
        mockClientUser.role,
      );
      expect(result).toEqual(response);
    });
  });
});
