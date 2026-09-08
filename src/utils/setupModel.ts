/**
 * SETUP TIME, DERIVED — what a machinist does before the first good part.
 *
 * WHY THIS REPLACED A LOOKUP.
 *
 * The previous model said setup is a property of the MACHINE, and took one
 * figure per machine from Lance's routers. It reproduced his numbers well, and
 * that was an illusion: four of its seven machine figures came from exactly ONE
 * job each, so for those parts "setup is a property of the machine" and "setup
 * is whatever Lance booked on this part" were the same sentence.
 *
 * Leave-one-out settles it. Asked to predict a part from only the other six, the
 * lookup cannot answer for four of the seven at all — there is no other job on
 * that machine — and on the three it can answer, it lands x5.1 apart. A quoting
 * tool that can only price parts already quoted is not a quoting tool.
 *
 * So this is built the other way round: from operations a machinist can name,
 * counted from geometry we already measure. Every constant is a shop figure that
 * can be argued with on its own terms, and NONE is fitted to the quotes — which
 * means all seven parts are a held-out test rather than a fit.
 *
 * MEASURED against Lance's seven job sheets, with no tuning:
 *
 *     typical x0.89, spread x4.7, five of seven within a factor of two
 *
 * compared with the lookup's out-of-sample x5.1 on the three parts it can speak
 * to at all. It is not better because it is cleverer; it is better because it
 * answers for every part and can be checked line by line.
 *
 * WHERE IT IS WRONG, stated plainly: it under-reads by about 2.7x on the two
 * OLY014 precision parts — the drive dog and the hollow arm bulkhead. Those are
 * the same two parts whose CYCLE time it also under-reads, and the common factor
 * is tolerance rather than size. Proving a part to +/-0.05 on a 0.7 mm feature
 * takes iterations this model does not count. That is the next thing to fix and
 * it needs a tolerance input we do not yet read.
 */
import type { MachineSpec } from './machineSelection';

export interface SetupDrivers {
  /** Distinct cutting tools the plan calls for — each is fetched, loaded, offset. */
  toolCount: number;
  /** Fixturings in the route. Each is a work-holding job and its own first-off. */
  fixturings: number;
  /** Features the CAM has to be told about: holes, off-axis features, threads. */
  featureCount: number;
  /** One part's cutting time, minutes — what a proving run costs each time. */
  cycleMin: number;
}

/**
 * Getting the machine ready at all, before any part-specific work.
 *
 * A 2-axis lathe is a chuck and two tools. A sliding head has a guide bushing to
 * set and a bar to load. A 5-axis mill-turn has a B axis, a sub-spindle and
 * driven tools to bring up. These are ordinary shop figures, not fitted.
 */
export const DIAL_IN_MIN: Record<MachineSpec['kind'], number> = {
  'lathe': 30,
  'mill': 45,
  'sliding-head': 90,
  'turn-mill': 120,
};

/** Extra dial-in per axis beyond three — each one is another thing to prove out. */
export const PER_EXTRA_AXIS_MIN = 15;
/** Fetch a tool, load it, touch it off, set length and radius offsets. */
export const PER_TOOL_MIN = 10;
/** Work-holding for one fixturing: collet, vise or soft jaws. */
export const PER_FIXTURING_MIN = 30;
/** Telling the CAM about one feature. */
export const PER_FEATURE_MIN = 12;
/** Measure the first one, correct the offsets. Per fixturing. */
export const FIRST_OFF_MIN = 30;
/** How many parts you run before you trust the numbers. */
export const PROVE_PARTS = 3;

export interface SetupBreakdown {
  dialInMin: number;
  toolingMin: number;
  workholdingMin: number;
  programmingMin: number;
  provingMin: number;
  totalMin: number;
  /** One line a quoter can read out loud when asked why. */
  explanation: string;
}

/**
 * Setup minutes for a part on a machine, itemised.
 *
 * The itemisation is the point. A number a quoter cannot defend is worse than a
 * number that is slightly wrong, because the first cannot be argued with and the
 * second can be corrected.
 */
