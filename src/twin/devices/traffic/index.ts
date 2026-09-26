/**
 * Traffic & parking digital twins (scenes `traffic-light` and `parking-garage`).
 *
 * Coordinate notes for scene authors
 *  - Meters, Y up. Most devices face +Z (see each file's header for its origin).
 *  - <Car/>, <CarFleet/> and <Pedestrian/> FACE +X, origin = center on the ground, so the scene logics'
 *    pose helpers (`trafficCarPose`, `garageCarPose`, `pedestrianPose`: x, z, yaw about +Y) plug in
 *    directly: position={[x, 0, z]} rotation={[0, yaw, 0]}. `variant` 0..7 picks style & paint.
 *  - <Intersection/> uses the traffic scene's plan frame (x = east, z = south, NS road along Z) and
 *    its defaults match TRAFFIC_GEOMETRY (3.5 m lanes, stop bars at 8 m, crosswalks centred 5.5 m).
 *  - Signal heads hang below their origin (hanger top). Put them under a mast arm with
 *    <SignalPole arms={[{ length, angle, attachments: [{ at, node: <TrafficSignalHead …/>, flip }] }]} />.
 *    Arm heading `angle` a: arm direction (cos a, 0, −sin a); heads face (sin a, 0, cos a), or the
 *    opposite with `flip` (far-side heads facing approaching traffic). The default arm height (6.4 m)
 *    gives ≈ 16.5 ft to the backplate bottom (MUTCD 4D.15 min 15 ft); `mastArmHeightForClearance()`
 *    solves the arm height for a target clearance (pass `baseElevation` for poles on a curb).
 *  - `poleRadiusAt(y)` gives the shaft radius for pole attachments (e.g. PedestrianPushButton
 *    `mount="none" poleRadius={…}` draws its own saddle adapter + band clamps; use `bands: false`).
 *  - Lamps take LedMode getters (boolean | 'on' | 'flash' | 'flash-fast'); flashing driven by the PLC
 *    should simply return booleans.
 *  - Operator devices (PedestrianPushButton, TicketDispenser) are momentary: onPress/onRelease, and
 *    animate from getPressed() so automated test presses animate too. Car, BarrierGate and the
 *    SignalCabinet door take onClick / onDoorClick with a pointer cursor + hover highlight.
 *  - SignalCabinet: `getLoadSwitchLed(slot, lamp)` mirrors PLC outputs on the 12 load-switch LEDs;
 *    keep the controller inside `SIGNAL_CABINET_DIMS.controllerZone` (back-panel coordinates).
 *  - Draw calls: static parts of each device are merged into one mesh with per-vertex finishes
 *    (`vcMaterial`): signal head 2, ped signal 2, pole ≈ 6 + attachments, gate ≈ 7.
 *  - Use <CarFleet/> (instanced, ≈ 23 draw calls total for any number of cars) for traffic;
 *    <Car/> costs ≈ 10 draw calls each.
 */
export * from './TrafficSignalHead';
export * from './PedestrianSignal';
export * from './PedestrianPushButton';
export * from './SignalPole';
export * from './SignalCabinet';
export * from './InductiveLoopMarking';
export * from './BarrierGate';
export * from './TicketDispenser';
export * from './LedSign';
export * from './ClearanceBar';
export * from './Car';
export * from './Pedestrian';
export * from './Road';
