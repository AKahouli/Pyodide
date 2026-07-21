import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { LoggerService } from '@modules/logger';
import {
  ConnectorActionSchemaContract,
  connectorActionContractsEqual,
  getAllowedFixedParamKeys,
} from '../utils/connector-fixed-params.util';

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
    previousActions: ConnectorActionSchemaContract[],
    nextActions: ConnectorActionSchemaContract[],
  ): Promise<void> {
    if (connectorActionContractsEqual(previousActions, nextActions)) {
      return;
    }

    const actions = nextActions.map((action) => ({ actionKey: action.key, isEnabled: true }));
    const allowedFixedParamKeys = getAllowedFixedParamKeys(nextActions);
    const bindingUpdate: Record<string, unknown> = {
      actions: { $literal: actions },
    };
    if (allowedFixedParamKeys !== null) {
      bindingUpdate.fixedParams = {
        $arrayToObject: {
          $filter: {
            input: {
              $objectToArray: {
                $cond: [
                  { $eq: [{ $type: '$$binding.fixedParams' }, 'object'] },
                  '$$binding.fixedParams',
                  {},
                ],
              },
            },
            as: 'param',
            cond: { $in: ['$$param.k', { $literal: allowedFixedParamKeys }] },
          },
        },
      };
    }

    const result = await this.connection.collection('flows').updateMany(
      { 'nodes.metadata.toolBindings.connectorId': connectorId },
      [{
        $set: {
          nodes: {
            $map: {
              input: '$nodes',
              as: 'node',
              in: {
                $mergeObjects: [
                  '$$node',
                  {
                    metadata: {
                      $cond: [
                        { $isArray: '$$node.metadata.toolBindings' },
                        {
                          $mergeObjects: [
                            '$$node.metadata',
                            {
                              toolBindings: {
                                $map: {
                                  input: '$$node.metadata.toolBindings',
                                  as: 'binding',
                                  in: {
                                    $cond: [
                                      { $eq: ['$$binding.connectorId', connectorId] },
                                      { $mergeObjects: ['$$binding', bindingUpdate] },
                                      '$$binding',
                                    ],
                                  },
                                },
                              },
                            },
                          ],
                        },
                        '$$node.metadata',
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      }],
    );

    this.logger.log('Synchronized playbook connector action bindings', {
      connectorId,
      matchedFlowCount: result.matchedCount,
      modifiedFlowCount: result.modifiedCount,
      currentActionKeys: nextActions.map((action) => action.key),
    });
  }
}
