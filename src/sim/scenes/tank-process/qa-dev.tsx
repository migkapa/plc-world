/** TEMPORARY visual-QA page for the tank effects (boiling / overflow). Not part of the app. */
import { useFrame } from '@react-three/fiber';
import { createRoot } from 'react-dom/client';
import '../../../index.css';
import { SceneCanvas } from '../../../twin/Stage';
import { createDemoRuntime } from '../../demo';
import { definition } from './definition';
import type { TankProcessState } from './logic';

const params = new URLSearchParams(location.search);
const fx = params.get('fx') ?? 'boil';
const d = createDemoRuntime(definition.logic, [], { run: false });
const s = d.runtime.state as TankProcessState;

function apply() {
  s.runningLight = true;
  if (fx === 'boil') {
    s.level = 72;
    s.temperature = 100;
    s.boiling = true;
    s.heaterOn = true;
    s.heaterGlow = 1;
    s.agitatorRpm = 90;
    s.mixerEnergized = true;
  } else if (fx === 'spill') {
    s.level = Number(params.get('level') ?? 100);
    s.spillRate = params.get('nospill') ? 0 : 2;
    s.overflow = !params.get('nospill');
    s.inflowRate = 4.5;
    s.fillValve = true;
    s.fillValveStroke = 1;
    s.fcvStroke = 0.6;
    s.fcvPosition = 60;
    s.temperature = 30;
    s.alarmHorn = !params.get('nohorn');
    s.lshh = false;
    s.lsh = true;
    s.lsl = true;
  } else if (fx === 'fill') {
    s.level = 45;
    s.inflowRate = 4.5;
    s.fillValve = true;
    s.fillValveStroke = 1;
    s.temperature = 55;
    s.heaterOn = true;
    s.heaterGlow = 1;
    s.agitatorRpm = 90;
  }
}
apply();

function Freeze() {
  useFrame(apply);
  return null;
}

const vec = (v: string | null, dflt: [number, number, number]) => (v ? (v.split(',').map(Number) as [number, number, number]) : dflt);
const cam = { id: 'qa', label: 'QA', position: vec(params.get('campos'), [1.6, 2.2, 2.5]), target: vec(params.get('target'), [0, 1.3, 0]) };
const View = definition.View;
createRoot(document.getElementById('root')!).render(
  <SceneCanvas cameras={[cam]} lighting="hall" quality={(params.get('quality') as 'low' | 'medium' | 'high') ?? 'high'}>
    <View state={s} runtime={d.runtime} />
    <Freeze />
  </SceneCanvas>,
);
