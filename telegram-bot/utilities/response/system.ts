import systemClient from 'system-client/client';

import { RootCallbackButtonSource } from 'telegram-bot/types/keyboard/root';
import { SystemCallbackButtonSource } from 'telegram-bot/types/keyboard/system';

import Markdown from 'telegram-bot/utilities/Markdown';
import { backCallbackButton, refreshCallbackButton } from 'telegram-bot/utilities/keyboard';
import ImmediateTextResponse from 'telegram-bot/utilities/response/ImmediateTextResponse';
import { formatDuration } from 'utilities/date';
import { formatPercent } from 'utilities/number';
import { formatSize } from 'utilities/size';
import { formatTemperature } from 'utilities/temperature';

export async function getStatusResponse(): Promise<ImmediateTextResponse> {
  const [cpuUsage] = await Promise.all([systemClient.getCpuUsage()]);

  const osTotalMemory = systemClient.getOsTotalMemory();
  const osUsedMemory = osTotalMemory - systemClient.getOsFreeMemory();

  const text = Markdown.create`💻 ${Markdown.bold('Система')}
🧮 ${Markdown.bold('Использование CPU')}: ${formatPercent(cpuUsage.os)}
🛠 ${Markdown.bold('Использование RAM')}: ${formatSize(osUsedMemory)} (${formatPercent(osUsedMemory / osTotalMemory)})
🕖 ${Markdown.bold('Время работы')}: ${formatDuration(systemClient.getOsUptime())}`;

  if (!systemClient.isWsl()) {
    const cpuTemperature = await systemClient.getCpuTemperature();

    text.add`
🌡 ${Markdown.bold('Температура CPU')}: ${formatTemperature(cpuTemperature)}`;
  }

  text.add`


🤖 ${Markdown.bold('Процесс')}
🧮 ${Markdown.bold('Использование CPU')}: ${formatPercent(cpuUsage.process)}
🛠 ${Markdown.bold('Использование RAM')}: ${formatSize(systemClient.getProcessUsedMemory())}
🕖 ${Markdown.bold('Время работы')}: ${formatDuration(systemClient.getProcessUptime())}`;

  return new ImmediateTextResponse({
    text,
    keyboard: [
      [
        refreshCallbackButton({
          source: SystemCallbackButtonSource.REFRESH_STATUS,
        }),
      ],
      [
        backCallbackButton({
          source: RootCallbackButtonSource.BACK_TO_ROOT,
        }),
      ],
    ],
  });
}
