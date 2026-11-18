import fs from "fs";
import path from "path";

function patchFile(filePath, replacements) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  let content = fs.readFileSync(filePath, "utf8");
  let modified = false;

  for (const [search, replace] of replacements) {
    if (content.includes(search)) {
      content = content.replaceAll(search, replace);
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, content, "utf8");
    console.log(`[patch-tanstack] Successfully patched ${filePath}`);
  }
}

// 1. Patch router-core load-matches (ESM & CJS)
const routerCorePaths = [
  path.resolve("node_modules/@tanstack/router-core/dist/esm/load-matches.js"),
  path.resolve("node_modules/@tanstack/router-core/dist/cjs/load-matches.cjs"),
];

const routerCoreReplacements = [
  [
    `const existingMatch = inner.router.getMatch(matchId);\n\tif (!existingMatch._nonReactive.beforeLoadPromise && !existingMatch._nonReactive.loaderPromise) return;`,
    `const existingMatch = inner.router.getMatch(matchId);\n\tif (!existingMatch?._nonReactive || (!existingMatch._nonReactive.beforeLoadPromise && !existingMatch._nonReactive.loaderPromise)) return;`,
  ],
  [
    `const existingMatch = inner.router.getMatch(matchId);\r\n\tif (!existingMatch._nonReactive.beforeLoadPromise && !existingMatch._nonReactive.loaderPromise) return;`,
    `const existingMatch = inner.router.getMatch(matchId);\r\n\tif (!existingMatch?._nonReactive || (!existingMatch._nonReactive.beforeLoadPromise && !existingMatch._nonReactive.loaderPromise)) return;`,
  ],
  [
    `return existingMatch._nonReactive.beforeLoadPromise ? existingMatch._nonReactive.beforeLoadPromise.then(then) : then();`,
    `return existingMatch?._nonReactive?.beforeLoadPromise ? existingMatch._nonReactive.beforeLoadPromise.then(then) : then();`,
  ],
  [`if (prevMatch._nonReactive.loaderPromise) {`, `if (prevMatch?._nonReactive?.loaderPromise) {`],
  [`await prevMatch._nonReactive.loaderPromise;`, `await prevMatch?._nonReactive?.loaderPromise;`],
  [
    `const error = match._nonReactive.error || match.error;`,
    `const error = match?._nonReactive?.error || match?.error;`,
  ],
  [
    `match._nonReactive.loaderPromise = createControlledPromise();`,
    `if (match?._nonReactive) match._nonReactive.loaderPromise = createControlledPromise();`,
  ],
  [
    `match._nonReactive.loaderPromise = require_utils.createControlledPromise();`,
    `if (match?._nonReactive) match._nonReactive.loaderPromise = require_utils.createControlledPromise();`,
  ],
  [
    `const setupPendingTimeout = (inner, matchId, route, match) => {\n\tif (match._nonReactive.pendingTimeout !== void 0) return;`,
    `const setupPendingTimeout = (inner, matchId, route, match) => {\n\tif (!match?._nonReactive || match._nonReactive.pendingTimeout !== void 0) return;`,
  ],
  [
    `const setupPendingTimeout = (inner, matchId, route, match) => {\r\n\tif (match._nonReactive.pendingTimeout !== void 0) return;`,
    `const setupPendingTimeout = (inner, matchId, route, match) => {\r\n\tif (!match?._nonReactive || match._nonReactive.pendingTimeout !== void 0) return;`,
  ],
  [
    `const setupPendingTimeout = (inner, matchId, route, match) => {\tif (match._nonReactive.pendingTimeout !== void 0) return;`,
    `const setupPendingTimeout = (inner, matchId, route, match) => {\tif (!match?._nonReactive || match._nonReactive.pendingTimeout !== void 0) return;`,
  ],
  [
    `const executeBeforeLoad = (inner, matchId, index, route) => {\n\tconst match = inner.router.getMatch(matchId);\n\tlet prevLoadPromise = match._nonReactive.loadPromise;`,
    `const executeBeforeLoad = (inner, matchId, index, route) => {\n\tconst match = inner.router.getMatch(matchId);\n\tif (!match?._nonReactive) return;\n\tlet prevLoadPromise = match._nonReactive.loadPromise;`,
  ],
  [
    `const executeBeforeLoad = (inner, matchId, index, route) => {\r\n\tconst match = inner.router.getMatch(matchId);\r\n\tlet prevLoadPromise = match._nonReactive.loadPromise;`,
    `const executeBeforeLoad = (inner, matchId, index, route) => {\r\n\tconst match = inner.router.getMatch(matchId);\r\n\tif (!match?._nonReactive) return;\r\n\tlet prevLoadPromise = match._nonReactive.loadPromise;`,
  ],
  [
    `const executeBeforeLoad = (inner, matchId, index, route) => {\tconst match = inner.router.getMatch(matchId);\tlet prevLoadPromise = match._nonReactive.loadPromise;`,
    `const executeBeforeLoad = (inner, matchId, index, route) => {\tconst match = inner.router.getMatch(matchId);\tif (!match?._nonReactive) return;\tlet prevLoadPromise = match._nonReactive.loadPromise;`,
  ],
  [
    `\tconst match = inner.router.getMatch(matchId);\n\tif (!loaderIsRunningAsync) {\n\t\tmatch._nonReactive.loaderPromise?.resolve();`,
    `\tconst match = inner.router.getMatch(matchId);\n\tif (!match?._nonReactive) return match;\n\tif (!loaderIsRunningAsync) {\n\t\tmatch._nonReactive.loaderPromise?.resolve();`,
  ],
  [
    `\tconst match = inner.router.getMatch(matchId);\r\n\tif (!loaderIsRunningAsync) {\r\n\t\tmatch._nonReactive.loaderPromise?.resolve();`,
    `\tconst match = inner.router.getMatch(matchId);\r\n\tif (!match?._nonReactive) return match;\r\n\tif (!loaderIsRunningAsync) {\r\n\t\tmatch._nonReactive.loaderPromise?.resolve();`,
  ],
  [
    `\tconst match = inner.router.getMatch(matchId);\tif (!loaderIsRunningAsync) {\t\tmatch._nonReactive.loaderPromise?.resolve();`,
    `\tconst match = inner.router.getMatch(matchId);\tif (!match?._nonReactive) return match;\tif (!loaderIsRunningAsync) {\t\tmatch._nonReactive.loaderPromise?.resolve();`,
  ],
  [
    `const then = () => {\n\t\tconst match = inner.router.getMatch(matchId);\n\t\tif (match.preload && (match.status === "redirected" || match.status === "notFound")) handleRedirectAndNotFound(inner, match, match.error);\n\t};`,
    `const then = () => {\n\t\tconst match = inner.router.getMatch(matchId);\n\t\tif (match && match.preload && (match.status === "redirected" || match.status === "notFound")) handleRedirectAndNotFound(inner, match, match.error);\n\t};`,
  ],
  [
    `const then = () => {\r\n\t\tconst match = inner.router.getMatch(matchId);\r\n\t\tif (match.preload && (match.status === "redirected" || match.status === "notFound")) handleRedirectAndNotFound(inner, match, match.error);\r\n\t};`,
    `const then = () => {\r\n\t\tconst match = inner.router.getMatch(matchId);\r\n\t\tif (match && match.preload && (match.status === "redirected" || match.status === "notFound")) handleRedirectAndNotFound(inner, match, match.error);\r\n\t};`,
  ],
  [
    `const then = () => {\t\tconst match = inner.router.getMatch(matchId);\t\tif (match.preload && (match.status === "redirected" || match.status === "notFound")) handleRedirectAndNotFound(inner, match, match.error);\t};`,
    `const then = () => {\t\tconst match = inner.router.getMatch(matchId);\t\tif (match && match.preload && (match.status === "redirected" || match.status === "notFound")) handleRedirectAndNotFound(inner, match, match.error);\t};`,
  ],
  [
    `const pendingPromise = match._nonReactive.minPendingPromise;`,
    `const pendingPromise = match?._nonReactive?.minPendingPromise;`,
  ],
  [
    `if (!(isServer ?? inner.router.isServer) && match._nonReactive.dehydrated) return true;`,
    `if (!(isServer ?? inner.router.isServer) && match?._nonReactive?.dehydrated) return true;`,
  ],
  [
    `if (!(_tanstack_router_core_isServer.isServer ?? inner.router.isServer) && match._nonReactive.dehydrated) return true;`,
    `if (!(_tanstack_router_core_isServer.isServer ?? inner.router.isServer) && match?._nonReactive?.dehydrated) return true;`,
  ],
  [
    `if (match) match._nonReactive.loaderPromise = void 0;`,
    `if (match?._nonReactive) match._nonReactive.loaderPromise = void 0;`,
  ],
];

