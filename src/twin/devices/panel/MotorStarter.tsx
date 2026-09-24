/**
 * IEC motor starter: <Contactor100C> with a <OverloadRelay193> (E100 by default) plugged directly underneath.
 * Origin: the contactor's origin (DIN clip plane, rail centerline, contactor center).
 */
import type { Placement } from '../../contracts';
import { C100, Contactor100C } from './Contactor100C';
import { E193, OverloadRelay193, type OverloadVariant } from './OverloadRelay193';

export interface MotorStarterProps extends Placement {
  getEnergized: () => boolean;
  getTripped: () => boolean;
  onReset?: () => void;
  contactorCatalog?: string;
  overloadCatalog?: string;
  /** Overload product (default 'E100'). */
  overloadVariant?: OverloadVariant;
}

/** Overall height of a contactor + overload assembly (m), measured from the contactor top. */
export const MOTOR_STARTER_HEIGHT = C100.h + E193.h;

export function MotorStarter({ getEnergized, getTripped, onReset, contactorCatalog, overloadCatalog, overloadVariant, position, rotation, scale }: MotorStarterProps) {
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <Contactor100C getEnergized={getEnergized} catalog={contactorCatalog} />
      <OverloadRelay193 position={[0, -C100.h / 2 - 0.0005, 0]} getTripped={getTripped} onReset={onReset} catalog={overloadCatalog} variant={overloadVariant} />
    </group>
  );
}
