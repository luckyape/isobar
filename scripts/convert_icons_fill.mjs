import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = path.resolve(__dirname, '../client/src/icons/weather-fill');
const OUTPUT_FILE = path.resolve(__dirname, '../client/src/icons/weather-fill/index.tsx');

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
    // 'fill': 'fill', // Don't strip fill, as these are fill icons
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
    svg = svg.replace(/([a-z]+-[a-z]+)=/g, (match, attr) => {
        if (ATTR_MAP[attr]) return `${ATTR_MAP[attr]}=`;
        // if starts with data-, keep as is (unlikely in these icons)
        return `${toCamelCase(attr)}=`;
    });

    // 3.5 Namespace IDs to prevent collisions in DOM
    // Replace id="val" with id="Name-val"
    // Replace url(#val) with url(#Name-val)
    // Replace xlink:href="#val" with xlink:href="#Name-val"

    // We do ID replacement carefully.
    // First find all IDs.
    const idRegex = /id="([^"]+)"/g;
    let match;
    const ids = new Set();
    while ((match = idRegex.exec(svg)) !== null) {
        ids.add(match[1]);
    }

    // Rewrite IDs
    ids.forEach(id => {
        const newId = `${name}-${id}`;
        // replace definition
        svg = svg.replace(new RegExp(`id="${id}"`, 'g'), `id="${newId}"`);
        // replace url references
        svg = svg.replace(new RegExp(`url\\(#${id}\\)`, 'g'), `url(#${newId})`);
        // replace href links
        svg = svg.replace(new RegExp(`xlink:href="#${id}"`, 'g'), `xlink:href="#${newId}"`);
        svg = svg.replace(new RegExp(`href="#${id}"`, 'g'), `href="#${newId}"`);
    });

    // 4. Handle special namespaced attrs like xlink:href if not caught
    svg = svg.replace(/xlink:href=/g, 'xlinkHref=');
    svg = svg.replace(/xmlns:xlink=/g, 'xmlnsXlink=');

    // 5. Colors:
    // For SOLID icons, usually they use 'fill' instead of 'stroke'.
    // We should allow currentColor for the main fill.
    // Check if there are hardcoded fills.
    // If we see fill="#..." we might want to replace with fill="currentColor" IF it's the primary color.
    // However, some icons might be multi-color.
    // Let's assume for now we keep them as is or replace specific greys/blacks?
    // User requirement: "use the solid versions". Doesn't explicitly say "monochrome".
    // But usually chart icons are colored by CSS.
    // Let's replace the common fill colors if they exist?
    // Actually, looking at the previous script, it replaced stroke="#cbd5e1" with currentColor.
    // Let's check a sample file content from previous step:
    // <circle cx="187.5" cy="187.5" r="84" fill="none" stroke="#fbbf24" stroke-miterlimit="10" stroke-width="15"/>
    // That was line.
    // Let's look at a fill one if we can... or just blindly trust that `currentColor` is better for valid React component usage in a chart where we might want to color it.
    // But wait, the user chart has colored icons.
    // If I replace with currentColor, they become single color.
    // The previous chart icons were colored.
    // So I should PROBABLY NOT replace colors unless I'm sure.
    // The previous script replaced a specific grey stroke.
    // I will safeguard: I won't replace massive colors blindly.
    // But for a generic React component, usually `fill="currentColor"` is what makes `text-blue-500` work.
    // The chart in screenshot shows white/grey icons in the matrix? No, wait.
    // In the user's uploaded image (step 1284), the icon is "Overcast" and it looks greyish/white.
    // In step 1232 image, the icons in the matrix were colored (yellow sun, blue rain).
    // If I use solid icons, do we lose the multi-color aspect?
    // Basmilius solid icons ("fill") are usually colored too.
    // I will NOT replace colors with currentColor by default, to preserve the multi-color nature if present.
    // EXCEPT if I need to fix specific issues.

    // 6. Add isStatic prop support (noop for these, but good for interface consistency if we shared type)
    // Actually, we don't need isStatic here as they are static.

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
        const componentName = name.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
        const validComponentName = /^\d/.test(componentName) ? `Icon${componentName}` : componentName;

        const content = fs.readFileSync(path.join(SOURCE_DIR, file), 'utf-8');
        output += processSVG(content, validComponentName);
        output += '\n';
    }

    const names = files.map(f => {
        const n = path.basename(f, '.svg');
        const cn = n.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
        return /^\d/.test(cn) ? `Icon${cn}` : cn;
    });

    // Export a separate map for these
    output += `\nexport const WeatherIconsFill = {\n  ${names.join(',\n  ')}\n} as const;\n`;

    fs.writeFileSync(OUTPUT_FILE, output);
    console.log(`Generated ${files.length} components in ${OUTPUT_FILE}`);
}

main();
