import {
    Controller,
    Get,
    Patch,
    Param,
    Query,
    Body,
    UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
    constructor(private readonly chatService: ChatService) { }

    @Get('conversations')
    @ApiOperation({ summary: 'Get all conversations' })
    async getConversations(
        @CurrentUser('sub') userId: string,
        @Query() pagination: PaginationDto,
    ) {
        return this.chatService.getConversations(userId, pagination);
    }

    @Get('conversations/:conversationId/messages')
    @ApiOperation({ summary: 'Get messages for a conversation' })
    async getMessages(
        @CurrentUser('sub') userId: string,
        @Param('conversationId') conversationId: string,
        @Query() pagination: PaginationDto,
    ) {
        return this.chatService.getMessages(userId, conversationId, pagination);
    }

    @Patch('conversations/:conversationId/read')
    @ApiOperation({ summary: 'Mark all messages as read in a conversation' })
    async markAsRead(
        @CurrentUser('sub') userId: string,
        @Param('conversationId') conversationId: string,
    ) {
        await this.chatService.markAsRead(userId, conversationId);
        return { message: 'Messages marked as read' };
    }

    @Patch('conversations/:conversationId/delivered')
    @ApiOperation({ summary: 'Mark messages as delivered in a conversation' })
    async markAsDelivered(
        @CurrentUser('sub') userId: string,
        @Param('conversationId') conversationId: string,
    ) {
        await this.chatService.markAsDelivered(userId, conversationId);
        return { message: 'Messages marked as delivered' };
    }

    @Patch('conversations/:conversationId/mute')
    @ApiOperation({ summary: 'Mute or unmute a conversation' })
    async muteConversation(
        @CurrentUser('sub') userId: string,
        @Param('conversationId') conversationId: string,
        @Body('muted') muted: boolean,
    ) {
        await this.chatService.muteConversation(userId, conversationId, muted);
        return { message: muted ? 'Conversation muted' : 'Conversation unmuted' };
    }

    @Get('unread')
    @ApiOperation({ summary: 'Get total unread message count across all conversations' })
    async getUnreadCount(@CurrentUser('sub') userId: string) {
        const count = await this.chatService.getTotalUnreadCount(userId);
        return { unreadCount: count };
    }
}
