import { build } from 'esbuild';

const shared = {
  bundle: true,
  format: 'esm' as const,
  platform: 'node' as const,
  target: 'node22',
  sourcemap: true,
};

for (const entry of ['prepare', 'worker', 'publish']) {
  await build({ ...shared, entryPoints: [`src/${entry}.ts`], outfile: `dist/${entry}.js` });
}
