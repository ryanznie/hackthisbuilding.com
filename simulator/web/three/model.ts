import * as THREE from 'three';
import { COLS, ROWS, type Frame } from '../../shared/contracts';
import { TOWER, WINDOW_COUNT, windowPosition } from './layout';
import { createMaterials, createWindowMaterial, skyMaterial } from './materials';

type Materials = ReturnType<typeof createMaterials>;
type Box = { position: [number, number, number]; scale: [number, number, number]; color?: string };

function boxes(group: THREE.Group, items: Box[], material: THREE.Material, name: string, shadows = true): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, items.length);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const color = new THREE.Color();
  items.forEach((item, index) => {
    matrix.compose(new THREE.Vector3(...item.position), quaternion, new THREE.Vector3(...item.scale));
    mesh.setMatrixAt(index, matrix);
    if (item.color) mesh.setColorAt(index, color.set(item.color));
  });
  mesh.name = name;
  mesh.castShadow = shadows;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  group.add(mesh);
  return mesh;
}

function box(items: Box[], x: number, y: number, z: number, w: number, h: number, d: number, color?: string) {
  items.push({ position: [x, y, z], scale: [w, h, d], ...(color ? { color } : {}) });
}

function towerGeometry(group: THREE.Group, m: Materials) {
  const concrete: Box[] = [], pale: Box[] = [], metal: Box[] = [], dark: Box[] = [], glass: Box[] = [], lobby: Box[] = [];
  // The rear shell sits behind the recessed glazing; piers and slabs project
  // past the glass, so the relief remains physical as the camera moves.
  box(concrete, 0, 41.7, -0.3, 27.4, 66.3, 14.5);
  for (const x of [-13.15, 13.15]) box(pale, x, 41.7, 7.38, 1.25, 66.4, 0.72);
  box(pale, 0, 75.4, 0, 28.1, 1.25, 15.4);
  box(dark, 0, 76.12, 0, 26.4, 0.2, 13.6);
  for (let row = 0; row <= ROWS; row++) {
    const y = TOWER.firstWindowY + TOWER.floorPitch / 2 - row * TOWER.floorPitch;
    box(pale, 0, y, 7.45, 25.7, 0.47, 0.76);
    for (const x of [-13.91, 13.91]) box(concrete, x, y, 0, 0.32, 0.47, 14.85);
    box(concrete, 0, y, -7.55, 27.5, 0.47, 0.3);
  }
  for (let column = 0; column <= COLS; column++) {
    box(pale, (column - COLS / 2) * TOWER.columnPitch, 42, 7.46, 0.37, 57.7, 0.72);
  }
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    const [x, y] = windowPosition(row, col);
    // Four thin aluminum reveals and an actual mullion split each window.
    box(dark, x, y, 7.21, 2.54, 3.02, 0.12);
    for (const dx of [-1.21, 1.21]) box(metal, x + dx, y, 7.37, 0.07, 2.92, 0.12);
    for (const dy of [-1.44, 1.44]) box(metal, x, y + dy, 7.37, 2.49, 0.07, 0.12);
    box(metal, x, y, 7.38, 0.065, 2.84, 0.13);
    for (const side of [-1, 1]) for (let bay = 0; bay < 4; bay++) {
      // Side glazing is built once per floor, after the front-grid loop below.
      if (col !== 0) continue;
      const z = -4.95 + bay * 3.3;
      box(glass, side * 13.75, y, z, 0.045, 2.75, 2.65);
      box(metal, side * 13.85, y, z, 0.08, 2.78, 0.06);
    }
  }
  for (const side of [-1, 1]) for (let bay = 0; bay < 5; bay++) box(concrete, side * 13.86, 42, -6.6 + bay * 3.3, 0.3, 57.7, 0.44);
  // A pair of darker mechanical floors below the roof parapet.
  for (let floor = 0; floor < 2; floor++) for (let column = 0; column < COLS; column++) {
    box(glass, (column - 4) * 2.8, 72.02 + floor * 1.57, 7.1, 2.35, 1.16, 0.07);
    box(metal, (column - 4) * 2.8, 72.02 + floor * 1.57, 7.2, 0.07, 1.16, 0.12);
  }
  for (let column = 0; column < 11; column++) box(pale, (column - 5) * 2.43, 10.3, 7.36, 0.15, 5.3, 0.3);
  // Deep pilotis, glazed lobby, and a cantilevered entrance canopy.
  box(concrete, 0, 8.15, 0, 28.1, 1.1, 15.3);
  for (const x of [-12.7, -4.25, 4.25, 12.7]) for (const z of [-5.7, 6.8]) box(pale, x, 3.78, z, 1.2, 7.55, 1.65);
  box(glass, 0, 3.24, 0, 22, 6.2, 9.4);
  for (let door = 0; door < 12; door++) {
    const x = -10.35 + door * 1.88;
    box(lobby, x, 3.1, 4.74, 1.65, 5.6, 0.025);
    box(metal, x - 0.87, 3.1, 4.8, 0.095, 5.72, 0.15);
    box(metal, x, 3.14, 4.83, 1.73, 0.08, 0.15);
  }
  box(pale, 0, 6.42, 7, 23.4, 0.3, 5.2);
  box(dark, 0, 6.16, 7.0, 21.4, 0.13, 4.7);
  box(lobby, 0, 6.05, 7.7, 19.7, 0.035, 1.25);
  for (let step = 0; step < 3; step++) box(concrete, 0, 0.15 + step * 0.15, 9.4 - step * 0.45, 28.8 - step * 0.4, 0.3, 2.9 - step * 0.7);
  boxes(group, concrete, m.concrete, 'Concrete structural body');
  boxes(group, pale, m.lightConcrete, 'Projecting piers and floor slabs');
  boxes(group, dark, m.darkMetal, 'Recesses and roof');
  boxes(group, metal, m.metal, 'Window frames and mullions');
  boxes(group, glass, m.glass, 'Side and mechanical glazing');
  boxes(group, lobby, m.warmGlass, 'Warm lobby glazing', false);
}

