import { describe, expect, it } from 'vitest';
import { GroupBy, Pivot, Top, Between, Bucket, Cumulative, MovingAvg, Change, Histogram, Stats, dashboardFunctions } from './dashboard-functions';
describe('bounded upstream dashboard functions', () => {
 const rows = [{ region: 'East', product: 'A', value: 0 }, { region: 'West', product: 'B', value: 20 }, { region: 'East', product: 'B', value: 10 }];
 it('groups, pivots, ranks and filters a sales dashboard without mutation', () => {
 expect(GroupBy.fn({ rows, key:'region', field:'value' })).toEqual([{key:'East',value:10},{key:'West',value:20}]);
 expect(GroupBy.fn({ rows, key:'region' })).toEqual([{key:'East',value:2},{key:'West',value:1}]);
 expect(Pivot.fn({rows,rowKey:'region',colKey:'product',field:'value'})).toEqual([{key:'East',A:0,B:10},{key:'West',A:0,B:20}]);
 expect(Top.fn({rows,field:'value',n:2})).toEqual([rows[1],rows[2]]);
 expect(Top.fn({rows:[null,2,2],field:'',n:3})).toEqual([2,2,null]);
 expect(Between.fn({rows,field:'value',min:10,max:null})).toEqual([rows[1],rows[2]]);
 expect(Between.fn({rows,field:'value',min:0,max:0})).toEqual([rows[0]]);
 expect(Between.fn({rows,field:'value',min:20,max:10})).toEqual([]);
 expect(rows[0].value).toBe(0);
 });
 it('buckets operations data with UTC dates, gaps and invalid dates', () => {
 const events=[{d:'2026-01-01',n:2},{d:'2026-01-03',n:4},{d:'2026-02-30',n:100}];
 expect(Bucket.fn({rows:events,dateField:'d',unit:'day',field:'n'})).toEqual([{key:'2026-01-01',value:2},{key:'2026-01-02',value:0},{key:'2026-01-03',value:4}]);
 expect(Bucket.fn({rows:events,dateField:'d',unit:'week'})).toEqual([{key:'2025-12-29',value:2}]);
 expect(Bucket.fn({rows:events,dateField:'d',unit:'month',field:'n',agg:'avg'})).toEqual([{key:'2026-01',value:3}]);
 expect(Bucket.fn({rows:[{d:'2026-01-01T23:00:00-02:00'}],dateField:'d',unit:'day'})).toEqual([{key:'2026-01-02',value:1}]);
 expect(()=>Bucket.fn({rows:[{d:'0100-01-01'},{d:'9999-01-01'}],dateField:'d',unit:'day',agg:'avg'})).toThrow();
 });
 it('calculates running and rolling values and changes including zero',()=>{
 expect(Cumulative.fn({rows:[0,2,null,4],field:''})).toEqual([0,2,2,6]);
 expect(MovingAvg.fn({rows:[2,4,6],field:'',window:2})).toEqual([2,3,5]);
 expect(Change.fn({current:120,previous:100})).toBe(20);
 expect(Change.fn({current:0,previous:0})).toBeNull();
 expect(Change.fn({current:0,previous:-10})).toBe(100);
 });
 it('rejects dotted writes while preserving top-level and number-list transforms', () => {
 const nested = [{ metric: { value: 2 } }, { metric: { value: 4 } }];
 expect(Cumulative.params.safeParse({ rows: nested, field: 'metric.value' }).success).toBe(false);
 expect(MovingAvg.params.safeParse({ rows: nested, field: 'metric.value', window: 2 }).success).toBe(false);
 expect(() => Cumulative.fn({ rows: nested, field: 'metric.value' })).toThrow();
 expect(() => MovingAvg.fn({ rows: nested, field: 'metric.value', window: 2 })).toThrow();
 expect(Cumulative.fn({ rows: [{ value: 2 }, { value: 4 }], field: 'value' })).toEqual([{ value: 2 }, { value: 6 }]);
 expect(MovingAvg.fn({ rows: [{ value: 2 }, { value: 4 }], field: 'value', window: 2 })).toEqual([{ value: 2 }, { value: 3 }]);
 expect(Cumulative.fn({ rows: [2, 4], field: '' })).toEqual([2, 6]);
 expect(MovingAvg.fn({ rows: [2, 4], field: '', window: 2 })).toEqual([2, 3]);
 expect(Between.fn({ rows: nested, field: 'metric.value', min: 3 })).toEqual([nested[1]]);
 });
 it('calculates histogram boundaries and population stats with empty data',()=>{
 expect(Histogram.fn({values:[0,1,2,3,4],bins:2})).toEqual([{key:'0',value:2,start:0,end:2},{key:'2',value:3,start:2,end:4}]);
 expect(Histogram.fn({values:[],bins:1})).toEqual([{key:'0',value:0,start:0,end:1}]);
 expect(Stats.fn({values:[]})).toEqual({count:0,min:0,max:0,mean:0,median:0,stdev:0});
 expect(Stats.fn({values:[1,3]})).toEqual({count:2,min:1,max:3,mean:2,median:2,stdev:1});
 });
 it('retains signed fractional and large dashboard metrics', () => {
 const sales = Stats.fn({ values: [0, 100, 100] });
 expect(sales.mean).toBeCloseTo(66.6666666667);
 expect(sales.median).toBe(100);
 const signed = Stats.fn({ values: [-1000.5, 500.25] });
 expect(signed).toMatchObject({ count: 2, min: -1000.5, max: 500.25, mean: -250.125, median: -250.125 });
 expect(signed.stdev).toBe(750.375);
 expect(Stats.fn({ values: [1000.5] })).toEqual({ count: 1, min: 1000.5, max: 1000.5, mean: 1000.5, median: 1000.5, stdev: 0 });
 expect(Histogram.fn({ values: [-0.5, 0.5], bins: 2, min: -0.5, max: 0.5 })).toEqual([{ key: '-0.5', value: 1, start: -0.5, end: 0 }, { key: '0', value: 1, start: 0, end: 0.5 }]);
 expect(Histogram.fn({ values: [1000.5], bins: 1, min: 1000.25, max: 1000.75 })[0].value).toBe(1);
 });
 it('rejects unsafe keys, inherited properties, excessive input and nonfinite output',()=>{
 for(const key of ['__proto__','constructor','x.prototype']) expect(()=>GroupBy.fn({rows,key})).toThrow();
 expect(()=>GroupBy.fn({rows:[JSON.parse('{"__proto__":1}')],key:'x'})).toThrow();
 expect(()=>GroupBy.fn({rows:[Object.create({x:1})],key:'x'})).toThrow();
 for(const b of ['constructor','key']) expect(()=>Pivot.fn({rows:[{a:'x',b}],rowKey:'a',colKey:'b'})).toThrow();
 expect(()=>GroupBy.fn({rows:Array(201).fill(0),key:''})).toThrow();
 expect(()=>Stats.fn({values:[Infinity]})).toThrow();
 expect(()=>Cumulative.fn({rows:[Number.MAX_VALUE,Number.MAX_VALUE],field:''})).toThrow();
 expect(()=>MovingAvg.fn({rows:[1],field:'',window:0})).toThrow();
 expect(()=>Histogram.fn({values:[1],bins:201})).toThrow();
 expect(()=>Histogram.fn({values:[],bins:2,min:-Number.MAX_VALUE,max:Number.MAX_VALUE})).toThrow();
 expect(()=>GroupBy.fn({rows:['x'.repeat(20_001)],key:''})).toThrow();
 expect(dashboardFunctions).toHaveLength(10);
 });
});
