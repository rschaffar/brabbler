// Small interception probes, never advisory payloads or service requests.
import assert from "node:assert/strict";
import path from "node:path";
import Module, { createRequire } from "node:module";

const installed = createRequire(path.join(process.cwd(), "package.json"));
const originalLoad = Module._load;

if (process.argv[2] === "mammoth") {
  const attempts = [];
  Module._load = function (request, parent, isMain) {
    const resolved = Module._resolveFilename(request, parent, isMain);
    if (typeof resolved === "string" && /[/\\]node_modules[/\\](?:argparse|sprintf-js)[/\\]/.test(resolved)) {
      attempts.push(resolved);
      throw new Error("SENTINEL_FORBIDDEN_FORMATTER_BRANCH");
    }
    return originalLoad.apply(this, arguments);
  };
  const mammoth = installed("mammoth");
  const mammothRequire = createRequire(installed.resolve("mammoth"));
  const JSZip = mammothRequire("jszip");
  for (const withStyleMap of [false, true]) {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file("word/document.xml", '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Small boundary probe</w:t></w:r></w:p></w:body></w:document>');
    if (withStyleMap) {
      zip.file("mammoth/style-map", "p => p.boundary-style:fresh");
      zip.file("word/_rels/document.xml.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="mammoth-style-map" Type="http://schemas.zwobble.org/mammoth/style-map" Target="/mammoth/style-map"/></Relationships>');
    }
    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
    assert(buffer.length < 8192);
    const result = await mammoth.convertToHtml({ buffer }, { externalFileAccess: false, convertImage: mammoth.images.dataUri });
    assert.equal(result.value, withStyleMap ? '<p class="boundary-style">Small boundary probe</p>' : "<p>Small boundary probe</p>");
    assert.deepEqual(attempts, []);
  }
  // Positive controls prove the hook refuses both branches before execution.
  for (const name of ["argparse", "sprintf-js"]) {
    assert.throws(() => mammothRequire(name), /SENTINEL_FORBIDDEN_FORMATTER_BRANCH/);
  }
  assert.equal(attempts.length, 2);
  console.log(JSON.stringify({ conversions: 2, embeddedStyleApplied: true, conversionForbiddenLoads: 0, positiveControls: attempts.length }));
} else if (process.argv[2] === "braces") {
  const calls = [];
  Module._load = function (request) {
    if (request === "fast-glob") return {
      globSync(pattern, options) {
        calls.push({ pattern, options });
        return ["fixture-root"];
      },
    };
    return originalLoad.apply(this, arguments);
  };
  const entry = installed.resolve("@next/eslint-plugin-next");
  const { getRootDirs } = installed(path.join(path.dirname(entry), "utils/get-root-dirs.js"));
  const cwd = "/tmp/literal-{ordinary,path}";
  assert.deepEqual(getRootDirs({ cwd, settings: {} }), [cwd]);
  assert.equal(calls.length, 0);
  assert.deepEqual(getRootDirs({ cwd, settings: { next: { rootDir: "packages/{one,two}" } } }), ["fixture-root"]);
  assert.deepEqual(calls, [{ pattern: "packages/{one,two}", options: { onlyDirectories: true } }]);
  calls.length = 0;
  assert.deepEqual(getRootDirs({ cwd, settings: { next: { rootDir: ["one", "two"] } } }), ["fixture-root", "fixture-root"]);
  assert.deepEqual(calls.map((call) => call.pattern), ["one", "two"]);
  console.log(JSON.stringify({ defaultGlobCalls: 0, stringControls: 1, arrayControls: 2, actualParserExecuted: false }));
} else {
  throw new Error("Unknown bounded advisory probe");
}
