import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { LoggerService } from '@modules/logger';

@Injectable()
export class ConnectorPlaybookBindingSyncService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ConnectorPlaybookBindingSyncService.name);
  }

  async syncConnectorActions(
    connectorId: string,
    previousEnabledActionKeys: string[],
    nextEnabledActionKeys: string[],
  ): Promise<void> {
    const previousKeys = new Set(previousEnabledActionKeys);
    const nextEnabledKeys = new Set(nextEnabledActionKeys);

    if (this.sameKeys(previousKeys, nextEnabledKeys)) {
      return;
    }

    const actions = nextEnabledActionKeys.map((actionKey) => ({ actionKey, isEnabled: true }));
    const result = await this.connection.collection('flows').updateMany(
      { 'nodes.metadata.toolBindings.connectorId': connectorId },
      {
        $set: {
          'nodes.$[].metadata.toolBindings.$[binding].actions': actions,
        },
      },
      { arrayFilters: [{ 'binding.connectorId': connectorId }] },
    );

    this.logger.log('Synchronized playbook connector action bindings', {
      connectorId,
      matchedFlowCount: result.matchedCount,
      modifiedFlowCount: result.modifiedCount,
      currentActionKeys: nextEnabledActionKeys,
    });
  }

  private sameKeys(left: Set<string>, right: Set<string>): boolean {
    return left.size === right.size && [...left].every((key) => right.has(key));
  }
}
