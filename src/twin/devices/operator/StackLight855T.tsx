/**
 * Legacy name. The Bulletin 855T was discontinued and replaced by the 856T Control Tower
 * (see ./StackLight856T). `StackLight855T` is kept so existing scene code keeps compiling; it renders
 * the CURRENT 856T by default — pass `series="855T"` for the legacy look.
 */
import { StackLight856T, type StackLight856TProps } from './StackLight856T';

export { S855, S856, stackLightHeight, type StackLightSeries } from './StackLight856T';

/** @deprecated Use {@link StackLight856T}. Renders the current 856T unless `series="855T"`. */
export const StackLight855T = StackLight856T;
/** @deprecated Use {@link StackLight856TProps}. */
export type StackLight855TProps = StackLight856TProps;
