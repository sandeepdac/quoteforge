import { unzipSync } from 'fflate';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export const IMPORT_LIMITS = { fileBytes: 64 * 1024 * 1024, xmlBytes: 5 * 1024 * 1024, totalXmlBytes: 10 * 1024 * 1024, entries: 1024, tools: 1500 };
export interface ImportedDimension { value: number; sourceUnit: string; mm?: number }
export interface CatalogComponent {
  sourceId: string;
  parentId?: string;
  name: string;
  sourceType: string;
  manufacturer?: string;
  partNumber?: string;
  millingFlag?: string;
  dimensions: Record<string, ImportedDimension>;
  flutes?: number;
  conditions: Array<{ material: string; operation: string }>;
}
export interface CatalogTool {
  id: string;
  name: string;
  kind: 'assembly' | 'component';
  sourceFile: string;
  libraryPath: string;
  sourceHash: string;
  schemaVersion: string;
  sourceId: string;
  components: CatalogComponent[];
  status: 'catalogue-only';
  warnings: string[];
}
export interface ToolImportPreview { tools: CatalogTool[]; notices: string[]; sourceFile: string }
type XmlNode = Record<string, any>;
const array = (v: any): XmlNode[] => v === undefined ? [] : Array.isArray(v) ? v : [v];
const attr = (n: XmlNode | undefined, key: string): string => String(n?.[`@_${key}`] ?? '');
const nodes = (n: XmlNode): XmlNode[] => array(n.Components?.CompTool);
const label = (s: string) => s.replace(/&(?:amp|lt|gt|quot|apos);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[entity]!);

/** Preserve source values; only explicit 0=mm and 1=inch length codes are converted. */
export function importDimension(value: string, unit: string): ImportedDimension | undefined {
  if (!value.trim()) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return undefined;
  return { value: number, sourceUnit: unit || 'missing',
    ...(unit === '0' ? { mm: number } : unit === '1' ? { mm: number * 25.4 } : {}) };
}

function flatten(node: XmlNode, parentId?: string, depth = 0): CatalogComponent[] {
  if (depth > 30) throw new Error('Component nesting exceeds the supported limit.');
  const sourceId = attr(node, 'ID');
  const dimensions: CatalogComponent['dimensions'] = Object.create(null);
  for (const [key, param] of Object.entries(node.Shape?.LenParams ?? {})) {
    if (key.startsWith('@_')) continue;
    const dimension = importDimension(attr(param as XmlNode, 'Val'), attr(param as XmlNode, 'Units'));
    if (dimension) dimensions[key] = dimension;
  }
  const flutes = Number(attr(node.Shape, 'NumFlutes'));
  const item: CatalogComponent = { sourceId, parentId, name: label(attr(node, 'Name')), sourceType: attr(node, 'Type'),
    manufacturer: label(attr(node, 'VendorName')) || undefined,
    partNumber: attr(node, 'VendorCatalogNum') || attr(node, 'CatalogNum') || undefined,
    millingFlag: attr(node, 'IsMilling') || undefined, dimensions,
    ...(Number.isInteger(flutes) && flutes > 0 ? { flutes } : {}),
    conditions: array(node.CuttingConditionsList?.CC).map(cc => ({ material: label(attr(cc, 'WorkMaterial')), operation: attr(cc, 'OperationType') })),
  };
  return [item, ...nodes(node).flatMap(child => flatten(child, sourceId, depth + 1))];
}

/** Parse the observed ToolKit XML schema, not arbitrary SolidCAM formats. */
export function parseToolKitXml(xml: string, sourceFile: string, libraryPath: string, hash: string): CatalogTool[] {
  if (new TextEncoder().encode(xml).length > IMPORT_LIMITS.xmlBytes) throw new Error('Tool XML exceeds the 5 MiB limit.');
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error('DTD and entity declarations are not permitted in tool libraries.');
  if (XMLValidator.validate(xml) !== true) throw new Error('The tool library contains invalid XML.');
  const data = new XMLParser({ ignoreAttributes: false, parseAttributeValue: false, parseTagValue: false, processEntities: false }).parse(xml);
  const manager = data.ToolsItemsManager;
  if (!manager || typeof manager !== 'object') throw new Error('Not a supported SolidCAM ToolKit XML library (ToolsItemsManager missing).');
  // Explicit version gate: do not guess the layout of a different schema.
  if (attr(manager, 'Version') !== '11') throw new Error(`ToolKit schema ${attr(manager, 'Version') || 'unknown'} is not yet validated; expected schema 11.`);
  const candidates: XmlNode[] = [];
  const walk = (node: XmlNode, depth: number) => {
    if (depth > 30) throw new Error('Library nesting exceeds the supported limit.');
    for (const child of nodes(node)) {
      if (attr(child, 'Type') === '6') walk(child, depth + 1);
      else candidates.push(child);
    }
  };
  walk(manager, 0);
  if (candidates.length > IMPORT_LIMITS.tools) throw new Error('Too many tool records; split the library into smaller exports.');
  const ids = new Set<string>();
  return candidates.map(node => {
    const sourceId = attr(node, 'ID');
    if (!sourceId || ids.has(sourceId)) throw new Error('Missing or duplicate tool IDs in the library.');
    ids.add(sourceId);
    const components = flatten(node);
    const warnings = ['Catalogue data only: inventory, machine compatibility and cutting conditions are not approved.'];
    if (components.some(c => Object.values(c.dimensions).some(d => d.mm === undefined))) warnings.push('Unknown length-unit codes retained without conversion.');
    if (components.some(c => c.conditions.some(cc => !cc.material))) warnings.push('Some cutting conditions have no work material.');
    if (!components.some(c => c.sourceType === '1')) warnings.push('No cutter component identified; review the component type.');
    return { id: `${hash}:${libraryPath}:${sourceId}`, name: label(attr(node, 'ToolName') || attr(node, 'Name')) || `Tool ${sourceId}`,
      kind: attr(node, 'Type') === '0' ? 'assembly' : 'component', sourceFile, libraryPath, sourceHash: hash,
      schemaVersion: attr(manager, 'Version'), sourceId, components, status: 'catalogue-only', warnings };
  });
}

