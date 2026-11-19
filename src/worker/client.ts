import type { LevDynamicsRequest, LevDynamicsResponse, LevResponse, RunResponse, ScenarioInput, WorkerRequest } from './sim.worker';
import type { LevScenarioInput, LevSolution } from '../physics/em/solve';
import type { LocalGrid } from '../physics/environment';
import type { ValidationResult } from '../validation/cases';
import SimWorker from './sim.worker?worker';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; progress?: (f: number) => void };

/**
 * Promise-based client. Two workers: one for full runs, one for fast
 * interactive previews (aiming), so a long orbital run never blocks aiming.
 */
export class SimClient {
  private workers: Worker[] = [];
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private readyCount = 0;
  ready: Promise<void>;

  constructor(egm: ArrayBuffer, gravityGrid: ArrayBuffer, elevationGrid: ArrayBuffer) {
    this.ready = new Promise((resolve, reject) => {
      for (let i = 0; i < 2; i++) {
        const w = new SimWorker();
        w.onmessage = (ev) => {
          const m = ev.data;
          if (m.type === 'ready') {
            if (++this.readyCount === 2) resolve();
            return;
          }
          const p = this.pending.get(m.id);
          if (!p) return;
          if (m.type === 'progress') p.progress?.(m.frac);
          else if (m.type === 'error') {
            this.pending.delete(m.id);
            p.reject(new Error(m.message));
          } else {
            this.pending.delete(m.id);
            p.resolve(m);
          }
        };
        w.onerror = (e) => reject(new Error(e.message));
        const init: WorkerRequest = { type: 'init', egm: egm.slice(0), gravityGrid: gravityGrid.slice(0), elevationGrid: elevationGrid.slice(0) };
        w.postMessage(init);
        this.workers.push(w);
      }
    });
  }

  setLocals(grids: LocalGrid[]) {
    for (const w of this.workers) w.postMessage({ type: 'locals', grids } satisfies WorkerRequest);
  }

  private call<T>(worker: number, msg: Omit<WorkerRequest, 'id'> & { type: 'run' | 'validate' }, progress?: (f: number) => void): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, progress });
      this.workers[worker].postMessage({ ...msg, id });
    });
  }

  run(scenario: ScenarioInput, progress?: (f: number) => void): Promise<RunResponse> {
    return this.call<RunResponse>(0, { type: 'run', scenario } as never, progress);
  }

  /** fast low-tolerance preview on the second worker; newer requests supersede older ones */
  private previewToken = 0;
  async preview(scenario: ScenarioInput): Promise<RunResponse | null> {
    const token = ++this.previewToken;
    const res = await this.call<RunResponse>(1, { type: 'run', scenario } as never);
    return token === this.previewToken ? res : null;
  }

  async validate(progress?: (f: number) => void): Promise<ValidationResult[]> {
    const r = await this.call<{ results: ValidationResult[] }>(0, { type: 'validate' } as never, progress);
    return r.results;
  }

  async emValidate(progress?: (f: number) => void): Promise<ValidationResult[]> {
    const r = await this.call<{ results: ValidationResult[] }>(0, { type: 'emValidate' } as never, progress);
    return r.results;
  }

  /** solve a levitation scenario (fast: no time stepping) */
  async levitate(scenario: LevScenarioInput): Promise<LevSolution> {
    const r = await this.call<LevResponse>(1, { type: 'levitate', scenario } as never);
    return r.solution;
  }

  /** newer levitation solves supersede older ones, like the aiming preview */
  private levToken = 0;
  async levitatePreview(scenario: LevScenarioInput): Promise<LevSolution | null> {
    const token = ++this.levToken;
    const r = await this.call<LevResponse>(1, { type: 'levitate', scenario } as never);
    return token === this.levToken ? r.solution : null;
  }

  /** 6-DOF rigid-body run, on the main worker */
  async levDynamics(request: LevDynamicsRequest, progress?: (f: number) => void): Promise<LevDynamicsResponse['run']> {
    const r = await this.call<LevDynamicsResponse>(0, { type: 'levDynamics', request } as never, progress);
    return r.run;
  }
}
