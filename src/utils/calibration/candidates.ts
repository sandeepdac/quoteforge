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
export const NEXT_STEPS = [
  'pricing structure: settled by the oracle, no work needed',
  'setup: adopt machine setup-character (v2), spread 7.8 -> 2.7',
  'cycle: dominant residual after v2, concentrated on done-complete parts',
] as const;
