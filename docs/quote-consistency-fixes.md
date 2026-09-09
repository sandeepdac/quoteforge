# Quote consistency fixes

This first implementation batch fixes reproducible accounting and workflow defects. It does not certify machining-time accuracy.

## Changed behavior

- Changing material preserves the model's volume. Density changes material weight, not geometry.
- Sparse parts are priced from the supplied stock volume. No automatic 15 percent yield cap or unpriced near-net blank is substituted. Prices can increase substantially for sparse parts.
- Milling cycle time and machine cost come from the same plan used by the traveller. Tool changes use the plan's tool identities per setup; rapids retain the existing 8 percent allowance. Positive subsecond operations are retained, and positive sub-cent costs remain in the accounting breakdown.
- Derived programming is charged once as NRE, excluded from recurring setup time and repeat-order prices. Legacy routes without derived setup retain their configured programming allowance.
- Review choices live in wizard state. Notes, markup and secondary-operation snapshots survive navigation and quote editing. Legacy secondary selections are recovered from cost lines; a warning requests price and lot-charge confirmation.
- A compressed plan cannot silently remove a priced route machine. Unallocated route operations remain on the traveller with a planning-required warning. Their zero run time means unallocated, not measured zero.
- Tapping already represented in the plan is not repeated as an additional PDF cost row.
- Runtime is now allocated by route holding. Milling plan seconds are charged at the catalog rate of the machine assigned to each setup; turned runtime uses the setup-weighted route rate. The adjustment is visible in the cost breakdown, and the plan/traveller retain the same operation seconds.

## Local acceptance checks

1. Run `npm install`, `npm test`, `npm run lint`, and `npm run build`.
2. Run `npm run dev` and open the Express app on port 3000.
3. Create an aluminium quote, change its material to stainless, and verify the solid volume remains unchanged.
4. Select finishing, enter notes, and change markup. Go back to Quantity and return to Review; save and reopen the quote. Verify all three selections remain.
5. Compare the cycle and operation-plan totals (allowing displayed rounding). Check the non-cutting row identifies both tool count and change count.
6. Test a two-machine route and verify both machines appear on the traveller. Treat any planning-required row as a blocker for shop-floor release.
7. Requote a sparse part: check the displayed stock and priced volume, and review the expected higher roughing cost.

Existing saved prices are not migrated automatically. Reopening and saving recalculates with the new engine; compare against the original before issuing a revision. Back up browser storage before testing production records.

## Remaining work

- Replace aggregate mill-turn boring estimates with operation-specific pilot, roughing and finishing paths and machine-specific non-cutting events.
- Validate tolerances, surface finish, tool reach, stock availability, setup and cycle times against the client evidence; separate quoted estimates from measured actuals.
- Allocate operations semantically to machines and charge each machine's actual runtime rate. Primary-rate pricing and heuristic setup allocation remain.
- Resolve markup versus gross-margin UI terminology, PDF pagination, durable persistence, authentication, and real customer delivery.
- Add browser interaction tests for the quote workflow. This batch has automated calculation and state-restoration tests, not a live client-corpus acceptance run.

No client source documents are included in this change.

- Mill-turn on-axis bores now use pilot-drill, radial roughing-pass, and finish-pass timing. The aggregate volume/MRR result remains a conservative floor for other spindle work.
