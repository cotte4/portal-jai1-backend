import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { EmailService } from '../../common/services';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { Prisma, TicketStatus } from '@prisma/client';

// Type definitions for better type safety - exported for use in controller
export interface TicketUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface TicketMessageSender {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
}

export interface TicketMessageResponse {
  id: string;
  ticketId: string;
  message: string;
  senderId: string | null;
  isRead?: boolean;
  sender: TicketMessageSender | null;
  createdAt: Date;
}

export interface TicketResponse {
  id: string;
  userId: string;
  subject: string;
  status: string;
  unreadCount?: number;
  user?: TicketUser;
  messages?: TicketMessageResponse[];
  messageCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private notificationsService: NotificationsService,
  ) {}

  async create(userId: string, createTicketDto: CreateTicketDto): Promise<TicketResponse> {
    this.logger.log(`Creating ticket for user ${userId} with subject: ${createTicketDto.subject}`);

    try {
      // Use transaction to ensure atomicity when creating ticket with initial message
      const result = await this.prisma.$transaction(async (tx) => {
        // Create ticket
        const ticket = await tx.ticket.create({
          data: {
            userId,
            subject: createTicketDto.subject,
          },
        });

        // If message is provided, create initial message
        let messages: TicketMessageResponse[] = [];
        if (createTicketDto.message) {
          const initialMessage = await tx.ticketMessage.create({
            data: {
              ticketId: ticket.id,
              senderId: userId,
              message: createTicketDto.message,
            },
          });
          messages = [
            {
              id: initialMessage.id,
              ticketId: ticket.id,
              message: initialMessage.message,
              senderId: userId,
              sender: null,
              createdAt: initialMessage.createdAt,
            },
          ];
        }

        return {
          id: ticket.id,
          userId,
          subject: ticket.subject,
          status: ticket.status,
          messages,
          createdAt: ticket.createdAt,
          updatedAt: ticket.updatedAt,
        };
      });

      this.logger.log(`Successfully created ticket ${result.id}`);
      return result;
    } catch (error) {
      this.logger.error(`Failed to create ticket for user ${userId}`, error instanceof Error ? error.stack : error);
      throw new InternalServerErrorException('Failed to create ticket');
    }
  }

  async findAll(options: { status?: string; userId?: string }): Promise<Omit<TicketResponse, 'messages'>[]> {
    this.logger.debug(`Finding tickets with options: ${JSON.stringify(options)}`);

    try {
      // Build where clause with proper Prisma types - exclude soft-deleted tickets
      const where: Prisma.TicketWhereInput = {
        deletedAt: null,
      };

      if (options.status) {
        where.status = options.status as TicketStatus;
      }

      if (options.userId) {
        where.userId = options.userId;
      }

      const tickets = await this.prisma.ticket.findMany({
        where,
        select: {
          id: true,
          subject: true,
          status: true,
          userId: true,
          unreadCount: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
          _count: {
            select: {
              messages: {
                where: { deletedAt: null },
              },
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
      });

      this.logger.debug(`Found ${tickets.length} tickets`);

      return tickets.map((ticket) => ({
        id: ticket.id,
        userId: ticket.userId,
        subject: ticket.subject,
        status: ticket.status,
        unreadCount: ticket.unreadCount,
        user: ticket.user ? {
          id: ticket.user.id,
          email: ticket.user.email,
          firstName: ticket.user.firstName,
          lastName: ticket.user.lastName,
        } : undefined,
        messageCount: ticket._count.messages,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
      }));
    } catch (error) {
      this.logger.error('Error in findAll tickets', error instanceof Error ? error.stack : error);
      throw new InternalServerErrorException('Failed to fetch tickets');
    }
  }

  async findOne(ticketId: string, userId: string, userRole: string): Promise<TicketResponse> {
    this.logger.debug(`Finding ticket ${ticketId} for user ${userId} (role: ${userRole})`);

    try {
      // Use select instead of include to fetch only needed fields (prevents over-fetching)
      // Exclude soft-deleted tickets and messages
      const ticket = await this.prisma.ticket.findUnique({
        where: { id: ticketId, deletedAt: null },
        select: {
          id: true,
          userId: true,
          subject: true,
          status: true,
          unreadCount: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
          messages: {
            where: { deletedAt: null },
            select: {
              id: true,
              message: true,
              senderId: true,
              isRead: true,
              createdAt: true,
              sender: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  role: true,
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!ticket) {
        this.logger.warn(`Ticket ${ticketId} not found`);
        throw new NotFoundException('Ticket not found');
      }

      // Check access
      if (userRole !== 'admin' && ticket.userId !== userId) {
        this.logger.warn(`User ${userId} denied access to ticket ${ticketId}`);
        throw new ForbiddenException('Access denied');
      }

      // Null check for user (shouldn't happen but defensive coding)
      if (!ticket.user) {
        this.logger.error(`Ticket ${ticketId} has no associated user`);
        throw new InternalServerErrorException('Ticket data integrity error');
      }

      return {
        id: ticket.id,
        userId: ticket.userId,
        subject: ticket.subject,
        status: ticket.status,
        unreadCount: ticket.unreadCount,
        user: {
          id: ticket.user.id,
          email: ticket.user.email,
          firstName: ticket.user.firstName,
          lastName: ticket.user.lastName,
        },
        messages: ticket.messages.map((msg) => ({
          id: msg.id,
          ticketId: ticket.id,
          message: msg.message,
          senderId: msg.senderId,
          isRead: msg.isRead,
          sender: msg.sender
            ? {
                id: msg.sender.id,
                firstName: msg.sender.firstName,
                lastName: msg.sender.lastName,
                role: msg.sender.role,
              }
            : null,
          createdAt: msg.createdAt,
        })),
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
      };
    } catch (error) {
      // Re-throw known exceptions
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error(`Error finding ticket ${ticketId}`, error instanceof Error ? error.stack : error);
      throw new InternalServerErrorException('Failed to fetch ticket');
    }
  }

  async addMessage(
    ticketId: string,
    userId: string,
    userRole: string,
    createMessageDto: CreateMessageDto,
  ): Promise<TicketResponse> {
    this.logger.log(`Adding message to ticket ${ticketId} by user ${userId}`);

    try {
      // Fetch ticket with only needed user fields for access check and notifications
      const ticket = await this.prisma.ticket.findUnique({
        where: { id: ticketId },
        select: {
          id: true,
          userId: true,
          subject: true,
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              role: true,
            },
          },
        },
      });

      if (!ticket) {
        this.logger.warn(`Ticket ${ticketId} not found when adding message`);
        throw new NotFoundException('Ticket not found');
      }

      // Check access
      if (userRole !== 'admin' && ticket.userId !== userId) {
        this.logger.warn(`User ${userId} denied access to add message to ticket ${ticketId}`);
        throw new ForbiddenException('Access denied');
      }

      // Use transaction to create message and update ticket atomically
      await this.prisma.$transaction(async (tx) => {
        await tx.ticketMessage.create({
          data: {
            ticketId,
            senderId: userId,
            message: createMessageDto.message,
          },
        });

        // Update ticket's updatedAt and increment unread count
        await tx.ticket.update({
          where: { id: ticketId },
          data: {
            updatedAt: new Date(),
            unreadCount: { increment: 1 },
          },
        });
      });

      // Send email and notification if admin is replying to a client's ticket
      if (userRole === 'admin' && ticket.user?.role === 'client') {
        // Create in-app notification (fire and forget with error handling)
        this.notificationsService.create(
          ticket.userId,
          'message',
          'Respuesta a tu ticket',
          `Nuevo mensaje en: ${ticket.subject}`,
        ).catch((err) => {
          this.logger.error(`Failed to create notification for ticket ${ticketId}`, err);
        });

        // TODO: Re-enable when needed
        // Send email notification (fire and forget with error handling)
        // if (ticket.user.email && ticket.user.firstName) {
        //   this.emailService.sendTicketResponseEmail(
        //     ticket.user.email,
        //     ticket.user.firstName,
        //     ticket.subject,
        //     createMessageDto.message,
        //   ).catch((err: Error) => {
        //     this.logger.error(`Failed to send email for ticket ${ticketId}`, err);
        //   });
        // }
      }

      this.logger.log(`Successfully added message to ticket ${ticketId}`);

      // Return the full ticket with all messages (frontend expects this)
      return this.findOne(ticketId, userId, userRole);
    } catch (error) {
      // Re-throw known exceptions
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error(`Error adding message to ticket ${ticketId}`, error instanceof Error ? error.stack : error);
      throw new InternalServerErrorException('Failed to add message');
    }
  }

  async updateStatus(ticketId: string, updateStatusDto: UpdateStatusDto): Promise<{ id: string; status: string; message: string }> {
    this.logger.log(`Updating status of ticket ${ticketId} to ${updateStatusDto.status}`);

    try {
      // First check if ticket exists
      const existingTicket = await this.prisma.ticket.findUnique({
        where: { id: ticketId },
        select: { id: true },
      });

      if (!existingTicket) {
        this.logger.warn(`Ticket ${ticketId} not found when updating status`);
        throw new NotFoundException('Ticket not found');
      }

      const ticket = await this.prisma.ticket.update({
        where: { id: ticketId },
        data: { status: updateStatusDto.status },
        select: { id: true, status: true },
      });

      this.logger.log(`Successfully updated ticket ${ticketId} status to ${ticket.status}`);

      return {
        id: ticket.id,
        status: ticket.status,
        message: 'Ticket status updated successfully',
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error updating ticket ${ticketId} status`, error instanceof Error ? error.stack : error);
      throw new InternalServerErrorException('Failed to update ticket status');
    }
  }

  /**
   * Soft-delete a ticket (user can delete own, admin can delete any)
   */
  async deleteTicket(ticketId: string, userId: string, userRole: string): Promise<{ message: string }> {
    this.logger.log(`Deleting ticket ${ticketId} by user ${userId}`);

    try {
      const ticket = await this.prisma.ticket.findUnique({
        where: { id: ticketId, deletedAt: null },
        select: { id: true, userId: true },
      });

      if (!ticket) {
        this.logger.warn(`Ticket ${ticketId} not found when deleting`);
        throw new NotFoundException('Ticket not found');
      }

      // Check access: user can only delete their own tickets, admin can delete any
      if (userRole !== 'admin' && ticket.userId !== userId) {
        this.logger.warn(`User ${userId} denied access to delete ticket ${ticketId}`);
        throw new ForbiddenException('Access denied');
      }

      // Soft-delete the ticket
      await this.prisma.ticket.update({
        where: { id: ticketId },
        data: { deletedAt: new Date() },
      });

      this.logger.log(`Ticket ${ticketId} soft-deleted by user ${userId}`);

      return { message: 'Ticket deleted successfully' };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error(`Error deleting ticket ${ticketId}`, error instanceof Error ? error.stack : error);
      throw new InternalServerErrorException('Failed to delete ticket');
    }
  }

  /**
   * Soft-delete a specific message (admin only)
   */
  async deleteMessage(ticketId: string, messageId: string, userId: string, userRole: string): Promise<{ message: string }> {
    this.logger.log(`Deleting message ${messageId} from ticket ${ticketId} by user ${userId}`);

    try {
      // Only admin can delete messages
      if (userRole !== 'admin') {
        this.logger.warn(`User ${userId} denied access to delete message (not admin)`);
        throw new ForbiddenException('Only admins can delete messages');
      }

      const message = await this.prisma.ticketMessage.findUnique({
        where: { id: messageId, deletedAt: null },
        select: { id: true, ticketId: true },
      });

      if (!message) {
        this.logger.warn(`Message ${messageId} not found when deleting`);
        throw new NotFoundException('Message not found');
      }

      if (message.ticketId !== ticketId) {
        this.logger.warn(`Message ${messageId} does not belong to ticket ${ticketId}`);
        throw new NotFoundException('Message not found in this ticket');
      }

      // Soft-delete the message
      await this.prisma.ticketMessage.update({
        where: { id: messageId },
        data: { deletedAt: new Date() },
      });

      this.logger.log(`Message ${messageId} soft-deleted by admin ${userId}`);

      return { message: 'Message deleted successfully' };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error(`Error deleting message ${messageId}`, error instanceof Error ? error.stack : error);
      throw new InternalServerErrorException('Failed to delete message');
    }
  }

  /**
   * Mark all messages in a ticket as read for the requesting user
   */
  async markMessagesAsRead(ticketId: string, userId: string, userRole: string): Promise<{ markedCount: number }> {
    this.logger.log(`Marking messages as read in ticket ${ticketId} for user ${userId}`);

    try {
      const ticket = await this.prisma.ticket.findUnique({
        where: { id: ticketId, deletedAt: null },
        select: { id: true, userId: true },
      });

      if (!ticket) {
        this.logger.warn(`Ticket ${ticketId} not found when marking messages as read`);
        throw new NotFoundException('Ticket not found');
      }

      // Check access
      if (userRole !== 'admin' && ticket.userId !== userId) {
        this.logger.warn(`User ${userId} denied access to mark messages as read in ticket ${ticketId}`);
        throw new ForbiddenException('Access denied');
      }

      // Mark messages as read based on who is reading:
      // - Client reads admin messages (messages not sent by client)
      // - Admin reads client messages (messages sent by the ticket owner)
      const whereClause: Prisma.TicketMessageWhereInput = {
        ticketId,
        isRead: false,
        deletedAt: null,
      };

      if (userRole === 'admin') {
        // Admin is reading - mark client messages as read
        whereClause.senderId = ticket.userId;
      } else {
        // Client is reading - mark admin messages as read (messages not from client)
        whereClause.NOT = { senderId: userId };
      }

      const result = await this.prisma.ticketMessage.updateMany({
        where: whereClause,
        data: { isRead: true },
      });

      // Reset unread count on ticket
      await this.prisma.ticket.update({
        where: { id: ticketId },
        data: { unreadCount: 0 },
      });

      this.logger.debug(`Marked ${result.count} messages as read in ticket ${ticketId}`);

      return { markedCount: result.count };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error(`Error marking messages as read in ticket ${ticketId}`, error instanceof Error ? error.stack : error);
      throw new InternalServerErrorException('Failed to mark messages as read');
    }
  }
}
