import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = path.resolve(__dirname, '../client/src/icons/weather');
const OUTPUT_FILE = path.resolve(__dirname, '../client/src/icons/weather/index.tsx');

function toCamelCase(str) {
    return str.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
}

// React specific attribute mappings
const ATTR_MAP = {
    'xlink:href': 'xlinkHref',
    'xmlns:xlink': 'xmlnsXlink',
    'class': 'className',
    'stroke-width': 'strokeWidth',
    'stroke-linecap': 'strokeLinecap',
    'stroke-linejoin': 'strokeLinejoin',
    'stroke-miterlimit': 'strokeMiterlimit',
    'fill-rule': 'fillRule',
    'clip-rule': 'clipRule',
    'clip-path': 'clipPath',
    'text-anchor': 'textAnchor',
    'dominant-baseline': 'dominantBaseline',
    'stop-color': 'stopColor',
    'stop-opacity': 'stopOpacity',
    'flood-color': 'floodColor',
    'flood-opacity': 'floodOpacity',
    'lighting-color': 'lightingColor',
    'font-family': 'fontFamily',
    'font-size': 'fontSize',
    'font-weight': 'fontWeight',
    'attributeName': 'attributeName', // already camel
    'attributeType': 'attributeType',
    'calcMode': 'calcMode',
    'keyTimes': 'keyTimes',
    'keySplines': 'keySplines',
    'repeatCount': 'repeatCount',
    'dur': 'dur',
    'begin': 'begin',
    'restart': 'restart',
    'repeatDur': 'repeatDur',
    'fill': 'fill', // keep
};

function processSVG(content, name) {
    // 1. Remove xml decl
    let svg = content.replace(/<\?xml.*?\?>/, '');

    // 2. Remove svg tag wrapper to put our own props
    // Extract inner content and viewBox
    const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
    const viewBox = viewBoxMatch ? viewBoxMatch[1] : '0 0 512 512';

    // Remove outer <svg ...> and </svg>
    svg = svg.replace(/^<svg[^>]*>|<\/svg>$/g, '');

    // 3. Replace attributes to camelCase
    // We'll iterate known attributes or use a regex for kebab-case attrs
    // A simple regex approach for standard svg attrs:
    svg = svg.replace(/([a-z]+-[a-z]+)=/g, (match, attr) => {
        if (ATTR_MAP[attr]) return `${ATTR_MAP[attr]}=`;
        return `${toCamelCase(attr)}=`;
    });

    // 4. Handle special namespaced attrs like xlink:href if not caught
    svg = svg.replace(/xlink:href=/g, 'xlinkHref=');
    svg = svg.replace(/xmlns:xlink=/g, 'xmlnsXlink=');

    // 5. Colors: Replace hardcoded hex with currentColor if mostly monochrome?
    // Basmilius icons use specific colors. For now, let's keep them but maybe allow override?
    // The user asked for "Use currentColor for stroke/fill where possible".
    // Let's replace 'stroke="#cbd5e1"' (the grey outline) with 'stroke="currentColor"'.
    // And keep fills (like red thermometer).
    svg = svg.replace(/stroke="#cbd5e1"/g, 'stroke="currentColor"');

    // Add React Props
    return `
export const ${name} = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="${viewBox}" fill="none" {...props}>
    ${svg}
  </svg>
);`;
}

async function main() {
    const files = fs.readdirSync(SOURCE_DIR).filter(f => f.endsWith('.svg'));
    let output = `import React from 'react';\n\n`;

    for (const file of files) {
        const name = path.basename(file, '.svg');
        // Convert kebab-case file name to PascalCase component name
        // e.g. clear-day -> ClearDay, thermometer -> Thermometer
        const componentName = name.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');

        // Prefix if starts with number (uv-index-1 -> UvIndex1)
        const validComponentName = /^\d/.test(componentName) ? `Icon${componentName}` : componentName;

        const content = fs.readFileSync(path.join(SOURCE_DIR, file), 'utf-8');
        output += processSVG(content, validComponentName);
        output += '\n';
    }

    // Also collect all names for a type
    const names = files.map(f => {
        const n = path.basename(f, '.svg');
        const cn = n.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
        return /^\d/.test(cn) ? `Icon${cn}` : cn;
    });

    output += `\nexport type WeatherIconComponent = typeof ${names[0]};\n`;
    output += `export const WeatherIcons = {\n  ${names.join(',\n  ')}\n} as const;\n`;
    output += `export type WeatherIconName = keyof typeof WeatherIcons;\n`;

    fs.writeFileSync(OUTPUT_FILE, output);
    console.log(`Generated ${files.length} components in ${OUTPUT_FILE}`);
}

main();
