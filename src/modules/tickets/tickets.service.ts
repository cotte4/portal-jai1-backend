import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateStatusDto } from './dto/update-status.dto';

@Injectable()
export class TicketsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, createTicketDto: CreateTicketDto) {
    const ticket = await this.prisma.ticket.create({
      data: {
        userId,
        subject: createTicketDto.subject,
      },
    });

    return {
      ticket: {
        id: ticket.id,
        subject: ticket.subject,
        status: ticket.status,
        created_at: ticket.createdAt,
      },
    };
  }

  async findAll(options: { status?: string; userId?: string }) {
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
      user: {
        id: ticket.user.id,
        email: ticket.user.email,
        first_name: ticket.user.firstName,
        last_name: ticket.user.lastName,
      },
      message_count: ticket._count.messages,
      created_at: ticket.createdAt,
      updated_at: ticket.updatedAt,
    }));
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
      subject: ticket.subject,
      status: ticket.status,
      user: {
        id: ticket.user.id,
        email: ticket.user.email,
        first_name: ticket.user.firstName,
        last_name: ticket.user.lastName,
      },
      messages: ticket.messages.map((msg) => ({
        id: msg.id,
        message: msg.message,
        sender: {
          id: msg.sender.id,
          first_name: msg.sender.firstName,
          last_name: msg.sender.lastName,
          role: msg.sender.role,
        },
        created_at: msg.createdAt,
      })),
      created_at: ticket.createdAt,
      updated_at: ticket.updatedAt,
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

    return {
      id: message.id,
      message: message.message,
      sender: {
        id: message.sender.id,
        first_name: message.sender.firstName,
        last_name: message.sender.lastName,
        role: message.sender.role,
      },
      created_at: message.createdAt,
    };
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
