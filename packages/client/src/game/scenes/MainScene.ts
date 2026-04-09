import {
  Scene,
  Engine,
  ArcRotateCamera,
  HemisphericLight,
  MeshBuilder,
  Vector3,
  Color3,
  StandardMaterial,
} from '@babylonjs/core';

export class MainScene {
  constructor(
    private engine: Engine,
    private canvas: HTMLCanvasElement,
  ) {}

  async create(): Promise<Scene> {
    const scene = new Scene(this.engine);
    scene.clearColor = new (Color3 as any)(0.53, 0.81, 0.92).toColor4(1);

    // Camera
    const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 3, 30, Vector3.Zero(), scene);
    camera.attachControl(this.canvas, true);
    camera.lowerRadiusLimit = 5;
    camera.upperRadiusLimit = 100;

    // Lighting
    const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene);
    light.intensity = 0.9;

    // Ground
    const ground = MeshBuilder.CreateGround('ground', { width: 100, height: 100, subdivisions: 4 }, scene);
    const groundMat = new StandardMaterial('groundMat', scene);
    groundMat.diffuseColor = new Color3(0.4, 0.6, 0.3);
    ground.material = groundMat;

    // Placeholder player (box)
    const player = MeshBuilder.CreateBox('player', { size: 1, height: 2 }, scene);
    player.position.y = 1;
    const playerMat = new StandardMaterial('playerMat', scene);
    playerMat.diffuseColor = new Color3(0.2, 0.4, 0.8);
    player.material = playerMat;

    return scene;
  }
}
