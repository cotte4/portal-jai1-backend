import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { EmailService } from '../../common/services';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateStatusDto } from './dto/update-status.dto';

@Injectable()
export class TicketsService {
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private notificationsService: NotificationsService,
  ) {}

  async create(userId: string, createTicketDto: CreateTicketDto) {
    // Create ticket
    const ticket = await this.prisma.ticket.create({
      data: {
        userId,
        subject: createTicketDto.subject,
      },
    });

    // If message is provided, create initial message
    let messages: any[] = [];
    if (createTicketDto.message) {
      const initialMessage = await this.prisma.ticketMessage.create({
        data: {
          ticketId: ticket.id,
          senderId: userId,
          message: createTicketDto.message,
        },
      });
      messages = [
        {
          id: initialMessage.id,
          message: initialMessage.message,
          senderId: userId,
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
  }

  async findAll(options: { status?: string; userId?: string }) {
    try {
      const where: any = {};

      if (options.status) {
        where.status = options.status;
      }

      if (options.userId) {
        where.userId = options.userId;
      }

      const tickets = await this.prisma.ticket.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
          _count: {
            select: { messages: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
      });

      return tickets.map((ticket) => ({
        id: ticket.id,
        subject: ticket.subject,
        status: ticket.status,
        user: ticket.user ? {
          id: ticket.user.id,
          email: ticket.user.email,
          firstName: ticket.user.firstName,
          lastName: ticket.user.lastName,
        } : null,
        messageCount: ticket._count.messages,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
      }));
    } catch (error) {
      console.error('Error in findAll tickets:', error);
      throw error;
    }
  }

  async findOne(ticketId: string, userId: string, userRole: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        messages: {
          include: {
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
      throw new NotFoundException('Ticket not found');
    }

    // Check access
    if (userRole !== 'admin' && ticket.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return {
      id: ticket.id,
      userId: ticket.userId,
      subject: ticket.subject,
      status: ticket.status,
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
        sender: {
          id: msg.sender.id,
          firstName: msg.sender.firstName,
          lastName: msg.sender.lastName,
          role: msg.sender.role,
        },
        createdAt: msg.createdAt,
      })),
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
    };
  }

  async addMessage(
    ticketId: string,
    userId: string,
    userRole: string,
    createMessageDto: CreateMessageDto,
  ) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
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
      throw new NotFoundException('Ticket not found');
    }

    // Check access
    if (userRole !== 'admin' && ticket.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    const message = await this.prisma.ticketMessage.create({
      data: {
        ticketId,
        senderId: userId,
        message: createMessageDto.message,
      },
      include: {
        sender: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
    });

    // Update ticket's updatedAt
    await this.prisma.ticket.update({
      where: { id: ticketId },
      data: { updatedAt: new Date() },
    });

    // Send email and notification if admin is replying to a client's ticket
    if (userRole === 'admin' && ticket.user.role === 'client') {
      // Create in-app notification
      await this.notificationsService.create(
        ticket.userId,
        'message',
        'Respuesta a tu ticket',
        `Nuevo mensaje en: ${ticket.subject}`,
      );

      // Send email notification (don't await to avoid blocking)
      this.emailService.sendTicketResponseEmail(
        ticket.user.email,
        ticket.user.firstName,
        ticket.subject,
        createMessageDto.message,
      );
    }

    // Return the full ticket with all messages (frontend expects this)
    return this.findOne(ticketId, userId, userRole);
  }

  async updateStatus(ticketId: string, updateStatusDto: UpdateStatusDto) {
    const ticket = await this.prisma.ticket.update({
      where: { id: ticketId },
      data: { status: updateStatusDto.status },
    });

    return {
      id: ticket.id,
      status: ticket.status,
      message: 'Ticket status updated successfully',
    };
  }
}