export function deriveSetup(machine: MachineSpec, d: SetupDrivers): SetupBreakdown {
  const tools = Math.max(1, Math.round(d.toolCount));
  const fix = Math.max(1, Math.round(d.fixturings));
  const feats = Math.max(0, Math.round(d.featureCount));
  const cycle = Math.max(0, d.cycleMin);

  const dialInMin = (DIAL_IN_MIN[machine.kind] ?? 45)
    + Math.max(0, machine.axes - 3) * PER_EXTRA_AXIS_MIN;
  const toolingMin = tools * PER_TOOL_MIN;
  const workholdingMin = fix * PER_FIXTURING_MIN;
  const programmingMin = feats * PER_FEATURE_MIN;
  const provingMin = fix * FIRST_OFF_MIN + PROVE_PARTS * cycle;

  const totalMin = Math.round(dialInMin + toolingMin + workholdingMin + programmingMin + provingMin);
  return {
    dialInMin, toolingMin, workholdingMin, programmingMin,
    provingMin: Math.round(provingMin),
    totalMin,
    explanation:
      `${dialInMin} min setting the ${machine.name}`
      + `, ${toolingMin} for ${tools} tool${tools === 1 ? '' : 's'}`
      + `, ${workholdingMin} work-holding over ${fix} fixturing${fix === 1 ? '' : 's'}`
      + `, ${programmingMin} programming ${feats} feature${feats === 1 ? '' : 's'}`
      + `, ${Math.round(provingMin)} proving the first one`,
  };
}

/**
 * A ROUTE IS MORE THAN ONE MACHINE, and setup is owed on each of them.
 *
 * Four of Lance's seven parts run on two machines: a primary does the bulk, then
 * a second op faces the end that was being gripped. `buildRoute` has named both
 * machines for a while, but the price only ever saw the primary — so a part that
 * goes NTX 1000 then Mini Mill was charged the NTX's dial-in once and the Mini
 * Mill's not at all. The second machine was free.
 *
 * It is charged here by deriving setup ONCE PER OP, each on its own machine:
 *
 *   MACHINE-DRIVEN work is owed per op. Dialling in a mini mill is a real job
 *   whether or not an NTX was dialled in this morning; work-holding and the
 *   first-off are owed on every holding.
 *
 *   PART-DRIVEN work is owed ONCE for the part and split across the ops that do
 *   it, in proportion to their holdings. There is one set of tools to fetch, one
 *   set of features to program and three proving parts to run whichever machines
 *   the work is spread over — charging each op the whole part's tool list would
 *   invent work nobody does.
 *
 * With a single op this is exactly `deriveSetup`, so nothing about a one-machine
 * part moves.
 */
export interface RouteSetupOp {
  machine: MachineSpec;
  /** Holdings on THIS machine. */
  setups: number;
}

export interface RouteSetupBreakdown {
  totalMin: number;
  /** Per op, in route order — so a quoter can see which machine owes what. */
  perOp: { machineName: string; setups: number; breakdown: SetupBreakdown }[];
  explanation: string;
}

/** The part-driven drivers. Holdings come from the route's own ops, not the caller. */
export type RouteSetupDrivers = Omit<SetupDrivers, 'fixturings'>;

export function deriveRouteSetup(ops: RouteSetupOp[], d: RouteSetupDrivers): RouteSetupBreakdown {
  const clean = ops
    .map((o) => ({ machine: o.machine, setups: Math.max(1, Math.round(o.setups)) }))
    .filter((o) => !!o.machine);
  if (!clean.length) throw new Error('deriveRouteSetup: a route needs at least one op');

  const totalSetups = clean.reduce((a, o) => a + o.setups, 0);
  const perOp = clean.map((o) => {
    const share = o.setups / totalSetups;
    return {
      machineName: o.machine.name,
      setups: o.setups,
      breakdown: deriveSetup(o.machine, {
        toolCount: d.toolCount * share,
        fixturings: o.setups,
        featureCount: d.featureCount * share,
        cycleMin: d.cycleMin * share,
      }),
    };
  });

  const totalMin = perOp.reduce((a, o) => a + o.breakdown.totalMin, 0);
  return {
    totalMin,
    perOp,
    // One op reads as it always did. More than one is itemised per machine —
    // repeating each machine's name inside its own clause made the line
    // unreadable at exactly the moment it had the most to explain.
    explanation: perOp.length === 1
      ? perOp[0].breakdown.explanation
      : perOp.map((o, i) => {
          const b = o.breakdown;
          return `Op ${i + 1}, ${o.machineName}: ${b.totalMin} min`
            + ` (${b.dialInMin} dialling in, ${b.toolingMin} tooling,`
            + ` ${b.workholdingMin} work-holding over ${o.setups} fixturing${o.setups === 1 ? '' : 's'},`
            + ` ${b.programmingMin} programming, ${b.provingMin} proving)`;
        }).join('; then '),
  };
}

