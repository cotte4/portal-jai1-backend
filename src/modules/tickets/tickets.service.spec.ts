import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { PrismaService } from '../../config/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

// Mock data
const mockUser = {
  id: 'user-1',
  email: 'client@example.com',
  firstName: 'John',
  lastName: 'Doe',
  role: 'client',
};

const mockAdminUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  firstName: 'Admin',
  lastName: 'User',
  role: 'admin',
};

const mockTicket = {
  id: 'ticket-1',
  userId: 'user-1',
  subject: 'Help with my tax form',
  status: 'open',
  unreadCount: 0,
  deletedAt: null,
  createdAt: new Date('2024-01-15'),
  updatedAt: new Date('2024-01-15'),
  user: mockUser,
};

const mockMessage = {
  id: 'msg-1',
  ticketId: 'ticket-1',
  senderId: 'user-1',
  message: 'I need help with my W2 form',
  isRead: false,
  deletedAt: null,
  createdAt: new Date('2024-01-15'),
  sender: mockUser,
};

const mockAdminMessage = {
  id: 'msg-2',
  ticketId: 'ticket-1',
  senderId: 'admin-1',
  message: 'Sure, I can help with that',
  isRead: false,
  deletedAt: null,
  createdAt: new Date('2024-01-16'),
  sender: mockAdminUser,
};

