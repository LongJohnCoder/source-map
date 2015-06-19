/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var SourceMapGenerator = require('../../lib/source-map/source-map-generator').SourceMapGenerator;
  var Scope = SourceMapGenerator.Scope;
  var Binding = SourceMapGenerator.Binding;
  var SourceMapConsumer = require('../../lib/source-map/source-map-consumer').SourceMapConsumer;
  var tags = require('../../lib/source-map/tags');

  // Original source, map.scm:
  //
  //     0         1         2         3
  //     0123456789012345678901234567890123456789
  // 01| (define (map f xs)
  // 02|   (if (null? xs)
  // 03|     '()
  // 04|     (let ((x (car xs))
  // 05|           (rest (cdr xs)))
  // 06|       (cons (f x) (map f rest)))))
  // 07|
  // 08| (define (inc x) (+ x 1))
  // 09|
  // 10| (define my-list '(1 2 3 4 5))
  // 11|
  // 10| (map inc my-list)
  //
  // Generated source, map.js:
  //
  //     0         1         2         3         4         5         6
  //     0123456789012345678901234567890123456789012345678901234567890123456789
  // 01| function map(f, xs) {
  // 02|   if (null_question(xs)) {
  // 03|     return null;
  // 04|   } else {
  // 05|     var x = car(xs);
  // 06|     var rest = cdr(xs);
  // 07|     return cons(f(x), map(f, res));
  // 08|   }
  // 09| }
  // 10|
  // 11| function inc(x) { return x + 1; }
  // 12|
  // 13| var my_list = cons(1, cons(2, cons(3, cons(4, cons(5, null)))));
  // 14|
  // 15| map(inc, my_list);
  function makeTestSourceMapGenerator() {
    var smg = new SourceMapGenerator();

    // Add a start and end bound mapping for the map function's scope.
    smg.addMapping({
      source: 'map.scm',
      original: {
        line: 1,
        column: 0
      },
      generated: {
        line: 1,
        column: 0
      }
    });
    smg.addMapping({
      source: 'map.scm',
      original: {
        line: 6,
        column: 34
      },
      generated: {
        line: 9,
        column: 1
      }
    });

    // Add a start and end bound mapping for the map function's let-block.
    smg.addMapping({
      source: 'map.scm',
      original: {
        line: 4,
        column: 4
      },
      generated: {
        line: 4,
        column: 9
      }
    });
    smg.addMapping({
      source: 'map.scm',
      original: {
        line: 6,
        column: 34
      },
      generated: {
        line: 8,
        column: 3
      }
    });

    // Add a start and end bound mapping for the inc function's scope.
    smg.addMapping({
      source: 'map.scm',
      original: {
        line: 8,
        column: 0
      },
      generated: {
        line: 11,
        column: 0
      }
    });
    smg.addMapping({
      source: 'map.scm',
      original: {
        line: 8,
        column: 24
      },
      generated: {
        line: 11,
        column: 33
      }
    });

    return smg;
  }

  function makeTestSourceMapWithScopes() {
    var smg = makeTestSourceMapGenerator();

    var mapFunction = smg.addScope({
      type: tags.VAL_SCOPE_TYPE_FUNCTION,
      name: 'map',
      start: {
        generatedLine: 1,
        generatedColumn: 0
      },
      end: {
        generatedLine: 9,
        generatedColumn: 1
      }
    });

    var f = mapFunction.addBinding({
      type: tags.VAL_BINDING_TYPE_PARAM,
      name: "f",
      value: "f"
    });

    var xs = mapFunction.addBinding({
      type: tags.VAL_BINDING_TYPE_PARAM,
      name: "xs",
      value: "xs"
    });

    var mapLetBlock = mapFunction.addScope({
      type: tags.VAL_SCOPE_TYPE_BLOCK,
      start: {
        generatedLine: 4,
        generatedColumn: 9
      },
      end: {
        generatedLine: 8,
        generatedColumn: 3
      }
    });

    var x = mapLetBlock.addBinding({
      type: tags.VAL_BINDING_TYPE_LOCAL,
      name: "x",
      value: "x"
    });

    var rest = mapLetBlock.addBinding({
      type: tags.VAL_BINDING_TYPE_LOCAL,
      name: "rest",
      value: "rest"
    });

    var incFunction = smg.addScope({
      type: tags.VAL_SCOPE_TYPE_FUNCTION,
      name: 'inc',
      start: {
        generatedLine: 11,
        generatedColumn: 0
      },
      end: {
        generatedLine: 11,
        generatedColumn: 33
      }
    });

    var x2 = incFunction.addBinding({
      type: tags.VAL_BINDING_TYPE_PARAM,
      name: "x",
      value: "x"
    });

    var my_list = smg.addBinding({
      type: tags.VAL_BINDING_TYPE_LOCAL,
      name: "my-list",
      value: "my_list"
    });

    return smg;
  }

  exports['test serializing a source map with scopes'] = function (assert, util) {
    var expectedMap = {
      version: 3,
      sources: ['map.scm'],
      names: ['map','f','xs','x','rest','inc','my-list','my_list'],
      mappings: 'AAAA;;;SAGI;;;;GAE8B;CAAA;;AAElC,iCAAwB',
      x_env: 'EMASMUOACMAOAQGSNGEMASCUNAEMASCUCACMAOCQDGEMASCUCAEMASCUCAAACMAOGQGSCGEMASFUDAA'
    };

    assert.equal(makeTestSourceMapWithScopes().toString(),
                 JSON.stringify(expectedMap));
  };

  exports['test serializing a source map with abbreviated scopes'] = function (assert, util) {
    var generator = makeTestSourceMapWithScopes();
    generator.usingAbbreviations = true;

    var expectedMap = {
      version: 3,
      sources: ['map.scm'],
      names: ['map','f','xs','x','rest','inc','my-list','my_list'],
      mappings: 'AAAA;;;SAGI;;;;GAE8B;CAAA;;AAElC,iCAAwB',
      x_env: 'IAEMSUAICCMOQSAIECMOQAKAAMOAKCAAGNGKAACNAKAACCAKEACDGKAACCAKAACCAAAKCAGGCGKAAFDAA'
    };

    assert.equal(generator.toString(),
                 JSON.stringify(expectedMap));
  };

  function testWithAndWithoutAbbreviations(testFunction) {
    return function (assert, util) {
      var withoutAbbreviations = makeTestSourceMapWithScopes();
      testFunction(assert, util, withoutAbbreviations.toString());

      var withAbbreviations = makeTestSourceMapWithScopes();
      withAbbreviations.usingAbbreviations = true;
      testFunction(assert, util, withAbbreviations.toString());
    };
  }

  exports['test consuming a source map with scopes'] =
  testWithAndWithoutAbbreviations(function (assert, util, sourceMap) {
    var smc = new SourceMapConsumer(sourceMap);

    var globalScope = smc.getScopeAt({
      generatedLine: 10,
      generatedColumn: 0
    });

    assert.ok(globalScope.isGlobalScope());
    assert.equal(globalScope.getParentScope(), null);
    assert.equal(globalScope, smc.getGlobalScope());
    var numberOfGlobalBindingsFound = 0;
    globalScope.eachBinding(function (b) {
      ++numberOfGlobalBindingsFound;
      assert.equal(b.getType(), tags.VAL_BINDING_TYPE_LOCAL);
      assert.equal(b.getName(), "my-list");
      assert.equal(b.getValue(), "my_list");
    });
    assert.equal(numberOfGlobalBindingsFound, 1);

    var mapFunction = smc.getScopeAt({
      generatedLine: 2,
      generatedColumn: 0
    });

    assert.ok(!mapFunction.isGlobalScope());
    assert.equal(mapFunction.getParentScope(), globalScope);
    assert.equal(mapFunction.getName(), "map");
    var foundF = false;
    var foundXs = false;
    mapFunction.eachBinding(function (b) {
      switch (b.getName()) {
      case "f":
        assert.ok(!foundF);
        foundF = true;
        assert.equal(b.getType(), tags.VAL_BINDING_TYPE_PARAM);
        assert.equal(b.getValue(), "f");
        break;
      case "xs":
        assert.ok(!foundXs);
        foundXs = true;
        assert.equal(b.getType(), tags.VAL_BINDING_TYPE_PARAM);
        assert.equal(b.getValue(), "xs");
        break;
      default:
        assert.ok(false, "Unexpected binding: " + b.getName());
      }
    });
    assert.ok(foundF);
    assert.ok(foundXs);

    var mapLetBlock = smc.getScopeAt({
      generatedLine: 5,
      generatedColumn: 0
    });

    assert.ok(!mapLetBlock.isGlobalScope());
    assert.equal(mapLetBlock.getParentScope(), mapFunction);
    assert.equal(mapLetBlock.getName(), null);
    var foundX = false;
    var foundRest = false;
    mapLetBlock.eachBinding(function (b) {
      switch (b.getName()) {
      case "x":
        assert.ok(!foundX);
        foundX = true;
        assert.equal(b.getType(), tags.VAL_BINDING_TYPE_LOCAL);
        assert.equal(b.getValue(), "x");
        break;
      case "rest":
        assert.ok(!foundRest);
        foundRest = true;
        assert.equal(b.getType(), tags.VAL_BINDING_TYPE_LOCAL);
        assert.equal(b.getValue(), "rest");
        break;
      default:
        assert.ok(false, "Unexpected binding: " + b.getName());
      }
    });
    assert.ok(foundRest);
    assert.ok(foundX);

    var incFunction = smc.getScopeAt({
      generatedLine: 11,
      generatedColumn: 10
    });
    assert.ok(!incFunction.isGlobalScope());
    assert.equal(incFunction.getParentScope(), globalScope);
    assert.equal(incFunction.getName(), "inc");
    var numberOfIncBindingsFound = 0;
    incFunction.eachBinding(function (b) {
      ++numberOfIncBindingsFound;
      assert.equal(b.getType(), tags.VAL_BINDING_TYPE_PARAM);
      assert.equal(b.getName(), "x");
      assert.equal(b.getValue(), "x");
    });
    assert.equal(numberOfIncBindingsFound, 1);
  });

});