for (const p of routerCorePaths) {
  patchFile(p, routerCoreReplacements);
}

// 2. Patch react-router Match (ESM & CJS)
const reactRouterPaths = [
  path.resolve("node_modules/@tanstack/react-router/dist/esm/Match.js"),
  path.resolve("node_modules/@tanstack/react-router/dist/cjs/Match.cjs"),
];

const reactRouterReplacements = [
  [
    `return router.getMatch(match.id)?._nonReactive[key] ?? match._nonReactive[key];`,
    `return router.getMatch(match?.id)?._nonReactive?.[key] ?? match?._nonReactive?.[key];`,
  ],
  [
    `if (routerMatch && !routerMatch._nonReactive.minPendingPromise) {`,
    `if (routerMatch?._nonReactive && !routerMatch._nonReactive.minPendingPromise) {`,
  ],
  [
    `if (match._displayPending) throw getMatchPromise(match, "displayPendingPromise");`,
    `if (match._displayPending) { const p = getMatchPromise(match, "displayPendingPromise"); if (p) throw p; }`,
  ],
  [
    `if (match._forcePending) throw getMatchPromise(match, "minPendingPromise");`,
    `if (match._forcePending) { const p = getMatchPromise(match, "minPendingPromise"); if (p) throw p; }`,
  ],
  [
    `if (match.status === "pending") throw getMatchPromise(match, "loadPromise");`,
    `if (match.status === "pending") { const p = getMatchPromise(match, "loadPromise"); if (p) throw p; }`,
  ],
  [
    `throw getMatchPromise(match, "loadPromise");`,
    `{ const p = getMatchPromise(match, "loadPromise"); if (p) throw p; }`,
  ],
];

