import * as THREE from 'three';

export function noiseTexture(size = 128, seed = 17): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  let value = seed;
  for (let i = 0; i < size * size; i++) {
    value = (Math.imul(value, 1664525) + 1013904223) | 0;
    const gray = 158 + ((value >>> 24) % 61);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = gray;
    data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export function createMaterials() {
  const concreteNoise = noiseTexture();
  const pavingNoise = noiseTexture(128, 43);
  pavingNoise.repeat.set(65, 65);
  const concrete = new THREE.MeshStandardMaterial({ color: '#b1aca0', roughness: 0.86, metalness: 0.035, bumpMap: concreteNoise, bumpScale: 0.065 });
  const lightConcrete = new THREE.MeshStandardMaterial({ color: '#c6c0b1', roughness: 0.77, metalness: 0.04, bumpMap: concreteNoise, bumpScale: 0.035 });
  const darkConcrete = new THREE.MeshStandardMaterial({ color: '#646d6c', roughness: 0.89, bumpMap: concreteNoise, bumpScale: 0.075 });
  const metal = new THREE.MeshStandardMaterial({ color: '#767e7c', roughness: 0.4, metalness: 0.65 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: '#202b2f', roughness: 0.47, metalness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: '#17252d', roughness: 0.17, metalness: 0.68, envMapIntensity: 1.1 });
  const ground = new THREE.MeshStandardMaterial({ color: '#384448', roughness: 0.48, metalness: 0.17, bumpMap: pavingNoise, bumpScale: 0.045 });
  const warmGlass = new THREE.MeshStandardMaterial({ color: '#8e8770', roughness: 0.25, metalness: 0.1, emissive: '#f9dca0', emissiveIntensity: 0.65 });
  const leaves = new THREE.MeshStandardMaterial({ color: '#263e39', roughness: 0.94, flatShading: false });
  const bark = new THREE.MeshStandardMaterial({ color: '#443e36', roughness: 1 });
  const dome = new THREE.MeshStandardMaterial({ color: '#dae0de', roughness: 0.47, metalness: 0.12 });
  return { concrete, lightConcrete, darkConcrete, metal, darkMetal, glass, ground, warmGlass, leaves, bark, dome };
}

export function createWindowMaterial(glow = false): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: glow,
    depthWrite: !glow,
    blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
    toneMapped: false,
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vLight;
      void main() {
        vUv = uv;
        vLight = instanceColor;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: glow ? `
      varying vec2 vUv;
      varying vec3 vLight;
      void main() {
        vec2 p = abs(vUv - .5) * 2.0;
        float falloff = pow(max(0.0, 1.0 - length(p)), 2.1);
        gl_FragColor = vec4(vLight * .55, falloff * .38);
        #include <colorspace_fragment>
      }
    ` : `
      varying vec2 vUv;
      varying vec3 vLight;
      void main() {
        float intensity = max(vLight.r, max(vLight.g, vLight.b));
        float curtain = .9 + .1 * sin(vUv.x * 46.0);
        float top = smoothstep(.62, 1.0, vUv.y);
        vec3 reflection = vec3(.011, .021, .026) * (.8 + top * 1.15);
        vec3 lit = vLight * curtain * (.82 + vUv.y * .18);
        vec3 result = mix(reflection, lit * 1.4 + vec3(.008), smoothstep(.003, .025, intensity));
        result += vec3(.009, .016, .019) * pow(max(0.0, 1.0 - abs(vUv.x - .24) * 7.0), 2.0) * (1.0 - intensity);
        gl_FragColor = vec4(result, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

export function skyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
    uniforms: { top: { value: new THREE.Color('#152a3e') }, horizon: { value: new THREE.Color('#879397') }, dusk: { value: new THREE.Color('#aa9580') } },
    vertexShader: `varying vec3 vDirection; void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `
      varying vec3 vDirection;
      uniform vec3 top; uniform vec3 horizon; uniform vec3 dusk;
      void main(){
        vec3 direction=normalize(vDirection);
        float altitude=max(0.0,direction.y);
        vec3 color=mix(horizon,top,pow(clamp(altitude*2.2,0.0,1.0),.58));
        float warm=pow(max(0.0,1.0-abs(direction.y)*6.0),3.0)*pow(max(0.0,dot(normalize(vec3(-.7,.02,-1.0)),direction)),3.0);
        color=mix(color,dusk,warm*.45);
        gl_FragColor=vec4(color,1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}
