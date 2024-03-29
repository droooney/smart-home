import path from 'node:path';

import { Torrent } from '@prisma/client';
import fs from 'fs-extra';
import { HttpsProxyAgent } from 'https-proxy-agent';
import RutrackerApi, { Torrent as RutrackerTorrent } from 'rutracker-api-with-proxy';

import { DOWNLOADS_DIRECTORY } from 'constants/paths';

import { loadTorrentFromFile } from 'telegram-bot/utilities/documents';
import CustomError, { ErrorCode } from 'utilities/CustomError';

const { PROXY_HOST: proxyHost, RUTRACKER_LOGIN: username, RUTRACKER_PASSWORD: password } = process.env;

class RutrackerClient {
  private api = new RutrackerApi(undefined, {
    httpsAgent: proxyHost ? new HttpsProxyAgent(proxyHost) : undefined,
  });
  private loginPromise: Promise<unknown> | undefined;

  async addTorrent(torrentId: string): Promise<Torrent | null> {
    await this.login();

    const stream = await this.api.download(torrentId);
    const filePath = path.resolve(DOWNLOADS_DIRECTORY, `rutracker-${torrentId}.torrent`);
    const writeStream = fs.createWriteStream(filePath);

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);

      stream.pipe(writeStream);
    });

    return loadTorrentFromFile(filePath);
  }

  private async login(): Promise<void> {
    await (this.loginPromise ??= (async () => {
      if (!username || !password) {
        throw new CustomError(ErrorCode.NO_AUTH, 'Не авторизован на rutracker');
      }

      try {
        await this.api.login({
          username,
          password,
        });
      } catch (err) {
        this.loginPromise = undefined;

        throw err;
      }
    })());
  }

  async search(query: string): Promise<RutrackerTorrent[]> {
    await this.login();

    return this.api.search({
      query,
      sort: 'seeds',
      order: 'desc',
    });
  }
}

export default RutrackerClient;
