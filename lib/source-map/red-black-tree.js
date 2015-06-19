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

  // A Red/Black Tree implementation based on chapter 13 of "Introduction to
  // Algorithms" by Cormen, et all (commonly known as CLRS). It provides O(log n)
  // search and insertion; note that deletion is not currently implemented, but
  // can be implemented in O(log n), as well.
  //
  // https://en.wikipedia.org/wiki/Red%E2%80%93black_tree is also very detailed
  // and informative.

  'use strict';

  /**
   * Construct a new RedBlackTree.
   *
   * @param Function compare
   *        A pure function that takes two elements and returns a number that is
   *        less than zero when the first element is less than the second, exactly
   *        zero when the elements are equal, and a number that is greater than
   *        zero when the first element is greater than the second.
   */
  function RedBlackTree(compare) {
    this.compare = compare;
    this._root = null;
    this._size = 0;
  }

  var RED   = RedBlackTree.RED   = 'RED';
  var BLACK = RedBlackTree.BLACK = 'BLACK';

  exports.RedBlackTree = RedBlackTree;

  RedBlackTree.prototype = {
    /**
     * Return the number of elements in this tree.
     */
    size: function () {
      return this._size;
    },

    /**
     * Insert a value into the tree.
     *
     * @param any value
     */
    insert: function (value) {
      this._insertNode(new RedBlackTree.Node(value));
      this._size++;
    },

    /**
     * Insert a node into the tree.
     *
     * @param RedBlackTree.Node z
     */
    _insertNode: function (z) {
      var y = null;
      var x = this._root;

      while (x) {
        y = x;
        x = this.compare(z.value, x.value) < 0 ? x._left : x._right;
      }

      z._parent = y;

      if (y === null) {
        this._root = z;
      } else if (this.compare(z.value, y.value) < 0) {
        y._left = z;
      } else {
        y._right = z;
      }

      this._insertFixup(z);
    },

    /**
     * After inserting the given node into the tree, fix up the tree so that the
     * Red/Black Tree properties are maintained and the tree is balanced. The
     * Red/Black Tree properties (taken from CLRS) are:
     *
     *   1. Every node is either red or black.
     *   2. The root is black.
     *   3. Every leaf (null) is black.
     *   4. If a node is red, then both its children are black.
     *   5. For each node, all paths from the node to descendant leaves contain
     *      the same number of black nodes.
     *
     * @param RedBlackTree.Node z
     */
    _insertFixup: function (z) {
      while (z && z._parent && z._parent._color === RED) {
        if (z._parent === z._parent._parent._left) {
          var y = z._parent._parent._right;
          if (y && y._color === RED) {
            z._parent._color = BLACK;
            y._color = BLACK;
            z._parent._parent._color = RED;
            z = z._parent._parent;
          } else if (z === z._parent._right) {
            z = z._parent;
            this._leftRotate(z);
          } else {
            z._parent._color = BLACK;
            z._parent._parent._color = RED;
            this._rightRotate(z._parent._parent);
          }
        } else {
          var y = z._parent._parent._left;
          if (y && y._color === RED) {
            z._parent._color = BLACK;
            y._color = BLACK;
            z._parent._parent._color = RED;
            z = z._parent._parent;
          } else if (z === z._parent._left) {
            z = z._parent;
            this._rightRotate(z);
          } else {
            z._parent._color = BLACK;
            z._parent._parent._color = RED;
            this._leftRotate(z._parent._parent);
          }
        }
      }

      this._root._color = BLACK;
    },

    /**
     * Tree rotations.
     *
     *    |                                      |
     *    x       ---- _leftRotate(x) --->       y
     *   / \                                    / \
     *  a   y                                  x   c
     *     / \    <--- _rightRotate(y) ----   / \
     *    b   c                              a   b
     *
     * @param RedBlackTree.Node x
     * @param RedBlackTree.Node y
     */

    _leftRotate: function (x) {
      var y = x._right
      if (!y) {
        return;
      }

      var b = y._left;

      y._parent = x._parent;
      if (!y._parent) {
        this._root = y;
      } else if (y._parent._left === x) {
        y._parent._left = y;
      } else {
        y._parent._right = y;
      }

      x._parent = y;
      x._right = b
      y._left = x;
      if (b) {
        b._parent = x;
      }
    },

    _rightRotate: function (y) {
      var x = y._left
      if (!x) {
        return;
      }

      var b = x._right;

      x._parent = y._parent;
      if (!x._parent) {
        this._root = x;
      } else if (x._parent._left === y) {
        x._parent._left = x;
      } else {
        x._parent._right = x;
      }

      y._parent = x;
      y._left = b
      x._right = y;
      if (b) {
        b._parent = y;
      }
    },

    /**
     * Search for the target value in the tree. If the value is in the tree (the
     * comparison function returns 0 for the target value and a node in the tree's
     * value), then the matching node is returned. Otherwise, null is returned.
     *
     * Optionally pass in a custom compare function. If this function does not
     * return 0, then the compare function passed to this tree's constructor
     * *must* return the same. However, this custom compare function may return
     * 0 when the compare function passed to the constructor would not. This
     * enables fuzzy searching.
     *
     * @param any target
     * @param Function compare
     * @returns RedBlackTree.Node | null
     */
    search: function (target, compare) {
      compare = compare || this.compare;
      var x = this._root;
      while (x) {
        var cmp = compare(target, x.value);
        if (cmp === 0) {
          return x;
        }
        x = cmp < 0 ? x._left : x._right;
      }
      return null;
    },

    /**
     * Do an in order traversal of the items in the collection, calling the
     * function `f` on each node.
     *
     * @param Function f
     */
    inOrderWalk: function (f) {
      this._inOrderWalkHelper(f, this._root);
    },

    _inOrderWalkHelper: function (f, node) {
      if (!node) {
        return;
      }
      this._inOrderWalkHelper(f, node._left);
      f(node);
      this._inOrderWalkHelper(f, node._right);
    },

    /**
     * Debug helper method to log the contents of the tree.
     */
    log: function () {
      this._logHelper(this._root, 0);
    },

    _logHelper: function (node, level) {
      if (!node) {
        return;
      }

      var indent = '';
      for (var i = 0; i < level; i++) {
        indent += '    ';
      }

      if (node._right) {
        this._logHelper(node._right, level + 1);
        console.log(indent + '   /');
      }

      node.log(indent);

      if (node._left) {
        console.log(indent + '   \\');
        this._logHelper(node._left, level + 1);
      }
    }
  };

  /**
   * A node in the Red/Black Tree.
   *
   * @param any value
   */
  RedBlackTree.Node = function (value) {
    this.value = value;
    this._color = RED;
    this._parent = null;
    this._right = null;
    this._left = null;
  };

  RedBlackTree.Node.prototype = {
    /**
     * Debug helper method to log the node.
     *
     * @param String indent
     */
    log: function (indent) {
      indent = indent || '';
      console.log(indent + 'color =', this._color === RED ? 'R' : 'B');
      console.log(indent + 'value =', this.value);
    }
  };

});
