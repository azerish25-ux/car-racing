p='docs/production/RENDERING_PIPELINE.md'
s=open(p).read()
old="""| Tone mapping | ACES | ACES | ACES | ACES (AgX / Khronos Neutral selectable on any preset) |"""
new="""| Tone mapping | ACES | ACES | ACES | **AgX** with a restrained filmic grade (ACES / Khronos Neutral selectable on any preset) |"""
assert old in s; s=s.replace(old,new)
old="""**Bloom.** The retained pyramid (13-tap downsample, tent upsample, firefly limiter) gains an
energy-conserving mode: no threshold, and the frame becomes `(1 − m)·scene + m·blur(scene)` with
`m = 0.035` (0.055 in wet air) by a constant-alpha blend — a fixed share of every pixel's energy
is redistributed (veiling glare) and total radiance is preserved."""
new="""**Bloom.** The retained pyramid (13-tap downsample, tent upsample, firefly limiter) gains an
energy-conserving mode: no threshold, and the frame becomes `(1 − m)·scene + m·blur(scene)` with
`m = 0.03` by day and at night, 0.02 at the golden hour and 0.045 in wet air
(`physicalBloomMix`) by a constant-alpha blend — a fixed share of every pixel's energy is
redistributed (veiling glare) and total radiance is preserved. The point-spread function is a
real lens's: level-to-level carry 0.45 (0.7 in threshold mode), so about 90 % of the redistributed
share stays within ~8 px and the coarsest level carries under 0.5 % (tight glare around sources,
almost no frame-wide veil). The energy mode has its own prefilter program: it limits only isolated
sub-pixel outliers (taps above 16× the median of the centre and inner diagonal taps), with
half-float-safe ceilings 2000/8000, so emitters authored in physical radiance glow: floodlight
heads (300× white), venue-kit lamps (150×) and rain lights (6×) when the energy bloom is on, their
threshold-mode gains elsewhere. Low/Medium/High keep the threshold prefilter unchanged."""
assert old in s; s=s.replace(old,new)
old="""**Tone mapping and lens.** ACES stays calibrated for the exposure keys and grade LUTs; AgX and
Khronos Neutral are user choices on any preset (`OutputPass` operator only; no other program
changes). Chromatic aberration adds 0.0012 grade fringe (≈ 2 px of red/blue separation in a 1080p
corner, none at the centre) on live and replay views only, never over a photo look or menu."""
new="""**Tone mapping and lens.** ACES stays calibrated for Low/Medium/High with the broadcast grade.
ULTRA defaults to AgX (it matches ACES at mid grey, so the exposure keys hold; soft highlight
roll-off without ACES's hue skews) and, over any filmic transform (AgX or Neutral), the grade uses
`FILMIC_GRADE_PROFILES`: S-curve 0.07–0.08, saturation 1.03–1.05 (offsetting AgX's own
desaturation), vibrance 0.04, with tints, vignette and the hue-selective LUT kept. Chromatic
aberration adds 0.0012 grade fringe (≈ 2 px of red/blue separation in a 1080p corner, none at the
centre) on live and replay views only, never over a photo look or menu. ULTRA's lens dirt is 0.3
(0.9 elsewhere)."""
assert old in s; s=s.replace(old,new)
old="""**Depth of field.** Retained: photo lens, D29 showroom, D30 broadcast telephoto. ULTRA adds the"""
new="""**Depth of field.** Retained: photo lens, D29 showroom. The D30 broadcast telephoto (trackside
lens under 20°, every preset) is a broadcast camera's thin lens: a 2/3-inch B4 gate (5.4 mm) at
f/4, maxblur 0.4 % (`BROADCAST_LENS`), so a 60–150 m pack keeps the frame sharp instead of reading
as a tilt-shift miniature; the pass skips pixels under half a pixel of blur. ULTRA adds the"""
assert old in s; s=s.replace(old,new)
old="""**Sun shafts** (`light-shafts.ts`). Screen-space volumetric scattering in linear HDR before bloom:
a quarter-resolution mask of open sky weighted by a Henyey-Greenstein lobe (g = 0.76), two 24-tap
radial gathers (576 effective samples) and an additive composite scaled by lighting (3× stronger at
sunset) and haze (broken cloud, rain); off at night, in studio backdrops, in menus and when the sun
is behind the camera."""
new="""**Sun shafts** (`light-shafts.ts`). Screen-space volumetric scattering in linear HDR before bloom:
a quarter-resolution mask of open sky weighted by a Henyey-Greenstein lobe (g = 0.9: beams start at
the disc and its aureole), two 24-tap radial gathers (decay 0.94, 576 effective samples) and an
additive composite scaled by lighting (0.04 by day, 0.06 at sunset) and haze (broken cloud, rain);
near geometry (under 150 m, open again by 1.5 km) keeps only 15 % of the beam, so a backlit canopy
stays dark between beams. Off at night, in studio backdrops, in menus and when the sun is behind
the camera.

**Atmosphere.** The sky is baked with summer aerosols (`SKY_LIGHT.haze` day 18/26/38, AOD ≈
0.09–0.18). The local atmosphere's aerial perspective is Beer–Lambert per channel with the same air
(`aerialExtinction`: Rayleigh plus Mie at the presented haze level, plus rain) and the 1200 m
aerosol scale height, so ridges keep their contrast and fade into the dome's own horizon. Night
city venues add a warm urban skyglow (stars at 5 %)."""
assert old in s; s=s.replace(old,new)
old="""procedural rain ripples on upward water films. The resolve reuses the four nearest rays with depth
weights, limits fireflies, and replaces the environment probe's share (the local probe cubemap"""
new="""procedural rain ripples on upward water films. The resolve reuses the four nearest rays with depth
weights (on wet upward surfaces each ray gathers four jittered taps along the direction to its hit,
so rain lights and the horizon streak as on a real wet road), limits fireflies, and replaces the
environment probe's share (the local probe cubemap"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)