function rooftop(group: THREE.Group, m: Materials) {
  for (const [x, z, radius] of [[-7.3, -0.5, 2.48], [8.35, 1.2, 1.3]]) {
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.67, radius * 0.75, 1.12, 24), m.darkConcrete);
    pedestal.position.set(x, TOWER.roof + 0.57, z);
    group.add(pedestal);
    const geometry = new THREE.IcosahedronGeometry(radius, 2);
    const radome = new THREE.Mesh(geometry, m.dome);
    radome.position.set(x, TOWER.roof + 1.07 + radius, z);
    radome.castShadow = true;
    group.add(radome);
    const seams = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 1), new THREE.LineBasicMaterial({ color: '#778b91', transparent: true, opacity: 0.22 }));
    seams.position.copy(radome.position);
    group.add(seams);
  }
  const service = [{ position: [1, 77.0, -2.5] as [number, number, number], scale: [5, 1.9, 3] as [number, number, number] }];
  boxes(group, service, m.darkConcrete, 'Rooftop mechanical enclosure');
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.12, 5.8, 10), m.metal);
  mast.position.set(3.6, 78.9, 1.3);
  group.add(mast);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), new THREE.MeshBasicMaterial({ color: '#ff7555', toneMapped: false }));
  beacon.position.set(3.6, 81.88, 1.3);
  group.add(beacon);
  const beaconHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialGlowTexture(), color: '#ff6446', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  beaconHalo.position.copy(beacon.position);
  beaconHalo.scale.setScalar(2.8);
  group.add(beaconHalo);
}

