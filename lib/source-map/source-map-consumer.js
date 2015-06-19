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

  var util = require('./util');
  var binarySearch = require('./binary-search');
  var ArraySet = require('./array-set').ArraySet;
  var base64VLQ = require('./base64-vlq');
  var quickSort = require('./quick-sort').quickSort;
  var RedBlackTree = require('./red-black-tree').RedBlackTree;
  var tags = require('./tags');

  function SourceMapConsumer(aSourceMap) {
    var sourceMap = aSourceMap;
    if (typeof aSourceMap === 'string') {
      sourceMap = JSON.parse(aSourceMap.replace(/^\)\]\}'/, ''));
    }

    return sourceMap.sections != null
      ? new IndexedSourceMapConsumer(sourceMap)
      : new BasicSourceMapConsumer(sourceMap);
  }

  SourceMapConsumer.fromSourceMap = function(aSourceMap) {
    return BasicSourceMapConsumer.fromSourceMap(aSourceMap);
  }

  /**
   * The version of the source mapping spec that we are consuming.
   */
  SourceMapConsumer.prototype._version = 3;

  // `__generatedMappings` and `__originalMappings` are arrays that hold the
  // parsed mapping coordinates from the source map's "mappings" attribute. They
  // are lazily instantiated, accessed via the `_generatedMappings` and
  // `_originalMappings` getters respectively, and we only parse the mappings
  // and create these arrays once queried for a source location. We jump through
  // these hoops because there can be many thousands of mappings, and parsing
  // them is expensive, so we only want to do it if we must.
  //
  // Each object in the arrays is of the form:
  //
  //     {
  //       generatedLine: The line number in the generated code,
  //       generatedColumn: The column number in the generated code,
  //       source: The path to the original source file that generated this
  //               chunk of code,
  //       originalLine: The line number in the original source that
  //                     corresponds to this chunk of generated code,
  //       originalColumn: The column number in the original source that
  //                       corresponds to this chunk of generated code,
  //       name: The name of the original symbol which generated this chunk of
  //             code.
  //     }
  //
  // All properties except for `generatedLine` and `generatedColumn` can be
  // `null`.
  //
  // `_generatedMappings` is ordered by the generated positions.
  //
  // `_originalMappings` is ordered by the original positions.

  SourceMapConsumer.prototype.__generatedMappings = null;
  Object.defineProperty(SourceMapConsumer.prototype, '_generatedMappings', {
    get: function () {
      if (!this.__generatedMappings) {
        this._parseMappings(this._mappings, this.sourceRoot);
      }

      return this.__generatedMappings;
    }
  });

  SourceMapConsumer.prototype.__originalMappings = null;
  Object.defineProperty(SourceMapConsumer.prototype, '_originalMappings', {
    get: function () {
      if (!this.__originalMappings) {
        this._parseMappings(this._mappings, this.sourceRoot);
      }

      return this.__originalMappings;
    }
  });

  SourceMapConsumer.prototype._charIsMappingSeparator =
    function SourceMapConsumer_charIsMappingSeparator(aStr, index) {
      var c = aStr.charAt(index);
      return c === ";" || c === ",";
    };

  /**
   * Parse the mappings in a string in to a data structure which we can easily
   * query (the ordered arrays in the `this.__generatedMappings` and
   * `this.__originalMappings` properties).
   */
  SourceMapConsumer.prototype._parseMappings =
    function SourceMapConsumer_parseMappings(aStr, aSourceRoot) {
      throw new Error("Subclasses must implement _parseMappings");
    };

  /**
   * Get the global scope. If there is no environment data encoded in this
   * source map, then return null.
   */
  SourceMapConsumer.prototype.getGlobalScope = function () {
    if (!this._env) {
      return null;
    }
    if (!this._globalScope) {
      this._parseEnv();
    }
    return this._globalScope;
  };

  /**
   * Parse the scopes and bindings stored in the "x_env" source map property.
   */
  SourceMapConsumer.prototype._parseEnv =
    function SourceMapConsumer_parseEnv(aStr) {
      throw new Error("Subclasses must implement _parseEnv");
    };

  /**
   * Get the innermost scope at the given generated location. If there is no
   * environment data encoded in this source map, then return null. All scopes
   * visible from the given location can then be found by walking the scopes'
   * .parent properties until the global scope is reached.
   */
  SourceMapConsumer.prototype.getScopeAt = function (generatedLocation) {
    if (!this._env) {
      return null;
    }

    var scope = this.getGlobalScope();
    var child;
    while ( (child = scope.getChildScopeAt(generatedLocation)) ) {
      scope = child;
    }
    return scope;
  };

  SourceMapConsumer.GENERATED_ORDER = 1;
  SourceMapConsumer.ORIGINAL_ORDER = 2;

  SourceMapConsumer.GREATEST_LOWER_BOUND = 1;
  SourceMapConsumer.LEAST_UPPER_BOUND = 2;

  /**
   * Iterate over each mapping between an original source/line/column and a
   * generated line/column in this source map.
   *
   * @param Function aCallback
   *        The function that is called with each mapping.
   * @param Object aContext
   *        Optional. If specified, this object will be the value of `this` every
   *        time that `aCallback` is called.
   * @param aOrder
   *        Either `SourceMapConsumer.GENERATED_ORDER` or
   *        `SourceMapConsumer.ORIGINAL_ORDER`. Specifies whether you want to
   *        iterate over the mappings sorted by the generated file's line/column
   *        order or the original's source/line/column order, respectively. Defaults to
   *        `SourceMapConsumer.GENERATED_ORDER`.
   */
  SourceMapConsumer.prototype.eachMapping =
    function SourceMapConsumer_eachMapping(aCallback, aContext, aOrder) {
      var context = aContext || null;
      var order = aOrder || SourceMapConsumer.GENERATED_ORDER;

      var mappings;
      switch (order) {
      case SourceMapConsumer.GENERATED_ORDER:
        mappings = this._generatedMappings;
        break;
      case SourceMapConsumer.ORIGINAL_ORDER:
        mappings = this._originalMappings;
        break;
      default:
        throw new Error("Unknown order of iteration.");
      }

      var sourceRoot = this.sourceRoot;
      mappings.map(function (mapping) {
        var source = mapping.source === null ? null : this._sources.at(mapping.source);
        if (source != null && sourceRoot != null) {
          source = util.join(sourceRoot, source);
        }
        return {
          source: source,
          generatedLine: mapping.generatedLine,
          generatedColumn: mapping.generatedColumn,
          originalLine: mapping.originalLine,
          originalColumn: mapping.originalColumn,
          name: mapping.name === null ? null : this.names.at(mapping.name)
        };
      }, this).forEach(aCallback, context);
    };

  /**
   * Returns all generated line and column information for the original source,
   * line, and column provided. If no column is provided, returns all mappings
   * corresponding to a either the line we are searching for or the next
   * closest line that has any mappings. Otherwise, returns all mappings
   * corresponding to the given line and either the column we are searching for
   * or the next closest column that has any offsets.
   *
   * The only argument is an object with the following properties:
   *
   *   - source: The filename of the original source.
   *   - line: The line number in the original source.
   *   - column: Optional. the column number in the original source.
   *
   * and an array of objects is returned, each with the following properties:
   *
   *   - line: The line number in the generated source, or null.
   *   - column: The column number in the generated source, or null.
   */
  SourceMapConsumer.prototype.allGeneratedPositionsFor =
    function SourceMapConsumer_allGeneratedPositionsFor(aArgs) {
      var line = util.getArg(aArgs, 'line');

      // When there is no exact match, BasicSourceMapConsumer.prototype._findMapping
      // returns the index of the closest mapping less than the needle. By
      // setting needle.originalColumn to 0, we thus find the last mapping for
      // the given line, provided such a mapping exists.
      var needle = {
        source: util.getArg(aArgs, 'source'),
        originalLine: line,
        originalColumn: util.getArg(aArgs, 'column', 0)
      };

      if (this.sourceRoot != null) {
        needle.source = util.relative(this.sourceRoot, needle.source);
      }
      if (!this._sources.has(needle.source)) {
        return [];
      }
      needle.source = this._sources.indexOf(needle.source);

      var mappings = [];

      var index = this._findMapping(needle,
                                    this._originalMappings,
                                    "originalLine",
                                    "originalColumn",
                                    util.compareByOriginalPositions,
                                    binarySearch.LEAST_UPPER_BOUND);
      if (index >= 0) {
        var mapping = this._originalMappings[index];

        if (aArgs.column === undefined) {
          var originalLine = mapping.originalLine;

          // Iterate until either we run out of mappings, or we run into
          // a mapping for a different line than the one we found. Since
          // mappings are sorted, this is guaranteed to find all mappings for
          // the line we found.
          while (mapping && mapping.originalLine === originalLine) {
            mappings.push({
              line: util.getArg(mapping, 'generatedLine', null),
              column: util.getArg(mapping, 'generatedColumn', null),
              lastColumn: util.getArg(mapping, 'lastGeneratedColumn', null)
            });

            mapping = this._originalMappings[++index];
          }
        } else {
          var originalColumn = mapping.originalColumn;

          // Iterate until either we run out of mappings, or we run into
          // a mapping for a different line than the one we were searching for.
          // Since mappings are sorted, this is guaranteed to find all mappings for
          // the line we are searching for.
          while (mapping &&
                 mapping.originalLine === line &&
                 mapping.originalColumn == originalColumn) {
            mappings.push({
              line: util.getArg(mapping, 'generatedLine', null),
              column: util.getArg(mapping, 'generatedColumn', null),
              lastColumn: util.getArg(mapping, 'lastGeneratedColumn', null)
            });

            mapping = this._originalMappings[++index];
          }
        }
      }

      return mappings;
    };

  exports.SourceMapConsumer = SourceMapConsumer;

  /**
   * A BasicSourceMapConsumer instance represents a parsed source map which we can
   * query for information about the original file positions by giving it a file
   * position in the generated source.
   *
   * The only parameter is the raw source map (either as a JSON string, or
   * already parsed to an object). According to the spec, source maps have the
   * following attributes:
   *
   *   - version: Which version of the source map spec this map is following.
   *   - sources: An array of URLs to the original source files.
   *   - names: An array of identifiers which can be referrenced by individual mappings.
   *   - sourceRoot: Optional. The URL root from which all sources are relative.
   *   - sourcesContent: Optional. An array of contents of the original source files.
   *   - mappings: A string of base64 VLQs which contain the actual mappings.
   *   - file: Optional. The generated file this source map is associated with.
   *
   * Here is an example source map, taken from the source map spec[0]:
   *
   *     {
   *       version : 3,
   *       file: "out.js",
   *       sourceRoot : "",
   *       sources: ["foo.js", "bar.js"],
   *       names: ["src", "maps", "are", "fun"],
   *       mappings: "AA,AB;;ABCDE;"
   *     }
   *
   * [0]: https://docs.google.com/document/d/1U1RGAehQwRypUTovF1KRlpiOFze0b-_2gc6fAH0KY0k/edit?pli=1#
   */
  function BasicSourceMapConsumer(aSourceMap) {
    var sourceMap = aSourceMap;
    if (typeof aSourceMap === 'string') {
      sourceMap = JSON.parse(aSourceMap.replace(/^\)\]\}'/, ''));
    }

    var version = util.getArg(sourceMap, 'version');
    var sources = util.getArg(sourceMap, 'sources');
    // Sass 3.3 leaves out the 'names' array, so we deviate from the spec (which
    // requires the array) to play nice here.
    var names = util.getArg(sourceMap, 'names', []);
    var sourceRoot = util.getArg(sourceMap, 'sourceRoot', null);
    var sourcesContent = util.getArg(sourceMap, 'sourcesContent', null);
    var mappings = util.getArg(sourceMap, 'mappings');
    var file = util.getArg(sourceMap, 'file', null);
    var env = util.getArg(sourceMap, 'x_env', null);

    // Once again, Sass deviates from the spec and supplies the version as a
    // string rather than a number, so we use loose equality checking here.
    if (version != this._version) {
      throw new Error('Unsupported version: ' + version);
    }

    // Some source maps produce relative source paths like "./foo.js" instead of
    // "foo.js".  Normalize these first so that future comparisons will succeed.
    // See bugzil.la/1090768.
    sources = sources.map(util.normalize);

    // Pass `true` below to allow duplicate names and sources. While source maps
    // are intended to be compressed and deduplicated, the TypeScript compiler
    // sometimes generates source maps with duplicates in them. See Github issue
    // #72 and bugzil.la/889492.
    this.names = ArraySet.fromArray(names, true);
    this._sources = ArraySet.fromArray(sources, true);

    this.sourceRoot = sourceRoot;
    this.sourcesContent = sourcesContent;
    this._mappings = mappings;
    this.file = file;

    this._env = env;
    this._globalScope = null;
    this._abbreviations = Object.create(null);
  }

  BasicSourceMapConsumer.prototype = Object.create(SourceMapConsumer.prototype);
  BasicSourceMapConsumer.prototype.consumer = SourceMapConsumer;

  /**
   * Create a BasicSourceMapConsumer from a SourceMapGenerator.
   *
   * @param SourceMapGenerator aSourceMap
   *        The source map that will be consumed.
   * @returns BasicSourceMapConsumer
   */
  BasicSourceMapConsumer.fromSourceMap =
    function SourceMapConsumer_fromSourceMap(aSourceMap) {
      var smc = Object.create(BasicSourceMapConsumer.prototype);

      var names = smc.names = ArraySet.fromArray(aSourceMap.names.toArray(), true);
      var sources = smc._sources = ArraySet.fromArray(aSourceMap._sources.toArray(), true);
      smc.sourceRoot = aSourceMap._sourceRoot;
      smc.sourcesContent = aSourceMap._generateSourcesContent(smc._sources.toArray(),
                                                              smc.sourceRoot);
      smc.file = aSourceMap._file;

      // Because we are modifying the entries (by converting string sources and
      // names to indices into the sources and names ArraySets), we have to make
      // a copy of the entry or else bad things happen. Shared mutable state
      // strikes again! See github issue #191.

      var generatedMappings = aSourceMap._mappings.toArray().slice();
      var destGeneratedMappings = smc.__generatedMappings = [];
      var destOriginalMappings = smc.__originalMappings = [];

      for (var i = 0, length = generatedMappings.length; i < length; i++) {
        var srcMapping = generatedMappings[i];
        var destMapping = new Mapping;
        destMapping.generatedLine = srcMapping.generatedLine;
        destMapping.generatedColumn = srcMapping.generatedColumn;

        if (srcMapping.source) {
          destMapping.source = sources.indexOf(srcMapping.source);
          destMapping.originalLine = srcMapping.originalLine;
          destMapping.originalColumn = srcMapping.originalColumn;

          if (srcMapping.name) {
            destMapping.name = names.indexOf(srcMapping.name);
          }

          destOriginalMappings.push(destMapping);
        }

        destGeneratedMappings.push(destMapping);
      }

      quickSort(smc.__originalMappings, util.compareByOriginalPositions);

      return smc;
    };

  /**
   * The version of the source mapping spec that we are consuming.
   */
  BasicSourceMapConsumer.prototype._version = 3;

  /**
   * The list of original sources.
   */
  Object.defineProperty(BasicSourceMapConsumer.prototype, 'sources', {
    get: function () {
      return this._sources.toArray().map(function (s) {
        return this.sourceRoot != null ? util.join(this.sourceRoot, s) : s;
      }, this);
    }
  });

  /**
   * Provide the JIT with a nice shape / hidden class.
   */
  function Mapping() {
    this.generatedLine = 0;
    this.generatedColumn = 0;
    this.source = null;
    this.originalLine = null;
    this.originalColumn = null;
    this.name = null;
  }

  /**
   * Parse the mappings in a string in to a data structure which we can easily
   * query (the ordered arrays in the `this.__generatedMappings` and
   * `this.__originalMappings` properties).
   */
  BasicSourceMapConsumer.prototype._parseMappings =
    function SourceMapConsumer_parseMappings(aStr, aSourceRoot) {
      var generatedLine = 1;
      var previousGeneratedColumn = 0;
      var previousOriginalLine = 0;
      var previousOriginalColumn = 0;
      var previousSource = 0;
      var previousName = 0;
      var length = aStr.length;
      var index = 0;
      var cachedSegments = {};
      var temp = {};
      var originalMappings = [];
      var generatedMappings = [];
      var mapping, str, segment, end, value;

      while (index < length) {
        if (aStr.charAt(index) === ';') {
          generatedLine++;
          index++;
          previousGeneratedColumn = 0;
        }
        else if (aStr.charAt(index) === ',') {
          index++;
        }
        else {
          mapping = new Mapping();
          mapping.generatedLine = generatedLine;

          // Because each offset is encoded relative to the previous one,
          // many segments often have the same encoding. We can exploit this
          // fact by caching the parsed variable length fields of each segment,
          // allowing us to avoid a second parse if we encounter the same
          // segment again.
          for (end = index; end < length; end++) {
            if (this._charIsMappingSeparator(aStr, end)) {
              break;
            }
          }
          str = aStr.slice(index, end);

          segment = cachedSegments[str];
          if (segment) {
            index += str.length;
          } else {
            segment = [];
            while (index < end) {
              base64VLQ.decode(aStr, index, temp);
              value = temp.value;
              index = temp.rest;
              segment.push(value);
            }

            if (segment.length === 2) {
              throw new Error('Found a source, but no line and column');
            }

            if (segment.length === 3) {
              throw new Error('Found a source and line, but no column');
            }

            cachedSegments[str] = segment;
          }

          // Generated column.
          mapping.generatedColumn = previousGeneratedColumn + segment[0];
          previousGeneratedColumn = mapping.generatedColumn;

          if (segment.length > 1) {
            // Original source.
            mapping.source = previousSource + segment[1];
            previousSource += segment[1];

            // Original line.
            mapping.originalLine = previousOriginalLine + segment[2];
            previousOriginalLine = mapping.originalLine;
            // Lines are stored 0-based
            mapping.originalLine += 1;

            // Original column.
            mapping.originalColumn = previousOriginalColumn + segment[3];
            previousOriginalColumn = mapping.originalColumn;

            if (segment.length > 4) {
              // Original name.
              mapping.name = previousName + segment[4];
              previousName += segment[4];
            }
          }

          generatedMappings.push(mapping);
          if (typeof mapping.originalLine === 'number') {
            originalMappings.push(mapping);
          }
        }
      }

      quickSort(generatedMappings, util.compareByGeneratedPositionsDeflated);
      this.__generatedMappings = generatedMappings;

      quickSort(originalMappings, util.compareByOriginalPositions);
      this.__originalMappings = originalMappings;
    };

  /**
   * Find the mapping that best matches the hypothetical "needle" mapping that
   * we are searching for in the given "haystack" of mappings.
   */
  BasicSourceMapConsumer.prototype._findMapping =
    function SourceMapConsumer_findMapping(aNeedle, aMappings, aLineName,
                                           aColumnName, aComparator, aBias) {
      // To return the position we are searching for, we must first find the
      // mapping for the given position and then return the opposite position it
      // points to. Because the mappings are sorted, we can use binary search to
      // find the best mapping.

      if (aNeedle[aLineName] <= 0) {
        throw new TypeError('Line must be greater than or equal to 1, got '
                            + aNeedle[aLineName]);
      }
      if (aNeedle[aColumnName] < 0) {
        throw new TypeError('Column must be greater than or equal to 0, got '
                            + aNeedle[aColumnName]);
      }

      return binarySearch.search(aNeedle, aMappings, aComparator, aBias);
    };

  /**
   * Compute the last column for each generated mapping. The last column is
   * inclusive.
   */
  BasicSourceMapConsumer.prototype.computeColumnSpans =
    function SourceMapConsumer_computeColumnSpans() {
      for (var index = 0; index < this._generatedMappings.length; ++index) {
        var mapping = this._generatedMappings[index];

        // Mappings do not contain a field for the last generated columnt. We
        // can come up with an optimistic estimate, however, by assuming that
        // mappings are contiguous (i.e. given two consecutive mappings, the
        // first mapping ends where the second one starts).
        if (index + 1 < this._generatedMappings.length) {
          var nextMapping = this._generatedMappings[index + 1];

          if (mapping.generatedLine === nextMapping.generatedLine) {
            mapping.lastGeneratedColumn = nextMapping.generatedColumn - 1;
            continue;
          }
        }

        // The last mapping for each line spans the entire line.
        mapping.lastGeneratedColumn = Infinity;
      }
    };

  /**
   * Returns the original source, line, and column information for the generated
   * source's line and column positions provided. The only argument is an object
   * with the following properties:
   *
   *   - line: The line number in the generated source.
   *   - column: The column number in the generated source.
   *   - bias: Either 'SourceMapConsumer.GREATEST_LOWER_BOUND' or
   *     'SourceMapConsumer.LEAST_UPPER_BOUND'. Specifies whether to return the
   *     closest element that is smaller than or greater than the one we are
   *     searching for, respectively, if the exact element cannot be found.
   *     Defaults to 'SourceMapConsumer.GREATEST_LOWER_BOUND'.
   *
   * and an object is returned with the following properties:
   *
   *   - source: The original source file, or null.
   *   - line: The line number in the original source, or null.
   *   - column: The column number in the original source, or null.
   *   - name: The original identifier, or null.
   */
  BasicSourceMapConsumer.prototype.originalPositionFor =
    function SourceMapConsumer_originalPositionFor(aArgs) {
      var needle = {
        generatedLine: util.getArg(aArgs, 'line'),
        generatedColumn: util.getArg(aArgs, 'column')
      };

      var index = this._findMapping(
        needle,
        this._generatedMappings,
        "generatedLine",
        "generatedColumn",
        util.compareByGeneratedPositionsDeflated,
        util.getArg(aArgs, 'bias', SourceMapConsumer.GREATEST_LOWER_BOUND)
      );

      if (index >= 0) {
        var mapping = this._generatedMappings[index];

        if (mapping.generatedLine === needle.generatedLine) {
          var source = util.getArg(mapping, 'source', null);
          if (source !== null) {
            source = this._sources.at(source);
            if (this.sourceRoot != null) {
              source = util.join(this.sourceRoot, source);
            }
          }
          var name = util.getArg(mapping, 'name', null);
          if (name !== null) {
            name = this.names.at(name);
          }
          return {
            source: source,
            line: util.getArg(mapping, 'originalLine', null),
            column: util.getArg(mapping, 'originalColumn', null),
            name: name
          };
        }
      }

      return {
        source: null,
        line: null,
        column: null,
        name: null
      };
    };

  /**
   * Return true if we have the source content for every source in the source
   * map, false otherwise.
   */
  BasicSourceMapConsumer.prototype.hasContentsOfAllSources =
    function BasicSourceMapConsumer_hasContentsOfAllSources() {
      if (!this.sourcesContent) {
        return false;
      }
      return this.sourcesContent.length >= this._sources.size() &&
        !this.sourcesContent.some(function (sc) { return sc == null; });
    };

  /**
   * Returns the original source content. The only argument is the url of the
   * original source file. Returns null if no original source content is
   * availible.
   */
  BasicSourceMapConsumer.prototype.sourceContentFor =
    function SourceMapConsumer_sourceContentFor(aSource, nullOnMissing) {
      if (!this.sourcesContent) {
        return null;
      }

      if (this.sourceRoot != null) {
        aSource = util.relative(this.sourceRoot, aSource);
      }

      if (this._sources.has(aSource)) {
        return this.sourcesContent[this._sources.indexOf(aSource)];
      }

      var url;
      if (this.sourceRoot != null
          && (url = util.urlParse(this.sourceRoot))) {
        // XXX: file:// URIs and absolute paths lead to unexpected behavior for
        // many users. We can help them out when they expect file:// URIs to
        // behave like it would if they were running a local HTTP server. See
        // https://bugzilla.mozilla.org/show_bug.cgi?id=885597.
        var fileUriAbsPath = aSource.replace(/^file:\/\//, "");
        if (url.scheme == "file"
            && this._sources.has(fileUriAbsPath)) {
          return this.sourcesContent[this._sources.indexOf(fileUriAbsPath)]
        }

        if ((!url.path || url.path == "/")
            && this._sources.has("/" + aSource)) {
          return this.sourcesContent[this._sources.indexOf("/" + aSource)];
        }
      }

      // This function is used recursively from
      // IndexedSourceMapConsumer.prototype.sourceContentFor. In that case, we
      // don't want to throw if we can't find the source - we just want to
      // return null, so we provide a flag to exit gracefully.
      if (nullOnMissing) {
        return null;
      }
      else {
        throw new Error('"' + aSource + '" is not in the SourceMap.');
      }
    };

  /**
   * Returns the generated line and column information for the original source,
   * line, and column positions provided. The only argument is an object with
   * the following properties:
   *
   *   - source: The filename of the original source.
   *   - line: The line number in the original source.
   *   - column: The column number in the original source.
   *   - bias: Either 'SourceMapConsumer.GREATEST_LOWER_BOUND' or
   *     'SourceMapConsumer.LEAST_UPPER_BOUND'. Specifies whether to return the
   *     closest element that is smaller than or greater than the one we are
   *     searching for, respectively, if the exact element cannot be found.
   *     Defaults to 'SourceMapConsumer.GREATEST_LOWER_BOUND'.
   *
   * and an object is returned with the following properties:
   *
   *   - line: The line number in the generated source, or null.
   *   - column: The column number in the generated source, or null.
   */
  BasicSourceMapConsumer.prototype.generatedPositionFor =
    function SourceMapConsumer_generatedPositionFor(aArgs) {
      var source = util.getArg(aArgs, 'source');
      if (this.sourceRoot != null) {
        source = util.relative(this.sourceRoot, source);
      }
      if (!this._sources.has(source)) {
        return {
          line: null,
          column: null,
          lastColumn: null
        };
      }
      source = this._sources.indexOf(source);

      var needle = {
        source: source,
        originalLine: util.getArg(aArgs, 'line'),
        originalColumn: util.getArg(aArgs, 'column')
      };

      var index = this._findMapping(
        needle,
        this._originalMappings,
        "originalLine",
        "originalColumn",
        util.compareByOriginalPositions,
        util.getArg(aArgs, 'bias', SourceMapConsumer.GREATEST_LOWER_BOUND)
      );

      if (index >= 0) {
        var mapping = this._originalMappings[index];

        if (mapping.source === needle.source) {
          return {
            line: util.getArg(mapping, 'generatedLine', null),
            column: util.getArg(mapping, 'generatedColumn', null),
            lastColumn: util.getArg(mapping, 'lastGeneratedColumn', null)
          };
        }
      }

      return {
        line: null,
        column: null,
        lastColumn: null
      };
    };

  /**
   * Parse the environment string into `SourceMapConsumer.Scope` and
   * `SourceMapConsumer.Binding` instances.
   */
  BasicSourceMapConsumer.prototype._parseEnv = function () {
    if (!this._env) {
      throw new Error("No environment data available");
    }

    this._globalScope = new Scope(null);
    var parseState = {
      string: this._env,
      length: this._env.length,
      peeked: null,
      value: 0,
      rest: 0,
      lastValueByProperty: Object.create(null),
      stack: [this._globalScope]
    };

    while (parseState.rest < parseState.length) {
      this._globalScope.addChild(this._parseRecord(parseState));
    }
  };

  /**
   * Parse a single base 64 VLQ from the environment string.
   */
  BasicSourceMapConsumer.prototype._parseOne = function (parseState) {
    if (parseState.peeked !== null) {
      var value = parseState.peeked;
      parseState.peeked = null;
      return value;
    }

    base64VLQ.decode(parseState.string, parseState.rest, parseState);
    return parseState.value;
  };

  /**
   * Peek at the next value that will be parsed from the environment string.
   */
  BasicSourceMapConsumer.prototype._peek = function (parseState) {
    if (parseState.peeked !== null) {
      return parseState.peeked;
    }

    var value = parseState.value;
    var peeked = parseState.peeked = this._parseOne(parseState);
    parseState.value = value;
    return peeked;
  }

  /**
   * Get an absolute value for the freshly parsed relative value.
   */
  function getValueFromRelative(parseState, property, relativeValue) {
    var lastValue = 0;
    if (parseState.lastValueByProperty[property]) {
      lastValue = parseState.lastValueByProperty[property];
    }

    var absoluteValue = lastValue + relativeValue;
    parseState.lastValueByProperty[property] = absoluteValue;
    return absoluteValue;
  };

  /**
   * Parse a single record from the environment string.
   */
  BasicSourceMapConsumer.prototype._parseRecord = function (parseState) {
    var recordType = this._parseOne(parseState);

    if (recordType == tags.RECORD_ABBREVIATION_DEFINITION) {
      return this._parseAbbreviationDefinition(parseState);
    } else if (recordType == tags.RECORD_ABBREVIATED) {
      return this._parseAbbreviatedRecord(parseState);
    } else {
      return this._parseVerboseRecord(parseState, recordType);
    }
  };

  /**
   * Parse an abbreviation definition record.
   */
  BasicSourceMapConsumer.prototype._parseAbbreviationDefinition = function (parseState) {
    var abbreviationId = this._parseOne(parseState);

    if (this._abbreviations[abbreviationId]) {
      throw new Error("Duplicate abbreviation definition for id: " + abbreviationId);
    }

    var abbreviationRecordType = this._parseOne(parseState);

    var properties = [];
    while (true) {
      var property = this._parseOne(parseState);
      if (property === tags.RECORD_DONE) {
        break;
      }
      properties.push(property);
    }

    var definition = new Abbreviation(abbreviationRecordType, properties);
    this._abbreviations[abbreviationId] = definition;
    return definition;
  };

  /**
   * Parse a single abbreviated record.
   */
  BasicSourceMapConsumer.prototype._parseAbbreviatedRecord = function (parseState) {
    var abbreviationId = this._parseOne(parseState);
    if (!this._abbreviations[abbreviationId]) {
      throw new Error("Reference to abbreviation that does not exist");
    }
    var definition = this._abbreviations[abbreviationId];

    var record = this._makeRecord(parseState, definition.recordType);
    for (var i = 0, length = definition.properties.length; i < length; i++) {
      var property = definition.properties[i];
      var value = getValueFromRelative(parseState, property, this._parseOne(parseState));
      record.defineProperty(property, value);
    }

    switch (this._parseOne(parseState)) {
    case tags.RECORD_CHILDREN:
      this._parseChildren(parseState, record);
      break;
    case tags.RECORD_DONE:
      break;
    default:
      throw new Error("Expected tag_record_children, or tag_record_done, found " + parseState.value);
    }

    record.finish();
    return record;
  };

  /**
   * Parse a single verbose record.
   */
  BasicSourceMapConsumer.prototype._parseVerboseRecord = function (parseState, recordType) {
    var record = this._makeRecord(parseState, recordType);

    while (true) {
      var property = this._parseOne(parseState);
      if (property === tags.RECORD_DONE) {
        break;
      }

      if (property === tags.RECORD_CHILDREN) {
        this._parseChildren(parseState, record);
        break;
      }

      var value = getValueFromRelative(parseState, property, this._parseOne(parseState));
      record.defineProperty(property, value);
    }

    record.finish();
    return record;
  };

  /**
   * Parse a record's children.
   */
  BasicSourceMapConsumer.prototype._parseChildren = function (parseState, parent) {
    parseState.stack.push(parent);

    while (this._peek(parseState) !== tags.RECORD_DONE) {
      parent.addChild(this._parseRecord(parseState));
    }

    // Consume the RECORD_DONE.
    this._parseOne(parseState);

    parseState.stack.pop();
  };

  /**
   * Create a new, empty record of the give type.
   */
  BasicSourceMapConsumer.prototype._makeRecord = function (parseState, recordType) {
    var parent = parseState.stack[parseState.stack.length - 1];

    if (recordType === tags.RECORD_BINDING) {
      return new Binding(parent, this);
    }

    if (recordType === tags.RECORD_SCOPE) {
      return new Scope(parent, this);
    }

    return new UnknownRecord(parent, this);
  };

  /**
   * In order to keep the generated environment string small, common record
   * metadata, such as record type and properties, may be factored out into
   * abbreviation definitions. This class represents an abbreviation definition
   * that we have parsed.
   */
  var Abbreviation = function (recordType, properties) {
    this.recordType = recordType;
    this.properties = properties;
  };

  /**
   * Represents a record of unknown type that we parsed from the environment
   * string. This exists to enable compatibility with future extensions.
   */
  var UnknownRecord = function (parent, consumer) { };
  UnknownRecord.prototype.finish = function () { };
  UnknownRecord.prototype.addChild = function (child) { };
  UnknownRecord.prototype.defineProperty = function (property, value) { };

  /**
   * A scope record that has been deserialized from the source map's
   * environment. It has zero or more child scopes and zero or more bindings.
   */
  var Scope = SourceMapConsumer.Scope = function (parent, consumer) {
    this._consumer = consumer;
    this._parent = parent;
    this._type = null;
    this._start = null;
    this._end = null;
    this._name = null;
    this._scopes = new RedBlackTree(Scope.compare);
    this._bindings = [];
  };

  /**
   * Compare two sibling Scope objects by their start positions. We needn't
   * worry about end positions because sibling scopes mustn't overlap.
   */
  Scope.compare = function (a, b) {
    return util.compareByGeneratedPositionsDeflated(a._start, b._start);
  };

  /**
   * Compare if the given generated location is before, after, or contained
   * within this scope's bounds.
   */
  Scope.compareContained = function (generatedLocation, scope) {
    var lower = util.compareByGeneratedPositionsDeflated(generatedLocation, scope._start);
    var upper = util.compareByGeneratedPositionsDeflated(generatedLocation, scope._end);

    if (lower == 0 || upper == 0 || (lower > 0 && 0 > upper)) {
      return 0;
    } else if (lower > 0 && upper > 0) {
      return 1;
    } else if (lower < 0 && upper < 0) {
      return -1;
    } else {
      // This shouldn't ever happen because we ensure start <= end when parsing
      // scopes. Some nasty person must have mutated the scope's private state!
      throw new Error("Bad scope: start > end!\nstart = " + JSON.stringify(scope._start)
                      + "\nend = " + JSON.stringify(scope._end));
    }
  };

  Scope.prototype.finish = function () {
    if (this._start === null) {
      throw new Error("Scope record without start boundary");
    }
    if (this._end === null) {
      throw new Error("Scope record without end boundary");
    }
    if (util.compareByGeneratedPositionsDeflated(this._start, this._end, true) > 0) {
      throw new Error("A scope's start position must be <= its end position");
    }
    this._assertChildScopesAreContainedAndNonOverlapping();
  };

  Scope.prototype.defineProperty = function (property, value) {
    switch (property) {

    case tags.PROPERTY_START:
      if (0 <= value && value < this._consumer._generatedMappings.length) {
        this._start = this._consumer._generatedMappings[value];
      }
      break;

    case tags.PROPERTY_END:
      if (0 <= value && value < this._consumer._generatedMappings.length) {
        this._end = this._consumer._generatedMappings[value];
      }
      break;

    case tags.PROPERTY_TYPE:
      if (value === tags.VALUE_TYPE_BLOCK || value === tags.VALUE_TYPE_FUNCTION) {
        this._type = value;
      }
      break;

    case tags.PROPERTY_NAME:
      if (0 <= value && value < this._consumer.names.size()) {
        this._name = this._consumer.names.at(value);
      }
      break;

    default:
      // Nothing to do here...

    }
  };

  Scope.prototype.addChild = function (record) {
    if (record instanceof Scope) {
      this._scopes.insert(record);
    } else if (record instanceof Binding) {
      this._bindings.push(record);
    } else {
      // Nothing to do here...
    }
  };

  Scope.prototype._assertChildScopesAreContainedAndNonOverlapping = function () {
    var lastChildScopeEnd = null;
    this.eachChildScope(function (s) {
      if (lastChildScopeEnd) {
        if (util.compareByGeneratedPositions(lastChildScopeEnd, s._start) >= 0) {
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
   * Is this the global scope or not? True if it is, false otherwise.
   */
  Scope.prototype.isGlobalScope = function () {
    return this._parent === null;
  };

  /**
   * Get this scope's parent, or null if this is the global scope.
   */
  Scope.prototype.getParentScope = function () {
    return this._parent;
  };

  /**
   * Get this scope's name, if it was given one. Returns null if this scope has
   * no name.
   */
  Scope.prototype.getName = function () {
    return this._name;
  };

  /**
   * Get this scope's direct child scope whose bounds contain the given
   * generated location. If there is no such child scope extant, then return
   * null.
   */
  Scope.prototype.getChildScopeAt = function (generatedLocation) {
    var node = this._scopes.search(generatedLocation, Scope.compareContained);
    return node ? node.value : null;
  };

  /**
   * Call f(child) for each of this scope's direct child scopes.
   */
  Scope.prototype.eachChildScope = function (f) {
    this._scopes.inOrderWalk(function (node) {
      f(node.value);
    });
  };

  /**
   * Call f(binding) for each of this scope's bindings.
   */
  Scope.prototype.eachBinding = function (f) {
    for (var i = 0, len = this._bindings.length; i < len; i++) {
      f(this._bindings[i]);
    }
  };

  /**
   * Log this scope, its bindings, and child scopes in a format that is easily
   * read by puny humans.
   */
  Scope.prototype.log = function (indent) {
    indent = indent || '';
    if (this.isGlobalScope()) {
      console.log(indent + 'Global Scope');
    } else {
      console.log(indent + 'Scope' + (this._name ? ' ' + this._name : ''));
      console.log(indent + '    type = ' + JSON.stringify(this._type));
      console.log(indent + '    start = ' + JSON.stringify(this._start));
      console.log(indent + '    end   = ' + JSON.stringify(this._end));
    }
    console.log(indent + '    Bindings:');
    this.eachBinding(function (b) {
      b.log(indent + '        ');
    });
    console.log(indent + '    Child Scopes:');
    this.eachChildScope(function (s) {
      s.log(indent + '        ');
    });
  };

  /**
   * A binding record that has been deserialized from the source map's
   * environment.
   */
  var Binding = SourceMapConsumer.Binding = function (parent, consumer) {
    this._consumer = consumer;
    this._type = null;
    this._name = null;
    this._value = null;
  };

  Binding.prototype.finish = function () {
    if (this._name === null) {
      throw new Error("Binding record without a name property");
    }
    if (this._value === null) {
      throw new Error("Binding record without a value property");
    }
  };

  Binding.prototype.addChild = function (child) { };

  Binding.prototype.defineProperty = function (property, value) {
    switch (property) {

    case tags.PROPERTY_TYPE:
      if (value === tags.VALUE_TYPE_CONST ||
          value === tags.VALUE_TYPE_LOCAL ||
          value === tags.VALUE_TYPE_PARAM) {
        this._type = value;
      }
      break;

    case tags.PROPERTY_NAME:
      if (0 <= value && value < this._consumer.names.size()) {
        this._name = this._consumer.names.at(value);
      }
      break;

    case tags.PROPERTY_VALUE:
      if (0 <= value && value < this._consumer.names.size()) {
        this._value = this._consumer.names.at(value);
      }
      break;

    default:
      // Nothing to do here...

    }
  };

  /**
   * Get the type of binding, eg `VAL_BINDING_TYPE_LOCAL` or
   * `VAL_BINDING_TYPE_PARAM`.
   */
  Binding.prototype.getType = function () {
    return this._type;
  };

  /**
   * Get the string name of this binding.
   */
  Binding.prototype.getName = function () {
    return this._name;
  };

  /**
   * Get the JavaScript snippet that can be evaluated within in the context of
   * this binding's owning scope to locate this binding's value.
   */
  Binding.prototype.getValue = function () {
    return this._value;
  };

  /**
   * Log this binding in a format that is easily read by puny humans.
   */
  Binding.prototype.log = function (indent) {
    indent = indent || '';
    console.log(indent + 'Binding ' + this._name);
    console.log(indent + '    type = ' + this._type);
    console.log(indent + '    value = ' + this._value);
  };

  exports.BasicSourceMapConsumer = BasicSourceMapConsumer;

  /**
   * An IndexedSourceMapConsumer instance represents a parsed source map which
   * we can query for information. It differs from BasicSourceMapConsumer in
   * that it takes "indexed" source maps (i.e. ones with a "sections" field) as
   * input.
   *
   * The only parameter is a raw source map (either as a JSON string, or already
   * parsed to an object). According to the spec for indexed source maps, they
   * have the following attributes:
   *
   *   - version: Which version of the source map spec this map is following.
   *   - file: Optional. The generated file this source map is associated with.
   *   - sections: A list of section definitions.
   *
   * Each value under the "sections" field has two fields:
   *   - offset: The offset into the original specified at which this section
   *       begins to apply, defined as an object with a "line" and "column"
   *       field.
   *   - map: A source map definition. This source map could also be indexed,
   *       but doesn't have to be.
   *
   * Instead of the "map" field, it's also possible to have a "url" field
   * specifying a URL to retrieve a source map from, but that's currently
   * unsupported.
   *
   * Here's an example source map, taken from the source map spec[0], but
   * modified to omit a section which uses the "url" field.
   *
   *  {
   *    version : 3,
   *    file: "app.js",
   *    sections: [{
   *      offset: {line:100, column:10},
   *      map: {
   *        version : 3,
   *        file: "section.js",
   *        sources: ["foo.js", "bar.js"],
   *        names: ["src", "maps", "are", "fun"],
   *        mappings: "AAAA,E;;ABCDE;"
   *      }
   *    }],
   *  }
   *
   * [0]: https://docs.google.com/document/d/1U1RGAehQwRypUTovF1KRlpiOFze0b-_2gc6fAH0KY0k/edit#heading=h.535es3xeprgt
   */
  function IndexedSourceMapConsumer(aSourceMap) {
    var sourceMap = aSourceMap;
    if (typeof aSourceMap === 'string') {
      sourceMap = JSON.parse(aSourceMap.replace(/^\)\]\}'/, ''));
    }

    var version = util.getArg(sourceMap, 'version');
    var sections = util.getArg(sourceMap, 'sections');

    if (version != this._version) {
      throw new Error('Unsupported version: ' + version);
    }

    this._sources = new ArraySet();
    this.names = new ArraySet();

    var lastOffset = {
      line: -1,
      column: 0
    };
    this._sections = sections.map(function (s) {
      if (s.url) {
        // The url field will require support for asynchronicity.
        // See https://github.com/mozilla/source-map/issues/16
        throw new Error('Support for url field in sections not implemented.');
      }
      var offset = util.getArg(s, 'offset');
      var offsetLine = util.getArg(offset, 'line');
      var offsetColumn = util.getArg(offset, 'column');

      if (offsetLine < lastOffset.line ||
          (offsetLine === lastOffset.line && offsetColumn < lastOffset.column)) {
        throw new Error('Section offsets must be ordered and non-overlapping.');
      }
      lastOffset = offset;

      return {
        generatedOffset: {
          // The offset fields are 0-based, but we use 1-based indices when
          // encoding/decoding from VLQ.
          generatedLine: offsetLine + 1,
          generatedColumn: offsetColumn + 1
        },
        consumer: new SourceMapConsumer(util.getArg(s, 'map'))
      }
    });
  }

  IndexedSourceMapConsumer.prototype = Object.create(SourceMapConsumer.prototype);
  IndexedSourceMapConsumer.prototype.constructor = SourceMapConsumer;

  /**
   * The version of the source mapping spec that we are consuming.
   */
  IndexedSourceMapConsumer.prototype._version = 3;

  /**
   * The list of original sources.
   */
  Object.defineProperty(IndexedSourceMapConsumer.prototype, 'sources', {
    get: function () {
      var sources = [];
      for (var i = 0; i < this._sections.length; i++) {
        for (var j = 0; j < this._sections[i].consumer.sources.length; j++) {
          sources.push(this._sections[i].consumer.sources[j]);
        }
      };
      return sources;
    }
  });

  /**
   * Returns the original source, line, and column information for the generated
   * source's line and column positions provided. The only argument is an object
   * with the following properties:
   *
   *   - line: The line number in the generated source.
   *   - column: The column number in the generated source.
   *
   * and an object is returned with the following properties:
   *
   *   - source: The original source file, or null.
   *   - line: The line number in the original source, or null.
   *   - column: The column number in the original source, or null.
   *   - name: The original identifier, or null.
   */
  IndexedSourceMapConsumer.prototype.originalPositionFor =
    function IndexedSourceMapConsumer_originalPositionFor(aArgs) {
      var needle = {
        generatedLine: util.getArg(aArgs, 'line'),
        generatedColumn: util.getArg(aArgs, 'column')
      };

      // Find the section containing the generated position we're trying to map
      // to an original position.
      var sectionIndex = binarySearch.search(needle, this._sections,
        function(needle, section) {
          var cmp = needle.generatedLine - section.generatedOffset.generatedLine;
          if (cmp) {
            return cmp;
          }

          return (needle.generatedColumn -
                  section.generatedOffset.generatedColumn);
        });
      var section = this._sections[sectionIndex];

      if (!section) {
        return {
          source: null,
          line: null,
          column: null,
          name: null
        };
      }

      return section.consumer.originalPositionFor({
        line: needle.generatedLine -
          (section.generatedOffset.generatedLine - 1),
        column: needle.generatedColumn -
          (section.generatedOffset.generatedLine === needle.generatedLine
           ? section.generatedOffset.generatedColumn - 1
           : 0),
        bias: aArgs.bias
      });
    };

  /**
   * Return true if we have the source content for every source in the source
   * map, false otherwise.
   */
  IndexedSourceMapConsumer.prototype.hasContentsOfAllSources =
    function IndexedSourceMapConsumer_hasContentsOfAllSources() {
      return this._sections.every(function (s) {
        return s.consumer.hasContentsOfAllSources();
      });
    };

  /**
   * Returns the original source content. The only argument is the url of the
   * original source file. Returns null if no original source content is
   * available.
   */
  IndexedSourceMapConsumer.prototype.sourceContentFor =
    function IndexedSourceMapConsumer_sourceContentFor(aSource, nullOnMissing) {
      for (var i = 0; i < this._sections.length; i++) {
        var section = this._sections[i];

        var content = section.consumer.sourceContentFor(aSource, true);
        if (content) {
          return content;
        }
      }
      if (nullOnMissing) {
        return null;
      }
      else {
        throw new Error('"' + aSource + '" is not in the SourceMap.');
      }
    };

  /**
   * Returns the generated line and column information for the original source,
   * line, and column positions provided. The only argument is an object with
   * the following properties:
   *
   *   - source: The filename of the original source.
   *   - line: The line number in the original source.
   *   - column: The column number in the original source.
   *
   * and an object is returned with the following properties:
   *
   *   - line: The line number in the generated source, or null.
   *   - column: The column number in the generated source, or null.
   */
  IndexedSourceMapConsumer.prototype.generatedPositionFor =
    function IndexedSourceMapConsumer_generatedPositionFor(aArgs) {
      for (var i = 0; i < this._sections.length; i++) {
        var section = this._sections[i];

        // Only consider this section if the requested source is in the list of
        // sources of the consumer.
        if (section.consumer.sources.indexOf(util.getArg(aArgs, 'source')) === -1) {
          continue;
        }
        var generatedPosition = section.consumer.generatedPositionFor(aArgs);
        if (generatedPosition) {
          var ret = {
            line: generatedPosition.line +
              (section.generatedOffset.generatedLine - 1),
            column: generatedPosition.column +
              (section.generatedOffset.generatedLine === generatedPosition.line
               ? section.generatedOffset.generatedColumn - 1
               : 0)
          };
          return ret;
        }
      }

      return {
        line: null,
        column: null
      };
    };

  /**
   * Parse the mappings in a string in to a data structure which we can easily
   * query (the ordered arrays in the `this.__generatedMappings` and
   * `this.__originalMappings` properties).
   */
  IndexedSourceMapConsumer.prototype._parseMappings =
    function IndexedSourceMapConsumer_parseMappings(aStr, aSourceRoot) {
      this.__generatedMappings = [];
      this.__originalMappings = [];
      for (var i = 0; i < this._sections.length; i++) {
        var section = this._sections[i];
        var sectionMappings = section.consumer._generatedMappings;
        for (var j = 0; j < sectionMappings.length; j++) {
          var mapping = sectionMappings[i];

          var source = section.consumer._sources.at(mapping.source);
          if (section.consumer.sourceRoot !== null) {
            source = util.join(section.consumer.sourceRoot, source);
          }
          this._sources.add(source);
          source = this._sources.indexOf(source);

          var name = section.consumer.names.at(mapping.name);
          this.names.add(name);
          name = this.names.indexOf(name);

          // The mappings coming from the consumer for the section have
          // generated positions relative to the start of the section, so we
          // need to offset them to be relative to the start of the concatenated
          // generated file.
          var adjustedMapping = {
            source: source,
            generatedLine: mapping.generatedLine +
              (section.generatedOffset.generatedLine - 1),
            generatedColumn: mapping.column +
              (section.generatedOffset.generatedLine === mapping.generatedLine)
              ? section.generatedOffset.generatedColumn - 1
              : 0,
            originalLine: mapping.originalLine,
            originalColumn: mapping.originalColumn,
            name: name
          };

          this.__generatedMappings.push(adjustedMapping);
          if (typeof adjustedMapping.originalLine === 'number') {
            this.__originalMappings.push(adjustedMapping);
          }
        };
      };

      quickSort(this.__generatedMappings, util.compareByGeneratedPositionsDeflated);
      quickSort(this.__originalMappings, util.compareByOriginalPositions);
    };

  exports.IndexedSourceMapConsumer = IndexedSourceMapConsumer;

});
