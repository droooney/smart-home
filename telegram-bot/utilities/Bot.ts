import { Prisma, TelegramUserData, TelegramUserState } from '@prisma/client';
import TelegramBotApi, { Message, User } from 'node-telegram-bot-api';

import { DOWNLOADS_DIRECTORY } from 'constants/paths';
import commands, { CommandType } from 'telegram-bot/constants/commands';

import prisma from 'db/prisma';

import {
  BeautifiedCallbackData,
  BeautifiedCallbackDataBySource,
  CallbackButtonSource,
  allInlineKeyboardButtonSources,
  callbackDataSchema,
} from 'telegram-bot/types/keyboard';
import { MaybePromise } from 'types/common';

import { beautifyCallbackData } from 'telegram-bot/utilities/keyboard';
import { CallbackQueryResponse, MessageResponse } from 'telegram-bot/utilities/response/Response';
import TextResponse from 'telegram-bot/utilities/response/TextResponse';
import { getErrorResponse } from 'telegram-bot/utilities/response/common';
import CustomError, { ErrorCode } from 'utilities/CustomError';
import { prepareErrorForHuman, prepareErrorForLogging } from 'utilities/error';

export interface BotOptions {
  token: string;
  usernameWhitelist: string[];
}

export interface TextHandlerContext {
  message: Message;
  userData: TelegramUserData;
  downloadDocument(): Promise<string | null>;
  updateUserState(
    data: Prisma.XOR<Prisma.TelegramUserDataUpdateInput, Prisma.TelegramUserDataUncheckedUpdateInput>,
  ): Promise<TelegramUserData>;
}

export interface CallbackQueryHandlerContext<CallbackData extends BeautifiedCallbackData> {
  data: CallbackData;
  message: Message;
  userData: TelegramUserData;
  updateUserState(
    data: Prisma.XOR<Prisma.TelegramUserDataUpdateInput, Prisma.TelegramUserDataUncheckedUpdateInput>,
  ): Promise<TelegramUserData>;
}

export type TextHandler = (ctx: TextHandlerContext) => MaybePromise<MessageResponse | null | undefined | void>;

export type CallbackQueryHandler<CallbackData extends BeautifiedCallbackData> = (
  ctx: CallbackQueryHandlerContext<CallbackData>,
) => MaybePromise<CallbackQueryResponse | null | undefined | void>;

class Bot {
  private readonly api: TelegramBotApi;
  private readonly usernameWhitelist: (string | undefined)[];
  private readonly commandHandlers: Partial<Record<CommandType, TextHandler>> = {};
  private readonly userStateHandlers: Partial<Record<TelegramUserState, TextHandler>> = {};
  private readonly callbackDataHandlers: {
    [Source in CallbackButtonSource]?: CallbackQueryHandler<BeautifiedCallbackDataBySource<Source>>;
  } = {};

  constructor(options: BotOptions) {
    this.api = new TelegramBotApi(options.token, {
      polling: {
        autoStart: false,
      },
    });
    this.usernameWhitelist = options.usernameWhitelist;

    this.api.on('polling_error', (err) => {
      console.log(prepareErrorForLogging(err));
    });
  }

  // TODO: research text limit
  async answerCallbackQuery(queryId: string, text: string): Promise<void> {
    await this.api.answerCallbackQuery(queryId, {
      text,
    });
  }

  async editMessage(message: Message, response: TextResponse): Promise<Message> {
    return response.editMessage({
      message,
      api: this.api,
    });
  }

  getUnhandledCallbackButtonSources(): CallbackButtonSource[] {
    return allInlineKeyboardButtonSources.filter((source) => !(source in this.callbackDataHandlers));
  }

  getUnhandledCommands(): CommandType[] {
    return Object.values(CommandType).filter((command) => !(command in this.commandHandlers));
  }

  getUnhandledUserStates(): TelegramUserState[] {
    return Object.values(TelegramUserState).filter((command) => !(command in this.userStateHandlers));
  }

