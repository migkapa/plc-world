import { describe, expect, it } from 'vitest';
import {
  MODULE_CATALOG,
  ioEchoPairs,
  ioKindOfPath,
  ioTagsForHardware,
  moduleForSlot,
  pointEchoOperand,
  pointOperand,
  runModeOperands,
} from './catalog';
import { createTagDatabase, type LogixTagDatabase } from './tags';
import { TEST_HARDWARE, TEST_HARDWARE_5380 } from './testUtils';
import type { HardwareConfig } from './types';

function dbFor(hw: HardwareConfig): LogixTagDatabase {
  const db = createTagDatabase();
  const io = ioTagsForHardware(hw);
  for (const t of io.types) db.registerDataType(t);
  for (const t of io.tags) db.define(t);
  return db;
}

describe('module catalog', () => {
  it('knows every catalog number with consistent metadata', () => {
    for (const [cat, info] of Object.entries(MODULE_CATALOG)) {
      expect(info.catalog).toBe(cat);
      if (info.kind === 'CPU' || info.kind === 'COMM') {
        expect(info.points).toBe(0);
        expect(info.inputType).toBeUndefined();
      } else {
        expect(info.points).toBeGreaterThan(0);
        expect(info.pointPath).toBeDefined();
      }
    }
    expect(MODULE_CATALOG['5069-L320ER'].platform).toBe('CompactLogix');
    expect(MODULE_CATALOG['1756-OB16E'].kind).toBe('DO');
  });

  it('creates Local:x:C/I/O tags for I/O modules only', () => {
    const { tags } = ioTagsForHardware(TEST_HARDWARE);
    const names = tags.map((t) => t.name);
    expect(names).toEqual([
      'Local:1:C',
      'Local:1:I',
      'Local:2:C',
      'Local:2:I',
      'Local:2:O',
      'Local:3:C',
      'Local:3:I',
      'Local:4:C',
      'Local:4:I',
      'Local:4:O',
    ]);
    expect(tags.every((t) => t.system)).toBe(true);
    expect(names.some((n) => n.startsWith('Local:0') || n.startsWith('Local:5'))).toBe(false);
  });

  it('resolves the ControlLogix operand paths used by the scenes', () => {
    const db = dbFor(TEST_HARDWARE);
    for (let n = 0; n < 16; n++) {
      expect(db.typeOf(`Local:1:I.Data.${n}`)).toBe('BOOL');
      expect(db.typeOf(`Local:2:O.Data.${n}`)).toBe('BOOL');
    }
    expect(db.exists('Local:1:I.Data.16')).toBe(true); // DINT word: bits 16-31 exist (unused points)
    expect(db.exists('Local:1:I.Data.32')).toBe(false);
    expect(db.typeOf('Local:1:I.Fault')).toBe('DINT');
    expect(db.typeOf('Local:2:I.Data')).toBe('DINT');
    expect(db.typeOf('Local:2:I.FuseBlown')).toBe('DINT');
    expect(db.typeOf('Local:3:I.Ch0Data')).toBe('REAL');
    expect(db.typeOf('Local:3:I.Ch7Data')).toBe('REAL');
    expect(db.typeOf('Local:3:I.ChannelFaults')).toBe('INT');
    expect(db.typeOf('Local:3:I.Ch0Fault')).toBe('BOOL');
    expect(db.typeOf('Local:4:O.Ch0Data')).toBe('REAL');
    expect(db.typeOf('Local:4:I.Ch1Data')).toBe('REAL');
    expect(db.readNumber('Local:3:C.Ch0HighEngineering')).toBe(100);
    expect(db.readNumber('Local:1:C.FilterOffOn_0_7')).toBe(1);
  });

  it('maps IF8 channel fault bits onto ChannelFaults', () => {
    const db = dbFor(TEST_HARDWARE);
    db.writeBool('Local:3:I.Ch2Fault', true);
    expect(db.readNumber('Local:3:I.ChannelFaults')).toBe(4);
    db.writeNumber('Local:3:I.ChannelFaults', 1);
    expect(db.readBool('Local:3:I.Ch0Fault')).toBe(true);
    expect(db.readBool('Local:3:I.Ch2Fault')).toBe(false);
  });

  it('resolves the Compact 5000 I/O operand paths used by the scenes', () => {
    const db = dbFor(TEST_HARDWARE_5380);
    expect(db.typeOf('Local:1:I.Pt00.Data')).toBe('BOOL');
    expect(db.typeOf('Local:1:I.Pt15.Fault')).toBe('BOOL');
    expect(db.typeOf('Local:1:I.RunMode')).toBe('BOOL');
    expect(db.typeOf('Local:1:I.ConnectionFaulted')).toBe('BOOL');
    expect(db.typeOf('Local:2:O.Pt07.Data')).toBe('BOOL');
    expect(db.typeOf('Local:2:I.Pt07.Fault')).toBe('BOOL');
    expect(db.typeOf('Local:3:I.Ch00.Data')).toBe('REAL');
    expect(db.typeOf('Local:3:I.Ch07.Uncertain')).toBe('BOOL');
    expect(db.typeOf('Local:4:O.Ch03.Data')).toBe('REAL');
    expect(db.exists('Local:1:I.Pt16.Data')).toBe(false);
    expect(db.exists('Local:0:I')).toBe(false);
  });

  it('builds point operands and slot lookups', () => {
    expect(pointOperand('1756-IB16', 1, 3)).toBe('Local:1:I.Data.3');
    expect(pointOperand('1756-OB16E', 2, 15)).toBe('Local:2:O.Data.15');
    expect(pointOperand('1756-IF8', 3, 1)).toBe('Local:3:I.Ch1Data');
    expect(pointOperand('5069-IB16', 1, 5)).toBe('Local:1:I.Pt05.Data');
    expect(pointOperand('5069-OF4', 4, 3)).toBe('Local:4:O.Ch03.Data');
    expect(pointOperand('1756-IB16', 1, 16)).toBeUndefined();
    expect(pointOperand('1756-L85E', 0, 0)).toBeUndefined();
    expect(pointEchoOperand('5069-OB16', 2, 1)).toBe('Local:2:I.Pt01.Data');
    expect(moduleForSlot(TEST_HARDWARE, 3)?.catalog).toBe('1756-IF8');
    expect(moduleForSlot(TEST_HARDWARE, 9)).toBeUndefined();
    expect(ioEchoPairs(TEST_HARDWARE)).toHaveLength(16 + 8);
    expect(runModeOperands(TEST_HARDWARE_5380)).toEqual([
      'Local:1:I.RunMode',
      'Local:2:I.RunMode',
      'Local:3:I.RunMode',
      'Local:4:I.RunMode',
    ]);
    expect(ioKindOfPath('Local:2:O.Data.3')).toBe('O');
    expect(ioKindOfPath('Local:12:I')).toBe('I');
    expect(ioKindOfPath('Motor')).toBeUndefined();
  });
});
