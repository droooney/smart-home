import { TelegramUserState } from '@prisma/client';
import torrentClient from 'torrent-client/client';

import DeferredResponse from 'telegram-bot/utilities/DeferredResponse';
import Response from 'telegram-bot/utilities/Response';
import { isTorrentDocument, tryLoadDocument } from 'telegram-bot/utilities/documents';
import { getAddTorrentResponse, getSearchRutrackerResponse } from 'telegram-bot/utilities/responseUtils';
import CustomError from 'utilities/CustomError';
import { formatSpeed, parseSize } from 'utilities/size';

import bot from 'telegram-bot/bot';

bot.handleUserState(TelegramUserState.First, async (ctx) => {
  await ctx.updateUserState({
    state: TelegramUserState.Waiting,
  });

  return new Response({
    text: 'Привет! Я - ТоррентБот. Добавляйте торренты, чтобы поставить их на скачивание',
  });
});

bot.handleUserState(TelegramUserState.Waiting, async (ctx) => {
  const { text, document } = ctx.message;

  if (isTorrentDocument(document)) {
    return new DeferredResponse({
      immediate: new Response({
        text: 'Торрент добавляется...',
      }),
      deferred: (async () => {
        const torrent = await tryLoadDocument(ctx);

        if (torrent) {
          return getAddTorrentResponse(torrent);
        }
      })(),
    });
  }

  if (text) {
    return getSearchRutrackerResponse(text);
  }
});

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

  let torrent = await tryLoadDocument(ctx);

  if (!torrent && text) {
    torrent = await torrentClient.addTorrent({
      type: 'magnet',
      magnet: text,
    });
  }

  return getAddTorrentResponse(torrent);
});

bot.handleUserState(TelegramUserState.SetDownloadLimit, async (ctx) => {
  const { text } = ctx.message;

  const downloadLimit = text === '-' ? '-' : parseSize(text ?? '');

  if (downloadLimit === null) {
    throw new CustomError('Ошибка формата данных');
  }

  await ctx.updateUserState({
    state: 'Waiting',
  });

  await torrentClient.setDownloadSpeedLimit(downloadLimit === '-' ? null : downloadLimit);

  return new Response({
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
    throw new CustomError('Ошибка формата данных');
  }

  await ctx.updateUserState({
    state: 'Waiting',
  });

  await torrentClient.setUploadSpeedLimit(uploadLimit === '-' ? null : uploadLimit);

  return new Response({
    text:
      uploadLimit === '-' ? 'Ограничение отдачи снято' : `Выставлено ограничение отдачи ${formatSpeed(uploadLimit)}`,
  });
});
