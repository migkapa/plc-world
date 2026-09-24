// Barrel for src/twin/devices/field — process & machine field devices (digital twins).
export { Motor, MotorBody, GearMotor, MOTOR_FRAMES, MOTOR_BLUE, GEARMOTOR, motorBodyLength, motorFinTip, gearMotorTorqueArmEnd } from './Motor';
export type { MotorFrame, MotorFrameSpec, MotorBodyProps, MotorExtraProps, GearMotorProps } from './Motor';
export { PhotoEye42EF, Retroreflector } from './PhotoEye';
export type { PhotoEyeExtraProps } from './PhotoEye';
export { ProxSensor872C } from './Prox';
export type { ProxExtraProps } from './Prox';
export { PneumaticCylinder, isoCylinderSize } from './Cylinder';
export type { CylinderExtraProps } from './Cylinder';
export { SolenoidValve } from './Valves';
export type { SolenoidValveExtraProps } from './Valves';
export { Conveyor, conveyorLayout, CONVEYOR, StaticInstances as FieldStaticInstances } from './Conveyor';
export type { ConveyorExtraProps, InstanceXf } from './Conveyor';
export { Boxes, CardboardBox, BOX_SIZES, boxGeometry, boxMaterial } from './Boxes';
export type { BoxKind, BoxState, BoxesProps } from './Boxes';
export { Tank, tankLayout, OnNozzle, nozzleLocal, TANK_LIQUID_COLOR } from './Tank';
export type { TankExtraProps, TankLayout, TankNozzle, TankNozzleId } from './Tank';
export { LevelSwitch, LevelTransmitter, TempTransmitter } from './Instruments';
export type { LevelTransmitterExtraProps, TempTransmitterExtraProps } from './Instruments';
export { Pipe, PipeElbow, PipeRun, Flange, SightGlass } from './Piping';
export type { PipeFinish, PipeProps, PipeElbowProps, PipeRunProps, FlangeProps } from './Piping';
export {
  Cable as FieldCable,
  M12Cordset,
  PushInFitting,
  CABLE_YELLOW,
  CABLE_GRAY,
  CABLE_BLACK,
  // cable routing & terminations
  RoutedCable as FieldRoutedCable,
  ConduitStub,
  STUB_TOP as CONDUIT_STUB_TOP,
  CableTie as FieldCableTie,
  JunctionBox as FieldJunctionBox,
  junctionBoxGlands as fieldJunctionBoxGlands,
  DEVICE_ROOT as FIELD_DEVICE_ROOT,
  // static draw-call batching
  Merge as FieldMerge,
} from './shared';
export type { CableRoute as FieldCableRoute } from './shared';
