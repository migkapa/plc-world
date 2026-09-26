import { describe, expect, it } from 'vitest';
import { SHOWROOM_DEVICES } from './catalog';
import { deviceMatches } from './DeviceList';
import { matchesQuery } from './search';

const find = (q: string) => SHOWROOM_DEVICES.filter((d) => deviceMatches(d, q)).map((d) => d.id);

describe('showroom search', () => {
  it('ignores spaces, hyphens and dots', () => {
    expect(matchesQuery('Supplies 24 V DC to sensors', '24V')).toBe(true);
    expect(matchesQuery('5069-OB16', '5069 ob16')).toBe(true);
    expect(matchesQuery('Timer On Delay', 'timer delay')).toBe(true);
    expect(matchesQuery('Timer On Delay', 'counter')).toBe(false);
  });
  it('finds devices by common nicknames', () => {
    expect(find('photo eye')).toContain('photo-eye-42ef');
    expect(find('24V')).toContain('1606-xls');
    expect(find('vfd')).toContain('powerflex-525');
    expect(find('hmi')).toContain('panelview-5310');
    expect(find('plc')).toContain('1756-l85e');
    expect(find('e-stop')).toContain('estop-800fm');
  });
});
