/**
 * Minimal pbrt-v4 scene reader for the landscape plant library: the parts of
 * one `ObjectBegin` block (plymesh shapes with their transform, reflectance
 * texture, alpha texture and material type). Node only.
 */
export interface PlantPart {
  /** Relative path of the PLY mesh (geometry/mesh_NNNNN.ply). */
  mesh: string;
  /** Column-major 4x4 transform from the mesh to the object. */
  transform: number[];
  /** Relative path of the reflectance (colour) image, if textured. */
  color: string | null;
  /** Relative path of the alpha image (the colour PNG's alpha for leaves). */
  alpha: string | null;
  /** Relative path of the displacement image (bark relief, leaf veins). */
  bump: string | null;
  /** pbrt material type: coateddiffuse (bark, needles) or diffusetransmission (leaves). */
  material: string;
  /** Constant reflectance when untextured. */
  reflectance: [number, number, number] | null;
}

type Token = string | number | Token[];

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const stack: Token[][] = [out];
  const re = /"([^"]*)"|(\[)|(\])|(#[^\n]*)|([^\s[\]"]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[4]) continue;
    const top = stack.at(-1)!;
    if (m[1] !== undefined) top.push(`"${m[1]}`);
    else if (m[2]) {
      const list: Token[] = [];
      top.push(list);
      stack.push(list);
    } else if (m[3]) stack.pop();
    else {
      const value = Number(m[5]);
      top.push(Number.isFinite(value) && /^[-+.\d]/.test(m[5]) ? value : m[5]);
    }
  }
  return out;
}

const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function multiply(a: number[], b: number[]) {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

/** Parameter list after a directive: `"type name" value` pairs. */
function params(tokens: Token[], start: number) {
  const values = new Map<string, Token[]>();
  let i = start;
  while (
    i < tokens.length &&
    typeof tokens[i] === 'string' &&
    (tokens[i] as string).startsWith('"')
  ) {
    const key = (tokens[i] as string).slice(1).split(/\s+/);
    const raw = tokens[i + 1];
    const list = Array.isArray(raw) ? raw : [raw];
    values.set(key[1] ?? key[0], list);
    i += 2;
  }
  return { values, next: i };
}
const str = (t: Token | undefined) => (typeof t === 'string' ? t.replace(/^"/, '') : null);

/** The plymesh parts of `ObjectBegin "<name>"`. */
export function plantParts(scene: string, name: string): PlantPart[] {
  const begin = scene.indexOf(`ObjectBegin "${name}"`);
  if (begin < 0) throw new Error(`pbrt: object ${name} not found`);
  const end = scene.indexOf('ObjectEnd', begin);
  const tokens = tokenize(scene.slice(begin, end));
  // Texture names are global in pbrt: a block may use one defined elsewhere.
  const textures = new Map<string, string>();
  for (const m of scene.matchAll(
    /Texture "([^"]+)" "[^"]+" "imagemap"\s+"string filename" "([^"]+)"/g,
  ))
    if (!textures.has(m[1])) textures.set(m[1], m[2]);
  interface State {
    transform: number[];
    material: string;
    reflectance: string | null;
    constant: [number, number, number] | null;
    bump: string | null;
  }
  const stack: State[] = [
    { transform: identity(), material: 'diffuse', reflectance: null, constant: null, bump: null },
  ];
  const parts: PlantPart[] = [];
  let i = 2;
  while (i < tokens.length) {
    const directive = tokens[i];
    const state = stack.at(-1)!;
    if (directive === 'AttributeBegin') {
      stack.push({ ...state, transform: [...state.transform] });
      i++;
    } else if (directive === 'AttributeEnd') {
      stack.pop();
      i++;
    } else if (directive === 'ConcatTransform' || directive === 'Transform') {
      const m = tokens[i + 1] as number[];
      state.transform = directive === 'Transform' ? [...m] : multiply(state.transform, m);
      i += 2;
    } else if (directive === 'Texture') {
      const id = str(tokens[i + 1])!;
      const p = params(tokens, i + 4);
      const file = str(p.values.get('filename')?.[0]);
      if (file) textures.set(id, file);
      i = p.next;
    } else if (directive === 'Material' || directive === 'MakeNamedMaterial') {
      const named = directive === 'MakeNamedMaterial';
      const p = params(tokens, i + (named ? 2 : 2));
      if (!named) {
        state.material = str(tokens[i + 1])!;
        const reflectance = p.values.get('reflectance');
        state.reflectance =
          reflectance && typeof reflectance[0] === 'string'
            ? (textures.get(str(reflectance[0])!) ?? null)
            : null;
        state.constant =
          reflectance && typeof reflectance[0] === 'number'
            ? (reflectance.slice(0, 3) as [number, number, number])
            : null;
        const displacement = p.values.get('displacement');
        state.bump = displacement ? (textures.get(str(displacement[0])!) ?? null) : null;
      }
      i = p.next;
    } else if (directive === 'Shape') {
      const p = params(tokens, i + 2);
      const mesh = str(p.values.get('filename')?.[0]);
      const alphaName = str(p.values.get('alpha')?.[0]);
      if (mesh)
        parts.push({
          mesh,
          transform: state.transform,
          color: state.reflectance,
          alpha: alphaName ? (textures.get(alphaName) ?? null) : null,
          bump: state.bump,
          material: state.material,
          reflectance: state.constant,
        });
      i = p.next;
    } else i++;
  }
  return parts;
}
