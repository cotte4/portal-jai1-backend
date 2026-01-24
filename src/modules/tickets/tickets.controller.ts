import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { TicketsService } from './tickets.service';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { Roles, CurrentUser } from '../../common/decorators';
import { PAGINATION_LIMITS, validateLimit } from '../../common/constants';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import {
  TicketsPaginatedResponseDto,
  TicketDetailDto,
  CreateTicketResponseDto,
  UpdateTicketStatusResponseDto,
} from './dto/ticket-response.dto';

// Type for authenticated user from JWT
interface AuthenticatedUser {
  id: string;
  email: string;
  role: 'admin' | 'client';
}

@ApiTags('tickets')
@ApiBearerAuth()
@Controller('tickets')
@UseGuards(JwtAuthGuard)
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new support ticket' })
  @ApiResponse({ status: 201, description: 'Ticket created', type: CreateTicketResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() createTicketDto: CreateTicketDto,
  ) {
    return this.ticketsService.create(user.id, createTicketDto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List tickets (paginated)' })
  @ApiQuery({ name: 'status', required: false, enum: ['open', 'in_progress', 'closed'] })
  @ApiQuery({ name: 'user_id', required: false, description: 'Filter by user ID (admin only)' })
  @ApiQuery({ name: 'cursor', required: false, description: 'Pagination cursor' })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page' })
  @ApiResponse({ status: 200, description: 'List of tickets', type: TicketsPaginatedResponseDto })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('user_id') userId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitStr?: string,
  ) {
    // Validate status if provided
    if (status && !['open', 'in_progress', 'closed'].includes(status)) {
      throw new BadRequestException('Invalid status. Must be one of: open, in_progress, closed');
    }

    const limit = validateLimit(limitStr, PAGINATION_LIMITS.TICKETS);

    // Admin can see all tickets, client can only see their own
    if (user.role === 'admin') {
      return this.ticketsService.findAll({ status, userId, cursor, limit });
    }
    return this.ticketsService.findAll({ status, userId: user.id, cursor, limit });
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get ticket details with messages' })
  @ApiResponse({ status: 200, description: 'Ticket details', type: TicketDetailDto })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST })) id: string,
  ) {
    return this.ticketsService.findOne(id, user.id, user.role);
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add message to ticket' })
  @ApiResponse({ status: 201, description: 'Message added' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async addMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST })) id: string,
    @Body() createMessageDto: CreateMessageDto,
  ) {
    return this.ticketsService.addMessage(id, user.id, user.role, createMessageDto);
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  @ApiOperation({ summary: 'Update ticket status (admin only)' })
  @ApiResponse({ status: 200, description: 'Status updated', type: UpdateTicketStatusResponseDto })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async updateStatus(
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST })) id: string,
    @Body() updateStatusDto: UpdateStatusDto,
  ) {
    return this.ticketsService.updateStatus(id, updateStatusDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete ticket' })
  @ApiResponse({ status: 200, description: 'Ticket deleted' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async deleteTicket(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST })) id: string,
  ) {
    return this.ticketsService.deleteTicket(id, user.id, user.role);
  }

  @Delete(':id/messages/:messageId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  @ApiOperation({ summary: 'Delete message (admin only)' })
  @ApiResponse({ status: 200, description: 'Message deleted' })
  @ApiResponse({ status: 404, description: 'Message not found' })
  async deleteMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST })) id: string,
    @Param('messageId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST })) messageId: string,
  ) {
    return this.ticketsService.deleteMessage(id, messageId, user.id, user.role);
  }

  @Patch(':id/messages/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark messages as read' })
  @ApiResponse({ status: 200, description: 'Messages marked as read' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async markMessagesAsRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST })) id: string,
  ) {
    return this.ticketsService.markMessagesAsRead(id, user.id, user.role);
  }
}
