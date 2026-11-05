/** Pure schema only. No populated tool registry, source-sensitivity inference or DB.
 * The coordinator must supply ALL content keys from PERMISSION_KEYS minus ai/projects
 * and explicitly classify every tool and result/scope variant (including data errors).
 * Trusted provenance must be persisted BEFORE delivery; this helper cannot attest it.
 * Shape: {version:positive integer, content_areas:string[], tools:{
 *   [toolName]: {areas:string[], variants?:{[variant]:{areas:string[]}}}
 * }}. Base areas are always unioned with a selected variant's incidental areas.
 */
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const key = (s) => typeof s === 'string' && /^[a-z][a-z0-9_]{0,127}$/.test(s) && !['__proto__', 'prototype', 'constructor'].includes(s);
function invalid() { throw new TypeError('Invalid canvas classification registry.'); }
function exact(value, allowed) { if (!plain(value) || Object.keys(value).some(k => !allowed.includes(k)))
    invalid(); }
function areaList(value, catalog) { if (!Array.isArray(value) || new Set(value).size !== value.length || value.some(k => !key(k) || ['ai', 'projects'].includes(k) || (catalog && !catalog.includes(k))))
    invalid(); return [...value]; }
export function validateClassificationRegistry(registry) {
    exact(registry, ['version', 'content_areas', 'tools']);
    if (!Number.isSafeInteger(registry.version) || registry.version < 1)
        invalid();
    const catalog = areaList(registry.content_areas);
    if (!catalog.length || !plain(registry.tools))
        invalid();
    const tools = Object.create(null);
    for (const [name, entry] of Object.entries(registry.tools)) {
        if (!key(name))
            invalid();
        exact(entry, ['areas', 'variants']);
        const normalized = { areas: Object.freeze(areaList(entry.areas, catalog)) };
        if (Object.hasOwn(entry, 'variants')) {
            if (!plain(entry.variants) || !Object.keys(entry.variants).length)
                invalid();
            const variants = Object.create(null);
            for (const [variant, value] of Object.entries(entry.variants)) {
                if (!key(variant))
                    invalid();
                exact(value, ['areas']);
                variants[variant] = Object.freeze({ areas: Object.freeze(areaList(value.areas, catalog)) });
            }
            normalized.variants = Object.freeze(variants);
        }
        tools[name] = Object.freeze(normalized);
    }
    return Object.freeze({ version: registry.version, content_areas: Object.freeze(catalog), tools: Object.freeze(tools) });
}
export function assertEveryToolClassified(toolNames, registry) {
    const normalized = validateClassificationRegistry(registry);
    if (!Array.isArray(toolNames) || toolNames.some(n => !key(n)) || new Set(toolNames).size !== toolNames.length)
        throw new TypeError('Invalid tool name list.');
    if (toolNames.some(name => !Object.hasOwn(normalized.tools, name)))
        throw new Error('Unclassified canvas tools.');
    return true;
}
export function classifyToolAreas(toolName, registry, variant) {
    const normalized = validateClassificationRegistry(registry);
    const entry = Object.hasOwn(normalized.tools, toolName) ? normalized.tools[toolName] : null;
    if (!entry || (entry.variants && (typeof variant !== 'string' || !Object.hasOwn(entry.variants, variant))) || (!entry.variants && variant !== undefined))
        return { areas: [...normalized.content_areas], complete: false };
    const areas = new Set([...entry.areas, ...(entry.variants?.[variant]?.areas ?? [])]);
    return { areas: normalized.content_areas.filter(k => areas.has(k)), complete: true };
}
