import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Jai1gentsController } from './jai1gents.controller';
import { Jai1gentsService } from './jai1gents.service';
import { PrismaService } from '../../config/prisma.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: '15m',
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [Jai1gentsController],
  providers: [Jai1gentsService, PrismaService],
  exports: [Jai1gentsService],
})
export class Jai1gentsModule {}