for (const p of reactRouterPaths) {
  patchFile(p, reactRouterReplacements);
}

// 3. Patch start-manifest-plugin so production SSR resolves client JS & CSS bundles
const startManifestPaths = [
  path.resolve(
    "node_modules/@tanstack/start-plugin-core/dist/esm/vite/start-manifest-plugin/plugin.js",
  ),
];

const startManifestReplacements = [
  [
    `function getEmptyStartManifestModule(clientEntry) {
	return \`export const tsrStartManifest = () => ({
      routes: {
        __root__: {
          preloads: ['\${clientEntry}'],
          scripts: [{ attrs: { type: 'module', async: true, src: '\${clientEntry}' } }],
        },
      },
    })\`;
}`,
    `function getEmptyStartManifestModule(clientEntry) {
	return \`import fs from "node:fs";
import path from "node:path";

let cachedManifest;

export const tsrStartManifest = () => {
  if (cachedManifest) return cachedManifest;

  let entryScript = '\${clientEntry}';
  let cssFile;

  try {
    const candidateDirs = [
      path.resolve(process.cwd(), '.output/public/assets'),
      path.resolve(process.cwd(), 'dist/assets'),
      path.resolve(process.cwd(), 'client/assets'),
      path.resolve(import.meta.dirname || '.', '../public/assets'),
      path.resolve(import.meta.dirname || '.', '../../public/assets'),
    ];

    if (process.env.NODE_ENV === "production") {
      for (const dir of candidateDirs) {
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir);
          const js = files.find((f) => f.startsWith('index-') && f.endsWith('.js'));
          const css = files.find((f) => f.startsWith('styles-') && f.endsWith('.css'));
          if (js) {
            entryScript = '/assets/' + js;
            if (css) cssFile = '/assets/' + css;
            break;
          }
        }
      }
    }
  } catch (e) {}

  cachedManifest = {
    routes: {
      __root__: {
        preloads: [entryScript],
        scripts: [{ attrs: { type: 'module', async: true, src: entryScript } }],
        ...(cssFile ? { css: [{ attrs: { rel: 'stylesheet', href: cssFile } }] } : {}),
      },
    },
  };
  return cachedManifest;
};\`;
}`,
  ],
];

for (const p of startManifestPaths) {
  patchFile(p, startManifestReplacements);
}

console.log("[patch-tanstack] Patch check completed.");
