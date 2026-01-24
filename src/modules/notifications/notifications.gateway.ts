import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

/**
 * WebSocket Gateway for real-time notifications
 *
 * Handles WebSocket connections and pushes notifications to connected clients
 * in real-time. Falls back to HTTP polling if WebSocket connection fails.
 */
@WebSocketGateway({
  namespace: 'notifications',
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:4200',
    credentials: true,
  },
  transports: ['websocket', 'polling'], // Prefer WebSocket, fallback to polling
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  /**
   * Map of userId -> Set of socket IDs
   * A user can have multiple active connections (multiple tabs/devices)
   */
  private userSockets = new Map<string, Set<string>>();

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  /**
   * Handle new client connections
   * Authenticate using JWT token from handshake
   */
  async handleConnection(@ConnectedSocket() client: Socket): Promise<void> {
    try {
      // Extract token from handshake auth
      const token = client.handshake.auth.token || client.handshake.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        this.logger.warn(`Connection rejected: No token provided (socket: ${client.id})`);
        client.disconnect();
        return;
      }

      // Verify JWT token
      const jwtSecret = this.configService.get<string>('JWT_SECRET');
      const payload = await this.jwtService.verifyAsync(token, { secret: jwtSecret });
      const userId = payload.sub;

      if (!userId) {
        this.logger.warn(`Connection rejected: Invalid token payload (socket: ${client.id})`);
        client.disconnect();
        return;
      }

      // Store socket connection for this user
      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      const userSocketSet = this.userSockets.get(userId)!;
      userSocketSet.add(client.id);

      // Store userId in socket data for easy access
      client.data.userId = userId;

      this.logger.log(`Client connected: ${client.id} (user: ${userId}, total connections: ${userSocketSet.size})`);

      // Send connection success event
      client.emit('connected', { userId, socketId: client.id });
    } catch (error) {
      this.logger.error(`Authentication failed for socket ${client.id}:`, error.message);
      client.emit('error', { message: 'Authentication failed' });
      client.disconnect();
    }
  }

  /**
   * Handle client disconnections
   * Clean up socket references
   */
  handleDisconnect(@ConnectedSocket() client: Socket): void {
    const userId = client.data.userId;

    if (userId && this.userSockets.has(userId)) {
      const userSocketSet = this.userSockets.get(userId)!;
      userSocketSet.delete(client.id);

      // Remove user entry if no more sockets
      if (userSocketSet.size === 0) {
        this.userSockets.delete(userId);
      }

      this.logger.log(`Client disconnected: ${client.id} (user: ${userId}, remaining connections: ${userSocketSet.size})`);
    } else {
      this.logger.log(`Client disconnected: ${client.id} (no user data)`);
    }
  }

  /**
   * Allow clients to manually ping the server to keep connection alive
   */
  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket): void {
    client.emit('pong', { timestamp: Date.now() });
  }

  /**
   * Emit a notification to a specific user
   * Sends to all connected sockets for that user (multi-device support)
   *
   * @param userId - Target user ID
   * @param notification - Notification data to send
   */
  emitNotificationToUser(userId: string, notification: any): void {
    const socketIds = this.userSockets.get(userId);

    if (!socketIds || socketIds.size === 0) {
      this.logger.debug(`No active connections for user ${userId}, notification will be delivered via polling`);
      return;
    }

    this.logger.log(`Emitting notification to user ${userId} (${socketIds.size} connections)`);

    // Send to all sockets for this user
    socketIds.forEach((socketId) => {
      this.server.to(socketId).emit('notification', notification);
    });
  }

  /**
   * Emit a notification to multiple users at once
   * More efficient than calling emitNotificationToUser multiple times
   *
   * @param userIds - Array of user IDs
   * @param notification - Notification data to send
   */
  emitNotificationToUsers(userIds: string[], notification: any): void {
    userIds.forEach((userId) => {
      this.emitNotificationToUser(userId, notification);
    });
  }

  /**
   * Broadcast a notification to all connected users
   * Use sparingly - only for system-wide announcements
   *
   * @param notification - Notification data to send
   */
  broadcastNotification(notification: any): void {
    this.logger.log(`Broadcasting notification to all connected users (${this.userSockets.size} users)`);
    this.server.emit('notification', notification);
  }

  /**
   * Get connection statistics (for monitoring/debugging)
   */
  getConnectionStats(): { totalUsers: number; totalConnections: number } {
    let totalConnections = 0;
    this.userSockets.forEach((socketSet) => {
      totalConnections += socketSet.size;
    });

    return {
      totalUsers: this.userSockets.size,
      totalConnections,
    };
  }

  /**
   * Check if a user is currently connected
   */
  isUserConnected(userId: string): boolean {
    const socketIds = this.userSockets.get(userId);
    return !!(socketIds && socketIds.size > 0);
  }

  /**
   * Emit a ticket message event to a specific user
   */
  emitTicketMessage(userId: string, ticketId: string, message: any): void {
    const socketIds = this.userSockets.get(userId);
    if (!socketIds || socketIds.size === 0) {
      this.logger.debug(`No active connections for user ${userId} for ticket message`);
      return;
    }
    this.logger.log(`Emitting ticket message to user ${userId} for ticket ${ticketId}`);
    socketIds.forEach((socketId) => {
      this.server.to(socketId).emit('ticket:message', { ticketId, message });
    });
  }

  /**
   * Emit ticket status change event
   */
  emitTicketStatusChange(userId: string, ticketId: string, newStatus: string): void {
    const socketIds = this.userSockets.get(userId);
    if (!socketIds || socketIds.size === 0) {
      this.logger.debug(`No active connections for user ${userId} for ticket status change`);
      return;
    }
    this.logger.log(`Emitting ticket status change to user ${userId} for ticket ${ticketId}: ${newStatus}`);
    socketIds.forEach((socketId) => {
      this.server.to(socketId).emit('ticket:status', { ticketId, status: newStatus });
    });
  }
}
