# Turning tool library: first increment

## Available now

Settings → Tooling separates reusable assembly records from the six core turning
operation assignments. Facing and roughing may reference the same assembly.
Legacy station/description rows remain readable; opening the editor does not
write a migration. Saving creates explicit assembly references. Sample and legacy
inventory starts unconfirmed.

Assembly identity drives distinct-tool setup preparation and selections along the
estimated operation sequence. The initial selection is included: A → A → B → A
means two assemblies and three selections, not four tools. This is an estimated
sequence, not measured controller events or a CAM-derived process plan.

The quote separately shows tool selections, a provisional rapid allowance and
loading. Selection and rapid times retain the existing efficiency adjustment;
loading does not. The plan/traveller runtime now includes all three. Turning
selection and loading allowances are editable in Settings → Estimate. Existing
saved settings are no longer silently changed from three to eight seconds.

Missing assignments are visible assumptions, not silent substitutions. Reference
G-code exports omit motion when any emitted operation lacks a valid tool call.
The preview is still not a production postprocessor.

## Limits

- Inventory is currently one turning setup template, not machine-specific stock.
- Diameter, cutting length, reach, minimum bore and source notes are recorded for
  review only. They do not yet constrain tool selection or cycle time.
- Inventory confirmation is not material, machine or clearance approval.
- Cutting speeds, feeds and depths of cut still come from the material model,
  not the individual assembly. Consumable cost remains an operation allowance.
- Grooving, threading, tapping and cross-feature tools remain provisional groups.
- Records use the app's browser storage, not a shared multi-user inventory database.
- Saved historical quotes are not automatically repriced when settings change.

## Data to obtain and next integrations

1. Obtain a CAM tool-library export or a list of the shop's holder, cutter and
   insert part numbers, including machine assignments and actual stick-out.
2. Attach manufacturer references for geometry and material/operation-specific
   cutting data. Keep recommended ranges separate from shop-approved overrides.
3. Add compatibility checks: operation type, pilot/minimum bore, depth/reach,
   holder clearance and machine limits. Missing data must remain unknown.
4. Feed the selected assembly's approved cutting data into timing, with each
   parameter's source visible in the estimate.
5. Add measured tool-selection/handling time, tool life, usable edges, purchase
   cost and availability. Validate estimates against held-out completed jobs.

A STEP model and drawing specify the part, not the shop's inventory or proven
cutting conditions. Generic sample records must not be presented as that evidence.
