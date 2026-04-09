import { Scene, DirectionalLight, Vector3, Color4 } from '@babylonjs/core';

/**
 * Manages a day/night cycle by rotating a directional light (sun)
 * and smoothly transitioning sky color and light intensity over time.
 */
export class DayNightCycle {
  private scene: Scene;
  private sunLight: DirectionalLight;
  private timeOfDay: number = 0.25; // Start at sunrise
  private cycleDuration: number;

  // Sky color presets
  private static readonly SKY_NIGHT = new Color4(0.05, 0.05, 0.15, 1);
  private static readonly SKY_DAWN = new Color4(0.9, 0.6, 0.4, 1);
  private static readonly SKY_DAY = new Color4(0.53, 0.81, 0.92, 1);
  private static readonly SKY_DUSK = new Color4(0.8, 0.4, 0.3, 1);

  // Light intensity presets
  private static readonly INTENSITY_DAY = 0.9;
  private static readonly INTENSITY_NIGHT = 0.15;

  constructor(scene: Scene, options?: { cycleDurationSeconds?: number }) {
    this.scene = scene;
    this.cycleDuration = options?.cycleDurationSeconds ?? 600;

    this.sunLight = new DirectionalLight('sunLight', new Vector3(0, -1, 0), this.scene);
    this.sunLight.intensity = DayNightCycle.INTENSITY_DAY;
  }

  /**
   * Advance the cycle and update lighting. Call each frame.
   * @param deltaTime - elapsed time in seconds since last frame
   */
  update(deltaTime: number): void {
    // Advance time
    this.timeOfDay += deltaTime / this.cycleDuration;
    this.timeOfDay %= 1;

    // Update sun direction — rotate around X axis to simulate arc across sky
    const sunAngle = this.timeOfDay * Math.PI * 2;
    this.sunLight.direction = new Vector3(0, -Math.cos(sunAngle), Math.sin(sunAngle));

    // Update sky color and light intensity
    this.scene.clearColor = this.computeSkyColor();
    this.sunLight.intensity = this.computeLightIntensity();
  }

  /**
   * Set the full cycle duration in seconds.
   */
  setCycleDuration(seconds: number): void {
    this.cycleDuration = seconds;
  }

  /**
   * Returns current time of day as a 0-1 float.
   * 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset
   */
  getTimeOfDay(): number {
    return this.timeOfDay;
  }

  /**
   * Linearly interpolate between two Color4 values.
   */
  private static lerpColor(a: Color4, b: Color4, t: number): Color4 {
    return new Color4(
      a.r + (b.r - a.r) * t,
      a.g + (b.g - a.g) * t,
      a.b + (b.b - a.b) * t,
      1,
    );
  }

  /**
   * Compute the sky color based on current time of day,
   * smoothly lerping between phase boundaries.
   */
  private computeSkyColor(): Color4 {
    const t = this.timeOfDay;

    // Night -> Dawn (0.2 to 0.3)
    if (t >= 0.2 && t < 0.3) {
      const factor = (t - 0.2) / 0.1;
      return DayNightCycle.lerpColor(DayNightCycle.SKY_NIGHT, DayNightCycle.SKY_DAWN, factor);
    }
    // Dawn -> Day (0.3 to 0.35) — short transition from dawn orange to blue sky
    if (t >= 0.3 && t < 0.35) {
      const factor = (t - 0.3) / 0.05;
      return DayNightCycle.lerpColor(DayNightCycle.SKY_DAWN, DayNightCycle.SKY_DAY, factor);
    }
    // Day (0.35 to 0.65)
    if (t >= 0.35 && t < 0.65) {
      return DayNightCycle.SKY_DAY.clone();
    }
    // Day -> Dusk (0.65 to 0.7)
    if (t >= 0.65 && t < 0.7) {
      const factor = (t - 0.65) / 0.05;
      return DayNightCycle.lerpColor(DayNightCycle.SKY_DAY, DayNightCycle.SKY_DUSK, factor);
    }
    // Dusk -> Night (0.7 to 0.8)
    if (t >= 0.7 && t < 0.8) {
      const factor = (t - 0.7) / 0.1;
      return DayNightCycle.lerpColor(DayNightCycle.SKY_DUSK, DayNightCycle.SKY_NIGHT, factor);
    }
    // Night (0.8 to 1.0 and 0.0 to 0.2)
    return DayNightCycle.SKY_NIGHT.clone();
  }

  /**
   * Compute light intensity, transitioning smoothly at dawn and dusk.
   */
  private computeLightIntensity(): number {
    const t = this.timeOfDay;
    const day = DayNightCycle.INTENSITY_DAY;
    const night = DayNightCycle.INTENSITY_NIGHT;

    // Dawn ramp up (0.2 to 0.3)
    if (t >= 0.2 && t < 0.3) {
      const factor = (t - 0.2) / 0.1;
      return night + (day - night) * factor;
    }
    // Full day (0.3 to 0.7)
    if (t >= 0.3 && t < 0.7) {
      return day;
    }
    // Dusk ramp down (0.7 to 0.8)
    if (t >= 0.7 && t < 0.8) {
      const factor = (t - 0.7) / 0.1;
      return day + (night - day) * factor;
    }
    // Night
    return night;
  }
}