describe('TicketsService', () => {
  let service: TicketsService;
  let prisma: any;
  let notificationsService: any;

  beforeEach(async () => {
    // Create mock services
    prisma = {
      ticket: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      ticketMessage: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(prisma)),
    };

    notificationsService = {
      create: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get<TicketsService>(TicketsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a ticket without initial message', async () => {
      prisma.ticket.create.mockResolvedValue(mockTicket);

      const result = await service.create('user-1', { subject: 'Help needed' });

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result.subject).toBe('Help with my tax form');
      expect(result.userId).toBe('user-1');
    });

    it('should create a ticket with initial message', async () => {
      prisma.ticket.create.mockResolvedValue(mockTicket);
      prisma.ticketMessage.create.mockResolvedValue(mockMessage);

      const result = await service.create('user-1', {
        subject: 'Help needed',
        message: 'Initial message content',
      });

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should throw InternalServerErrorException on database error', async () => {
      prisma.$transaction.mockRejectedValue(new Error('DB error'));

      await expect(
        service.create('user-1', { subject: 'Test' }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('findAll', () => {
    it('should return all tickets without filters', async () => {
      prisma.ticket.findMany.mockResolvedValue([
        { ...mockTicket, _count: { messages: 5 } },
      ]);

      const result = await service.findAll({});

      expect(prisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null },
          orderBy: { updatedAt: 'desc' },
        }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].messageCount).toBe(5);
    });

    it('should filter by status', async () => {
      prisma.ticket.findMany.mockResolvedValue([]);

      await service.findAll({ status: 'open' });

      expect(prisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null, status: 'open' },
        }),
      );
    });

    it('should filter by userId', async () => {
      prisma.ticket.findMany.mockResolvedValue([]);

      await service.findAll({ userId: 'user-1' });

      expect(prisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null, userId: 'user-1' },
        }),
      );
    });

    it('should throw InternalServerErrorException on database error', async () => {
      prisma.ticket.findMany.mockRejectedValue(new Error('DB error'));

      await expect(service.findAll({})).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('findOne', () => {
    it('should return ticket for owner', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        ...mockTicket,
        messages: [mockMessage],
      });

      const result = await service.findOne('ticket-1', 'user-1', 'client');

      expect(result.id).toBe('ticket-1');
      expect(result.messages).toHaveLength(1);
    });

    it('should return ticket for admin regardless of owner', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        ...mockTicket,
        messages: [mockMessage],
      });

      const result = await service.findOne('ticket-1', 'admin-1', 'admin');

      expect(result.id).toBe('ticket-1');
    });

    it('should throw NotFoundException if ticket not found', async () => {
      prisma.ticket.findUnique.mockResolvedValue(null);

      await expect(
        service.findOne('invalid-id', 'user-1', 'client'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if user is not owner and not admin', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        ...mockTicket,
        messages: [],
      });

      await expect(
        service.findOne('ticket-1', 'other-user', 'client'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw InternalServerErrorException if ticket has no user', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        ...mockTicket,
        user: null,
        messages: [],
      });

      await expect(
        service.findOne('ticket-1', 'user-1', 'client'),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('addMessage', () => {
    beforeEach(() => {
      // Setup findOne mock for the return value
      prisma.ticket.findUnique
        .mockResolvedValueOnce({ ...mockTicket, user: mockUser }) // First call in addMessage
        .mockResolvedValueOnce({ ...mockTicket, messages: [mockMessage, mockAdminMessage] }); // Second call in findOne
    });

    it('should add message to ticket by owner', async () => {
      const result = await service.addMessage(
        'ticket-1',
        'user-1',
        'client',
        { message: 'New message' },
      );

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should add message to ticket by admin', async () => {
      prisma.ticket.findUnique
        .mockReset()
        .mockResolvedValueOnce({ ...mockTicket, user: mockUser })
        .mockResolvedValueOnce({ ...mockTicket, messages: [mockMessage] });

      await service.addMessage('ticket-1', 'admin-1', 'admin', {
        message: 'Admin reply',
      });

      // Admin replying to client should trigger notification
      expect(notificationsService.create).toHaveBeenCalledWith(
        'user-1',
        'message',
        'Respuesta a tu ticket',
        expect.stringContaining('Help with my tax form'),
      );
    });

    it('should throw NotFoundException if ticket not found', async () => {
      prisma.ticket.findUnique.mockReset().mockResolvedValue(null);

      await expect(
        service.addMessage('invalid-id', 'user-1', 'client', {
          message: 'Test',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if user has no access', async () => {
      prisma.ticket.findUnique.mockReset().mockResolvedValue({
        ...mockTicket,
        user: mockUser,
      });

      await expect(
        service.addMessage('ticket-1', 'other-user', 'client', {
          message: 'Test',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateStatus', () => {
    it('should update ticket status', async () => {
      prisma.ticket.findUnique.mockResolvedValue(mockTicket);
      prisma.ticket.update.mockResolvedValue({
        id: 'ticket-1',
        status: 'resolved',
      });

      const result = await service.updateStatus('ticket-1', {
        status: 'resolved' as any,
      });

      expect(result).toEqual({
        id: 'ticket-1',
        status: 'resolved',
        message: 'Ticket status updated successfully',
      });
    });

    it('should throw NotFoundException if ticket not found', async () => {
      prisma.ticket.findUnique.mockResolvedValue(null);

      await expect(
        service.updateStatus('invalid-id', { status: 'resolved' as any }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteTicket', () => {
    it('should soft-delete ticket when admin', async () => {
      prisma.ticket.findUnique.mockResolvedValue(mockTicket);
      prisma.ticket.update.mockResolvedValue({
        ...mockTicket,
        deletedAt: new Date(),
      });

      const result = await service.deleteTicket('ticket-1', 'admin-1', 'admin');

      expect(prisma.ticket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(result).toEqual({ message: 'Ticket deleted successfully' });
    });

    it('should throw ForbiddenException when non-admin tries to delete', async () => {
      await expect(
        service.deleteTicket('ticket-1', 'user-1', 'client'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if ticket not found', async () => {
      prisma.ticket.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteTicket('invalid-id', 'admin-1', 'admin'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteMessage', () => {
    it('should soft-delete message when admin', async () => {
      prisma.ticketMessage.findUnique.mockResolvedValue(mockMessage);
      prisma.ticketMessage.update.mockResolvedValue({
        ...mockMessage,
        deletedAt: new Date(),
      });

      const result = await service.deleteMessage(
        'ticket-1',
        'msg-1',
        'admin-1',
        'admin',
      );

      expect(prisma.ticketMessage.update).toHaveBeenCalledWith({
        where: { id: 'msg-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(result).toEqual({ message: 'Message deleted successfully' });
    });

    it('should throw ForbiddenException when non-admin tries to delete', async () => {
      await expect(
        service.deleteMessage('ticket-1', 'msg-1', 'user-1', 'client'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if message not found', async () => {
      prisma.ticketMessage.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteMessage('ticket-1', 'invalid-id', 'admin-1', 'admin'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if message belongs to different ticket', async () => {
      prisma.ticketMessage.findUnique.mockResolvedValue({
        ...mockMessage,
        ticketId: 'different-ticket',
      });

      await expect(
        service.deleteMessage('ticket-1', 'msg-1', 'admin-1', 'admin'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('markMessagesAsRead', () => {
    it('should mark messages as read for ticket owner (client)', async () => {
      prisma.ticket.findUnique.mockResolvedValue(mockTicket);
      prisma.ticketMessage.updateMany.mockResolvedValue({ count: 3 });
      prisma.ticket.update.mockResolvedValue({ ...mockTicket, unreadCount: 0 });

      const result = await service.markMessagesAsRead(
        'ticket-1',
        'user-1',
        'client',
      );

      expect(prisma.ticketMessage.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          ticketId: 'ticket-1',
          isRead: false,
          deletedAt: null,
          NOT: { senderId: 'user-1' }, // Client reads messages NOT from themselves
        }),
        data: { isRead: true },
      });
      expect(result).toEqual({ markedCount: 3 });
    });

    it('should mark messages as read for admin', async () => {
      prisma.ticket.findUnique.mockResolvedValue(mockTicket);
      prisma.ticketMessage.updateMany.mockResolvedValue({ count: 2 });
      prisma.ticket.update.mockResolvedValue({ ...mockTicket, unreadCount: 0 });

      const result = await service.markMessagesAsRead(
        'ticket-1',
        'admin-1',
        'admin',
      );

      expect(prisma.ticketMessage.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          ticketId: 'ticket-1',
          isRead: false,
          deletedAt: null,
          senderId: 'user-1', // Admin reads messages from the ticket owner
        }),
        data: { isRead: true },
      });
      expect(result).toEqual({ markedCount: 2 });
    });

    it('should reset unread count on ticket', async () => {
      prisma.ticket.findUnique.mockResolvedValue(mockTicket);
      prisma.ticketMessage.updateMany.mockResolvedValue({ count: 1 });
      prisma.ticket.update.mockResolvedValue({ ...mockTicket, unreadCount: 0 });

      await service.markMessagesAsRead('ticket-1', 'user-1', 'client');

      expect(prisma.ticket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-1' },
        data: { unreadCount: 0 },
      });
    });

    it('should throw NotFoundException if ticket not found', async () => {
      prisma.ticket.findUnique.mockResolvedValue(null);

      await expect(
        service.markMessagesAsRead('invalid-id', 'user-1', 'client'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if user has no access', async () => {
      prisma.ticket.findUnique.mockResolvedValue(mockTicket);

      await expect(
        service.markMessagesAsRead('ticket-1', 'other-user', 'client'),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
