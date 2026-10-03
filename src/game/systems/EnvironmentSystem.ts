import * as THREE from 'three';
import { BIOMES } from '../../data/biomes';
import { useGameStore } from '../../stores/gameStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useWorldStore } from '../../stores/worldStore';
import type { Game } from '../Game';

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'mist';

interface Palette {
  top: THREE.Color;
  horizon: THREE.Color;
  bottom: THREE.Color;
  sun: THREE.Color;
  ambient: THREE.Color;
  ground: THREE.Color;
}

const c = (h: string) => new THREE.Color(h);
// Keyframes over sun height (-1 .. 1)
const KEYS: { h: number; p: Palette }[] = [
  { h: -1, p: { top: c('#0a1030'), horizon: c('#26325a'), bottom: c('#121a36'), sun: c('#6a7ab0'), ambient: c('#34456f'), ground: c('#1a1e30') } },
  { h: -0.18, p: { top: c('#131d44'), horizon: c('#34406e'), bottom: c('#1a2344'), sun: c('#7a88b8'), ambient: c('#38486e'), ground: c('#1c2034') } },
  { h: -0.02, p: { top: c('#35477e'), horizon: c('#e0876a'), bottom: c('#4a4a6a'), sun: c('#ff9a5a'), ambient: c('#6a6690'), ground: c('#3a3040') } },
  { h: 0.12, p: { top: c('#5a8fd0'), horizon: c('#f5c490'), bottom: c('#9ab4d0'), sun: c('#ffd09a'), ambient: c('#a0aac8'), ground: c('#6a5a4a') } },
  { h: 0.35, p: { top: c('#4a8fd8'), horizon: c('#bfe0f5'), bottom: c('#9cc0dc'), sun: c('#fff2d8'), ambient: c('#b0c4e0'), ground: c('#7a6a58') } },
  { h: 1, p: { top: c('#3f86d8'), horizon: c('#c6e4f8'), bottom: c('#a4c6e0'), sun: c('#fff6e6'), ambient: c('#bccce6'), ground: c('#806e5a') } },
];

function samplePalette(h: number, out: Palette) {
  let i = 0;
  while (i < KEYS.length - 2 && h > KEYS[i + 1].h) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = THREE.MathUtils.clamp((h - a.h) / (b.h - a.h), 0, 1);
  for (const k of Object.keys(out) as (keyof Palette)[]) out[k].copy(a.p[k]).lerp(b.p[k], t);
}

const WEATHER_TABLE: { kind: WeatherKind; weight: number; min: number; max: number }[] = [
  { kind: 'clear', weight: 5, min: 240, max: 520 },
  { kind: 'cloudy', weight: 3, min: 150, max: 320 },
  { kind: 'rain', weight: 2, min: 120, max: 260 },
  { kind: 'storm', weight: 0.6, min: 90, max: 180 },
  { kind: 'mist', weight: 1.2, min: 100, max: 200 },
];

/** Day/night palette, sun & moon, fog and weather transitions. */
export class EnvironmentSystem {
  private pal: Palette = { top: c('#000'), horizon: c('#000'), bottom: c('#000'), sun: c('#000'), ambient: c('#000'), ground: c('#000') };
  private fogTint = new THREE.Color('#bcd8f0');
  private targetFogTint = new THREE.Color('#bcd8f0');
  weather: WeatherKind = 'clear';
  private weatherTimer = 300;
  /** smoothed weather parameters */
  cover = 0.35;
  rain = 0;
  mist = 0;
  private storm = 0;
  private lightning = 0;
  private lightningTimer = 12;
  private hudTimer = 0;
  readonly hemi: THREE.HemisphereLight;
  readonly sunLight: THREE.DirectionalLight;
  private tmp = new THREE.Color();

  constructor(private game: Game) {
    this.hemi = new THREE.HemisphereLight('#bccce6', '#806e5a', 1.2);
    this.sunLight = new THREE.DirectionalLight('#fff2d8', 1.6);
    this.sunLight.castShadow = false;
    game.scene.add(this.hemi, this.sunLight, this.sunLight.target);
  }

  setWeather(kind: WeatherKind, duration?: number): void {
    this.weather = kind;
    const row = WEATHER_TABLE.find((w) => w.kind === kind)!;
    this.weatherTimer = duration ?? row.min + Math.random() * (row.max - row.min);
    useWorldStore.setState({ weather: kind[0].toUpperCase() + kind.slice(1) });
  }

