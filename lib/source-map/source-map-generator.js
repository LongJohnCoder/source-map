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

  var base64VLQ = require('./base64-vlq');
  var binarySearch = require('./binary-search').search;
  var util = require('./util');
  var ArraySet = require('./array-set').ArraySet;
  var MappingList = require('./mapping-list').MappingList;
  var tags = require('./tags');
  var RedBlackTree = require('./red-black-tree').RedBlackTree;

  /**
   * An instance of the SourceMapGenerator represents a source map which is
   * being built incrementally. You may pass an object with the following
   * properties:
   *
   *   - file: The filename of the generated source.
   *   - sourceRoot: A root for all relative URLs in this source map.
   */
  function SourceMapGenerator(aArgs) {
    if (!aArgs) {
      aArgs = {};
    }
    this._file = util.getArg(aArgs, 'file', null);
    this._sourceRoot = util.getArg(aArgs, 'sourceRoot', null);
    this._skipValidation = util.getArg(aArgs, 'skipValidation', false);
    this._sources = new ArraySet();
    this.names = new ArraySet();
    this._mappings = new MappingList();
    this._sourcesContents = null;
    this._scopes = new RedBlackTree(Scope.compare);
    this._bindings = [];

    this.usingAbbreviations = false;
    this._abbreviationDefinitions = Object.create(null);
    this._abbreviationDefinitionCount = 0;
  }

  SourceMapGenerator.prototype._version = 3;

  /**
   * Creates a new SourceMapGenerator based on a SourceMapConsumer
   *
   * @param aSourceMapConsumer The SourceMap.
   */
  SourceMapGenerator.fromSourceMap =
    function SourceMapGenerator_fromSourceMap(aSourceMapConsumer) {
      var sourceRoot = aSourceMapConsumer.sourceRoot;
      var generator = new SourceMapGenerator({
        file: aSourceMapConsumer.file,
        sourceRoot: sourceRoot
      });
      aSourceMapConsumer.eachMapping(function (mapping) {
        var newMapping = {
          generated: {
            line: mapping.generatedLine,
            column: mapping.generatedColumn
          }
        };

        if (mapping.source != null) {
          newMapping.source = mapping.source;
          if (sourceRoot != null) {
            newMapping.source = util.relative(sourceRoot, newMapping.source);
          }

          newMapping.original = {
            line: mapping.originalLine,
            column: mapping.originalColumn
          };

          if (mapping.name != null) {
            newMapping.name = mapping.name;
          }
        }

        generator.addMapping(newMapping);
      });
      aSourceMapConsumer.sources.forEach(function (sourceFile) {
        var content = aSourceMapConsumer.sourceContentFor(sourceFile);
        if (content != null) {
          generator.setSourceContent(sourceFile, content);
        }
      });
      return generator;
    };

  /**
   * Add a single mapping from original source line and column to the generated
   * source's line and column for this source map being created. The mapping
   * object should have the following properties:
   *
   *   - generated: An object with the generated line and column positions.
   *   - original: An object with the original line and column positions.
   *   - source: The original source file (relative to the sourceRoot).
   *   - name: An optional original token name for this mapping.
   */
  SourceMapGenerator.prototype.addMapping =
    function SourceMapGenerator_addMapping(aArgs) {
      var generated = util.getArg(aArgs, 'generated');
      var original = util.getArg(aArgs, 'original', null);
      var source = util.getArg(aArgs, 'source', null);
      var name = util.getArg(aArgs, 'name', null);

      if (!this._skipValidation) {
        this._validateMapping(generated, original, source, name);
      }

      if (source != null && !this._sources.has(source)) {
        this._sources.add(source);
      }

      if (name != null && !this.names.has(name)) {
        this.names.add(name);
      }

      this._mappings.add({
        generatedLine: generated.line,
        generatedColumn: generated.column,
        originalLine: original != null && original.line,
        originalColumn: original != null && original.column,
        source: source,
        name: name
      });
    };

  /**
   * Set the source content for a source file.
   */
  SourceMapGenerator.prototype.setSourceContent =
    function SourceMapGenerator_setSourceContent(aSourceFile, aSourceContent) {
      var source = aSourceFile;
      if (this._sourceRoot != null) {
        source = util.relative(this._sourceRoot, source);
      }

      if (aSourceContent != null) {
        // Add the source content to the _sourcesContents map.
        // Create a new _sourcesContents map if the property is null.
        if (!this._sourcesContents) {
          this._sourcesContents = {};
        }
        this._sourcesContents[util.toSetString(source)] = aSourceContent;
      } else if (this._sourcesContents) {
        // Remove the source file from the _sourcesContents map.
        // If the _sourcesContents map is empty, set the property to null.
        delete this._sourcesContents[util.toSetString(source)];
        if (Object.keys(this._sourcesContents).length === 0) {
          this._sourcesContents = null;
        }
      }
    };

  /**
   * Applies the mappings of a sub-source-map for a specific source file to the
   * source map being generated. Each mapping to the supplied source file is
   * rewritten using the supplied source map. Note: The resolution for the
   * resulting mappings is the minimium of this map and the supplied map.
   *
   * @param aSourceMapConsumer The source map to be applied.
   * @param aSourceFile Optional. The filename of the source file.
   *        If omitted, SourceMapConsumer's file property will be used.
   * @param aSourceMapPath Optional. The dirname of the path to the source map
   *        to be applied. If relative, it is relative to the SourceMapConsumer.
   *        This parameter is needed when the two source maps aren't in the same
   *        directory, and the source map to be applied contains relative source
   *        paths. If so, those relative source paths need to be rewritten
   *        relative to the SourceMapGenerator.
   */
  SourceMapGenerator.prototype.applySourceMap =
    function SourceMapGenerator_applySourceMap(aSourceMapConsumer, aSourceFile, aSourceMapPath) {
      var sourceFile = aSourceFile;
      // If aSourceFile is omitted, we will use the file property of the SourceMap
      if (aSourceFile == null) {
        if (aSourceMapConsumer.file == null) {
          throw new Error(
            'SourceMapGenerator.prototype.applySourceMap requires either an explicit source file, ' +
            'or the source map\'s "file" property. Both were omitted.'
          );
        }
        sourceFile = aSourceMapConsumer.file;
      }
      var sourceRoot = this._sourceRoot;
      // Make "sourceFile" relative if an absolute Url is passed.
      if (sourceRoot != null) {
        sourceFile = util.relative(sourceRoot, sourceFile);
      }
      // Applying the SourceMap can add and remove items from the sources and
      // the names array.
      var newSources = new ArraySet();
      var newNames = new ArraySet();

      // Find mappings for the "sourceFile"
      this._mappings.unsortedForEach(function (mapping) {
        if (mapping.source === sourceFile && mapping.originalLine != null) {
          // Check if it can be mapped by the source map, then update the mapping.
          var original = aSourceMapConsumer.originalPositionFor({
            line: mapping.originalLine,
            column: mapping.originalColumn
          });
          if (original.source != null) {
            // Copy mapping
            mapping.source = original.source;
            if (aSourceMapPath != null) {
              mapping.source = util.join(aSourceMapPath, mapping.source)
            }
            if (sourceRoot != null) {
              mapping.source = util.relative(sourceRoot, mapping.source);
            }
            mapping.originalLine = original.line;
            mapping.originalColumn = original.column;
            if (original.name != null) {
              mapping.name = original.name;
            }
          }
        }

        var source = mapping.source;
        if (source != null && !newSources.has(source)) {
          newSources.add(source);
        }

        var name = mapping.name;
        if (name != null && !newNames.has(name)) {
          newNames.add(name);
        }

      }, this);
      this._sources = newSources;
      this.names = newNames;

      // Copy sourcesContents of applied map.
      aSourceMapConsumer.sources.forEach(function (sourceFile) {
        var content = aSourceMapConsumer.sourceContentFor(sourceFile);
        if (content != null) {
          if (aSourceMapPath != null) {
            sourceFile = util.join(aSourceMapPath, sourceFile);
          }
          if (sourceRoot != null) {
            sourceFile = util.relative(sourceRoot, sourceFile);
          }
          this.setSourceContent(sourceFile, content);
        }
      }, this);
    };

  /**
   * A mapping can have one of the three levels of data:
   *
   *   1. Just the generated position.
   *   2. The Generated position, original position, and original source.
   *   3. Generated and original position, original source, as well as a name
   *      token.
   *
   * To maintain consistency, we validate that any new mapping being added falls
   * in to one of these categories.
   */
  SourceMapGenerator.prototype._validateMapping =
    function SourceMapGenerator_validateMapping(aGenerated, aOriginal, aSource,
                                                aName) {
      if (aGenerated && 'line' in aGenerated && 'column' in aGenerated
          && aGenerated.line > 0 && aGenerated.column >= 0
          && !aOriginal && !aSource && !aName) {
        // Case 1.
        return;
      }
      else if (aGenerated && 'line' in aGenerated && 'column' in aGenerated
               && aOriginal && 'line' in aOriginal && 'column' in aOriginal
               && aGenerated.line > 0 && aGenerated.column >= 0
               && aOriginal.line > 0 && aOriginal.column >= 0
               && aSource) {
        // Cases 2 and 3.
        return;
      }
      else {
        throw new Error('Invalid mapping: ' + JSON.stringify({
          generated: aGenerated,
          source: aSource,
          original: aOriginal,
          name: aName
        }));
      }
    };

  /**
   * Return the list of mappings sorted by generated position. DO NOT MODIFY THE
   * RETURNED ARRAY OR ITS CONTENTS!
   */
  SourceMapGenerator.prototype._getMappings = function () {
    return this._mappings.toArray();
  };

  /**
   * Ensure that there is an abbreviation definition for the given record type
   * and property list. Returns the abbreviation id.
   */
  SourceMapGenerator.prototype.ensureAbbreviationDefinition = function (recordType, properties) {
    var key = String(recordType) + String(properties);
    var existingDefinition = this._abbreviationDefinitions[key]
    if (existingDefinition) {
      return existingDefinition.id;
    }

    var newDefinitionId = this._abbreviationDefinitionCount++;
    this._abbreviationDefinitions[key] = {
      id: newDefinitionId,
      recordType: recordType,
      properties: properties
    };
    return newDefinitionId;
  };

  /**
   * Serialize the accumulated mappings in to the stream of base 64 VLQs
   * specified by the source map format.
   */
  SourceMapGenerator.prototype._serializeMappings =
    function SourceMapGenerator_serializeMappings() {
      var previousGeneratedColumn = 0;
      var previousGeneratedLine = 1;
      var previousOriginalColumn = 0;
      var previousOriginalLine = 0;
      var previousName = 0;
      var previousSource = 0;
      var result = '';
      var mapping;

      var mappings = this._getMappings();

      for (var i = 0, len = mappings.length; i < len; i++) {
        mapping = mappings[i];

        if (mapping.generatedLine !== previousGeneratedLine) {
          previousGeneratedColumn = 0;
          while (mapping.generatedLine !== previousGeneratedLine) {
            result += ';';
            previousGeneratedLine++;
          }
        }
        else {
          if (i > 0) {
            if (!util.compareByGeneratedPositionsInflated(mapping, mappings[i - 1])) {
              continue;
            }
            result += ',';
          }
        }

        result += base64VLQ.encode(mapping.generatedColumn
                                   - previousGeneratedColumn);
        previousGeneratedColumn = mapping.generatedColumn;

        if (mapping.source != null) {
          result += base64VLQ.encode(this._sources.indexOf(mapping.source)
                                     - previousSource);
          previousSource = this._sources.indexOf(mapping.source);

          // Lines are stored 0-based in SourceMap spec version 3.
          result += base64VLQ.encode(mapping.originalLine - 1
                                     - previousOriginalLine);
          previousOriginalLine = mapping.originalLine - 1;

          result += base64VLQ.encode(mapping.originalColumn
                                     - previousOriginalColumn);
          previousOriginalColumn = mapping.originalColumn;

          if (mapping.name != null) {
            result += base64VLQ.encode(this.names.indexOf(mapping.name)
                                       - previousName);
            previousName = this.names.indexOf(mapping.name);
          }
        }
      }

      return result;
    };

  SourceMapGenerator.prototype._generateSourcesContent =
    function SourceMapGenerator_generateSourcesContent(aSources, aSourceRoot) {
      return aSources.map(function (source) {
        if (!this._sourcesContents) {
          return null;
        }
        if (aSourceRoot != null) {
          source = util.relative(aSourceRoot, source);
        }
        var key = util.toSetString(source);
        return Object.prototype.hasOwnProperty.call(this._sourcesContents,
                                                    key)
          ? this._sourcesContents[key]
          : null;
      }, this);
    };

  SourceMapGenerator.prototype._serializeAbbreviationDefinitions = function () {
    var str = '';
    var keys = Object.keys(this._abbreviationDefinitions);

    for (var i = 0; i < keys.length; i++) {
      var definition = this._abbreviationDefinitions[keys[i]];

      str += base64VLQ.encode(tags.RECORD_ABBREVIATION_DEFINITION);
      str += base64VLQ.encode(definition.id);
      str += base64VLQ.encode(definition.recordType);

      for (var j = 0; j < definition.properties.length; j++) {
        str += base64VLQ.encode(definition.properties[j]);
      }

      str += base64VLQ.encode(tags.RECORD_DONE);
    }

    return str;
  };

  /**
   * Encode a new top-level lexical scope in the source map being generated.
   *
   * @param {Object} args
   *        An object with the following properties:
   *          - type: One of the VAL_SCOPE_TYPE_* tags.
   *          - start: Marks the start of the scope. Object of the form
   *                   { generatedLine, generatedColumn }.
   *          - end: Marks the end of the scope. Object of the form
   *                   { generatedLine, generatedColumn }.
   *          - name: Optional string name for this scope.
   */
  SourceMapGenerator.prototype.addScope = function (args) {
    return new Scope(this, this, args);
  };

  /**
   * Encode a new global binding in the source map being generated.
   *
   * @param {Object} args
   *        An object with the following properties:
   *          - type: One of the VAL_BINDING_TYPE_* tags.
   *          - name: String symbol name for this binding.
   *          - value: String snippet of JS to locate and/or pretty-print this
   *                   binding's value.
   */
  SourceMapGenerator.prototype.addBinding = function (args) {
    return new Binding(this, this, args);
  };

  /**
   * Get the relative value for the given absolute value. Relative to the last
   * value used for the given property.
   */
  function getRelativeToLastValue(serializeContext, property, value) {
    var lastValue = 0;
    if (serializeContext.lastValueByProperty[property]) {
      lastValue = serializeContext.lastValueByProperty[property];
    }

    serializeContext.lastValueByProperty[property] = value;
    return value - lastValue;
  }

  /**
   * Represents a lexical scope in the source map being generated.
   *
   * @param SourceMapGenerator generator
   *        The generator for the source map being created.
   * @param {SourceMapGenerator|Scope} parent
   *        The parent of this scope. The SourceMapGenerator itself if this is a
   *        top level scope. Otherwise, this scope's parent scope.
   * @param {Object} args
   *        An object of the form specified by `SourceMapGenerator.prototype.addScope`.
   */
  var Scope = function (generator, parent, args) {
    this._type = util.getArg(args, 'type');
    this._bindings = [];
    this._scopes = new RedBlackTree(Scope.compare);
    this._name = null;
    this._start = null;
    this._end = null;
    this._generator = generator;

    var start = util.getArg(args, 'start');
    var mappings = generator._getMappings();
    var idx = binarySearch(start, mappings, function (a, b) {
      return util.compareByGeneratedPositionsInflated(a, b, true);
    });
    if (idx === -1) {
      throw new Error("Bad scope starting boundary: there must be a " +
                      "corresponding mapping in the SourceMapGenerator.");
    }
    this._start = mappings[idx];

    var end = util.getArg(args, 'end');
    idx = binarySearch(end, mappings, function (a, b) {
      return util.compareByGeneratedPositionsInflated(a, b, true);
    });
    if (idx === -1) {
      throw new Error("Bad scope ending boundary: there must be a " +
                      "corresponding mapping in the SourceMapGenerator");
    }
    this._end = mappings[idx];

    var name = util.getArg(args, 'name', null);
    if (name) {
      generator.names.add(name);
      this._name = generator.names.indexOf(name);
    }

    parent._scopes.insert(this);
  };

  /**
   * Compare two sibling Scope objects by their start positions. We needn't
   * worry about end positions because sibling scopes mustn't overlap.
   */
  Scope.compare = function (a, b) {
    return util.compareByGeneratedPositionsInflated(a._start, b._start, true);
  };

  /**
   * Add a child scope that is enclosed within this one.
   *
   * @see SourceMapGenerator.prototype.addScope
   */
  Scope.prototype.addScope = function (args) {
    return new Scope(this._generator, this, args);
  };

  /**
   * Add a binding within this scope.
   *
   * @see SourceMapGenerator.prototype.addBinding
   */
  Scope.prototype.addBinding = function (args) {
    return new Binding(this._generator, this, args);
  };

  Scope.prototype.ensureAbbreviationDefinition = function (recordType, properties) {
    return this._generator.ensureAbbreviationDefinition(recordType, properties);
  };

  Scope.prototype._assertChildScopesAreContainedAndNonOverlapping = function () {
    var lastChildScopeEnd = null;
    this._scopes.inOrderWalk(function (s) {
      if (lastChildScopeEnd) {
        if (util.compareByGeneratedPositionsInflated(lastChildScopeEnd, s._start, true) >= 0) {
          throw new Error("Child scopes must be non-overlapping");
        }
        lastChildScopeEnd = s._end;

        if (Scope.compareContained(s._start, s.getParentScope()) !== 0 ||
            Scope.compareContained(s._end, s.getParentScope()) !== 0) {
          throw new Error("Child scopes must be wholly contained within their parent scope");
        }
      }
    });
  };

  /**
   * Serialize this scope, its bindings, and child scopes into the format used
   * by the `x_env` property on a source map.
   */
  Scope.prototype.serialize = function (serializeContext) {
    var mappings = this._generator._getMappings();

    var startIdx = binarySearch(this._start, mappings, function (a, b) {
      return util.compareByGeneratedPositionsInflated(a, b, true);
    });
    var endIdx = binarySearch(this._end, mappings, function (a, b) {
      return util.compareByGeneratedPositionsInflated(a, b, true);
    });

    if (serializeContext.usingAbbreviations) {
      return this._serializeAbbreviated(serializeContext, startIdx, endIdx);
    }

    var str = '';
    str += base64VLQ.encode(tags.RECORD_SCOPE);

    str += base64VLQ.encode(tags.PROPERTY_TYPE);
    str += base64VLQ.encode(getRelativeToLastValue(serializeContext,
                                                   tags.PROPERTY_TYPE,
                                                   this._type));

    str += base64VLQ.encode(tags.PROPERTY_START);
    str += base64VLQ.encode(getRelativeToLastValue(serializeContext,
                                                   tags.PROPERTY_START,
                                                   startIdx));

    str += base64VLQ.encode(tags.PROPERTY_END);
    str += base64VLQ.encode(getRelativeToLastValue(serializeContext,
                                                   tags.PROPERTY_END,
                                                   endIdx));

    if (this._name !== null) {
      str += base64VLQ.encode(tags.PROPERTY_NAME);
      str += base64VLQ.encode(getRelativeToLastValue(serializeContext,
                                                     tags.PROPERTY_NAME,
                                                     this._name));
    }

    str += this._serializeChildren(serializeContext);
    str += base64VLQ.encode(tags.RECORD_DONE);
    return str;
  };

  Scope.prototype._serializeAbbreviated = function (serializeContext, startIdx, endIdx) {
    var properties = [
      tags.PROPERTY_TYPE,
      tags.PROPERTY_START,
      tags.PROPERTY_END
    ];
    if (this._name !== null) {
      properties.push(tags.PROPERTY_NAME);
    }

    var abbreviationId = this._generator.ensureAbbreviationDefinition(tags.RECORD_SCOPE,
                                                                      properties);

    var str = '';
    str += base64VLQ.encode(tags.RECORD_ABBREVIATED);
    str += base64VLQ.encode(abbreviationId);

    str += base64VLQ.encode(getRelativeToLastValue(serializeContext,
                                                   tags.PROPERTY_TYPE,
                                                   this._type));
    str += base64VLQ.encode(getRelativeToLastValue(serializeContext,
                                                   tags.PROPERTY_START,
                                                   startIdx));
    str += base64VLQ.encode(getRelativeToLastValue(serializeContext,
                                                   tags.PROPERTY_END,
                                                   endIdx));

    if (this._name !== null) {
      str += base64VLQ.encode(getRelativeToLastValue(serializeContext,
                                                     tags.PROPERTY_NAME,
                                                     this._name));
    }

    str += this._serializeChildren(serializeContext);
    str += base64VLQ.encode(tags.RECORD_DONE);
    return str;
  };

  Scope.prototype._serializeChildren = function (serializeContext) {
    var str = '';

    if (this._bindings.length || this._scopes.size()) {
      str += base64VLQ.encode(tags.RECORD_CHILDREN);

      for (var i = 0; i < this._bindings.length; i++) {
        str += this._bindings[i].serialize(serializeContext);
      }

      if (!serializeContext.skipValidation) {
        this._assertChildScopesAreContainedAndNonOverlapping();
      }
      this._scopes.inOrderWalk(function (node) {
        str += node.value.serialize(serializeContext);
      });
    }

    return str;
  };

  /**
   * Encode a new binding in the source map being generated.
   *
   * @param SourceMapGenerator generator
   *        The generator for the source map being created.
   * @param {SourceMapGenerator|Scope} parent
   *        The parent of this binding. The SourceMapGenerator itself if this is
   *        a top level, global binding. Otherwise, this binding's parent scope.
   * @param {Object} args
   *        An object of the form specified by `SourceMapGenerator.prototype.addBinding`.
   */
  var Binding = function (generator, parent, aArgs) {
    this._generator = generator;
    this._type = util.getArg(aArgs, 'type');

    var name = util.getArg(aArgs, 'name');
    generator.names.add(name);
    this._name = generator.names.indexOf(name);

    var value = util.getArg(aArgs, 'value');
    generator.names.add(value);
    this._value = generator.names.indexOf(value);

    parent._bindings.push(this);
  };

  /**
   * Serialize this binding into the format used by the `x_env` property on a
   * source map.
   */
  Binding.prototype.serialize = function (serializeContext) {
    if (serializeContext.usingAbbreviations) {
      return this._serializeAbbreviated(serializeContext);
    }

    var str = '';
    str += base64VLQ.encode(tags.RECORD_BINDING);

    str += base64VLQ.encode(tags.PROPERTY_TYPE);
    str += base64VLQ.encode(getRelativeToLastValue(serializeContext,
                                                   tags.PROPERTY_TYPE,
                                                   this._type));

    str += base64VLQ.encode(tags.PROPERTY_NAME);
    str += base64VLQ.encode(getRelativeToLastValue(serializeContext,
                                                   tags.PROPERTY_NAME,
                                                   this._name));

    str += base64VLQ.encode(tags.PROPERTY_VALUE);
    str += base64VLQ.encode(getRelativeToLastValue(serializeContext,
                                                   tags.PROPERTY_VALUE,
                                                   this._value));

    str += base64VLQ.encode(tags.RECORD_DONE);
    return str;
  };

  Binding.prototype._serializeAbbreviated = function (serializeContext) {
    var abbreviationId = this._generator.ensureAbbreviationDefinition(
      tags.RECORD_BINDING,
      [
        tags.PROPERTY_TYPE,
        tags.PROPERTY_NAME,
        tags.PROPERTY_VALUE
      ]
    );

    var str = '';
    str += base64VLQ.encode(tags.RECORD_ABBREVIATED);
    str += base64VLQ.encode(abbreviationId);

    str += base64VLQ.encode(getRelativeToLastValue(serializeContext,
                                                   tags.PROPERTY_TYPE,
                                                   this._type));
    str += base64VLQ.encode(getRelativeToLastValue(serializeContext,
                                                   tags.PROPERTY_NAME,
                                                   this._name));
    str += base64VLQ.encode(getRelativeToLastValue(serializeContext,
                                                   tags.PROPERTY_VALUE,
                                                   this._value));

    str += base64VLQ.encode(tags.RECORD_DONE);
    return str;
  };

  /**
   * Externalize the source map.
   */
  SourceMapGenerator.prototype.toJSON =
    function SourceMapGenerator_toJSON() {
      var map = {
        version: this._version,
        sources: this._sources.toArray(),
        names: this.names.toArray(),
        mappings: this._serializeMappings()
      };

      if (this._file != null) {
        map.file = this._file;
      }

      if (this._sourceRoot != null) {
        map.sourceRoot = this._sourceRoot;
      }

      if (this._sourcesContents) {
        map.sourcesContent = this._generateSourcesContent(map.sources, map.sourceRoot);
      }

      if (this._bindings.length || this._scopes.size()) {
        var env = '';
        var serializeContext = {
          usingAbbreviations: this.usingAbbreviations,
          skipValidation: this._skipValidation,
          lastValueByProperty: Object.create(null)
        };
        for (var i = 0; i < this._bindings.length; i++) {
          env += this._bindings[i].serialize(serializeContext);
        }
        this._scopes.inOrderWalk(function (node) {
          env += node.value.serialize(serializeContext);
        });
        map.x_env = this._serializeAbbreviationDefinitions() + env;
      }

      return map;
    };

  /**
   * Render the source map being generated to a string.
   */
  SourceMapGenerator.prototype.toString =
    function SourceMapGenerator_toString() {
      return JSON.stringify(this.toJSON());
    };

  exports.SourceMapGenerator = SourceMapGenerator;

});
