import path from 'node:path';

import { Torrent, TorrentFile, TorrentState } from '@prisma/client';
import chunk from 'lodash/chunk';
import groupBy from 'lodash/groupBy';
import map from 'lodash/map';
import sortBy from 'lodash/sortBy';
import torrentClient from 'torrent-client/client';
import { Torrent as ClientTorrent } from 'webtorrent';

import prisma from 'db/prisma';

import { CallbackButtonSource } from 'telegram-bot/types/keyboard';

import DeferredResponse from 'telegram-bot/utilities/DeferredResponse';
import Markdown from 'telegram-bot/utilities/Markdown';
import Response from 'telegram-bot/utilities/Response';
import rutrackerClient from 'telegram-bot/utilities/RutrackerClient';
import TorrentClient from 'torrent-client/utilities/TorrentClient';
import CustomError, { ErrorCode } from 'utilities/CustomError';
import { formatIndex, formatPercent, formatProgress, minmax } from 'utilities/number';
import { formatSize, formatSpeed } from 'utilities/size';

const STATUS_STATE_SORTING: { [State in TorrentState]: number } = {
  Downloading: 0,
  Verifying: 1,
  Queued: 2,
  Paused: 3,
  Error: 4,
  Finished: 5,
};

const STATE_TITLE: { [State in TorrentState]: string } = {
  Downloading: '🟢 Скачивается',
  Verifying: '🟡 Проверяется',
  Queued: '🔵 В очереди',
  Paused: '🟠 На паузе',
  Error: '🔴 Ошибка',
  Finished: '⚪️ Завершен',
};

const LIST_PAGE_SIZE = 5;

export async function getAddTorrentResponse(getTorrent: () => Promise<Torrent | null>): Promise<DeferredResponse> {
  return new DeferredResponse({
    immediate: new Response({
      text: 'Торрент добавляется...',
    }),
    async getDeferred() {
      const torrent = await getTorrent();

      if (!torrent) {
        return new Response({
          text: 'Данные торрента отсутствуют',
        });
      }

      return new Response({
        text: Markdown.create`Торрент${torrent.name ? Markdown.create` "${torrent.name}"` : ''} добавлен!`,
        keyboard: [
          [
            {
              type: 'callback',
              text: '▶️ Подробнее',
              callbackData: {
                source: CallbackButtonSource.TORRENT_CLIENT_NAVIGATE_TO_TORRENT,
                torrentId: torrent.infoHash,
              },
            },
          ],
        ],
      });
    },
  });
}

export async function getSearchRutrackerResponse(text: string): Promise<DeferredResponse> {
  return new DeferredResponse({
    immediate: new Response({
      text: Markdown.create`Запущен поиск на rutracker по строке "${text}"...`,
    }),
    async getDeferred() {
      const torrents = await rutrackerClient.search(text);
      const topTorrents = torrents.slice(0, 10);

      if (!torrents.length) {
        return new Response({
          text: 'Результатов не найдено',
        });
      }

      return new Response({
        text: Markdown.join(
          topTorrents.map(
            ({ title, author, seeds, size }, index) => Markdown.create`${Markdown.bold('Название')}: ${formatIndex(
              index,
            )} ${title}
${Markdown.bold('Автор')}: ${author}
${Markdown.bold('Размер')}: ${formatSize(size)}
${Markdown.bold('Сидов')}: ${seeds}
`,
          ),
          '\n\n',
        ),
        keyboard: chunk(
          topTorrents.map(({ id }, index) => ({
            type: 'callback',
            text: formatIndex(index),
            callbackData: {
              source: CallbackButtonSource.TORRENT_CLIENT_RUTRACKER_SEARCH_ADD_TORRENT,
              torrentId: id,
            },
          })),
          3,
        ),
      });
    },
  });
}