  update(dt: number, simulate: boolean): void {
    const g = this.game;
    const clock = g.clock;
    const u = g.assets.uniforms;
    const settings = useSettingsStore.getState();

    // ---- weather state machine
    if (simulate) {
      this.weatherTimer -= dt;
      if (this.weatherTimer <= 0) {
        const total = WEATHER_TABLE.reduce((s, w) => s + w.weight, 0);
        let pick = Math.random() * total;
        for (const w of WEATHER_TABLE) {
          pick -= w.weight;
          if (pick <= 0) {
            this.setWeather(w.kind);
            break;
          }
        }
      }
    }
    const tw = this.weather;
    const k = Math.min(1, dt * 0.08); // gradual transitions
    this.cover += ((tw === 'clear' ? 0.3 : tw === 'mist' ? 0.5 : tw === 'cloudy' ? 0.85 : 1) - this.cover) * k;
    this.rain += ((tw === 'rain' ? 0.7 : tw === 'storm' ? 1 : 0) - this.rain) * k;
    this.mist += ((tw === 'mist' ? 1 : 0) - this.mist) * k;
    this.storm += ((tw === 'storm' ? 1 : 0) - this.storm) * k;
    const gloom = Math.max(0, this.cover - 0.4) * 0.6 + this.storm * 0.2;

    // ---- sun / moon
    const f = clock.dayFraction;
    const ang = (f - 0.25) * Math.PI * 2;
    const sunDir = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0.32).normalize();
    const moonDir = sunDir.clone().multiplyScalar(-1);
    const h = sunDir.y;
    samplePalette(h, this.pal);
    const daylight = clock.daylight;

    // desaturate / darken with clouds and rain
    const grey = (col: THREE.Color, amt: number) => {
      const l = col.r * 0.3 + col.g * 0.59 + col.b * 0.11;
      col.lerp(this.tmp.setRGB(l, l, l), amt).multiplyScalar(1 - amt * 0.35);
    };
    for (const key of ['top', 'horizon', 'bottom', 'ambient'] as const) grey(this.pal[key], gloom);
    this.pal.sun.multiplyScalar(1 - gloom * 0.75);

