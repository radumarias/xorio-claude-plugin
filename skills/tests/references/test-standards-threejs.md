# Three.js Test Standards

## Testing Without WebGL

Three.js tests run in Node.js without a real GPU. Mock the renderer:

```typescript
// test-setup.ts or jest.setup.ts
jest.mock('three', () => {
  const actual = jest.requireActual('three');
  return {
    ...actual,
    WebGLRenderer: jest.fn().mockImplementation(() => ({
      setSize: jest.fn(),
      setPixelRatio: jest.fn(),
      render: jest.fn(),
      dispose: jest.fn(),
      domElement: document.createElement('canvas'),
      shadowMap: { enabled: false },
    })),
  };
});
```

Alternatively, use `jest-webgl-canvas-mock` or `headless-gl` for tests that need a WebGL context.

## Scene Graph Testing

```typescript
import * as THREE from 'three';

describe('SceneBuilder', () => {
  let scene: THREE.Scene;

  beforeEach(() => {
    scene = new THREE.Scene();
  });

  it('adds mesh to scene', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geometry, material);

    scene.add(mesh);
    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]).toBe(mesh);
  });

  it('removes object from scene by name', () => {
    const mesh = new THREE.Mesh();
    mesh.name = 'target';
    scene.add(mesh);

    const target = scene.getObjectByName('target');
    if (target) scene.remove(target);

    expect(scene.children).toHaveLength(0);
  });

  it('traverses scene hierarchy', () => {
    const parent = new THREE.Group();
    const child = new THREE.Mesh();
    parent.add(child);
    scene.add(parent);

    const visited: THREE.Object3D[] = [];
    scene.traverse((obj) => visited.push(obj));

    expect(visited).toHaveLength(3); // scene, parent, child
  });
});
```

## Camera and Controls Testing

```typescript
describe('CameraSetup', () => {
  it('creates perspective camera with correct FOV', () => {
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000);
    expect(camera.fov).toBe(75);
    expect(camera.aspect).toBeCloseTo(16 / 9);
  });

  it('positions camera at expected location', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 5, 10);

    expect(camera.position.x).toBe(0);
    expect(camera.position.y).toBe(5);
    expect(camera.position.z).toBe(10);
  });
});
```

## Raycasting Tests

```typescript
describe('Raycaster', () => {
  it('detects intersection with mesh', () => {
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshBasicMaterial()
    );
    scene.add(mesh);

    const raycaster = new THREE.Raycaster();
    raycaster.set(
      new THREE.Vector3(0, 0, 5),
      new THREE.Vector3(0, 0, -1)
    );

    const intersects = raycaster.intersectObject(mesh);
    expect(intersects.length).toBeGreaterThan(0);
  });

  it('returns empty array when no intersection', () => {
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial()
    );
    mesh.position.set(100, 0, 0);
    scene.add(mesh);

    const raycaster = new THREE.Raycaster();
    raycaster.set(
      new THREE.Vector3(0, 0, 5),
      new THREE.Vector3(0, 0, -1)
    );

    const intersects = raycaster.intersectObject(mesh);
    expect(intersects).toHaveLength(0);
  });
});
```

## Animation and Frame Callback Testing

```typescript
describe('AnimationLoop', () => {
  it('calls update callback each frame', () => {
    const onUpdate = jest.fn();
    const clock = new THREE.Clock();

    // Simulate 3 frames
    for (let i = 0; i < 3; i++) {
      const delta = clock.getDelta();
      onUpdate(delta);
    }

    expect(onUpdate).toHaveBeenCalledTimes(3);
  });
});
```

## Loader Pipeline Testing

```typescript
describe('GLBLoader', () => {
  it('parses valid GLB buffer', async () => {
    const loader = new GLTFLoader();
    // Use a minimal valid GLB fixture
    const buffer = fs.readFileSync('fixtures/minimal.glb');

    const gltf = await new Promise((resolve, reject) => {
      loader.parse(buffer.buffer, '', resolve, reject);
    });

    expect(gltf.scene).toBeDefined();
    expect(gltf.scene.children.length).toBeGreaterThan(0);
  });
});
```

## Resource Cleanup

Always dispose of Three.js resources in tests:

```typescript
afterEach(() => {
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => m.dispose());
      } else {
        obj.material.dispose();
      }
    }
  });
});
```

## What to Focus On

1. **Scene graph construction** — add/remove/traverse objects
2. **Math and transforms** — positions, rotations, matrix operations
3. **Raycasting logic** — intersection detection, picking
4. **Loader pipelines** — GLB, texture, material loading
5. **Custom shaders** — uniform values and setup (not visual output)

## What to Skip

- Visual rendering output (pixel comparison)
- GPU-specific behavior (shadow maps, post-processing)
- Browser-specific WebGL features
- Animation visual results (test the data, not the pixels)
