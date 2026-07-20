import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const mobileDirectory = path.resolve(scriptDirectory, '..');
const outputDirectory = path.join(mobileDirectory, 'src/assets/icons');
const sourceLogo = path.resolve(
  mobileDirectory,
  '../../../crew/packages/web/public/icon-512.png',
);
const phosphorDefinitions = path.resolve(
  mobileDirectory,
  '../../node_modules/@phosphor-icons/react/dist/defs',
);

const icons = {
  'arrow-right': 'ArrowRight',
  bus: 'Bus',
  calendar: 'CalendarBlank',
  'caret-right': 'CaretRight',
  chat: 'ChatCircleDots',
  check: 'CheckCircle',
  'cloud-offline': 'CloudSlash',
  more: 'DotsThree',
  flag: 'FlagPennant',
  golf: 'Golf',
  location: 'MapPin',
  navigation: 'NavigationArrow',
  crew: 'UsersFour',
  wine: 'Wine',
};

await mkdir(outputDirectory, { recursive: true });

for (const [name, definitionName] of Object.entries(icons)) {
  const definition = await readFile(
    path.join(phosphorDefinitions, `${definitionName}.es.js`),
    'utf8',
  );
  const fillBlock = /\[\s*"fill",([\s\S]*?)\n\s*\],\n\s*\[\s*"light"/.exec(
    definition,
  )?.[1];
  const paths = [...(fillBlock ?? '').matchAll(/d: "([^"]+)"/g)].map(
    match => `<path d="${match[1]}"/>`,
  );
  if (paths.length === 0)
    throw new Error(`Missing fill paths for ${definitionName}`);
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="#2D2D2D">${paths.join(
    '',
  )}</svg>`;
  await sharp(Buffer.from(markup))
    .png()
    .toFile(path.join(outputDirectory, `${name}.png`));
}

await sharp(sourceLogo)
  .resize(192, 192)
  .png()
  .toFile(path.join(mobileDirectory, 'src/assets/crew-logo.png'));
