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

  // Test RedBlackTree.js

  var RedBlackTree = require("../../lib/source-map/red-black-tree").RedBlackTree;
  var RED = RedBlackTree.RED;
  var BLACK = RedBlackTree.BLACK;

  function compareNumbers(a, b) {
    return a - b;
  }

  exports['test red black tree'] = function (assert) {
    var tree = new RedBlackTree(compareNumbers);

    testInsertionAndSearch(assert, tree);
    testInOrderWalk(assert, tree);
    testRedOrBlack(assert, tree);
    testRootIsBlack(assert, tree);
    testNoRedNodeHasRedChildren(assert, tree);
    testEqualNumberOfBlackNodes(assert, tree);
  };

  function testInsertionAndSearch(assert, tree) {
    for (var i = 0; i < 20; i++) {
      tree.insert(i);
      var node = tree.search(i);
      assert.ok(node);
      assert.equal(node.value, i);
    }

    for (var i = 100; i > 80; i--) {
      tree.insert(i);
      var node = tree.search(i);
      assert.ok(node);
      assert.equal(node.value, i);
    }
  }

  function testInOrderWalk(assert, tree) {
    var lastValue = -Infinity;
    var n = 0;

    tree.inOrderWalk(function (node) {
      assert.ok(node.value > lastValue, 'Each value should get larger as we walk the tree.');
      lastValue = node.value;
      n++;
    });

    assert.equal(n, 40, 'Should have found 40 things in the tree.');
  }

  function testRedOrBlack(assert, tree) {
    tree.inOrderWalk(function (node) {
      assert.ok(node._color === RED || node._color === BLACK,
                'Every node\'s color is either red or black.');
    });
  }

  function testRootIsBlack(assert, tree) {
    assert.equal(tree._root._color, BLACK,
                 'A tree\'s root is always black.');
  }

  function testNoRedNodeHasRedChildren(assert, tree) {
    tree.inOrderWalk(function (node) {
      if (node._color === RED) {
        if (node._right) {
          assert.equal(node._right._color, BLACK,
                       'Children of a red node must be black.');
        }
        if (node._left) {
          assert.equal(node._left._color, BLACK,
                'Children of a red node must be black.');
        }
      }
    });
  }

  function testEqualNumberOfBlackNodes(assert, tree) {
    var numberOfBlackNodesExpected = -1;

    function checkPath(node) {
      var numberOfBlackNodesFound = 0;
      var path = [];

      while (node) {
        path.push(node);
        if (node._color === BLACK) {
          numberOfBlackNodesFound++;
        }
        node = node._parent;
      }

      if (numberOfBlackNodesExpected === -1) {
        // This is the first leaf node we have visited, so set the expected number
        // of black nodes for other leaves to check against.
        numberOfBlackNodesExpected = numberOfBlackNodesFound;
      } else {
        assert.equal(numberOfBlackNodesFound, numberOfBlackNodesExpected,
                     'Every path from a leaf to the root should have the same number ' +
                     'of black nodes.');
      }
    }

    function isLeaf(node) {
      return !node._left && !node._right;
    }

    tree.inOrderWalk(function (node) {
      if (isLeaf(node)) {
        checkPath(node);
      }
    });
  }

});
