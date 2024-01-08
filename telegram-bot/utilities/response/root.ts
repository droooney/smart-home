import { RootCallbackButtonSource } from 'telegram-bot/types/keyboard/root';

import ImmediateTextResponse from 'telegram-bot/utilities/ImmediateTextResponse';
import { callbackButton } from 'telegram-bot/utilities/keyboard';

export async function getRootResponse(): Promise<ImmediateTextResponse> {
  return new ImmediateTextResponse({
    text: 'Привет! Я - Страж Дома! Воспользуйся одной из кнопок ниже',
    keyboard: [
      [
        callbackButton('💻 Система', {
          source: RootCallbackButtonSource.OPEN_SYSTEM,
        }),
      ],
      [
        callbackButton('📽 Торрент клиент', {
          source: RootCallbackButtonSource.OPEN_TORRENT_CLIENT,
        }),
      ],
    ],
  });
}
