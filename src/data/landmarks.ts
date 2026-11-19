/**
 * Curated launch sites. Elevations are the official/surveyed ground heights
 * (m above MSL); `dropHeight` is a suggested release height above that ground.
 */
import type { BodyId } from '../physics/bodies';

export interface Landmark {
  id: string;
  name: string;
  body: BodyId;
  lat: number;
  lon: number;
  /** ground elevation at the site [m MSL]; null = use terrain data */
  ground: number | null;
  dropHeight: number;
  note: string;
  preset?: { object?: string; mode?: 'drop' | 'throw'; speed?: number; elevation?: number; azimuth?: number; deployAGL?: number };
}

export const LANDMARKS: Landmark[] = [
  { id: 'everest', name: 'Mount Everest summit', body: 'earth', lat: 27.98900, lon: 86.92561, ground: 8848.86, dropHeight: 2, note: '8848.86 m (China–Nepal survey 2020). Thin air: ρ ≈ 0.47 kg/m³; g is ~0.03 m/s² lower than at sea level.' },
  { id: 'burj', name: 'Burj Khalifa (tip)', body: 'earth', lat: 25.19720, lon: 55.27440, ground: 5, dropHeight: 828, note: 'World’s tallest building, 828 m (CTBUH).' },
  { id: 'eiffel', name: 'Eiffel Tower (top floor)', body: 'earth', lat: 48.85837, lon: 2.29448, ground: 33, dropHeight: 276, note: 'Top visitor floor at 276 m above the Champ de Mars.' },
  { id: 'shanghai', name: 'Shanghai Tower', body: 'earth', lat: 31.23353, lon: 121.50553, ground: 4, dropHeight: 632, note: '632 m, China’s tallest building.' },
  { id: 'empire', name: 'Empire State Building (observatory)', body: 'earth', lat: 40.74844, lon: -73.98566, ground: 16, dropHeight: 373, note: 'The 102nd-floor observatory, 373 m. The “penny from the Empire State” myth: it reaches only ~13 m/s.', preset: { object: 'coin' } },
  { id: 'cntower', name: 'CN Tower (SkyPod)', body: 'earth', lat: 43.64256, lon: -79.38706, ground: 76, dropHeight: 447, note: 'SkyPod observation deck, 447 m.' },
  { id: 'pisa', name: 'Leaning Tower of Pisa', body: 'earth', lat: 43.72297, lon: 10.39659, ground: 2, dropHeight: 56, note: 'Galileo’s (legendary) drop experiment, 56 m.', preset: { object: 'cannonball' } },
  { id: 'grandcanyon', name: 'Grand Canyon (Mather Point, South Rim)', body: 'earth', lat: 36.06095, lon: -112.10730, ground: null, dropHeight: 1.6, note: 'South Rim lookout, 2175 m. The canyon floor drops ~400 m within 250 m to the north — throw out over the edge.', preset: { mode: 'throw', speed: 30, elevation: 25, azimuth: 0 } },
  { id: 'angel', name: 'Angel Falls (base)', body: 'earth', lat: 5.96700, lon: -62.53640, ground: null, dropHeight: 979, note: 'Highest uninterrupted waterfall, 979 m — drop a raindrop from the lip (release height measured from the terrain below).', preset: { object: 'raindrop' } },
  { id: 'mariana', name: 'Challenger Deep (sea surface)', body: 'earth', lat: 11.37310, lon: 142.59170, ground: null, dropHeight: 1, note: 'Deepest point of the oceans, ~10 935 m. Drop a bowling ball and watch it sink.', preset: { object: 'bowling' } },
  { id: 'deadsea', name: 'Dead Sea shore', body: 'earth', lat: 31.55900, lon: 35.47320, ground: null, dropHeight: 2, note: 'Lowest land on Earth, −430 m: the densest natural air on land.' },
  { id: 'chimborazo', name: 'Chimborazo summit', body: 'earth', lat: -1.46920, lon: -78.81750, ground: 6263, dropHeight: 2, note: 'Farthest point from Earth’s centre (6384.4 km) — equatorial bulge + altitude: weakest surface gravity on land.' },
  { id: 'northpole', name: 'Geographic North Pole', body: 'earth', lat: 90, lon: 0, ground: null, dropHeight: 100, note: 'No centrifugal effect: strongest normal gravity, ≈ 9.832 m/s². No Coriolis deflection for drops.' },
  { id: 'southpole', name: 'South Pole (Amundsen–Scott)', body: 'earth', lat: -90, lon: 0, ground: null, dropHeight: 100, note: 'On the 2.8 km Antarctic ice sheet.' },
  { id: 'equator', name: 'Equator (Gulf of Guinea, 0°, 0°)', body: 'earth', lat: 0, lon: 0, ground: null, dropHeight: 100, note: 'Maximum centrifugal effect: normal gravity 9.7803 m/s². Maximum eastward Coriolis drift for drops.' },
  { id: 'hudson', name: 'Hudson Bay', body: 'earth', lat: 60, lon: -85, ground: null, dropHeight: 100, note: 'Famous negative gravity anomaly (~ −40 mGal) left by the vanished Laurentide ice sheet.' },
  { id: 'roswell', name: 'Roswell — Red Bull Stratos', body: 'earth', lat: 33.39000, lon: -104.52000, ground: 1100, dropHeight: 38969.4 - 1100, note: '14 Oct 2012: Felix Baumgartner jumped from 38 969.4 m and reached Mach 1.25.', preset: { object: 'stratos', mode: 'drop', deployAGL: 2566.8 - 1100 } },
  { id: 'kennedy', name: 'Kennedy Space Center LC-39A', body: 'earth', lat: 28.60822, lon: -80.60428, ground: 3, dropHeight: 2, note: 'Why rockets climb first: an 8 km/s throw at sea level meets a wall of air (tens of thousands of g). Compare with “Orbit insertion, 200 km”.', preset: { mode: 'throw', speed: 8000, elevation: 2, azimuth: 90, object: 'capsule' } },
  { id: 'leo', name: 'Orbit insertion, 200 km over Florida', body: 'earth', lat: 28.5, lon: -80.6, ground: null, dropHeight: 200000, note: 'Circular orbit at 200 km needs 7.79 km/s inertial. Speeds here are relative to the rotating ground, so eastward that is 7.79 − 0.41 (Earth’s spin at 28.5°) = 7.38 km/s. Thin air (ρ ≈ 2.5e-10 kg/m³) slowly drags it down.', preset: { object: 'capsule', mode: 'throw', speed: 7381, elevation: 0, azimuth: 90 } },
  { id: 'iss', name: 'ISS altitude over the Pacific', body: 'earth', lat: 0, lon: -150, ground: null, dropHeight: 408000, note: 'Drop from 408 km: without orbital speed, it falls straight down — and burns.', preset: { object: 'meteoroid' } },
  { id: 'apollo15', name: 'Hadley–Apennine (Apollo 15)', body: 'moon', lat: 26.13222, lon: 3.63386, ground: 0, dropHeight: 1.6, note: '2 Aug 1971: David Scott dropped a hammer and a feather. They landed together.', preset: { object: 'feather' } },
  { id: 'tranquility', name: 'Tranquility Base (Apollo 11)', body: 'moon', lat: 0.67409, lon: 23.47298, ground: 0, dropHeight: 100, note: 'One-sixth gravity, no air.' },
  { id: 'olympus', name: 'Olympus Mons', body: 'mars', lat: 18.65, lon: -133.8, ground: 21900, dropHeight: 2, note: 'Tallest volcano in the solar system, ~21.9 km above the datum.' },
  { id: 'gale', name: 'Gale Crater (Curiosity)', body: 'mars', lat: -4.5895, lon: 137.4417, ground: -4500, dropHeight: 100, note: 'Curiosity rover landing site, ~4.5 km below datum.' },
  { id: 'galileo', name: 'Galileo probe entry', body: 'jupiter', lat: 6.5, lon: 4.4, ground: 0, dropHeight: 400000, note: '7 Dec 1995: the probe entered at 47.4 km/s and returned data down to ~22 bar.', preset: { object: 'capsule', mode: 'throw', speed: 47400, elevation: -8.5, azimuth: 90 } },
];
