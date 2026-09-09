import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { importDimension, mergeToolCatalogue, parseToolKitXml, previewSolidcamLibrary } from './solidcamImport';

// Entirely synthetic fixtures; no supplier or client library data is committed.
const sample = (unit = '1', material = '') => `<ToolsItemsManager Version="11" Istoolkit="1"><Components>
<CompTool ID="1" Type="0" ToolName="Test assembly"><Components>
<CompTool ID="2" Type="2" Name="Test holder"><Components>
<CompTool ID="3" Type="1" Name="Test cutter" VendorName="Fixture &amp; Co" CatalogNum="000123" IsMilling="-1">
<Shape NumFlutes="3"><LenParams><D Units="${unit}" Val="0.5"/><CL Units="0" Val="12"/><SD Val="8"/></LenParams></Shape>
<CuttingConditionsList><CC WorkMaterial="${material}" OperationType="4"/></CuttingConditionsList>
</CompTool></Components></CompTool></Components></CompTool></Components></ToolsItemsManager>`;
const parse = (xml = sample()) => parseToolKitXml(xml, 'fixture.tls', 'fixture.tls', 'hash');

describe('SolidCAM ToolKit metadata import', () => {
  it('retains assemblies, parent relationships and string part numbers', () => {
    const [tool] = parse();
    expect(tool.kind).toBe('assembly');
    expect(tool.components).toHaveLength(3);
    const cutter = tool.components[2];
    expect(cutter.parentId).toBe('2');
    expect(cutter.partNumber).toBe('000123');
    expect(cutter.manufacturer).toBe('Fixture & Co');
    expect(cutter.flutes).toBe(3);
    expect(tool.status).toBe('catalogue-only');
  });
  it('converts each explicit length unit independently without guessing missing units', () => {
    const d = parse()[0].components[2].dimensions;
    expect(d.D).toEqual({ value: .5, sourceUnit: '1', mm: 12.7 });
    expect(d.CL.mm).toBe(12);
    expect(d.SD).toEqual({ value: 8, sourceUnit: 'missing' });
    expect(parse()[0].warnings.some(w => w.includes('Unknown length-unit'))).toBe(true);
  });
  it('does not interpret unrecognised unit codes as metric', () => {
    expect(importDimension('2', '71')).toEqual({ value: 2, sourceUnit: '71' });
  });
  it.each(['', 'NaN', '-1', 'Infinity'])('rejects invalid dimension %s', value => {
    expect(importDimension(value, '0')).toBeUndefined();
  });
  it('does not activate materialless cutting data', () => {
    const [tool] = parse();
    expect(tool.warnings.some(w => w.includes('no work material'))).toBe(true);
    expect(tool).not.toHaveProperty('vc');
    expect(tool).not.toHaveProperty('feed');
  });
  it('preserves named work materials as references, not approved cutting parameters', () => {
    expect(parse(sample('1', 'Test material'))[0].components[2].conditions[0].material).toBe('Test material');
  });
  it('rejects external entities and malformed XML', () => {
    expect(() => parse('<!DOCTYPE x [<!ENTITY y SYSTEM "file:///secret">]>' + sample())).toThrow(/not permitted/);
    expect(() => parse('<ToolsItemsManager>')).toThrow(/invalid XML/);
  });
  it('rejects unsupported schemas and non-ToolKit XML', () => {
    expect(() => parse(sample().replace('Version="11"', 'Version="99"'))).toThrow(/not yet validated/);
    expect(() => parse('<Other/>')).toThrow(/ToolsItemsManager missing/);
  });
  it('walks component folders without treating them as tool assemblies', () => {
    const tools = parse('<ToolsItemsManager Version="11"><Components><CompTool ID="f" Type="6"><Components><CompTool ID="c" Type="1" Name="Fixture"/></Components></CompTool></Components></ToolsItemsManager>');
    expect(tools).toHaveLength(1);
    expect(tools[0].kind).toBe('component');
  });
  it('rejects duplicate and absent source IDs', () => {
    expect(() => parse('<ToolsItemsManager Version="11"><Components><CompTool ID="1"/><CompTool ID="1"/></Components></ToolsItemsManager>')).toThrow(/duplicate/);
    expect(() => parse('<ToolsItemsManager Version="11"><Components><CompTool/></Components></ToolsItemsManager>')).toThrow(/Missing/);
  });
});

describe('SolidCAM files and archives', () => {
  it('imports .tkz XML without treating STL or bundled TLV as extra assemblies', async () => {
    const archive = zipSync({ 'part.tls': strToU8(sample()), 'components/library.TLV': strToU8(sample()), 'model.stl': strToU8('not an stl') });
    const result = await previewSolidcamLibrary(archive, 'fixture.tkz');
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.notices.some(n => n.includes('STL geometry was not'))).toBe(true);
  });
  it('imports standalone XML and makes identical reimports idempotent', async () => {
    const a = await previewSolidcamLibrary(strToU8(sample()), 'fixture.tls');
    const b = await previewSolidcamLibrary(strToU8(sample()), 'fixture.tls');
    expect(mergeToolCatalogue(a.tools, b.tools)).toHaveLength(1);
    const changed = await previewSolidcamLibrary(strToU8(sample('0')), 'fixture.tls');
    expect(mergeToolCatalogue(a.tools, changed.tools)).toHaveLength(2);
  });
  it('does not overwrite existing catalogue edits during a reimport', () => {
    const [tool] = parse();
    expect(mergeToolCatalogue([{ ...tool, name: 'Existing name' }], [tool])[0].name).toBe('Existing name');
  });
  it('rejects unsafe archive paths and archives without metadata', async () => {
    await expect(previewSolidcamLibrary(zipSync({ '../bad.tls': strToU8(sample()) }), 'bad.tkz')).rejects.toThrow(/Unsafe/);
    await expect(previewSolidcamLibrary(zipSync({ 'model.stl': strToU8('x') }), 'empty.tkz')).rejects.toThrow(/No supported/);
  });
  it('fails clearly for binary TAB, renamed binaries, ETL and corrupt archives', async () => {
    await expect(previewSolidcamLibrary(strToU8('CT32.\0'), 'library.TAB')).rejects.toThrow(/Binary/);
    await expect(previewSolidcamLibrary(strToU8('CT32.\0'), 'library.tls')).rejects.toThrow(/Binary/);
    await expect(previewSolidcamLibrary(strToU8('BEGIN_PROCESS'), 'library.etl')).rejects.toThrow(/ETL support/);
    await expect(previewSolidcamLibrary(strToU8('not a zip'), 'library.tkz')).rejects.toThrow();
  });
});
