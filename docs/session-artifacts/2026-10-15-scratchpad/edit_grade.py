p='src/rendering/options.ts'
s=open(p).read()
old="""/** Display transform after exposure. ACES is the calibrated default on every
 * preset; AgX and Khronos Neutral are opt-in alternatives (three 0.180). */"""
new="""/** Display transform after exposure. ACES is the calibrated default on Low,
 * Medium and High; ULTRA defaults to AgX (a soft highlight roll-off without
 * ACES's hue skews and second contrast curve, matched to ACES at mid grey) with
 * its own lighter grade (broadcast-grade.ts FILMIC_GRADE_PROFILES). Khronos
 * Neutral is an opt-in alternative (three 0.180). */"""
assert old in s; s=s.replace(old,new)
old="""function ultraPreset(): GraphicsOptions {
  return {
    ...graphicsPreset('high'),
    shadowSize: 4096,"""
new="""function ultraPreset(): GraphicsOptions {
  return {
    ...graphicsPreset('high'),
    toneMapper: 'agx',
    shadowSize: 4096,"""
assert old in s; s=s.replace(old,new)
s=s.replace("""/** ULTRA: High plus temporal AA (complementing 4x MSAA) with sharpening, SSR,
 * temporal GTAO, a 4096 near sun map inside three cascades, energy-conserving
 * bloom, sun shafts, restrained lens fringe and replay depth of field. */""","""/** ULTRA: High plus temporal AA (complementing 4x MSAA) with sharpening, SSR,
 * temporal GTAO, a 4096 near sun map inside three cascades, energy-conserving
 * bloom, sun shafts, restrained lens fringe, replay depth of field and the AgX
 * display transform with a restrained grade. */""")
open(p,'w').write(s)

p='src/rendering/broadcast-grade.ts'
s=open(p).read()
old="""/** CPU reference of the shader's tone curve; used by tests and documentation. */"""
new="""/** Grade over a filmic display transform (AgX or Khronos Neutral; ULTRA's
 * default). The broadcast profiles above were tuned over ACES, which already
 * adds contrast and saturation; on top of a neutral transform they read as a
 * 'game-punchy' second curve that pushes exactly the muted natural materials
 * (grass, sky, asphalt, foliage). Here the S-curve is light, saturation is
 * neutral and vibrance a hint; tints, vignette and the hue-selective LUT stay. */
export const FILMIC_GRADE_PROFILES: Readonly<
  Record<LightingMode | 'studio', Readonly<GradeProfile>>
> = Object.freeze({
  day: { ...GRADE_PROFILES.day, contrast: 0.08, saturation: 1.0, vibrance: 0.04 },
  sunset: { ...GRADE_PROFILES.sunset, contrast: 0.08, saturation: 1.02, vibrance: 0.04 },
  night: { ...GRADE_PROFILES.night, contrast: 0.07, saturation: 1.0, vibrance: 0.04 },
  studio: { ...GRADE_PROFILES.studio, contrast: 0.07, saturation: 1.0, vibrance: 0.04 },
});

/** CPU reference of the shader's tone curve; used by tests and documentation. */"""
assert old in s; s=s.replace(old,new)
old="""  /** ULTRA restrained lateral chromatic aberration, added to the profile's
   * fringe (0 on every other preset; never applied over a photo look). */
  lensFringe = 0;"""
new="""  /** ULTRA restrained lateral chromatic aberration, added to the profile's
   * fringe (0 on every other preset; never applied over a photo look). */
  lensFringe = 0;
  /** True over a filmic display transform (AgX/Neutral): FILMIC_GRADE_PROFILES. */
  filmic = false;"""
assert old in s; s=s.replace(old,new)
old="""    const p = this.photoOverride ?? GRADE_PROFILES[profile];"""
new="""    const p = this.photoOverride ?? (this.filmic ? FILMIC_GRADE_PROFILES : GRADE_PROFILES)[profile];"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)

p='src/rendering/ultra/pipeline.ts'
s=open(p).read()
old="""    renderer.toneMapping = TONE_MAPPING[graphics.toneMapper];"""
new="""    renderer.toneMapping = TONE_MAPPING[graphics.toneMapper];
    this.host.grade.filmic = graphics.toneMapper !== 'aces';"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)

p='tests/ultra-options.test.ts'
s=open(p).read()
old="""    // Tone mapping stays the calibrated ACES; AgX/Neutral are user choices.
    expect(ultra.toneMapper).toBe('aces');"""
new="""    // ULTRA displays through AgX (with its own restrained grade); Low/Medium/
    // High keep the calibrated ACES.
    expect(ultra.toneMapper).toBe('agx');"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)