// TODO: add keyboard (settings, set limits)
export async function getStatusResponse(): Promise<Response> {
  const [clientState, downloadSpeed, uploadSpeed, notFinishedTorrents] = await Promise.all([
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
  ]);

  const status = new Markdown();

  if (clientState.paused) {
    status.add`🟠 Клиент стоит на паузе

`;
  }

  status.add`${Markdown.bold('Скорость загрузки')}: ${formatSpeed(downloadSpeed)}${
    clientState.downloadSpeedLimit !== null &&
    Markdown.create` (ограничение: ${formatSpeed(clientState.downloadSpeedLimit)})`
  }
${Markdown.bold('Скорость отдачи')}: ${formatSpeed(uploadSpeed)}${
    clientState.uploadSpeedLimit !== null &&
    Markdown.create` (ограничение: ${formatSpeed(clientState.uploadSpeedLimit)})`
  }

`;

  const notFinishedTorrentsText = await formatTorrents(notFinishedTorrents);

  status.add`${notFinishedTorrentsText.isEmpty() ? 'Нет активных торрентов' : notFinishedTorrentsText}`;

  return new Response({
    text: status,
    keyboard: [
      [
        {
          type: 'callback',
          text: '🔄 Обновить',
          callbackData: {
            source: CallbackButtonSource.TORRENT_CLIENT_STATUS_REFRESH,
          },
        },
        {
          type: 'callback',
          text: clientState.paused ? '▶️ Продолжить' : '⏸ Пауза',
          callbackData: {
            source: CallbackButtonSource.TORRENT_CLIENT_STATUS_PAUSE,
            pause: !clientState.paused,
          },
        },
      ],
      [
        {
          type: 'callback',
          text: '➕ Добавить',
          callbackData: {
            source: CallbackButtonSource.TORRENT_CLIENT_ADD_TORRENT,
          },
        },
        {
          type: 'callback',
          text: '📜 Список',
          callbackData: {
            source: CallbackButtonSource.TORRENT_CLIENT_STATUS_SHOW_TORRENTS_LIST,
          },
        },
      ],
      [
        {
          type: 'callback',
          text: '◀️ Назад',
          callbackData: {
            source: CallbackButtonSource.ROOT_BACK_TO_ROOT,
          },
        },
      ],
    ],
  });
}

export async function getTelegramTorrentsListResponse(page: number = 0): Promise<Response> {
  // TODO: better pagination
  const torrents = await prisma.torrent.findMany();
  const sortedTorrents = sortTorrents(torrents);

  const start = page * LIST_PAGE_SIZE;
  const end = start + LIST_PAGE_SIZE;

  const pageTorrents = sortedTorrents.slice(start, end);

  const hasPrevButton = start > 0;
  const hastNextButton = end < sortedTorrents.length;

  const text = await formatTorrents(pageTorrents);

  return new Response({
    text: text.isEmpty() ? 'Нет торрентов' : text,
    keyboard: [
      [
        {
          type: 'callback',
          text: '🔄 Обновить',
          callbackData: {
            source: CallbackButtonSource.TORRENT_CLIENT_TORRENTS_LIST_REFRESH,
            page,
          },
        },
      ],
      ...pageTorrents.map((torrent) => [
        {
          type: 'callback',
          text: torrent.name ?? 'Неизвестно',
          callbackData: {
            source: CallbackButtonSource.TORRENT_CLIENT_TORRENTS_LIST_ITEM,
            torrentId: torrent.infoHash,
          },
        } as const,
      ]),
      [
        hasPrevButton && {
          type: 'callback',
          text: '◀️',
          callbackData: {
            source: CallbackButtonSource.TORRENT_CLIENT_TORRENTS_LIST_PAGE,
            page: page - 1,
          },
        },
        hastNextButton && {
          type: 'callback',
          text: '▶️',
          callbackData: {
            source: CallbackButtonSource.TORRENT_CLIENT_TORRENTS_LIST_PAGE,
            page: page + 1,
          },
        },
      ],
      [
        {
          type: 'callback',
          text: '◀️ Назад',
          callbackData: {
            source: CallbackButtonSource.TORRENT_CLIENT_BACK_TO_STATUS,
          },
        },
      ],
    ],
  });
}

