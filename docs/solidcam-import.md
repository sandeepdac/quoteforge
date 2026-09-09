# SolidCAM catalogue import

Open **Settings → Tool Imports**, choose a file, review the preview and select
records. Acknowledge that you have permission for your intended use before
saving. Imports are local to the browser; files are not sent to the app server.

## Supported in this increment

- ToolKit XML with `ToolsItemsManager Version="11"`, in `.tls`, `.tlv` or `.xml`.
- `.tkz` ZIP archives containing these XML libraries. If `.tls` assembly libraries
  exist, bundled `.tlv` components are excluded from the top-level catalogue to
  avoid duplicate listings. Inline assembly components are retained.
- Names, source IDs, manufacturer references, part numbers, parent-child
  component relationships, flute counts and length parameters.
- Explicit per-length unit codes: `0` for millimetres and `1` for inches. Both the
  original value/unit code and converted millimetres are retained. Missing or
  unknown codes are not guessed. Confirm representative dimensions in SolidCAM.
- Work-material and operation references from cutting-condition records. These
  are NOT feeds/speeds and do not activate approved cutting parameters.

This is the observed XML schema version, not a claim of compatibility with every
release of SolidCAM. Other schemas fail explicitly until validated.

## Not implemented

Binary `.TAB`, text `.etl`, linked-library resolution, mounting transformations,
STL geometry/simulation, turning-tool suitability, pricing, supplier licensing or
shop-inventory synchronization. Importing a catalogue does not change an existing
quote, operation assignment, machine setup, feed, speed or consumable allowance.

The manufacturer libraries and the TITAN download are not distributed with the
code. Download access is not a commercial redistribution licence. The fixture in
`src/utils/fixtures/synthetic-toolkit.tls` is original synthetic test data only.

## Persistence and guardrails

Records are stored separately under the app's versioned `imported-tool-catalogue`
browser-storage key. Exact reimports use a source SHA-256, library path and source
ID to avoid duplicates. Changed files become distinct revisions; imports never
silently overwrite existing catalogue records. Save failures are visible.

Keep the source file as backup: this is not a multi-user database. The initial
catalogue cap is 1,500 records / 2 million serialized characters. Limits also
cover file size, metadata expansion, ZIP entry count and component nesting.
Parsing runs in a cancellable worker with a timeout. Archive content is never
written to disk, STL entries are skipped, unsafe paths are rejected, and XML DTD
and entity declarations are prohibited.

## Verification

Synthetic tests cover units, component trees, materialless conditions, duplicate
IDs, repeat import, unknown schemas, unsafe paths, malformed XML and unsupported
binary files. Local read-only inspection of the supplied TITAN archive yielded
15 assemblies and 45 inline component records; this is not production machining
validation or permission to redistribute its contents.

Next: validate a manufacturer-backed turning assembly export, add `.etl` support,
then implement reviewed promotion from catalogue to machine-specific inventory
and geometry/material suitability checks before integrating cutting data.
