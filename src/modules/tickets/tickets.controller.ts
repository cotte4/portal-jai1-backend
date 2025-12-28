import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { Roles, CurrentUser } from '../../common/decorators';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateStatusDto } from './dto/update-status.dto';

@Controller('tickets')
@UseGuards(JwtAuthGuard)
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Post()
  async create(@CurrentUser() user: any, @Body() createTicketDto: CreateTicketDto) {
    return this.ticketsService.create(user.id, createTicketDto);
  }

  @Get()
  async findAll(
    @CurrentUser() user: any,
    @Query('status') status?: string,
    @Query('user_id') userId?: string,
  ) {
    // Admin can see all tickets, client can only see their own
    if (user.role === 'admin') {
      return this.ticketsService.findAll({ status, userId });
    }
    return this.ticketsService.findAll({ status, userId: user.id });
  }

  @Get(':id')
  async findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.ticketsService.findOne(id, user.id, user.role);
  }

  @Post(':id/messages')
  async addMessage(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() createMessageDto: CreateMessageDto,
  ) {
    return this.ticketsService.addMessage(id, user.id, user.role, createMessageDto);
  }

  @Patch(':id/status')
  @UseGuards(RolesGuard)
  @Roles('admin' as any)
  async updateStatus(
    @Param('id') id: string,
    @Body() updateStatusDto: UpdateStatusDto,
  ) {
    return this.ticketsService.updateStatus(id, updateStatusDto);
  }
}
