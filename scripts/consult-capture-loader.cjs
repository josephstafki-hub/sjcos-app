// webpack loader for the consult offline bundle: TypeScript/TSX → ES2020 with the SWC
// binary that ships with Next (no extra dependency). Used only by
// scripts/build-consult-capture.mjs.
const swc = require('next/dist/build/swc');
let ready = null;
module.exports = function consultCaptureLoader(source) {
  const done = this.async();
  const file = this.resourcePath;
  const ts = /\.tsx?$/.test(file), tsx = /\.tsx$/.test(file);
  ready = ready || swc.loadBindings();
  ready.then(() => swc.transform(source, {
    filename: file, sourceMaps: false, isModule: true,
    jsc: { parser: ts ? { syntax: 'typescript', tsx } : { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic', development: false } }, target: 'es2020' },
    module: { type: 'es6' },
  })).then((r) => done(null, r.code), done);
};
