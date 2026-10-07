import { isUUID } from 'class-validator';
import { BadRequestException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { attributeTypes, nodeCategories, recordPolicies, SemanticGraphOperation } from './semantic-model.types';
import { fieldSearchIndexProblems } from './semantic-search-settings.types';

type JsonObject = Record<string, unknown>;

const operationTypes = new Set([
  'node_type.create','node_type.update','node_type.delete','relation_type.create','relation_type.update','relation_type.delete',
  'record.create','record.update','record.delete','record_relation.create','record_relation.update','record_relation.delete','layout.update',
]);
const cardinalities = new Set(['one_to_one','one_to_many','many_to_one','many_to_many']);

function invalid(message: string): never {
  throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED,message);
}

function object(value: unknown, field: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${field} must be an object`);
  return value as JsonObject;
}

function only(value: JsonObject, fields: string[], name: string): void {
  if (Object.keys(value).some((key)=>!fields.includes(key))) invalid(`${name} contains unsupported fields`);
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isUUID(value)) invalid(`${field} must be a UUID`);
  return value;
}

function text(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) invalid(`${field} must be a non-empty string`);
  return value;
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') invalid(`${field} must be a boolean`);
  return value;
}

function position(value: unknown, field: string): void {
  const item = object(value,field);
  only(item,['x','y'],field);
  if (typeof item.x !== 'number' || !Number.isFinite(item.x) || typeof item.y !== 'number' || !Number.isFinite(item.y)) invalid(`${field} requires finite x and y values`);
}

function stringArray(value: unknown, field: string): void {
  if (!Array.isArray(value) || value.some((item)=>typeof item !== 'string')) invalid(`${field} must be a string array`);
}

function attributes(value: unknown): void {
  if (!Array.isArray(value)) invalid('attributes must be an array');
  for (const entry of value) {
    const item = object(entry,'attribute');
    only(item,['key','label','type','required','description','options','aliases','searchIndex'],'attribute');
    if (!/^[a-z][a-z0-9_]*$/.test(text(item.key,'attribute.key'))) invalid('attribute.key is invalid');
    text(item.label,'attribute.label');
    if (!attributeTypes.includes(item.type as never)) invalid('attribute.type is invalid');
    bool(item.required,'attribute.required');
    if (item.description !== undefined) text(item.description,'attribute.description',true);
    if (item.options !== undefined) stringArray(item.options,'attribute.options');
    if (item.aliases !== undefined) stringArray(item.aliases,'attribute.aliases');
    if (item.searchIndex !== undefined && item.searchIndex !== null) {
      const problems = fieldSearchIndexProblems(item.searchIndex, undefined, 'attribute.searchIndex: ');
      if (problems.length) invalid(problems.join('; '));
    }
  }
}

function values(value: unknown, field = 'values'): void {
  object(value,field);
}

function node(value: unknown, partial: boolean): void {
  const item = object(value,partial?'changes':'entity');
  const allowed = ['key','label','description','category','recordPolicy','aliases','attributes','position'];
  only(item,partial?allowed:['id',...allowed,'systemKey'],partial?'changes':'entity');
  if (!partial) {
    uuid(item.id,'entity.id');
    if (item.systemKey !== null) invalid('User-created concepts cannot set systemKey');
  }
  if (!partial || item.key !== undefined) {
    if (!/^[a-z][a-z0-9_]*$/.test(text(item.key,'key'))) invalid('key is invalid');
  }
  if (!partial || item.label !== undefined) text(item.label,'label');
  if (!partial || item.description !== undefined) text(item.description,'description',true);
  if (!partial || item.category !== undefined) {
    if (!nodeCategories.includes(item.category as never)) invalid('category is invalid');
  }
  if (!partial || item.recordPolicy !== undefined) {
    if (!recordPolicies.includes(item.recordPolicy as never)) invalid('recordPolicy is invalid');
  }
  if (!partial || item.aliases !== undefined) stringArray(item.aliases,'aliases');
  if (!partial || item.attributes !== undefined) attributes(item.attributes);
  if (!partial || item.position !== undefined) position(item.position,'position');
}

function relation(value: unknown, partial: boolean): void {
  const item = object(value,partial?'changes':'entity');
  const allowed = ['key','label','inverseLabel','description','sourceNodeTypeId','targetNodeTypeId','cardinality','traversable','filterable','attributes'];
  only(item,partial?allowed:['id',...allowed],partial?'changes':'entity');
  if (!partial) uuid(item.id,'entity.id');
  if (!partial || item.key !== undefined) {
    if (!/^[a-z][a-z0-9_]*$/.test(text(item.key,'key'))) invalid('key is invalid');
  }
  if (!partial || item.label !== undefined) text(item.label,'label');
  if (!partial || item.inverseLabel !== undefined) text(item.inverseLabel,'inverseLabel',true);
  if (!partial || item.description !== undefined) text(item.description,'description',true);
  if (!partial || item.sourceNodeTypeId !== undefined) uuid(item.sourceNodeTypeId,'sourceNodeTypeId');
  if (!partial || item.targetNodeTypeId !== undefined) uuid(item.targetNodeTypeId,'targetNodeTypeId');
  if (!partial || item.cardinality !== undefined) {
    if (!cardinalities.has(String(item.cardinality))) invalid('cardinality is invalid');
  }
  if (!partial || item.traversable !== undefined) bool(item.traversable,'traversable');
  if (!partial || item.filterable !== undefined) bool(item.filterable,'filterable');
  if (!partial || item.attributes !== undefined) attributes(item.attributes);
}

function record(value: unknown, partial: boolean): void {
  const item = object(value,partial?'changes':'entity');
  const allowed = ['label','values','status','position'];
  only(item,partial?allowed:['id','nodeTypeId',...allowed],partial?'changes':'entity');
  if (!partial) {
    uuid(item.id,'entity.id');
    uuid(item.nodeTypeId,'nodeTypeId');
  }
  if (!partial || item.label !== undefined) text(item.label,'label');
  if (!partial || item.values !== undefined) values(item.values);
  if (!partial || item.status !== undefined) {
    if (item.status !== 'active' && item.status !== 'inactive') invalid('status is invalid');
  }
  if (!partial || item.position !== undefined) position(item.position,'position');
}

function recordRelation(value: unknown, partial: boolean): void {
  const item = object(value,partial?'changes':'entity');
  only(item,partial?['values']:['id','relationTypeId','sourceRecordId','targetRecordId','values'],partial?'changes':'entity');
  if (!partial) {
    uuid(item.id,'entity.id');
    uuid(item.relationTypeId,'relationTypeId');
    uuid(item.sourceRecordId,'sourceRecordId');
    uuid(item.targetRecordId,'targetRecordId');
  }
  values(item.values);
}

export function parseSemanticGraphOperation(input: JsonObject): SemanticGraphOperation {
  if (typeof input.type !== 'string' || !operationTypes.has(input.type)) invalid('Unsupported graph operation');
  if (input.type === 'layout.update') {
    only(input,['type','positions'],'layout operation');
    if (!Array.isArray(input.positions) || input.positions.length > 1000) invalid('Layout operations require up to 1000 positions');
    const ids = new Set<string>();
    for (const entry of input.positions) {
      const item = object(entry,'layout position');
      only(item,['id','position'],'layout position');
      const id = uuid(item.id,'layout position id');
      if (ids.has(id)) invalid('Layout positions must have unique ids');
      ids.add(id);
      position(item.position,'layout position');
    }
    return input as unknown as SemanticGraphOperation;
  }
  const type = input.type;
  const isCreate = type.endsWith('.create');
  const isUpdate = type.endsWith('.update');
  only(input,isCreate?['type','entity']:isUpdate?['type','id','changes']:['type','id'],'graph operation');
  if (!isCreate) uuid(input.id,'operation id');
  if (isUpdate && Object.keys(object(input.changes,'changes')).length === 0) invalid('Update operations require at least one change');
  if (isCreate || isUpdate) {
    if (type.startsWith('node_type.')) node(isCreate?input.entity:input.changes,isUpdate);
    if (type.startsWith('relation_type.')) relation(isCreate?input.entity:input.changes,isUpdate);
    if (type.startsWith('record_relation.')) recordRelation(isCreate?input.entity:input.changes,isUpdate);
    else if (type.startsWith('record.')) record(isCreate?input.entity:input.changes,isUpdate);
  }
  return input as unknown as SemanticGraphOperation;
}
