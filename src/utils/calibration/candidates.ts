/**
 * CANDIDATE MODELS, and what each one is for.
 *
 * These are not four attempts at the same thing. Each isolates one question, and
 * the answers only mean something side by side:
 *
 *   v0  the shipped engine. The incumbent.
 *   v1  v0's times at Lance's flat rate. Asks: is the rate discovery worth
 *       shipping ON ITS OWN? (No — see below. It must go with the times.)
 *   v2  setup from machine setup-character, at the flat rate. The first
 *       candidate that beats v0 on the number that matters.
 *   v3  ORACLE. Lance's own router minutes at his own rate. Not shippable —
 *       it is the ceiling, and its job is to tell us where the error ISN'T.
 *
 * THE ORACLE IS THE IMPORTANT ONE. It reproduces every quoted price to within
 * 3%. So the way we turn time into money — flat rate, externals at cost, margin
 * on selling price — is already correct, and *every* remaining error in the
 * shipped engine is time estimation. That single result rules out rates, margin
 * structure and material handling as causes, which is worth more than any
 * improvement to the total.
 */

/**
 * The rate observation. Exact to the penny on four single-op parts, and the
 * two-quantity part solves to it independently for setup and cycle separately.
 * Not a fit.
 */
export const flatRatePerHour = (machiningOps: number) => (machiningOps <= 1 ? 30.0 : 38.0);

/**
 * Setup minutes as a property of the MACHINE, not of the part.
 *
 * This is the hypothesis that survived. Setting a 5-axis mill-turn with twenty
 * driven tools is a bigger job than setting a 2-axis lathe, whatever is in the
 * chuck — so the first-order driver is which machine, and part complexity is a
 * second-order modifier rather than the other way round.
 *
 * Fitted to seven parts, so `assumed` at best. But unlike a global multiplier it
 * makes a falsifiable claim about each machine INDIVIDUALLY: one new quote on
 * the SR20 tests the SR20 number and nothing else. That is the difference
 * between a model that can be pressure-tested and one that can only be re-fitted.
 *
 * Known weak points, in priority order for the next quote:
 *   - SR#32 at 900 vs SR20 at 240. Both Swiss sliding heads, 3.75x apart. Either
 *     part complexity matters more than this model allows, or these are not
 *     comparable machines. One more SR#32 part settles it.
 *   - NTX1000 seen at 600 and 1200. The 2x spread is inside one machine, so
 *     something part-specific is real and unmodelled here.
 */
export const SETUP_CHARACTER_MIN: Record<string, number> = {
  'XD10': 180,
  'Mori': 210,
  'SR20': 240,
  'SR#32': 900,
  'NTX1000': 900,
  'MINI MILL': 405,
  'HAAS VF2': 60,
};

/** A second machining op sets up faster: the part exists, only the holding changes. */
export const SECOND_OP_SETUP_FRACTION = 0.5;

/**
 * Scores measured over the seven quotes. `spread` is worst/best price ratio and
 * is the only figure that cannot be moved by a constant — a model that improves
 * `typical` while leaving `spread` alone has done nothing but rescale.
 */
export const MEASURED = {
  v0: { typical: 0.34, spread: 7.8, systematic: true },
  v1: { typical: 0.34, spread: 5.0, systematic: true },
  v2: { typical: 0.71, spread: 2.7, systematic: false },
  v3: { typical: 1.00, spread: 1.1, systematic: false },
} as const;

/**
 * RE-MEASURED once machine selection reached 6/6 on Lance's routers, and once
 * setup came from the whole ROUTE rather than one machine's character stretched
 * by a fudge factor. v2 above used LANCE'S machine for each part; these use ours.
 *
 * The three ingredients were measured SEPARATELY, and that mattered — bundled
 * together they score worse than the best one alone:
 *
 *   shipped                    typical 0.32   spread 6.8
 *   flat £30/hr rate only      typical 0.22   spread 8.8   worse
 *   two-op rate uplift only    typical 0.33   spread 7.8   worse
 *   route setup only           typical 0.78   spread 3.5   SHIPPED
 *   all three                  typical 0.52   spread 3.8   worse than route alone
 *
 * Flattening the rate is the change that looks most obviously right and measures
 * most obviously wrong. The reason is in the cycle column: our cycle times run
 * 3-50x fast, and a £75/hr rate against Lance's £30 is quietly absorbing that.
 * Remove the padding before fixing what it was padding and the answer gets worse.
 */
export const MEASURED_V4 = {
  shipped: { typical: 0.32, spread: 6.8, systematic: true },
  flatRateOnly: { typical: 0.22, spread: 8.8, systematic: true },
  rateUpliftOnly: { typical: 0.33, spread: 7.8, systematic: true },
  routeSetupOnly: { typical: 0.78, spread: 3.5, systematic: false },
  allThree: { typical: 0.52, spread: 3.8, systematic: true },
} as const;

