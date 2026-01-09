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
import { TicketsService } from './tickets.service';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { Roles, CurrentUser } from '../../common/decorators';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateStatusDto } from './dto/update-status.dto';

// Type for authenticated user from JWT
interface AuthenticatedUser {
  id: string;
  email: string;
  role: 'admin' | 'client';
}

@Controller('tickets')
@UseGuards(JwtAuthGuard)
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() createTicketDto: CreateTicketDto,
  ) {
    return this.ticketsService.create(user.id, createTicketDto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('user_id') userId?: string,
  ) {
    // Validate status if provided
    if (status && !['open', 'in_progress', 'closed'].includes(status)) {
      throw new BadRequestException('Invalid status. Must be one of: open, in_progress, closed');
    }

    // Admin can see all tickets, client can only see their own
    if (user.role === 'admin') {
      return this.ticketsService.findAll({ status, userId });
    }
    return this.ticketsService.findAll({ status, userId: user.id });
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST })) id: string,
  ) {
    return this.ticketsService.findOne(id, user.id, user.role);
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.CREATED)
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
  @Roles('admin' as const)
  async updateStatus(
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST })) id: string,
    @Body() updateStatusDto: UpdateStatusDto,
  ) {
    return this.ticketsService.updateStatus(id, updateStatusDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteTicket(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST })) id: string,
  ) {
    return this.ticketsService.deleteTicket(id, user.id, user.role);
  }

  @Delete(':id/messages/:messageId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles('admin' as const)
  async deleteMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST })) id: string,
    @Param('messageId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST })) messageId: string,
  ) {
    return this.ticketsService.deleteMessage(id, messageId, user.id, user.role);
  }

  @Patch(':id/messages/read')
  @HttpCode(HttpStatus.OK)
  async markMessagesAsRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST })) id: string,
  ) {
    return this.ticketsService.markMessagesAsRead(id, user.id, user.role);
  }
}
