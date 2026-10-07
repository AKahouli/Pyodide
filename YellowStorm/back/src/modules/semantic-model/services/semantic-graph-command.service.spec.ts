import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { SemanticGraphCommandService } from './semantic-graph-command.service';

describe('SemanticGraphCommandService graph operations', () => {
  const versionId = '10000000-0000-4000-8000-000000000001';
  const nodeId = '10000000-0000-4000-8000-000000000002';
  const relationId = '10000000-0000-4000-8000-000000000003';
  const sourceId = '10000000-0000-4000-8000-000000000004';
  const targetId = '10000000-0000-4000-8000-000000000005';
  const client = { query: jest.fn() };
  const database = {
    transaction: jest.fn(async (work: (transactionClient: typeof client) => Promise<unknown>) => work(client)),
  };
  const repository = { apply: jest.fn() };
  const models = {
    requireActiveRole: jest.fn(),
    audit: jest.fn(),
  };
  const service = new SemanticGraphCommandService(database as never, repository as never, models as never, {} as never);

  beforeEach(() => {
    jest.clearAllMocks();
    models.requireActiveRole.mockResolvedValue({ currentDraftVersionId:versionId });
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM semantic_model.versions')) return { rows:[{ revision:0,status:'draft' }],rowCount:1 };
      if (sql.includes('SELECT node.id')) return { rows:[{id:nodeId,protected:false}],rowCount:1 };
      if (sql.includes('UPDATE semantic_model.versions')) return { rows:[{ revision:1 }],rowCount:1 };
      return { rows:[],rowCount:0 };
    });
  });

  it('accepts layout updates whose ids are carried by positions', async () => {
    const operation = { type:'layout.update',positions:[{ id:nodeId,position:{ x:40,y:80 } }] };

    await expect(service.apply('user-id','model-id',{ expectedRevision:0,operations:[operation] })).resolves.toMatchObject({ revision:1 });
    expect(repository.apply).toHaveBeenCalledWith(client,'model-id',versionId,operation);
  });

  it('still rejects a layout update without positions', async () => {
    await expect(service.apply('user-id','model-id',{
      expectedRevision:0,
      operations:[{ type:'layout.update' } as never],
    })).rejects.toMatchObject({ code:ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED });
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('rejects record links that do not match their concept relationship', async () => {
    const operation = {
      type:'record_relation.create' as const,
      entity:{ id:'10000000-0000-4000-8000-000000000006',relationTypeId:relationId,sourceRecordId:sourceId,targetRecordId:targetId,values:{} },
    };

    await expect(service.apply('user-id','model-id',{ expectedRevision:0,operations:[operation] })).rejects.toMatchObject({
      code:ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED,
    });
    expect(repository.apply).not.toHaveBeenCalled();
  });

  it('rejects records for concepts that do not allow them', async () => {
    const operation = {type:'record.create' as const,entity:{id:sourceId,nodeTypeId:nodeId,label:'Acme',values:{},status:'active' as const,position:{x:0,y:0}}};
    await expect(service.apply('user-id','model-id',{expectedRevision:0,operations:[operation]})).rejects.toMatchObject({
      code:ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED,
    });
    expect(repository.apply).not.toHaveBeenCalled();
  });

  it('rejects duplicate compatible record links', async () => {
    client.query.mockImplementation(async (sql:string) => {
      if (sql.includes('FROM semantic_model.versions')) return {rows:[{revision:0,status:'draft'}],rowCount:1};
      if (sql.includes('SELECT NOT EXISTS')) return {rows:[{available:false}],rowCount:1};
      return {rows:[],rowCount:0};
    });
    const operation = {type:'record_relation.create' as const,entity:{id:'10000000-0000-4000-8000-000000000006',relationTypeId:relationId,sourceRecordId:sourceId,targetRecordId:targetId,values:{}}};
    await expect(service.apply('user-id','model-id',{expectedRevision:0,operations:[operation]})).rejects.toMatchObject({
      code:ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED,
    });
  });

  it('rejects malformed operation ids before opening a transaction', async () => {
    await expect(service.apply('user-id','model-id',{expectedRevision:0,operations:[{type:'record.delete',id:'not-a-uuid'}]})).rejects.toMatchObject({
      code:ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED,
    });
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('rejects disabling records while a concept still has records', async () => {
    client.query.mockImplementation(async (sql:string) => {
      if (sql.includes('FROM semantic_model.versions')) return {rows:[{revision:0,status:'draft'}],rowCount:1};
      if (sql.includes('SELECT system_key')) return {rows:[{systemKey:null}],rowCount:1};
      if (sql.includes('FROM semantic_model.records')) return {rows:[{}],rowCount:1};
      return {rows:[],rowCount:0};
    });
    await expect(service.apply('user-id','model-id',{expectedRevision:0,operations:[{
      type:'node_type.update',id:nodeId,changes:{recordPolicy:'none'},
    }]})).rejects.toMatchObject({code:ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED});
    expect(repository.apply).not.toHaveBeenCalled();
  });

  it('allows cleanup of a non-system record after its policy was disabled', async () => {
    client.query.mockImplementation(async (sql:string) => {
      if (sql.includes('FROM semantic_model.versions')) return {rows:[{revision:0,status:'draft'}],rowCount:1};
      if (sql.includes('JOIN semantic_model.node_types')) return {rows:[{}],rowCount:1};
      if (sql.includes('UPDATE semantic_model.versions')) return {rows:[{revision:1}],rowCount:1};
      return {rows:[],rowCount:0};
    });
    const operation = {type:'record.delete' as const,id:sourceId};
    await expect(service.apply('user-id','model-id',{expectedRevision:0,operations:[operation]})).resolves.toMatchObject({revision:1});
    expect(repository.apply).toHaveBeenCalledWith(client,'model-id',versionId,operation);
  });
});