function radialGlowTexture(): THREE.DataTexture {
  const side = 32, bytes = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const index = (y * side + x) * 4;
    bytes[index] = bytes[index + 1] = bytes[index + 2] = 255;
    bytes[index + 3] = Math.round(Math.max(0, 1 - Math.hypot(x - 15.5, y - 15.5) / 15.5) ** 2.5 * 255);
  }
  const texture = new THREE.DataTexture(bytes, side, side);
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function campus(group: THREE.Group, m: Materials) {
  const blocks: Box[] = [], glass: Box[] = [], trim: Box[] = [], warm: Box[] = [];
  const buildings = [
    [-49, -21, 42, 15, 23], [-29, -55, 36, 23, 22], [44, -33, 33, 21, 26], [70, -11, 28, 13, 23],
    [-80, -48, 34, 25, 27], [26, -77, 34, 32, 25], [88, -66, 32, 28, 24], [-66, 10, 29, 9, 18],
  ];
  buildings.forEach(([x, z, width, height, depth], index) => {
    box(blocks, x, height / 2, z, width, height, depth, index % 2 ? '#9b9c95' : '#888e87');
    box(trim, x, height + 0.18, z, width + 0.8, 0.45, depth + 0.8);
    const floors = Math.floor(height / 3.1), columns = Math.floor(width / 2.7);
    for (let row = 0; row < floors; row++) {
      box(trim, x, 2.6 + row * 3.1, z + depth / 2 + 0.12, width, 0.22, 0.2);
      for (let col = 0; col < columns; col++) {
        const target = (col * 7 + row * 3 + index * 11) % 13 < 2 ? warm : glass;
        box(target, x - width / 2 + 1.5 + col * 2.7, 1.6 + row * 3.1, z + depth / 2 + 0.13, 1.2, 1.8, 0.06);
      }
    }
    for (const side of [-1, 1]) for (let row = 0; row < floors; row++) for (let col = 0; col < Math.floor(depth / 3.1); col++) {
      box(glass, x + side * (width / 2 + 0.04), 1.6 + row * 3.1, z - depth / 2 + 1.7 + col * 3.1, 0.06, 1.8, 1.2);
    }
  });
  boxes(group, blocks, m.darkConcrete, 'Campus masonry volumes');
  boxes(group, trim, m.concrete, 'Campus cornices and floor bands');
  boxes(group, glass, m.glass, 'Campus windows', false);
  boxes(group, warm, m.warmGlass, 'Occupied campus windows', false);
}

