import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Playbook, PlaybookDocument } from '../schemas/playbook.schema';
import { NotFoundException, ForbiddenException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';

interface RequestWithPlaybook extends Request {
  user: { _id: Types.ObjectId };
  params: { id?: string; playbookId?: string };
}

@Injectable()
export class PlaybookOwnerGuard implements CanActivate {
  constructor(
    @InjectModel(Playbook.name)
    private readonly playbookModel: Model<PlaybookDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithPlaybook>();
    const user = request.user;

    const playbookId = request.params.id || request.params.playbookId;

    if (!playbookId || !Types.ObjectId.isValid(playbookId)) {
      throw new NotFoundException(ErrorCode.NOT_FOUND, 'Invalid playbook ID format');
    }

    const playbook = await this.playbookModel
      .findById(playbookId)
      .select('createdBy')
      .lean()
      .exec();

    if (!playbook) {
      throw new NotFoundException(ErrorCode.NOT_FOUND, 'Playbook not found');
    }

    if (playbook.createdBy.toString() !== user._id.toString()) {
      throw new ForbiddenException(ErrorCode.FORBIDDEN, 'You do not have access to this playbook');
    }

    return true;
  }
}