    // lightning (gentle, accessibility aware)
    if (simulate && this.storm > 0.6) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 9 + Math.random() * 16;
        this.lightning = settings.accessibility.reduceFlashing ? 0.25 : 0.7;
        setTimeout(() => g.audio.play('thunder', { volume: 0.8 }), 600 + Math.random() * 1600);
      }
    }
    this.lightning = Math.max(0, this.lightning - dt * 2.2);
    const flash = this.lightning;

    // ---- biome fog tint at the player
    const biome = g.currentBiome;
    if (biome >= 0) {
      const ft = BIOMES[biome].fogTint;
      this.targetFogTint.setRGB(ft[0], ft[1], ft[2]);
    }
    this.fogTint.lerp(this.targetFogTint, Math.min(1, dt * 0.5));

    // ---- sky uniforms
    const sky = g.sky.uniforms;
    sky.uTop.value.copy(this.pal.top).addScalar(flash * 0.3);
    sky.uHorizon.value.copy(this.pal.horizon).multiply(this.tmp.copy(this.fogTint).lerp(new THREE.Color(1, 1, 1), 0.5)).multiplyScalar(1.25).addScalar(flash * 0.3);
    sky.uBottom.value.copy(this.pal.bottom);
    sky.uSunDir.value.copy(sunDir);
    sky.uMoonDir.value.copy(moonDir);
    sky.uSunColor.value.copy(this.pal.sun);
    sky.uStars.value = THREE.MathUtils.clamp(1 - daylight * 1.6, 0, 1) * (1 - this.cover * 0.7);
    sky.uTime.value = g.time;
    sky.uSunsetGlow.value = THREE.MathUtils.clamp(1 - Math.abs(h) * 4, 0, 1) * (1 - gloom);

    // ---- terrain & entity lighting
    const isDay = h > -0.05;
    const lightDir = isDay ? sunDir : moonDir;
    u.uSunDir.value.copy(lightDir.y < 0.15 ? lightDir.clone().setY(0.15).normalize() : lightDir);
    const sunStrength = isDay ? THREE.MathUtils.smoothstep(h, -0.05, 0.25) : THREE.MathUtils.smoothstep(-h, 0.05, 0.4) * 0.42;
    u.uSunColor.value.copy(isDay ? this.pal.sun : new THREE.Color('#8fa0d8')).multiplyScalar(sunStrength * (1 - gloom * 0.6));
    const nightVision = g.player.hasBuff('glowsight') ? 1 : 0;
    u.uSkyAmbient.value.copy(this.pal.ambient).multiplyScalar(0.75).addScalar(flash * 0.5);
    u.uGroundAmbient.value.copy(this.pal.ground).multiplyScalar(0.8);
    u.uNightVision.value = nightVision * (1 - daylight);
    u.uDaylight.value = daylight;
    u.uTime.value = g.time;
    u.uWind.value = 0.6 + this.cover * 0.6 + this.storm * 1.2;
    u.uWet.value = this.rain;
    u.uSkyReflect.value.copy(sky.uHorizon.value).lerp(sky.uTop.value, 0.4);

    // ---- fog
    const radius = g.chunks.renderRadius * 16;
    let fogFar = Math.max(40, radius - 4);
    let fogNear = fogFar * ((g.build ? 0.72 : 0.5) - this.mist * 0.35 - this.rain * 0.15);
    fogFar *= 1 - this.mist * 0.55 - this.rain * 0.2;
    const fogColor = this.tmp.copy(sky.uHorizon.value).lerp(this.pal.bottom, 0.25);
    if (g.player.headInWater) {
      fogColor.setRGB(0.1, 0.3, 0.42).multiplyScalar(0.3 + daylight * 0.7);
      fogNear = 0;
      fogFar = 14;
    } else if (g.undergroundFactor > 0.5) {
      fogColor.lerp(new THREE.Color('#0b0a10'), (g.undergroundFactor - 0.5) * 1.6);
    }
    u.uFogColor.value.copy(fogColor);
    u.uFogNear.value = fogNear;
    u.uFogFar.value = fogFar;
    const sf = g.scene.fog as THREE.Fog | null;
    if (sf) {
      sf.color.copy(fogColor);
      sf.near = fogNear;
      sf.far = fogFar;
    }
    g.scene.background = null;

    // clouds
    const cl = g.clouds.uniforms;
    cl.uLight.value.copy(this.pal.horizon).lerp(new THREE.Color(1, 1, 1), 0.55 * daylight).multiplyScalar(0.55 + daylight * 0.5 - gloom * 0.3);
    cl.uShadow.value.copy(cl.uLight.value).multiplyScalar(0.72);
    cl.uFogColor.value.copy(sky.uHorizon.value);
    cl.uFogFar.value = 320;
    cl.uCover.value = this.cover;
    g.clouds.mesh.visible = settings.graphics.clouds;

    // entity lights
    this.hemi.color.copy(u.uSkyAmbient.value).multiplyScalar(1.4);
    this.hemi.groundColor.copy(u.uGroundAmbient.value);
    this.hemi.intensity = 1.7 + nightVision * 0.5;
    this.sunLight.color.copy(u.uSunColor.value);
    this.sunLight.intensity = 2.3;
    const pp = g.player.position;
    this.sunLight.position.set(pp.x + lightDir.x * 50, pp.y + Math.max(0.2, lightDir.y) * 50, pp.z + lightDir.z * 50);
    this.sunLight.target.position.copy(pp);

    // rain
    const underRoof = g.world.surfaceY(Math.floor(pp.x), Math.floor(pp.z)) > pp.y + 2;
    g.rain.update(g.time, g.camera, underRoof ? 0 : this.rain);

    // HUD clock ~1 Hz
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 1;
      useWorldStore.getState().setClock(clock.label(), clock.day, clock.isNight);
      void useGameStore;
    }
  }

  serialize(): { weather: WeatherKind; timer: number } {
    return { weather: this.weather, timer: this.weatherTimer };
  }

  load(d: { weather: WeatherKind; timer: number } | undefined): void {
    if (!d) return;
    this.setWeather(d.weather, d.timer);
    const tw = d.weather;
    this.cover = tw === 'clear' ? 0.3 : tw === 'cloudy' ? 0.85 : tw === 'mist' ? 0.5 : 1;
    this.rain = tw === 'rain' ? 0.7 : tw === 'storm' ? 1 : 0;
    this.mist = tw === 'mist' ? 1 : 0;
  }
}