function decodeXml(bytes: Uint8Array): string {
  const header = new TextDecoder().decode(bytes.subarray(0, 250));
  const encoding = /encoding\s*=\s*["']([^"']+)/i.exec(header)?.[1] ?? 'utf-8';
  if (!/^(?:utf-8|iso-8859-1|windows-1252)$/i.test(encoding)) throw new Error(`Unsupported XML encoding: ${encoding}`);
  return new TextDecoder(encoding, { fatal: true }).decode(bytes);
}

/** Extract metadata only, in memory. Never write archive paths or decompress STL geometry. */
export async function previewSolidcamLibrary(bytes: Uint8Array, filename: string): Promise<ToolImportPreview> {
  if (!bytes.length || bytes.length > IMPORT_LIMITS.fileBytes) throw new Error('Choose a non-empty library smaller than 64 MiB.');
  if (/\.tab$/i.test(filename) || (bytes[0] === 67 && bytes[1] === 84)) throw new Error('Binary .TAB libraries are not supported yet. Export ToolKit XML (.tls/.tlv) from SolidCAM; renaming the file will not convert it.');
  if (!/\.(tkz|tls|tlv|xml)$/i.test(filename)) throw new Error('Supported formats: .tkz archives and ToolKit XML .tls, .tlv or .xml. ETL support is not implemented yet.');
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  let entries: Record<string, Uint8Array>;
  const notices: string[] = [];
  if (/\.tkz$/i.test(filename)) {
    let total = 0, count = 0;
    const seen = new Set<string>();
    entries = unzipSync(bytes, { filter: entry => {
      if (++count > IMPORT_LIMITS.entries) throw new Error('Archive has too many entries.');
      const path = entry.name.replace(/\\/g, '/');
      if (path.startsWith('/') || path.includes(':') || path.split('/').includes('..')) throw new Error('Unsafe archive path.');
      if (!/\.(tls|tlv)$/i.test(path)) return false;
      if (seen.has(path.toLowerCase())) throw new Error('Duplicate library paths in archive.');
      seen.add(path.toLowerCase());
      total += entry.originalSize;
      if (!Number.isFinite(entry.originalSize) || entry.originalSize > IMPORT_LIMITS.xmlBytes || total > IMPORT_LIMITS.totalXmlBytes) throw new Error('Archive XML exceeds the import size limit.');
      return true;
    } });
    notices.push('STL geometry was not decompressed or imported. Component relationships are retained; external geometry and library links are not resolved.');
    const assemblyPaths = Object.keys(entries).filter(path => /\.tls$/i.test(path));
    if (assemblyPaths.length) {
      entries = Object.fromEntries(assemblyPaths.map(path => [path, entries[path]]));
      notices.push('Importing assembly libraries only; bundled component libraries are excluded to avoid duplicate catalogue entries.');
    }
  } else entries = { [filename]: bytes };
  if (!Object.keys(entries).length) throw new Error('No supported ToolKit XML libraries found.');
  const tools = Object.entries(entries).flatMap(([path, xmlBytes]) => {
    if (xmlBytes.length > IMPORT_LIMITS.xmlBytes) throw new Error('Decompressed XML exceeds the import limit.');
    return parseToolKitXml(decodeXml(xmlBytes), filename, path, hash);
  });
  if (!tools.length || tools.length > IMPORT_LIMITS.tools) throw new Error('Library is empty or exceeds the tool-count limit.');
  notices.push('Length fields explicitly marked Units=0 are converted as mm; Units=1 as inches. Confirm representative dimensions before using catalogue data. Feeds/speeds are not imported as approved cutting parameters.');
  return { tools, sourceFile: filename, notices };
}

/** Exact reimports are idempotent; changed files remain separate revisions. */
export function mergeToolCatalogue(existing: CatalogTool[], incoming: CatalogTool[]): CatalogTool[] {
  const merged = new Map(existing.map(tool => [tool.id, tool]));
  for (const tool of incoming) if (!merged.has(tool.id)) merged.set(tool.id, { ...tool, status: 'catalogue-only' });
  const result = [...merged.values()];
  if (result.length > IMPORT_LIMITS.tools || JSON.stringify(result).length > 2_000_000) throw new Error('Catalogue storage limit reached. Export a smaller tool selection.');
  return result;
}
