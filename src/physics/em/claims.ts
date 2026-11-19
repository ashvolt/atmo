/**
 * Antigravity claims, and what measurement says about each.
 *
 * Nothing here is a matter of opinion: every row carries the experiment that
 * tested it and the bound that experiment set. Where a claim is ruled out by a
 * conservation law rather than a measurement, the law is named instead.
 *
 * The distinction the app keeps throughout: *levitation* is balancing gravity
 * with another force, which is ordinary physics and works. *Antigravity* would
 * be reducing or shielding gravity itself, and there is no evidence it is
 * possible — the equivalence principle has been tested to about one part in
 * 10¹⁵ and gravitational shielding to comparable precision.
 */

export interface Claim {
  id: string;
  title: string;
  year: string;
  who: string;
  claimed: string;
  /** what was measured, and by whom */
  tested: string;
  /** the experimental bound, as text, with its number */
  bound: string;
  status: 'refuted' | 'unsupported' | 'misidentified' | 'forbidden' | 'established';
  /** the physics that settles it */
  verdict: string;
  source: string;
}

export const CLAIM_STATUS_LABEL: Record<Claim['status'], string> = {
  refuted: 'Refuted by direct measurement',
  unsupported: 'No replication, no evidence',
  misidentified: 'Real effect, wrong explanation',
  forbidden: 'Excluded by a conservation law',
  established: 'Established physics',
};

export const CLAIMS: Claim[] = [
  {
    id: 'equivalence',
    title: 'Does gravity pull equally on everything?',
    year: '1687–2022',
    who: 'Newton, Eötvös, Dicke, Braginsky, MICROSCOPE',
    claimed: 'If different materials fell at even slightly different rates, a material could be found that gravity pulled on less — the first thing real antigravity would need.',
    tested: 'The MICROSCOPE satellite compared the free fall of titanium and platinum test masses in orbit for two years.',
    bound: 'Eötvös parameter η = (−1.5 ± 2.3 ± 1.5) × 10⁻¹⁵ — zero to about one part in 10¹⁵',
    status: 'established',
    verdict: 'Gravity is universal to the precision of the best experiment ever done. No material is magnetically, electrically or chemically privileged in free fall.',
    source: 'P. Touboul et al., Phys. Rev. Lett. 129 (2022) 121102',
  },
  {
    id: 'shielding',
    title: 'Can gravity be shielded or absorbed?',
    year: '1920–present',
    who: 'Majorana (proposed), lunar laser ranging (tested)',
    claimed: 'That a dense screen placed between two bodies would absorb part of their gravitational attraction, with an absorption coefficient h.',
    tested: 'Lunar laser ranging measures the Earth–Moon distance to a few millimetres and would see the Sun’s pull on the Moon change when the Earth lies between them. Eclipse gravimetry tests the same thing.',
    bound: 'h < 10⁻²² m²/kg, about 10¹³ times smaller than Majorana needed to explain anything',
    status: 'refuted',
    verdict: 'There is no gravitational analogue of a Faraday cage. Gravity couples to mass-energy, which cannot be given the opposite sign to make a screen; and unlike charge, there is no negative gravitational charge to redistribute.',
    source: 'J. G. Williams, S. G. Turyshev & D. H. Boggs, Phys. Rev. Lett. 93 (2004) 261101; Eckhardt, Phys. Rev. D 42 (1990) 2144',
  },
  {
    id: 'podkletnov',
    title: 'Podkletnov’s rotating superconductor',
    year: '1992–1997',
    who: 'E. Podkletnov & R. Nieminen',
    claimed: 'A spinning, magnetically levitated YBCO disc reduced the weight of objects above it by 0.05–2.1 %.',
    tested: 'Independent attempts to reproduce the effect, including a dedicated NASA Marshall programme (the "Delta-g" experiment) and work at the University of Sheffield, found nothing. The original paper was withdrawn from publication before it appeared.',
    bound: 'No weight change above a few parts in 10⁸ — more than five orders of magnitude below the claim',
    status: 'unsupported',
    verdict: 'Never replicated. The original measurement used a balance in the fringe field of a large AC magnet, where ordinary magnetic and convective forces act on the test mass at exactly the claimed size.',
    source: 'C. Woods et al., AIAA 2001-3657; N. Li et al., Physica C 281 (1997) 260',
  },
  {
    id: 'emdrive',
    title: 'The EmDrive and other "reactionless" thrusters',
    year: '2001–2021',
    who: 'R. Shawyer; NASA Eagleworks; TU Dresden',
    claimed: 'Microwaves bouncing inside a tapered copper cavity produce net thrust — 1.2 mN/kW — without expelling anything.',
    tested: 'TU Dresden rebuilt the Eagleworks apparatus with a torsion balance able to resolve nanonewtons, and traced every apparent thrust to thermal expansion of the mounting and to the Earth’s magnetic field acting on the power leads. Reversing the cavity made no difference to the "thrust".',
    bound: 'Thrust < 10⁻⁴ of the claimed value once thermal and magnetic artefacts are removed',
    status: 'refuted',
    verdict: 'The measured force was the apparatus warming up. A closed cavity cannot produce net thrust without something leaving it: momentum conservation follows from the translational symmetry of space, which is as well tested as physics gets.',
    source: 'M. Tajmar et al., Acta Astronautica 141 (2017) 8; M. Kößling et al., 2021 (SpaceDrive II)',
  },
  {
    id: 'lifter',
    title: 'Ionic "lifters" and the Biefeld–Brown effect',
    year: '1920s–present',
    who: 'T. T. Brown; many hobbyists',
    claimed: 'A high-voltage asymmetric capacitor lifts itself by coupling electricity to gravity.',
    tested: 'The same device in vacuum produces no thrust at all. In air its thrust matches ion-wind (corona discharge) theory, roughly 20–100 N per kilowatt at a few tens of kilovolts.',
    bound: 'Thrust in vacuum below the noise floor of a milligram balance; thrust in air fully accounted for by momentum transfer to air ions',
    status: 'misidentified',
    verdict: 'A real and useful effect — electroaerodynamic propulsion, now flown on small aircraft — but it is a fan with no moving parts, not antigravity. Remove the air and it stops.',
    source: 'M. Tajmar, AIAA J. 42 (2004) 315; H. Xu et al., Nature 563 (2018) 532',
  },
  {
    id: 'negativemass',
    title: 'Negative mass',
    year: '1957–present',
    who: 'H. Bondi; W. B. Bonnor',
    claimed: 'A material with negative gravitational mass would be repelled by ordinary matter — genuine antigravity.',
    tested: 'No negative-mass matter has ever been observed. Antimatter was the obvious candidate, and the ALPHA-g experiment at CERN measured antihydrogen falling *downwards* at the normal rate.',
    bound: 'Antihydrogen’s gravitational acceleration is (0.75 ± 0.15)·g downwards — same sign, same order',
    status: 'unsupported',
    verdict: 'If it existed, a negative-mass and a positive-mass body would chase each other, accelerating forever with no energy input — a runaway that breaks energy conservation and, in general relativity, lets you build closed timelike curves. The energy conditions that forbid it are also what forbid traversable wormholes.',
    source: 'H. Bondi, Rev. Mod. Phys. 29 (1957) 423; E. K. Anderson et al., Nature 621 (2023) 716',
  },
  {
    id: 'gravitomagnetic',
    title: 'Spinning masses as a gravity shield',
    year: '1918–present',
    who: 'Lense & Thirring (theory); Gravity Probe B (measurement)',
    claimed: 'That a rapidly spinning mass can generate a repulsive "gravitomagnetic" field strong enough to be useful.',
    tested: 'Frame dragging is real and was measured by Gravity Probe B around the Earth. Its size is the issue.',
    bound: 'Earth’s frame-dragging precession is 37 milliarcseconds per year — about 10⁻¹⁴ of the Newtonian effect',
    status: 'established',
    verdict: 'Gravitomagnetism exists, is predicted by general relativity, and has been measured. But it scales as v²/c², so a laboratory rotor produces an effect some 10²⁰ times too small to notice, let alone lift anything.',
    source: 'C. W. F. Everitt et al., Phys. Rev. Lett. 106 (2011) 221101',
  },
  {
    id: 'diamagnetic',
    title: 'Levitating a living thing in a magnet',
    year: '1997',
    who: 'A. Geim, M. Berry, Nijmegen High Field Magnet Laboratory',
    claimed: 'That a frog can be made to float in mid-air, unharmed, with no support.',
    tested: 'Done, in a 16 T magnet with a 32 mm bore. Water, hazelnuts, a frog and later a mouse have all been levitated this way.',
    bound: 'Needs B·∂B/∂z ≈ 1400 T²/m — met and exceeded',
    status: 'established',
    verdict: 'Completely real, and not antigravity: water is weakly diamagnetic, so a strong enough field gradient pushes it up as hard as gravity pulls it down. Geim shared the 2000 Ig Nobel Prize for it, and the 2010 Nobel Prize for graphene.',
    source: 'M. V. Berry & A. K. Geim, Eur. J. Phys. 18 (1997) 307',
  },
];