export async function getTelegramTorrentInfo(infoHash: string, withDeleteConfirm: boolean = false): Promise<Response> {
  const [clientState, torrent, clientTorrent] = await Promise.all([
    torrentClient.getState(),
    prisma.torrent.findUnique({
      where: {
        infoHash,
      },
    }),
    torrentClient.getClientTorrent(infoHash),
  ]);

  if (!torrent) {
    throw new CustomError(ErrorCode.NOT_FOUND, 'Торрент не найден');
  }

  const progress = TorrentClient.getRealProgress(torrent, torrent, clientTorrent);
  const verifiedString =
    torrent.state === TorrentState.Verifying && clientTorrent
      ? Markdown.create`
${Markdown.bold('Проверено')}: ${formatPercent(
          minmax(TorrentClient.getProgress(clientTorrent) / torrent.progress || 0, 0, 1),
        )}`
      : '';
  const errorString =
    torrent.state === TorrentState.Error && torrent.errorMessage
      ? Markdown.create`
${torrent.errorMessage}`
      : '';

  // TODO: show remaining time
  const info = Markdown.create`
${Markdown.bold('Название')}: ${torrent.name}
${Markdown.bold('Статус')}: ${STATE_TITLE[torrent.state]}
${Markdown.bold('Размер')}: ${formatSize(torrent.size)}
${Markdown.bold('Скачано')}: ${formatPercent(progress)}${verifiedString}${errorString}`;

  const isPausedOrError = torrent.state === TorrentState.Paused || torrent.state === TorrentState.Error;
  const isCritical = clientState.criticalTorrentId === infoHash;

  return new Response({
    text: info,
    keyboard: [
      torrent.state !== TorrentState.Finished && [
        {
          type: 'callback',
          text: '🔄 Обновить',
          callbackData: {
            source: CallbackButtonSource.TORRENT_CLIENT_TORRENT_REFRESH,
            torrentId: infoHash,
          },
        },
        {
          type: 'callback',
          text: isCritical ? '❕ Сделать некритичным' : '❗️ Сделать критичным',
          callbackData: {
            source: CallbackButtonSource.TORRENT_CLIENT_TORRENT_SET_CRITICAL,
            torrentId: infoHash,
            critical: !isCritical,
          },
        },
      ],
      [
        torrent.state !== TorrentState.Finished && {
          type: 'callback',
          text: isPausedOrError ? '▶️ Продолжить' : '⏸ Пауза',
          callbackData: {
            source: CallbackButtonSource.TORRENT_CLIENT_TORRENT_PAUSE,
            torrentId: infoHash,
            pause: !isPausedOrError,
          },
        },
        withDeleteConfirm
          ? {
              type: 'callback',
              text: '🗑 Точно удалить?',
              callbackData: {
                source: CallbackButtonSource.TORRENT_CLIENT_TORRENT_DELETE_CONFIRM,
                torrentId: infoHash,
              },
            }
          : {
              type: 'callback',
              text: '🗑 Удалить',
              callbackData: {
                source: CallbackButtonSource.TORRENT_CLIENT_TORRENT_DELETE,
                torrentId: infoHash,
              },
            },
      ],
      [
        {
          type: 'callback',
          text: '📄 Файлы',
          callbackData: {
            source: CallbackButtonSource.TORRENT_CLIENT_TORRENT_SHOW_FILES,
            torrentId: infoHash,
          },
        },
      ],
      [
        {
          type: 'callback',
          text: '◀️ К списку',
          callbackData: {
            source: CallbackButtonSource.TORRENT_CLIENT_TORRENT_BACK_TO_LIST,
          },
        },
      ],
    ],
  });
}

