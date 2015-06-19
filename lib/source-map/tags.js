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

  exports.RECORD_DONE                    = 0;
  exports.RECORD_SCOPE                   = 1;
  exports.RECORD_BINDING                 = 2;
  exports.RECORD_CHILDREN                = 3;
  exports.RECORD_ABBREVIATION_DEFINITION = 4;
  exports.RECORD_ABBREVIATED             = 5;

  exports.PROPERTY_TYPE  = 6;
  exports.PROPERTY_START = 7;
  exports.PROPERTY_END   = 8;
  exports.PROPERTY_NAME  = 9;
  exports.PROPERTY_VALUE = 10;

  exports.VALUE_TYPE_BLOCK    = 11;
  exports.VALUE_TYPE_FUNCTION = 12;
  exports.VALUE_TYPE_LOCAL    = 13;
  exports.VALUE_TYPE_PARAM    = 14;
  exports.VALUE_TYPE_CONST    = 15;

});
