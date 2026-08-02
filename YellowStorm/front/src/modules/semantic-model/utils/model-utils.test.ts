import { describe, expect, it } from 'vitest';
import type { SemanticGraph, SemanticNodeType } from '../types';
import { compatibleRecordRelations, nextConceptPosition, nextLinkedConceptPosition, uniqueBusinessKey } from './model-utils';

function node(id: string, x: number, y: number): SemanticNodeType {
  return {
    id,
    key:id,
    label:id,
    description:'',
    category:'business_object',
    recordPolicy:'none',
    systemKey:null,
    aliases:[],
    attributes:[],
    position:{x,y},
  };
}

describe('nextConceptPosition', () => {
  it('uses the first canvas slot for an empty model', () => {
    expect(nextConceptPosition([])).toEqual({x:120,y:120});
  });

  it('places consecutive concepts in separate slots', () => {
    expect(nextConceptPosition([node('first',120,120)])).toEqual({x:424,y:120});
  });

  it('skips occupied slots without moving existing concepts', () => {
    const nodes = [node('first',120,120),node('second',424,120),node('third',728,120)];
    expect(nextConceptPosition(nodes)).toEqual({x:120,y:284});
  });
});

describe('uniqueBusinessKey', () => {
  it('adds the first available suffix', () => {
    expect(uniqueBusinessKey('Related to',['related_to','related_to_2'])).toBe('related_to_3');
  });
});

describe('nextLinkedConceptPosition', () => {
  it('places a child to the right and avoids an occupied position', () => {
    const source = node('source',120,120);
    expect(nextLinkedConceptPosition(source.position,[source])).toEqual({x:432,y:120});
    expect(nextLinkedConceptPosition(source.position,[source,node('occupied',432,120)])).toEqual({x:432,y:300});
  });
});

describe('compatibleRecordRelations', () => {
  const graph: SemanticGraph = {
    modelId:'model',versionId:'version',revision:0,
    nodes:[node('customer',0,0),node('contract',300,0)],
    relations:[{id:'places',key:'places',label:'places',inverseLabel:'',description:'',sourceNodeTypeId:'customer',targetNodeTypeId:'contract',cardinality:'many_to_many',traversable:true,filterable:true,attributes:[]}],
    records:[
      {id:'customer-1',nodeTypeId:'customer',label:'Acme',values:{},status:'active',position:{x:0,y:0}},
      {id:'contract-1',nodeTypeId:'contract',label:'Agreement',values:{},status:'active',position:{x:300,y:0}},
    ],
    recordRelations:[],
  };

  it('uses a matching concept relationship', () => {
    expect(compatibleRecordRelations(graph,'customer-1','contract-1')).toMatchObject([{relation:{id:'places'},sourceRecordId:'customer-1',targetRecordId:'contract-1'}]);
  });

  it('normalizes a reverse drag to the concept direction', () => {
    expect(compatibleRecordRelations(graph,'contract-1','customer-1')).toMatchObject([{sourceRecordId:'customer-1',targetRecordId:'contract-1'}]);
  });

  it('does not invent a relationship for incompatible records', () => {
    expect(compatibleRecordRelations({...graph,relations:[]},'customer-1','contract-1')).toEqual([]);
  });
});
