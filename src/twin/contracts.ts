/**
 * Prop contracts for the 3D digital-twin device components.
 * See `common.tsx` for units/orientation/live-getter conventions.
 *
 * Component files live in `src/twin/devices/**` and are re-exported from `src/twin/devices/index.ts`.
 */
import type { ReactNode } from 'react';
import type { ControllerStatus, HardwareConfig, KeySwitch } from '../plc/types';
import type { LedColor } from './common';

export type Vec3 = [number, number, number];

export interface Placement {
  position?: Vec3;
  rotation?: Vec3;
  scale?: number;
}

// ---------------------------------------------------------------------------
// PLC hardware (ControlLogix 1756 / CompactLogix 5380)
// ---------------------------------------------------------------------------

/** Live connection from a rack to the running controller. Create with `rackLiveFromController()`. */
export interface RackLive {
  status(): ControllerStatus;
  /** Digital point state for the module in `slot` (DI: input image, DO: output driven to field). */
  point(slot: number, index: number): boolean;
  /** Analog channel value in engineering units for AI/AO modules. */
  channel(slot: number, ch: number): number;
  /** Operator turned the controller key switch (click on the key in 3D). */
  setKeySwitch?(pos: KeySwitch): void;
}

export interface RackProps extends Placement {
  hardware: HardwareConfig;
  live?: RackLive;
  /** Show the module doors open (reveals RTB wiring on I/O modules). */
  doorsOpen?: boolean;
  /** Called when a module is clicked (for info panels / I/O tree selection). */
  onSelectModule?: (slot: number) => void;
  /** Highlight a slot (hover in the I/O tree). */
  highlightSlot?: number;
}

/** <ControlLogixRack/>: 1756 chassis + power supply + modules. Origin: back-bottom-center of the chassis. */
export type ControlLogixRackProps = RackProps;
/** <CompactLogixRack/>: 5069 controller + local I/O modules + end cap on a DIN rail. Origin: back-bottom-center. */
export type CompactLogixRackProps = RackProps;

export interface PowerFlex525Props extends Placement {
  /** Output frequency in Hz (0..60). */
  getFrequency: () => number;
  getRunning: () => boolean;
  getFaulted?: () => boolean;
  /** Direction for the FWD/REV indicator. */
  getReverse?: () => boolean;
  /** Frame size A..E (affects dimensions). */
  frame?: 'A' | 'B' | 'C';
}

export interface PanelView5310Props extends Placement {
  /** Screen size in inches. */
  size?: 7 | 9 | 10 | 12 | 15;
  /** HTML content rendered on the screen (interactive). */
  children?: ReactNode;
  /** Screen content pixel resolution (default 800x480 for 7"). */
  resolution?: [number, number];
}

// ---------------------------------------------------------------------------
// Operator devices (22.5 mm 800F family, 855T stack lights, trainer devices)
// ---------------------------------------------------------------------------

export type OperatorColor = 'green' | 'red' | 'black' | 'yellow' | 'blue' | 'white' | 'amber';

export interface PushButtonProps extends Placement {
  color: OperatorColor;
  /** 800F operator style. */
  style?: 'flush' | 'extended' | 'mushroom';
  /** Legend plate text shown above the button, e.g. 'START'. */
  legend?: string;
  /** Illuminated push button lens state. */
  getLit?: () => boolean;
  /** Visual pressed state (so tests/automation pressing it animate too). */
  getPressed: () => boolean;
  onPress?: () => void;
  onRelease?: () => void;
  /** Contact block label for tooltips, e.g. 'N.O.' / 'N.C.'. */
  contact?: 'N.O.' | 'N.C.';
}

export interface EStopProps extends Placement {
  /** True while the mushroom is pushed in (latched). */
  getEngaged: () => boolean;
  /** Click toggles: push to engage, twist-release to reset. */
  onToggle?: () => void;
  legend?: string;
}

export interface SelectorSwitchProps extends Placement {
  positions: string[];
  getPosition: () => number;
  onChange?: (index: number) => void;
  legend?: string;
  /** Knob style. */
  knob?: 'standard' | 'long-lever';
  color?: OperatorColor;
}

export interface PilotLightProps extends Placement {
  color: LedColor;
  getLit: () => boolean;
  legend?: string;
}

