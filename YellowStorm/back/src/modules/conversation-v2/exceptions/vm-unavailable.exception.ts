import { ConflictException } from '@nestjs/common';

export class VmUnavailableException extends ConflictException {
  constructor() {
    super({ code: 'VM_UNAVAILABLE', message: 'No VM attached to this session' });
  }
}