export async function getFilesResponse(infoHash: string, page: number = 0): Promise<Response> {
  // TODO: better pagination
  const [torrent, files, clientTorrent] = await Promise.all([
    prisma.torrent.findUnique({
      where: {
        infoHash,
      },
    }),
    prisma.torrentFile.findMany({
      where: {
        torrentId: infoHash,
      },
      orderBy: {
        path: 'asc',
      },
    }),
    torrentClient.getClientTorrent(infoHash),
  ]);

  if (!torrent) {
    throw new CustomError(ErrorCode.NOT_FOUND, 'Торрент не найден');
  }

  const start = page * LIST_PAGE_SIZE;
  const end = start + LIST_PAGE_SIZE;

  const pageFiles = files.slice(start, end);

  const hasPrevButton = start > 0;
  const hastNextButton = end < files.length;

  return new Response({
    text: formatTorrentFiles(pageFiles, {
      torrent,
      clientTorrent,
    }),
    keyboard: [
      [
        {
          type: 'callback',
          text: '🔄 Обновить',
          callbackData: {
            source: CallbackButtonSource.TORRENT_CLIENT_TORRENT_FILES_REFRESH,
            torrentId: infoHash,
            page,
          },
        },
      ],
      [
        hasPrevButton && {
          type: 'callback',
          text: '◀️',
          callbackData: {
            source: CallbackButtonSource.TORRENT_CLIENT_TORRENT_FILES_PAGE,
            torrentId: infoHash,
            page: page - 1,
          },
        },
        hastNextButton && {
          type: 'callback',
          text: '▶️',
          callbackData: {
            source: CallbackButtonSource.TORRENT_CLIENT_TORRENT_FILES_PAGE,
            torrentId: infoHash,
            page: page + 1,
          },
        },
      ],
      [
        {
          type: 'callback',
          text: '◀️ К торренту',
          callbackData: {
            source: CallbackButtonSource.TORRENT_CLIENT_BACK_TO_TORRENT,
            torrentId: infoHash,
          },
        },
      ],
    ],
  });
}

export function sortTorrents(torrents: Torrent[]): Torrent[] {
  return sortBy(torrents, ({ state }) => STATUS_STATE_SORTING[state]);
}

export async function formatTorrents(torrents: Torrent[]): Promise<Markdown> {
  const sortedTorrents = sortTorrents(torrents);
  const groupedTorrents = groupBy(sortedTorrents, ({ state }) => state);

  const formattedGroups = await Promise.all(
    map(groupedTorrents, async (torrents, groupString) => {
      const filesStrings = await Promise.all(torrents.map(formatTorrentsListItem));

      return Markdown.create`${Markdown.bold(STATE_TITLE[groupString as TorrentState])}
${Markdown.join(filesStrings, '\n\n')}`;
    }),
  );

  return Markdown.join(formattedGroups, '\n\n');
}

export async function formatTorrentsListItem(torrent: Torrent): Promise<Markdown> {
  const [clientTorrent, clientState] = await Promise.all([
    torrentClient.getClientTorrent(torrent.infoHash),
    torrentClient.getState(),
  ]);
  const progress = TorrentClient.getRealProgress(torrent, torrent, clientTorrent);

  return Markdown.create`${clientState.criticalTorrentId === torrent.infoHash ? '❗️ ' : ''}${
    torrent.name ?? 'Неизвестно'
  } (${formatSize(torrent.size)}, ${formatPercent(progress)})`;
}

export interface FormatTorrentFilesOptions {
  torrent: Torrent;
  clientTorrent: ClientTorrent | null;
}

export function formatTorrentFiles(files: TorrentFile[], options: FormatTorrentFilesOptions): Markdown {
  return Markdown.join(
    files.map((file) => formatTorrentFile(file, options)),
    '\n\n',
  );
}

export interface FormatTorrentFileOptions {
  torrent: Torrent;
  clientTorrent: ClientTorrent | null;
}

export function formatTorrentFile(file: TorrentFile, options: FormatTorrentFileOptions): Markdown {
  const { torrent, clientTorrent } = options;

  const clientTorrentFile = clientTorrent?.files.find(({ path }) => path === file.path);
  const progress = TorrentClient.getRealProgress(file, torrent, clientTorrentFile);

  return Markdown.create`${file.path === torrent.name ? file.path : path.relative(torrent.name ?? '', file.path)}
${formatProgress(progress)}
${formatSize(file.size)}, ${formatPercent(progress)}`;
}
