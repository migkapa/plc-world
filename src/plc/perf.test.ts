import { describe, expect, it } from 'vitest';
import { bool, counter, dint, real, runLogic, timer } from './testUtils';
import type { TagDef } from './types';

describe('performance', () => {
  it('scans a 200-rung program in well under 1 ms', () => {
    const tags: TagDef[] = [
      bool('Run', { initial: true }),
      bool('Bits', { dims: 64 }),
      dint('Idx'),
      dint('Words', { dims: 50 }),
      real('Levels', { dims: 50 }),
      timer('Timers', { dims: 50 }),
      counter('Counters', { dims: 50 }),
    ];
    const rungs: string[] = [];
    for (let i = 0; i < 50; i++) {
      rungs.push(`XIC(Run)[XIC(Bits[${i}]),XIO(Bits[${i + 1}])XIC(Local:1:I.Data.${i % 16})]OTE(Bits[${i + 2}]);`);
      rungs.push(`XIC(Bits[${i + 2}])TON(Timers[${i}],${1000 + i},0);`);
      rungs.push(`XIC(Timers[${i}].DN)CTU(Counters[${i}],10,0)ADD(Words[${i}],1,Words[${i}]);`);
      rungs.push(`GRT(Levels[${i}],50.0)MOV(Words[Idx],Words[${i}])CPT(Levels[${i}],Levels[${i}] * 0.5 + 1.0);`);
    }
    expect(rungs).toHaveLength(200);
    const plc = runLogic(rungs, tags);
    for (let i = 0; i < 200; i++) plc.scan(10); // warm up the JIT
    const n = 2000;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      plc.writeInputFromField(`Local:1:I.Data.${i % 16}`, (i & 1) === 0);
      plc.scan(10);
    }
    const perScan = (performance.now() - t0) / n;
    expect(plc.getStatus().mode).toBe('REM_RUN');
    expect(perScan).toBeLessThan(1);
    // eslint-disable-next-line no-console
    console.log(`200-rung scan: ${(perScan * 1000).toFixed(1)} µs (simulated scan time ${plc.getStatus().lastScanMs} ms)`);
  });
});
