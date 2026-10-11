import * as T from 'three';
/** Evaluated Blender quaternions, shared phase per person in colour and shadows.
 * Two texel samples interpolate within a clip; no CPU mixer per spectator. */
export function installAudienceActions(
  material: T.Material,
  atlas: T.DataTexture,
  time: { value: number },
) {
  const previous = material.onBeforeCompile.bind(material),
    key = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.uniforms.audiencePose = { value: atlas };
    shader.uniforms.audienceTime = time;
    shader.vertexShader =
      `uniform sampler2D audiencePose;
uniform float audienceTime;
vec4 audienceQuat(float action,float sampleFrame) {
 float i=floor(sampleFrame), u=fract(sampleFrame);
 vec2 uv=vec2((crowdJoint+.5)/4.,(action*121.+i+.5)/484.);
 vec4 a=texture2D(audiencePose,uv),b=texture2D(audiencePose,uv+vec2(0.,1./484.));
 return normalize(mix(a,b* (dot(a,b)<0.?-1.:1.),u));
}
mat3 audienceTurn() {
 if (crowdJoint>.5&&crowdJoint<2.5&&crowdCrossed()>.5) return mat3(1.);
 float t=mod(audienceTime+spectatorPhase*.63661977236,4.)*30.;
 vec4 idle=audienceQuat(0.,t);
 float action=spectatorStyle.w>.82?3.:(fract(spectatorPhase*4.13)>.45?2.:1.);
 vec4 gesture=audienceQuat(action,t);
 float response=action>2.5?1.:smoothstep(.04,.38,crowdReaction.x)*(1.-clamp(crowdReaction.y,0.,1.));
 vec4 q=normalize(mix(idle,gesture*(dot(idle,gesture)<0.?-1.:1.),response));
 q=normalize(mix(vec4(0.,0.,0.,1.),q,crowdMotion));
 vec3 v=q.xyz;float w=q.w;
 return mat3(1.-2.*(v.y*v.y+v.z*v.z),2.*(v.x*v.y+v.z*w),2.*(v.x*v.z-v.y*w),
 2.*(v.x*v.y-v.z*w),1.-2.*(v.x*v.x+v.z*v.z),2.*(v.y*v.z+v.x*w),
 2.*(v.x*v.z+v.y*w),2.*(v.y*v.z-v.x*w),1.-2.*(v.x*v.x+v.y*v.y));
}
` + shader.vertexShader;
    // Helpers must follow the attributes/uniforms they read. Move this prefix
    // immediately before main, after the original crowd declarations.
    const split = shader.vertexShader.indexOf('varying float vCrowdRank;');
    if (split < 0 || !shader.vertexShader.includes('void main() {'))
      throw new Error('Authored audience shader hooks missing');
    const helper = shader.vertexShader.slice(0, split);
    shader.vertexShader = shader.vertexShader
      .slice(split)
      .replace('void main() {', helper + '\nvoid main() {');
    shader.vertexShader = shader.vertexShader
      .replace('crowdTurn() * (shaped', 'audienceTurn() * (shaped')
      .replace('crowdTurn() * normalize(objectNormal)', 'audienceTurn() * normalize(objectNormal)');
  };
  material.customProgramCacheKey = () => key() + '|audience-authored-v2';
}