function landscape(group: THREE.Group, m: Materials) {
  // Campus occupies the near bank; the Charles is genuine water geometry on
  // the south side, visible in the wider riverside preset.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(640, 368), m.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.04, -137);
  ground.receiveShadow = true;
  group.add(ground);
  const joints: number[] = [];
  for (let i = -100; i <= 100; i += 4) {
    if (i <= 36) joints.push(-105, 0.013, i, 105, 0.013, i);
    joints.push(i, 0.013, -100, i, 0.013, 37);
  }
  const jointGeometry = new THREE.BufferGeometry();
  jointGeometry.setAttribute('position', new THREE.Float32BufferAttribute(joints, 3));
  group.add(new THREE.LineSegments(jointGeometry, new THREE.LineBasicMaterial({ color: '#202e34', transparent: true, opacity: 0.22 })));
  const curbs: Box[] = [], benches: Box[] = [];
  box(curbs, 0, 0.17, 47, 630, 0.34, 0.6);
  box(curbs, 0, 0.08, 38.1, 630, 0.24, 0.35);
  const riverMaterial = new THREE.ShaderMaterial({
    toneMapped: false,
    uniforms: { deep: { value: new THREE.Color('#243c4a') }, horizon: { value: new THREE.Color('#84979e') } },
    vertexShader: 'varying vec3 vWorld;void main(){vec4 world=modelMatrix*vec4(position,1.);vWorld=world.xyz;gl_Position=projectionMatrix*viewMatrix*world;}',
    fragmentShader: `
      varying vec3 vWorld; uniform vec3 deep; uniform vec3 horizon;
      void main(){
        vec3 eye=normalize(cameraPosition-vWorld);
        float fresnel=pow(1.-max(0.,eye.y),3.);
        float broad=sin(vWorld.z*.6+sin(vWorld.x*.15)*1.9)*.5+.5;
        float ripple=pow(sin(vWorld.z*2.8+sin(vWorld.x*.46)*2.6)*.5+.5,16.);
        vec3 color=mix(deep,horizon,fresnel*.36)+vec3(.014,.019,.024)*ripple*(.4+broad*.6);
        gl_FragColor=vec4(color,1.);
        #include <colorspace_fragment>
      }
    `,
  });
  const river = new THREE.Mesh(new THREE.PlaneGeometry(640, 400), riverMaterial);
  river.name = 'Charles River';
  river.rotation.x = -Math.PI / 2;
  river.position.set(0, -0.23, 247.4);
  group.add(river);
  const road: Box[] = [];
  box(road, 0, 0.003, 42.2, 630, 0.035, 7.3);
  boxes(group, road, m.darkMetal, 'Memorial Drive beside the river', false);
  for (const x of [-32, 33]) {
    box(curbs, x, 0.23, 9, 11.5, 0.46, 26);
    box(benches, x + (x < 0 ? 7.8 : -7.8), 0.8, 9, 1.15, 0.32, 5.5);
    for (const z of [7, 11]) box(benches, x + (x < 0 ? 7.8 : -7.8), 0.36, z, 0.9, 0.7, 0.17);
  }
  boxes(group, curbs, m.darkConcrete, 'Raised landscape beds');
  boxes(group, benches, m.darkMetal, 'Plaza benches');
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.33, 5, 8), m.bark, 12);
  const leaves = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), m.leaves, 12 * 7);
  const transform = new THREE.Object3D();
  const leafColor = new THREE.Color();
  const locations = [[-32, 5], [-34, 17], [33, 3], [36, 17], [-50, 35], [56, 32], [-55, -16], [66, -18], [-86, 13], [84, 17], [-21, -26], [24, -32]];
  locations.forEach(([x, z], index) => {
    transform.position.set(x, 2.65, z); transform.scale.set(1, 1 + (index % 3) * 0.15, 1); transform.rotation.set(0, 0, 0); transform.updateMatrix(); trunks.setMatrixAt(index, transform.matrix);
    for (let lobe = 0; lobe < 7; lobe++) {
      const angle = lobe * 2.4 + index;
      transform.position.set(x + Math.sin(angle) * (lobe ? 1.7 : 0), 6.8 + Math.cos(angle * 0.7) * 1.3, z + Math.cos(angle) * (lobe ? 1.6 : 0));
      transform.scale.set(2.45 + (lobe % 3) * 0.3, 2.9 + (index % 2) * 0.5, 2.6);
      transform.rotation.set(lobe, angle, index * 0.4); transform.updateMatrix();
      leaves.setMatrixAt(index * 7 + lobe, transform.matrix);
      leaves.setColorAt(index * 7 + lobe, leafColor.setHSL(0.39 + (lobe % 3) * 0.016, 0.16, 0.7 + (lobe % 2) * 0.1));
    }
  });
  trunks.castShadow = leaves.castShadow = true;
  leaves.receiveShadow = true;
  group.add(trunks, leaves);
  const lampMetal: Box[] = [], lampLight: Box[] = [];
  for (const [x, z] of [[-21, 13], [21, 13], [-42, 31], [45, 31], [-9, 36], [11, 36]]) {
    box(lampMetal, x, 2.4, z, 0.14, 4.8, 0.14);
    box(lampMetal, x, 4.65, z, 1.4, 0.12, 0.2);
    box(lampLight, x, 4.5, z, 1.25, 0.15, 0.32);
    // Six short-range lamps avoid a costly point light per animated window.
    const light = new THREE.PointLight('#ffdc9d', 15, 12, 2);
    light.position.set(x, 4.25, z);
    group.add(light);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial({ map: radialGlowTexture(), color: '#edca88', transparent: true, opacity: 0.065, depthWrite: false, blending: THREE.AdditiveBlending }));
    pool.rotation.x = -Math.PI / 2; pool.position.set(x, 0.026, z); group.add(pool);
  }
  boxes(group, lampMetal, m.darkMetal, 'Plaza light fittings');
  boxes(group, lampLight, m.warmGlass, 'Plaza light emitters', false);
}

