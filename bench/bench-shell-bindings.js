if (typeof load !== "function") {
  var fs = require("fs");
  var vm = require("vm");
  load = function(file) {
    var src = fs.readFileSync(file, "utf8");
    vm.runInThisContext(src);
  };
}

if (typeof print !== "function") {
  print = console.log.bind(console);
}

load("./scalajs-runtime-sourcemap.js");
load("./stats.js");
load("../dist/source-map.js");
load("./bench.js");

function encode(str) {
  let arr = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i);
  return arr;
}
testSourceMap.mappings = encode(testSourceMap.mappings);

print("Parsing source map");
print(benchmarkParseSourceMap());
print();
// print("Serializing source map");
// print(benchmarkSerializeSourceMap());