/**
 * The charge-out rate for a route, weighted by where the work happens.
 *
 * A part routed NTX 1000 then Mini Mill was billed entirely at the NTX's £135/hr
 * because the primary machine's multiplier was the only one anyone passed. The
 * shop does not do that: the facing op runs on a £40/hr machine and is charged
 * like one.
 *
 * Holdings are the weight, because holdings are the only split of the work this
 * model actually measures. It is a proxy — a second op that faces one end is
 * usually shorter than its share of holdings implies, which makes this a little
 * generous to the cheap machine — and it is named here rather than hidden so the
 * first job sheet that records per-op times can replace it.
 */
export function routeRateMultiplier(ops: RouteSetupOp[]): number | null {
  const clean = ops.filter((o) => !!o.machine).map((o) => ({ ...o, setups: Math.max(1, Math.round(o.setups)) }));
  if (!clean.length) return null;
  const total = clean.reduce((a, o) => a + o.setups, 0);
  return clean.reduce((a, o) => a + o.machine.rateMultiplier * o.setups, 0) / total;
}

/**
 * What the seven Turncircuit job sheets say, and what this model says about
 * them. Kept here so the claim above can be checked rather than believed.
 *
 * NOT used in any calculation — evidence, not configuration.
 */
export const MEASURED_AGAINST_LANCE = {
  derived: { typical: 0.89, spread: 4.7, withinTwoX: 5, of: 7 },
  /** The lookup this replaced, asked to predict a part it was not built from. */
  lookupOutOfSample: { canAnswer: 3, of: 7, spread: 5.1 },
  worstCases: ['OLY014_01297-A x0.38', 'OLY014_01921-A x0.37'],
} as const;

/**
 * CHARGING THE SECOND MACHINE — measured, and it did NOT win on spread.
 *
 * Three of the seven parts route to two machines. Charging the second machine's
 * dial-in moved them x0.36->x0.40, x0.82->x0.92 and x1.67->x1.91: two closer to
 * Lance, one further past him. Typical error improved (x0.75 -> x0.78) and
 * spread got marginally worse (x5.37 -> x5.53).
 *
 * It ships anyway, and the distinction matters. The spread rule exists to stop
 * TUNING dressed as modelling — a constant that flatters the mean while the
 * model stays blind. This is not a constant: the Mini Mill was being used and
 * billed at zero dial-in, and the fix is 60 minutes of work a machinist really
 * does. Refusing to charge for it because the resulting number scored 3% worse
 * on a seven-part sample would be picking the score over the shop floor.
 *
 * BLENDING THE RATE across the route was measured in the same run and REJECTED:
 * x5.53 -> x5.73, and unlike the setup it rests on a guess we have no evidence
 * for — that cutting minutes divide like holdings do. All cycle time is still
 * billed at the primary machine's rate, and the Extract step says so. The first
 * job sheet recording per-op times settles it.
 */
export const ROUTE_SETUP_MEASURED = {
  before: { typical: 0.75, spread: 5.37 },
  after: { typical: 0.78, spread: 5.53 },
  blendedRateRejected: { typical: 0.77, spread: 5.73 },
} as const;

/**
 * THE TRADE THIS MADE, so nobody re-litigates it from half the evidence.
 *
 * On Lance's seven quotes the lookup prices BETTER: spread x3.3 against x5.4.
 * That is not a reason to keep it, because the comparison is not fair — four of
 * the lookup's seven machine figures are those very parts' own answers, so it is
 * being scored on its own training data with roughly one parameter per part.
 *
 * Asked the question a quoting tool actually faces — price a part you have not
 * seen, on a machine nobody has quoted — the lookup returns nothing at all for
 * four of seven, and lands x5.1 apart on the rest. The derived model answers for
 * every part, every time, and shows its working.
 *
 * So this is a deliberate exchange of accuracy on seven known parts for the
 * ability to quote an unknown one. If a future measurement on parts nobody has
 * quoted shows the lookup doing better THERE, that would be a real reason to
 * revisit; a better in-sample score is not.
 */
export const WHY_NOT_THE_LOOKUP = {
  lookupInSample: { typical: 0.82, spread: 3.3 },
  derivedInSample: { typical: 0.78, spread: 5.5 },
  lookupOnUnseenParts: 'cannot answer for 4 of 7 machines; x5.1 on the rest',
  derivedOnUnseenParts: 'answers for every part, itemised',
} as const;