  handleCallbackQuery<Source extends CallbackButtonSource>(
    source: Source | Source[],
    handler: CallbackQueryHandler<BeautifiedCallbackDataBySource<Source>>,
  ): void {
    ([] as Source[]).concat(source).forEach((source) => {
      // @ts-ignore
      this.callbackDataHandlers[source] = handler;
    });
  }

  handleCommand(command: CommandType, handler: TextHandler): void {
    this.commandHandlers[command] = handler;
  }

  handleUserState(state: TelegramUserState, handler: TextHandler): void {
    this.userStateHandlers[state] = handler;
  }

  isUserAllowed(user: User): boolean {
    return this.usernameWhitelist.includes(user.username);
  }

  async sendMessage(chatId: number, response: TextResponse, replyToMessageId?: number): Promise<Message> {
    return response.sendMessage({
      chatId,
      replyToMessageId,
      api: this.api,
    });
  }

  async start(): Promise<void> {
    this.api.on('message', async (message) => {
      try {
        const { from: user, text, document } = message;

        if (!user || !this.isUserAllowed(user)) {
          return;
        }

        const telegramUserId = user.id;

        const userData = await prisma.telegramUserData.upsert({
          where: {
            telegramUserId,
          },
          update: {},
          create: {
            telegramUserId,
            state: 'First',
          },
        });

        const ctx: TextHandlerContext = {
          message,
          userData,
          downloadDocument: async () => {
            if (!document) {
              return null;
            }

            return this.api.downloadFile(document.file_id, DOWNLOADS_DIRECTORY);
          },
          updateUserState: async (data) => {
            return prisma.telegramUserData.update({
              where: {
                telegramUserId,
              },
              data,
            });
          },
        };

        let handler: TextHandler | undefined;

        if (text && text in this.commandHandlers) {
          handler = this.commandHandlers[text as CommandType];
        }

        if (!handler) {
          handler = this.userStateHandlers[userData.state];
        }

        if (!handler) {
          return;
        }

        const response = await handler(ctx);

        if (response) {
          await response.respondToMessage({
            message,
            bot: this,
            api: this.api,
          });
        }
      } catch (err) {
        console.log(prepareErrorForLogging(err));

        try {
          await this.sendMessage(message.chat.id, getErrorResponse(err), message.message_id);
        } catch (err) {
          console.log(prepareErrorForLogging(err));
        }
      }
    });

    this.api.on('callback_query', async (query) => {
      try {
        const { from: user, message, data } = query;

        if (!user || !message || !this.isUserAllowed(user)) {
          return;
        }

        const telegramUserId = user.id;

        if (!data) {
          return;
        }

        const callbackData = JSON.parse(data);

        const userData = await prisma.telegramUserData.findUnique({
          where: {
            telegramUserId,
          },
        });

        if (!userData) {
          return;
        }

        const parsed = callbackDataSchema.safeParse(callbackData);

        if (!parsed.success) {
          throw new CustomError(ErrorCode.UNSUPPORTED, 'Не поддерживается');
        }

        const beautifiedCallbackData = beautifyCallbackData(parsed.data);

        const ctx: CallbackQueryHandlerContext<typeof beautifiedCallbackData> = {
          data: beautifiedCallbackData,
          message,
          userData,
          updateUserState: async (data) => {
            return prisma.telegramUserData.update({
              where: {
                telegramUserId,
              },
              data,
            });
          },
        };

        const handler = this.callbackDataHandlers[beautifiedCallbackData.source] as
          | CallbackQueryHandler<typeof beautifiedCallbackData>
          | undefined;

        if (!handler) {
          throw new CustomError(ErrorCode.UNSUPPORTED, 'Не поддерживается');
        }

        const response = await handler(ctx);

        if (response) {
          await response.respondToCallbackQuery({
            query,
            bot: this,
            api: this.api,
          });
        }
      } catch (err) {
        console.log(prepareErrorForLogging(err));

        try {
          await this.answerCallbackQuery(query.id, prepareErrorForHuman(err));
        } catch (err) {
          console.log(prepareErrorForLogging(err));
        }
      }
    });

    await this.api.setMyCommands(commands);

    await this.api.startPolling();
  }
}

export default Bot;