/**
 * The impossibility argument, stated in the form the app shows it.
 * Each item is a step that can be checked rather than taken on trust.
 */
export const IMPOSSIBILITY_STEPS: { title: string; body: string }[] = [
  {
    title: 'Gravity has only one sign',
    body: 'Electric charge comes in two kinds, so charges can be arranged to cancel — that is what makes a Faraday cage possible. Every known form of mass-energy gravitates with the same sign, so there is nothing to cancel with. This is not a technological gap; it is the structure of the field.',
  },
  {
    title: 'Free fall does not depend on what you are made of',
    body: 'The MICROSCOPE satellite compared titanium and platinum in orbit and found their accelerations equal to about one part in 10¹⁵. If any material were even slightly privileged, that is where it would have shown up.',
  },
  {
    title: 'A static field cannot trap a fixed moment',
    body: 'Earnshaw’s theorem: in a source-free region the interaction energy of a fixed charge or dipole is a harmonic function, so its Laplacian vanishes and the three stiffnesses sum to zero. Stability in one direction is paid for with instability in another. You can check it in the app: the trace of the stiffness matrix comes out zero to machine precision.',
  },
  {
    title: 'But induced moments are a different matter',
    body: 'If the moment is induced rather than fixed, the energy goes as B² instead of B, and ∇²(B²) = 2|∇B|² ≥ 0. B² is subharmonic: it can have a minimum, just never a maximum. A diamagnet sits in that minimum. This is the whole reason diamagnetic and superconducting levitation work, and why paramagnetic levitation never can.',
  },
  {
    title: 'So levitation is easy and antigravity is not',
    body: 'Six of the modes in this app hold objects up indefinitely with no trickery. None of them touch gravity. They balance it — with a field gradient, with induced currents, with sound, with light, with feedback, or by pushing air down. That distinction is the whole subject.',
  },
];
