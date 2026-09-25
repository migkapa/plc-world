// Barrel for src/twin/devices/plc/controllogix — ControlLogix 1756 digital twins.
export {
  CLX,
  chassisLayout as controlLogixChassisLayout,
  type ChassisCatalog as ControlLogixChassisCatalog,
  type ChassisLayout as ControlLogixChassisLayout,
  type PowerSupplyCatalog as PowerSupply1756Catalog,
} from './dims';
export { ControlLogixChassis, slotX as controlLogixSlotX, type ControlLogixChassisProps } from './Chassis';
export { PowerSupply1756, type PowerSupply1756Props } from './PowerSupply';
export { Controller1756L8, type Controller1756L8Props, type ControllerCatalog1756 } from './Controller';
export { Comm1756, type Comm1756Props, type CommCatalog1756 } from './Comm';
export {
  DigitalModule1756,
  AnalogModule1756,
  type DigitalModule1756Props,
  type AnalogModule1756Props,
  type DigitalCatalog1756,
  type AnalogCatalog1756,
} from './IoModules';
export { SlotFiller1756N2, type SlotFiller1756N2Props } from './SlotFiller';
export { ControlLogixRack, RACK_LOD_PX, type ControlLogixRackComponentProps, type ControlLogixRackExtraProps } from './Rack';
export { ControlLogixRackImpostor } from './RackImpostor';
export {
  DotMatrixDisplay as DotMatrixDisplay1756,
  type DotMatrixDisplayProps as DotMatrixDisplay1756Props,
  type StatusLedState as StatusLedState1756,
} from './shared';
