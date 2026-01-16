import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { UsersModule } from '../users/users.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmailService } from '../../common/services';
import { SupabaseService } from '../../config/supabase.service';
import { getAuthConfig } from '../../config/auth.config';

@Module({
  imports: [
    UsersModule,
    ReferralsModule,
    NotificationsModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const authConfig = getAuthConfig(configService);
        return {
          secret: authConfig.jwtSecret,
          signOptions: {
            expiresIn: authConfig.accessTokenExpirySeconds,
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, GoogleStrategy, EmailService, SupabaseService],
  exports: [AuthService],
})
export class AuthModule {}
