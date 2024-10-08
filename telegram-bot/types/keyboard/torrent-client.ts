import { z } from 'zod';

// next number is 26
export enum TorrentClientCallbackButtonType {
  // Status
  OpenStatus = 't0',
  StatusRefresh = 't1',
  PauseClient = 't2',

  // Torrent list
  OpenTorrentsList = 't3',
  TorrentsListPage = 't5',
  TorrentsListRefresh = 't6',

  // Torrent
  OpenTorrent = 't23',
  TorrentRefresh = 't7',
  TorrentDelete = 't8',
  TorrentDeleteConfirm = 't9',
  TorrentPause = 't10',
  TorrentSetCritical = 't11',

  // File list
  OpenFiles = 't13',
  FilesListPage = 't14',
  FilesListRefresh = 't15',

  // File
  OpenFile = 't17',
  FileRefresh = 't18',
  DeleteFile = 't19',
  DeleteFileConfirm = 't20',

  // Misc
  AddTorrent = 't22',

  // Rutracker
  RutrackerSearch = 't25',
  RutrackerSearchAddTorrent = 't24',
}

export const torrentClientCallbackDataSchema = z.union([
  z.object({
    type: z.literal(TorrentClientCallbackButtonType.OpenStatus),
  }),

  z.object({
    type: z.literal(TorrentClientCallbackButtonType.StatusRefresh),
  }),

  z.object({
    type: z.literal(TorrentClientCallbackButtonType.PauseClient),
    pause: z.boolean(),
  }),

  z.object({
    type: z.literal(TorrentClientCallbackButtonType.OpenTorrentsList),
  }),

  z.object({
    type: z.literal(TorrentClientCallbackButtonType.TorrentsListPage),
    page: z.number(),
  }),

  z.object({
    type: z.literal(TorrentClientCallbackButtonType.TorrentsListRefresh),
    page: z.number(),
  }),

  z.object({
    type: z.literal(TorrentClientCallbackButtonType.TorrentRefresh),
    torrentId: z.string(),
  }),

  z.object({
    type: z.literal(TorrentClientCallbackButtonType.TorrentDelete),
    torrentId: z.string(),
  }),

  z.object({
    type: z.literal(TorrentClientCallbackButtonType.TorrentDeleteConfirm),
    torrentId: z.string(),
  }),

  z.object({
    type: z.literal(TorrentClientCallbackButtonType.TorrentPause),
    torrentId: z.string(),
    pause: z.boolean(),
  }),

  z.object({
    type: z.literal(TorrentClientCallbackButtonType.TorrentSetCritical),
    torrentId: z.string(),
    critical: z.boolean(),
  }),

  z.object({
    type: z.literal(TorrentClientCallbackButtonType.OpenFiles),
    torrentId: z.string(),
  }),

  z.object({
    type: z.literal(TorrentClientCallbackButtonType.FilesListPage),
    torrentId: z.string(),
    page: z.number(),
  }),

  z.object({
    type: z.literal(TorrentClientCallbackButtonType.FilesListRefresh),
    torrentId: z.string(),
    page: z.number(),
  }),

  z.object({
    type: z.literal(TorrentClientCallbackButtonType.OpenFile),
    fileId: z.number(),
  }),

  z.object({
    type: z.literal(TorrentClientCallbackButtonType.FileRefresh),
    fileId: z.number(),
  }),

  z.object({
    type: z.literal(TorrentClientCallbackButtonType.DeleteFile),
    fileId: z.number(),
  }),

  z.object({
    type: z.literal(TorrentClientCallbackButtonType.DeleteFileConfirm),
    fileId: z.number(),
  }),

  z.object({
    type: z.literal(TorrentClientCallbackButtonType.AddTorrent),
  }),

  z.object({
    type: z.literal(TorrentClientCallbackButtonType.OpenTorrent),
    torrentId: z.string(),
  }),

  z.object({
    type: z.literal(TorrentClientCallbackButtonType.RutrackerSearch),
  }),

  z.object({
    type: z.literal(TorrentClientCallbackButtonType.RutrackerSearchAddTorrent),
    torrentId: z.string(),
  }),
]);
