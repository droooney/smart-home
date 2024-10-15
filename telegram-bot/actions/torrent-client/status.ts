import { TorrentState } from '@prisma/client';
import { Markdown } from '@tg-sensei/bot';
import torrentClient from 'torrent-client/client';

import prisma from 'db/prisma';

import { MessageAction } from 'telegram-bot/types/actions';
import { RootCallbackButtonType } from 'telegram-bot/types/keyboard/root';
import { TorrentClientCallbackButtonType } from 'telegram-bot/types/keyboard/torrent-client';

import MessageWithNotificationAction from 'telegram-bot/utilities/actions/MessageWithNotificationAction';
import RefreshDataAction from 'telegram-bot/utilities/actions/RefreshDataAction';
import { formatTorrents } from 'telegram-bot/utilities/actions/torrent-client';
import {
  addCallbackButton,
  backCallbackButton,
  callbackButton,
  listCallbackButton,
  refreshCallbackButton,
} from 'telegram-bot/utilities/keyboard';
import { formatSize, formatSpeed } from 'utilities/size';

import { callbackDataProvider } from 'telegram-bot/bot';

callbackDataProvider.handle(TorrentClientCallbackButtonType.OpenStatus, async ({ data }) => {
  const action = await getStatusAction();

  return data.isRefresh ? new RefreshDataAction(action) : action;
});

callbackDataProvider.handle(TorrentClientCallbackButtonType.PauseClient, async ({ data }) => {
  const { pause } = data;

  if (pause) {
    await torrentClient.pause();
  } else {
    await torrentClient.unpause();
  }

  return new MessageWithNotificationAction({
    text: pause ? 'Клиент поставлен на паузу' : 'Клиент снят с паузы',
    updateAction: await getStatusAction(),
  });
});

// TODO: add keyboard (settings, set limits)
async function getStatusAction(): Promise<MessageAction> {
  const [clientState, downloadSpeed, uploadSpeed, notFinishedTorrents, { _sum: allTorrentsSum }] = await Promise.all([
    torrentClient.getState(),
    torrentClient.getDownloadSpeed(),
    torrentClient.getUploadSpeed(),
    prisma.torrent.findMany({
      where: {
        state: {
          in: [TorrentState.Verifying, TorrentState.Downloading],
        },
      },
    }),
    prisma.torrent.aggregate({
      _sum: {
        size: true,
      },
    }),
  ]);

  const allTorrentsSize = allTorrentsSum.size ?? 0n;

  const status = new Markdown();

  if (clientState.paused) {
    status.add`🟠 ${Markdown.italic('Клиент стоит на паузе')}

`;
  }

  status.add`${Markdown.bold('⚡️ Скорость загрузки')}: ${formatSpeed(downloadSpeed)}${
    clientState.downloadSpeedLimit !== null &&
    Markdown.create` (ограничение: ${formatSpeed(clientState.downloadSpeedLimit)})`
  }
${Markdown.bold('⚡️ Скорость отдачи')}: ${formatSpeed(uploadSpeed)}${
    clientState.uploadSpeedLimit !== null &&
    Markdown.create` (ограничение: ${formatSpeed(clientState.uploadSpeedLimit)})`
  }
${Markdown.bold('💾 Размер всех торрентов')}: ${formatSize(allTorrentsSize)}

`;

  const notFinishedTorrentsText = await formatTorrents(notFinishedTorrents);

  status.add`${
    notFinishedTorrentsText.isEmpty() ? Markdown.italic('Нет активных торрентов') : notFinishedTorrentsText
  }`;

  return new MessageAction({
    content: {
      type: 'text',
      text: status,
    },
    replyMarkup: [
      [
        refreshCallbackButton({
          type: TorrentClientCallbackButtonType.OpenStatus,
          isRefresh: true,
        }),
        clientState.paused
          ? callbackButton('▶️', 'Продолжить', {
              type: TorrentClientCallbackButtonType.PauseClient,
              pause: false,
            })
          : callbackButton('⏸', 'Пауза', {
              type: TorrentClientCallbackButtonType.PauseClient,
              pause: true,
            }),
      ],
      [
        addCallbackButton({
          type: TorrentClientCallbackButtonType.AddTorrent,
        }),
        listCallbackButton({
          type: TorrentClientCallbackButtonType.OpenTorrentsList,
        }),
      ],
      [
        callbackButton('🔎', 'Поиск по Rutracker', {
          type: TorrentClientCallbackButtonType.RutrackerSearch,
        }),
      ],
      [
        backCallbackButton({
          type: RootCallbackButtonType.OpenRoot,
        }),
      ],
    ],
  });
}
