import { Device, DeviceType } from '@prisma/client';
import findKey from 'lodash/findKey';

import prisma from 'db/prisma';

import { AddDevicePayload } from 'devices-client/types/device';

import { wakeOnLan } from 'devices-client/utilities/wol';
import CustomError, { ErrorCode } from 'utilities/CustomError';

const DEVICE_STRING: Record<DeviceType, string[]> = {
  [DeviceType.Tv]: ['телевизор', 'телек', 'телик'],
};

export default class DevicesClient {
  static readonly defaultDevicePayload: AddDevicePayload = {
    type: DeviceType.Tv,
    name: '',
    mac: '',
    address: '',
  };

  async addDevice(data: AddDevicePayload): Promise<Device> {
    return prisma.device.create({
      data,
    });
  }

  async deleteDevice(deviceId: number): Promise<void> {
    await prisma.device.delete({
      where: {
        id: deviceId,
      },
    });
  }

  async isAddressAllowed(address: string): Promise<boolean> {
    return !(await prisma.device.findFirst({
      where: {
        address,
      },
    }));
  }

  async isMacAllowed(mac: string): Promise<boolean> {
    return !(await prisma.device.findFirst({
      where: {
        mac,
      },
    }));
  }

  async isNameAllowed(name: string): Promise<boolean> {
    return !(await prisma.device.findFirst({
      where: {
        name,
      },
    }));
  }

  async turnOnDevice(deviceId: number): Promise<void> {
    await this.wakeDevice(deviceId);
  }

  async findDevice(query: string): Promise<Device | null> {
    const deviceType = findKey(DEVICE_STRING, (strings) => strings.includes(query)) as DeviceType | undefined;

    return prisma.device.findFirst({
      where: {
        OR: [
          {
            name: {
              contains: query,
            },
          },
          ...(deviceType
            ? [
                {
                  type: {
                    in: [deviceType],
                  },
                },
              ]
            : []),
        ],
      },
    });
  }

  private async wakeDevice(deviceId: number): Promise<void> {
    const device = await prisma.device.findUnique({
      where: {
        id: deviceId,
      },
    });

    if (!device) {
      throw new CustomError(ErrorCode.NOT_FOUND, 'Устройство не найдено');
    }

    await wakeOnLan({
      mac: device.mac,
      address: device.address,
    });
  }
}