/**
 * WHAT THE COMPARISON SAYS TO DO NEXT, in order:
 *
 * 1. The pricing structure is DONE. The oracle proves it. Stop looking there.
 * 2. Setup: v2 takes spread from 7.8 to 2.7 and stops the errors all pointing
 *    one way. Ship the machine-character model, keep its weak points listed
 *    above visible, and let the next quote test them.
 * 3. CYCLE time is then the dominant residual, and it is concentrated on the two
 *    intricate parts: after v2 fixes setup on the Drive Dog (setup ratio 0.98)
 *    its price is still 0.57 because cycle is 0.09 — 11x low. The Hollow Arm is
 *    33x low on cycle. Both are done-complete jobs with many tiny features, so
 *    the cycle model is what to attack after setup, not before.
 */
/**
 * CYCLE TIME — what was wrong, what was fixed, and what is still missing.
 *
 * The diagnosis that mattered was not "our times are too low". It was that the
 * model could not TELL THE PARTS APART. Lance's cycle times span x53 across the
 * seven jobs — 1.5 min for a guide rod, 80 min for a hollow arm bulkhead — and
 * ours spanned x7. No multiplier fixes that, for the same reason no multiplier
 * fixed the price spread.
 *
 * Worse, nothing we measured predicted his minutes. Removed VOLUME, which is
 * what the model is mostly built on, correlates r = 0.07. Surface area r = 0.15.
 * The model was driving on the wrong variable.
 *
 * FOUR DEFECTS were found and fixed, all of them things that cost zero or were
 * simply mis-measured, none of them tuned to make a number come out right:
 *
 *   1. Hole DEPTH was assumed to be the thinnest wall of the billet. The Cold
 *      Stage Block's ⌀1.0 x 25 mm hole was priced as 14 mm.
 *   2. Hole DIAMETER did not enter the drilling time at all — a flat 12 s per
 *      hole. A ⌀0.65 drill and a ⌀20 drill cost the same.
 *   3. Bore depth was read from the largest single FACE of a bore rather than
 *      the whole bore, so the VOC housing's 70 mm through hole measured 14 mm.
 *      A related sign error, where two halves of one hole with opposing axes
 *      were merged without being brought into a common frame, reported that same
 *      part as having a 125 mm hole in a 70 mm body.
 *   4. Off-axis (cross) features were detected, named in the plan, and costed at
 *      NOTHING. This was known and documented rather than hidden, which is how
 *      it was found. Two of Lance's parts make the case on their own: a stainless
 *      guide rod with no cross features runs 1.5 min, and an acetal drive dog of
 *      the same size in an easier material runs 15 min, and cross features are
 *      the only difference between them.
 *
 * WHAT IT BOUGHT, on price over the seven quotes: typical 0.78 -> 0.83, spread
 * unchanged at 3.5. Honest reading: the defects were real and worth fixing, the
 * cycle model discriminates better than it did (x7 -> x9 of Lance's x53), and
 * the score barely moved. Fix number 2 measured slightly WORSE on its own,
 * because the flat 12 s it replaced was overcharging small holes and quietly
 * covering for time missing elsewhere.
 *
 * WHAT IS STILL MISSING, stated plainly rather than fitted away: cycle time is
 * still roughly 5x short, and most of the shortfall sits on one part. The hollow
 * arm bulkhead is 11 mm across with a ⌀0.65 hole and Lance books 80 minutes a
 * part on it. No cutting-rate arithmetic reaches that number — the metal removal
 * is seconds. What fills those 80 minutes is not cutting: it is the care a
 * machinist takes with a tool that snaps if it is pushed, on a part that already
 * has an hour in it. That is real, it is large, and this model cannot see it.
 * It is question 1 for Lance, not a coefficient to invent.
 */
export const MEASURED_CYCLE = {
  /** Ratio of our cycle minutes to Lance's, geometric mean over the seven parts. */
  before: { typical: 0.134, spread: 16.2, dynamicRange: 7 },
  after: { typical: 0.206, spread: 20.3, dynamicRange: 9 },
  /** Lance's own cycle times span this much. The target for discrimination. */
  lanceDynamicRange: 53,
  /** The same fixes measured on PRICE, which is what actually ships. */
  priceBefore: { typical: 0.78, spread: 3.5 },
  priceAfter: { typical: 0.83, spread: 3.5 },
} as const;

export const NEXT_STEPS = [
  'pricing structure: settled by the oracle, no work needed',
  'machine selection: DONE, 6/6 against Lance routers',
  'setup: DONE, route setup shipped, spread 6.8 -> 3.5',
  'cycle: four measurement defects fixed; still ~5x fast (see MEASURED_CYCLE)',
  'cycle, remaining: the gap is NOT cutting rate. Ask Lance what fills the hour',
  'rate: only after cycle. Flattening it now measures WORSE (see MEASURED_V4)',
] as const;
