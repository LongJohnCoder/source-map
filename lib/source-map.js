/*
 * Copyright 2009-2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE.txt or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
exports.SourceMapGenerator = require('./source-map/source-map-generator').SourceMapGenerator;
exports.SourceMapConsumer = require('./source-map/source-map-consumer').SourceMapConsumer;
exports.SourceNode = require('./source-map/source-node').SourceNode;

// Re-export the tag constants.
var tags = require('./source-map/tags');
Object.getOwnPropertyNames(tags).forEach(function (tag) {
  Object.defineProperty(exports, tag, {
    writable: false,
    configurable: false,
    value: tags[tag]
  });
});