function groundReflection(): THREE.InstancedMesh {
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: 'varying vec2 vUv; varying vec3 vLight; void main(){vUv=uv;vLight=instanceColor;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}',
    fragmentShader: `
      varying vec2 vUv; varying vec3 vLight;
      void main(){
        float edge=pow(max(0.,1.-abs(vUv.x-.5)*2.),2.);
        float ripple=.55+.45*sin(vUv.y*193.+sin(vUv.x*33.)*2.);
        float fade=pow(vUv.y,2.)*(1.-smoothstep(.92,1.,vUv.y));
        gl_FragColor=vec4(vLight*.35,edge*fade*ripple*.28);
        #include <colorspace_fragment>
      }
    `,
  });
  const reflections = new THREE.InstancedMesh(new THREE.PlaneGeometry(3.1, 23), material, COLS);
  const transform = new THREE.Object3D();
  for (let col = 0; col < COLS; col++) {
    transform.position.set((col - 4) * 2.8, 0.032, 21.5); transform.rotation.x = -Math.PI / 2; transform.updateMatrix();
    reflections.setMatrixAt(col, transform.matrix); reflections.setColorAt(col, new THREE.Color(0));
  }
  reflections.name = 'Subtle colored facade reflection on paving';
  return reflections;
}

export interface BuildingModel { root: THREE.Group; updateFrame: (frame: Frame) => void; windowCount: number; }

export function createBuildingModel(scene: THREE.Scene): BuildingModel {
  const root = new THREE.Group();
  root.name = 'MIT Green Building architectural study';
  const materials = createMaterials();
  towerGeometry(root, materials);
  rooftop(root, materials);
  campus(root, materials);
  landscape(root, materials);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(440, 24, 16), skyMaterial());
  sky.position.y = -35;
  root.add(sky);
  const windows = new THREE.InstancedMesh(new THREE.PlaneGeometry(TOWER.windowWidth, TOWER.windowHeight), createWindowMaterial(), WINDOW_COUNT);
  const glow = new THREE.InstancedMesh(new THREE.PlaneGeometry(4.7, 5.2), createWindowMaterial(true), WINDOW_COUNT);
  windows.name = '153 individually addressable south facade windows';
  glow.name = '153 soft window light halos';
  const matrix = new THREE.Matrix4(), color = new THREE.Color();
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    const [x, y, z] = windowPosition(row, col), index = row * COLS + col;
    windows.setMatrixAt(index, matrix.makeTranslation(x, y, z));
    glow.setMatrixAt(index, matrix.makeTranslation(x, y, z + 0.56));
    windows.setColorAt(index, color.set('#101c23'));
    glow.setColorAt(index, color.set('#000000'));
  }
  windows.instanceColor!.setUsage(THREE.DynamicDrawUsage);
  glow.instanceColor!.setUsage(THREE.DynamicDrawUsage);
  windows.computeBoundingSphere(); glow.computeBoundingSphere();
  root.add(windows, glow);
  const reflection = groundReflection();
  reflection.instanceColor!.setUsage(THREE.DynamicDrawUsage);
  root.add(reflection);
  scene.add(root);
  return {
    root,
    windowCount: WINDOW_COUNT,
    updateFrame(frame) {
      for (let col = 0; col < COLS; col++) {
        let red = 0, green = 0, blue = 0;
        for (let row = 0; row < ROWS; row++) {
          const pixel = frame[row]?.[col] ?? [0, 0, 0];
          color.setRGB(pixel[0] / 255, pixel[1] / 255, pixel[2] / 255, THREE.SRGBColorSpace);
          const index = row * COLS + col;
          windows.setColorAt(index, color);
          glow.setColorAt(index, color);
          red += color.r; green += color.g; blue += color.b;
        }
        reflection.setColorAt(col, color.setRGB(red / ROWS, green / ROWS, blue / ROWS));
      }
      windows.instanceColor!.needsUpdate = true;
      glow.instanceColor!.needsUpdate = true;
      reflection.instanceColor!.needsUpdate = true;
    },
  };
}

/** Materials/geometries can be shared by hundreds of instances; release each once. */
export function disposeScene(scene: THREE.Scene): void {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  scene.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => materials.add(material));
    if (object instanceof THREE.InstancedMesh) object.dispose();
    if (object instanceof THREE.DirectionalLight || object instanceof THREE.SpotLight || object instanceof THREE.PointLight) object.shadow.dispose();
  });
  materials.forEach(material => {
    Object.values(material).forEach(value => { if (value instanceof THREE.Texture) textures.add(value); });
    material.dispose();
  });
  geometries.forEach(geometry => geometry.dispose());
  textures.forEach(texture => texture.dispose());
  scene.clear();
}
