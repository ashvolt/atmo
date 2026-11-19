import './style.css';
import { fetchBuffer, parseElevationGrid, parseGravityGrid } from './app/data';
import { App } from './app/app';

async function boot() {
  const fill = document.getElementById('loading-fill')!;
  const text = document.getElementById('loading-text')!;
  const steps: [string, string][] = [
    ['data/egm2008_n360.bin', 'EGM2008 gravity model (65 341 coefficients)'],
    ['data/gravity_grid.bin', 'Gravity anomaly & geoid grids'],
    ['data/elevation_grid.bin', 'Global elevation & bathymetry'],
  ];
  const bufs: ArrayBuffer[] = [];
  for (let i = 0; i < steps.length; i++) {
    text.textContent = `Loading ${steps[i][1]}…`;
    bufs.push(await fetchBuffer(steps[i][0]));
    fill.style.width = `${((i + 1) / (steps.length + 1)) * 100}%`;
  }
  text.textContent = 'Starting physics workers & renderer…';
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const [egm, grav, elev] = bufs;
  new App(canvas, egm, parseGravityGrid(grav.slice(0)), parseElevationGrid(elev.slice(0)), grav, elev);
  fill.style.width = '100%';
  setTimeout(() => document.getElementById('loading')!.classList.add('done'), 400);
}

boot().catch((e) => {
  document.getElementById('loading-text')!.textContent = `Failed to start: ${e.message}`;
  console.error(e);
});
