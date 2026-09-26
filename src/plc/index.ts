/**
 * Logix 5000 runtime public API (headless — no React/DOM/three).
 */
export * from './types';
export * from './neutralText';
export {
  MODULE_CATALOG,
  MODULE_DATA_TYPES,
  CHASSIS_SLOTS,
  ioTagsForHardware,
  ioEchoPairs,
  ioKindOfPath,
  pointOperand,
  pointEchoOperand,
  moduleForSlot,
  controllerModule,
  hasIoModules,
  runModeOperands,
  type CatalogEntry,
} from './catalog';
export {
  createTagDatabase,
  parseOperandPath,
  isValidTagName,
  TIMER_TYPE,
  COUNTER_TYPE,
  CONTROL_TYPE,
  BUILTIN_TYPES,
  type LogixTagDatabase,
  type OperandRef,
} from './tags';
export { compileExpression, ExpressionError, type CompiledExpression, type NumSource } from './expression';
export { roundHalfEven, parseNumericLiteral, toDint, toInt, toSint, toReal, type NumericLiteral } from './convert';
export { TagError, PlcFault, FAULT_TEXT, faultText, faultId } from './errors';
export {
  INSTRUCTIONS,
  INSTRUCTION_DEFS,
  INSTRUCTION_CATEGORIES,
  getInstruction,
  instructionsByCategory,
  isOutputInstruction,
  type InstructionDef,
} from './instructions';
export { verifyProject, formatVerifyError } from './verify';
export { createController, SYSTEM_FLAGS, type LogixController, type ControllerOptions } from './controller';
