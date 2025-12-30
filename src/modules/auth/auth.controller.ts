import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto) {
    // #region agent log
    require('fs').appendFileSync('c:\\Users\\fran-\\OneDrive\\Escritorio\\portal-jai1\\.cursor\\debug.log', JSON.stringify({location:'auth.controller.ts:29',message:'login endpoint called',data:{email:loginDto.email,hasPassword:!!loginDto.password},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})+'\n');
    // #endregion
    try {
      const result = await this.authService.login(loginDto);
      // #region agent log
      require('fs').appendFileSync('c:\\Users\\fran-\\OneDrive\\Escritorio\\portal-jai1\\.cursor\\debug.log', JSON.stringify({location:'auth.controller.ts:33',message:'login endpoint success',data:{hasUser:!!result.user,userRole:result.user?.role},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})+'\n');
      // #endregion
      return result;
    } catch (error) {
      // #region agent log
      require('fs').appendFileSync('c:\\Users\\fran-\\OneDrive\\Escritorio\\portal-jai1\\.cursor\\debug.log', JSON.stringify({location:'auth.controller.ts:37',message:'login endpoint error',data:{errorType:error.constructor.name,errorMessage:error.message,statusCode:error.status},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})+'\n');
      // #endregion
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async logout(@CurrentUser() user: any) {
    return this.authService.logout(user.id);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refreshTokens(refreshTokenDto.refresh_token);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(
      resetPasswordDto.token,
      resetPasswordDto.new_password,
    );
  }
}