export interface StackLightProps extends Placement {
  /** Tier colors from TOP to BOTTOM. */
  tiers: LedColor[];
  /** Lit state per tier index (0 = top). */
  getTier: (index: number) => boolean;
  /** Optional audible module (shows a vibrating horn tier). */
  getHorn?: () => boolean;
  /** Mounting: pole on a base (855T), 'side' bracket or direct 'top' of cabinet. */
  mount?: 'pole' | 'base';
}

export interface ToggleSwitchProps extends Placement {
  getOn: () => boolean;
  onToggle?: () => void;
  legend?: string;
}

export interface PotentiometerProps extends Placement {
  /** 0..100 %. */
  getValue: () => number;
  onChange?: (value: number) => void;
  legend?: string;
}

export interface AnalogMeterProps extends Placement {
  /** 0..100 % of scale. */
  getValue: () => number;
  legend?: string;
  /** Scale end labels. */
  scaleLabels?: [string, string];
  units?: string;
}

// ---------------------------------------------------------------------------
// Panel / cabinet components
// ---------------------------------------------------------------------------

export interface EnclosureProps extends Placement {
  /** Outer size in meters: width, height, depth. */
  size: Vec3;
  /** Door open angle in radians (0 = closed). */
  doorAngle?: number;
  color?: string;
  /** Components mounted on the backplate: children positioned in backplate coordinates (origin = backplate center, +Z out). */
  children?: ReactNode;
  /** Items mounted on the door front (push buttons...), door-local coords (origin = door center, +Z out). */
  doorChildren?: ReactNode;
  /** Show a legend/nameplate on the door. */
  nameplate?: string;
}

export interface ContactorProps extends Placement {
  getEnergized: () => boolean;
  /** Catalog (for the label), e.g. '100-C09'. */
  catalog?: string;
}

export interface OverloadRelayProps extends Placement {
  getTripped: () => boolean;
  catalog?: string;
}

export interface TerminalBlocksProps extends Placement {
  count: number;
  /** Colors per block (default gray). */
  colors?: string[];
  labels?: string[];
}

// ---------------------------------------------------------------------------
// Field devices
// ---------------------------------------------------------------------------

export interface MotorProps extends Placement {
  /** Shaft speed in RPM (drives shaft & fan rotation). */
  getRpm: () => number;
  /** NEMA-ish frame scale, 'small' ~0.25 m long, 'medium' ~0.45 m. */
  frame?: 'small' | 'medium' | 'large';
  color?: string;
  /** Show a warm glow / vibration when overloaded. */
  getOverloaded?: () => boolean;
}

export interface PhotoEyeProps extends Placement {
  /** Beam blocked by an object. */
  getBlocked: () => boolean;
  /** Sensor output state (what goes to the PLC; LED indicator). */
  getOutput: () => boolean;
  /** Beam length to the reflector (m); draws the beam & reflector when > 0. */
  beamLength?: number;
  /** Show the red emitter beam. */
  showBeam?: boolean;
}

export interface ProxSensorProps extends Placement {
  getActive: () => boolean;
  /** Barrel diameter (m), default 0.018 (M18). */
  diameter?: number;
}

export interface CylinderProps extends Placement {
  /** 0 = retracted, 1 = fully extended. */
  getExtension: () => number;
  stroke?: number;
  bore?: number;
  /** Optional reed switch LEDs. */
  getRetractedSensor?: () => boolean;
  getExtendedSensor?: () => boolean;
}

export interface SolenoidValveProps extends Placement {
  getEnergized: () => boolean;
  /** Process valve (pipe) or pneumatic valve (manifold). */
  variant?: 'process' | 'pneumatic';
  pipeDiameter?: number;
}

export interface ConveyorProps extends Placement {
  length: number;
  width?: number;
  /** Height of the belt surface above the floor. */
  height?: number;
  /** Belt travel distance in meters (monotonic) — used to scroll the belt texture/rollers. */
  getBeltPosition: () => number;
  /** Show side guards. */
  guards?: boolean;
}

export interface TankProps extends Placement {
  /** Liquid level 0..100 %. */
  getLevel: () => number;
  /** Liquid temperature (°C) for color tinting. */
  getTemperature?: () => number;
  /** Agitator speed in RPM. */
  getAgitatorRpm?: () => number;
  diameter?: number;
  height?: number;
  /** Cut-away view to see the liquid. */
  cutaway?: boolean;
  liquidColor?: string;
}

export interface LevelSwitchProps extends Placement {
  getActive: () => boolean;
}

export interface TransmitterProps extends Placement {
  /** Value shown on the local display. */
  getValue: () => number;
  units: string;
  tagLabel?: string;
}
