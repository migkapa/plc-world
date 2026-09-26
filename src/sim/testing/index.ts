/**
 * Test utilities for scene models (FakeIo, harness, conformance suite) plus the shared scene kit.
 *
 * NOTE: `sceneContract.ts` imports vitest — production code must import `./sceneKit` directly,
 * never this barrel.
 */
export { FakeIo } from './fakeIo';
export { createHarness } from './harness';
export type { FakePlc, HarnessOptions, SceneHarness } from './harness';
export { sceneContractSuite } from './sceneContract';
export type { ContractOptions } from './sceneContract';
export * from './sceneKit';
