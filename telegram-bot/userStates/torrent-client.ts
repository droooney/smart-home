import { TelegramUserState } from '@prisma/client';
import torrentClient from 'torrent-client/client';

import { tryLoadDocument } from 'telegram-bot/utilities/documents';
import ImmediateTextResponse from 'telegram-bot/utilities/response/ImmediateTextResponse';
import CustomError, { ErrorCode } from 'utilities/CustomError';
import { formatSpeed, parseSize } from 'utilities/size';

import bot from 'telegram-bot/bot';
import { getAddTorrentResponse, getSearchRutrackerResponse } from 'telegram-bot/responses/torrent-client';

bot.handleUserState(TelegramUserState.SearchRutracker, async (ctx) => {
  await ctx.updateUserState({
    state: TelegramUserState.Waiting,
  });

  return getSearchRutrackerResponse(ctx.message.text ?? '');
});

bot.handleUserState(TelegramUserState.AddTorrent, async (ctx) => {
  const { text } = ctx.message;

  await ctx.updateUserState({
    state: TelegramUserState.Waiting,
  });

  return getAddTorrentResponse(async () => {
    let torrent = await tryLoadDocument(ctx);

    if (!torrent && text) {
      torrent = await torrentClient.addTorrent({
        type: 'magnet',
        magnet: text,
      });
    }

    return torrent;
  });
});

bot.handleUserState(TelegramUserState.SetDownloadLimit, async (ctx) => {
  const { text } = ctx.message;

  const downloadLimit = text === '-' ? '-' : parseSize(text ?? '');

  if (downloadLimit === null) {
    throw new CustomError(ErrorCode.WRONG_FORMAT, 'Ошибка формата данных');
  }

  await ctx.updateUserState({
    state: TelegramUserState.Waiting,
  });

  await torrentClient.setDownloadSpeedLimit(downloadLimit === '-' ? null : downloadLimit);

  return new ImmediateTextResponse({
    text:
      downloadLimit === '-'
        ? 'Ограничение загрузки снято'
        : `Выставлено ограничение загрузки ${formatSpeed(downloadLimit)}`,
  });
});

bot.handleUserState(TelegramUserState.SetUploadLimit, async (ctx) => {
  const { text } = ctx.message;

  const uploadLimit = text === '-' ? '-' : parseSize(text ?? '');

  if (uploadLimit === null) {
    throw new CustomError(ErrorCode.WRONG_FORMAT, 'Ошибка формата данных');
  }

  await ctx.updateUserState({
    state: TelegramUserState.Waiting,
  });

  await torrentClient.setUploadSpeedLimit(uploadLimit === '-' ? null : uploadLimit);

  return new ImmediateTextResponse({
    text:
      uploadLimit === '-' ? 'Ограничение отдачи снято' : `Выставлено ограничение отдачи ${formatSpeed(uploadLimit)}`,
  });
});
