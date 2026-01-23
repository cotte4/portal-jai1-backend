import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { PrismaService } from '../../config/prisma.service';

@Module({
  imports: [
    // Import JwtModule for WebSocket authentication
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsGateway, PrismaService],
  exports: [NotificationsService, NotificationsGateway],
})
export class NotificationsModule {
  constructor(
    private notificationsService: NotificationsService,
    private notificationsGateway: NotificationsGateway,
  ) {
    // Set gateway reference in service to avoid circular dependency
    this.notificationsService.setGateway(this.notificationsGateway);
  }
}
