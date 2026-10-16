import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** Menu/orbit/broadcast cameras must never inherit first-person self-culling. */
export function bikeFirstPersonView(
  mode: string,
  menu: boolean,
  pregame: boolean,
  photoView?: string,
) {
  return (
    !pregame &&
    (!photoView || photoView === 'cockpit') &&
    (!menu || !!photoView) &&
    mode === 'cockpit'
  );
}

export interface BikeInstrumentValues {
  speed?: number;
  gear?: number;
  rpm?: number;
}
/** F.GEAR uses reverse=0, neutral=1, first=2, not the displayed gear number. */
export function bikeInstrumentReadout(values: BikeInstrumentValues, limiterRPM: number) {
  const finite = (v: number | undefined) => (Number.isFinite(v) ? v! : 0);
  return {
    speed: Math.round(Math.max(0, finite(values.speed)) * 3.6),
    gear: !Number.isFinite(values.gear)
      ? 'N'
      : finite(values.gear) <= 0
        ? 'R'
        : finite(values.gear) < 2
          ? 'N'
          : String(Math.round(finite(values.gear)) - 1),
    rpm: Math.round(Math.max(0, finite(values.rpm)) / 100) * 100,
    fill: T.MathUtils.clamp(finite(values.rpm) / Math.max(1, finite(limiterRPM)), 0, 1),
  };
}
/** One small cockpit canvas per high LOD, redrawn only when its quantised
 * snapshot readout changes. It never invents speed or gear from wall time. */
export class BikeCockpit {
  readonly root = new T.Group();
  private readonly canvas = document.createElement('canvas');
  private readonly texture: T.CanvasTexture;
  private readonly material: T.MeshBasicMaterial;
  private readonly shellMaterial = new T.MeshStandardMaterial({ color: 0x101316, roughness: 0.46 });
  private key = '';
  constructor(private readonly limiterRPM: number) {
    this.canvas.width = 512;
    this.canvas.height = 256;
    this.texture = new T.CanvasTexture(this.canvas);
    this.texture.colorSpace = T.SRGBColorSpace;
    this.texture.userData.dynamic = true;
    this.texture.anisotropy = 4;
    this.material = new T.MeshBasicMaterial({ map: this.texture, toneMapped: false });
    this.root.name = 'Snapshot-driven GP instruments';
    const shell = new T.Mesh(
      new RoundedBoxGeometry(0.152, 0.081, 0.018, 2, 0.006),
      this.shellMaterial,
    );
    shell.castShadow = shell.receiveShadow = true;
    this.root.add(shell);
    const display = new T.Mesh(new T.PlaneGeometry(0.132, 0.066), this.material);
    display.name = 'GP instrument display';
    // The face looks back and up towards the rider, not down into the cowl.
    display.rotation.y = Math.PI;
    display.position.z = -0.0095;
    this.root.add(display);
    // Recessed below the windscreen; the cowl provides a real open well.
    this.root.position.set(0, 0.31, 0.6);
    this.root.rotation.x = 0.72;
    this.update({});
  }
  update(values: BikeInstrumentValues) {
    const r = bikeInstrumentReadout(values, this.limiterRPM);
    const lamps = Math.round(r.fill * 12);
    const key = `${r.speed}/${r.gear}/${r.rpm}/${lamps}`;
    if (key === this.key) return;
    this.key = key;
    const c = this.canvas.getContext('2d');
    if (!c) return;
    c.fillStyle = '#0b1014';
    c.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 12; i++) {
      c.fillStyle = i >= lamps ? '#243039' : i < 6 ? '#a1d8bc' : i < 10 ? '#f0cc70' : '#f06049';
      c.fillRect(16 + i * 40, 14, 33, 13);
    }
    c.fillStyle = '#e5ecee';
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    c.font = '700 30px sans-serif';
    c.fillText('MOTOBOUND', 18, 66);
    c.fillStyle = '#8fa0a9';
    c.font = '22px monospace';
    c.fillText('GEAR', 21, 106);
    c.fillText('KM/H', 220, 106);
    c.fillStyle = '#f0f2ec';
    c.font = '700 104px monospace';
    c.fillText(r.gear, 18, 205);
    c.font = '700 92px monospace';
    c.fillText(String(r.speed).padStart(3, '0'), 218, 203);
    c.fillStyle = '#8fa0a9';
    c.font = '22px monospace';
    c.fillText(`${r.rpm} RPM`, 21, 242);
    this.texture.needsUpdate = true;
  }
  dispose() {
    this.texture.dispose();
    this.material.dispose();
    this.shellMaterial.dispose();
  }
}
