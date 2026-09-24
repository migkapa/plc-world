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
 *    opposite with `flip` (far-side heads facing approaching traffic).
 *  - Lamps take LedMode getters (boolean | 'on' | 'flash' | 'flash-fast'); flashing driven by the PLC
 *    should simply return booleans.
 *  - Operator devices (PedestrianPushButton, TicketDispenser) are momentary: onPress/onRelease, and
 *    animate from getPressed() so automated test presses animate too.
 *  - Use <CarFleet/> (instanced, ~34 draw calls total) for traffic; <Car/> costs ~16 draw calls each.
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
