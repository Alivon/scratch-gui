/**
 * @license
 * Visual Blocks Editor
 *
 * Copyright 2012 Google Inc.
 * https://developers.google.com/blockly/
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview Methods for graphically rendering a block as SVG.
 * @author fraser@google.com (Neil Fraser)
 */
'use strict';

goog.provide('Blockly.BlockSvg');

goog.require('Blockly.Block');
goog.require('Blockly.ContextMenu');
goog.require('goog.Timer');
goog.require('goog.asserts');
goog.require('goog.dom');
goog.require('goog.math.Coordinate');
goog.require('goog.userAgent');


/**
 * Class for a block's SVG representation.
 * Not normally called directly, workspace.newBlock() is preferred.
 * @param {!Blockly.Workspace} workspace The block's workspace.
 * @param {?string} prototypeName Name of the language object containing
 *     type-specific functions for this block.
 * @param {=string} opt_id Optional ID.  Use this ID if provided, otherwise
 *     create a new id.
 * @extends {Blockly.Block}
 * @constructor
 */
Blockly.BlockSvg = function(workspace, prototypeName, opt_id) {
  // Create core elements for the block.
  /** @type {SVGElement} */
  this.svgGroup_ = Blockly.createSvgElement('g', {}, null);
  /** @type {SVGElement} */
  this.svgPath_ = Blockly.createSvgElement('path', {'class': 'blocklyPath'},
      this.svgGroup_);
  this.svgPath_.tooltip = this;
  Blockly.Tooltip.bindMouseEvents(this.svgPath_);
  Blockly.BlockSvg.superClass_.constructor.call(this,
      workspace, prototypeName, opt_id);
};
goog.inherits(Blockly.BlockSvg, Blockly.Block);

/**
 * Height of this block, not including any statement blocks above or below.
 */
Blockly.BlockSvg.prototype.height = 0;
/**
 * Width of this block, including any connected value blocks.
 */
Blockly.BlockSvg.prototype.width = 0;

/**
 * Original location of block being dragged.
 * @type {goog.math.Coordinate}
 * @private
 */
Blockly.BlockSvg.prototype.dragStartXY_ = null;

/**
 * Constant for identifying rows that are to be rendered inline.
 * Don't collide with Blockly.INPUT_VALUE and friends.
 * @const
 */
Blockly.BlockSvg.INLINE = -1;

/**
 * Create and initialize the SVG representation of the block.
 * May be called more than once.
 */
Blockly.BlockSvg.prototype.initSvg = function() {
  goog.asserts.assert(this.workspace.rendered, 'Workspace is headless.');
  for (var i = 0, input; input = this.inputList[i]; i++) {
    input.init();
  }
  var icons = this.getIcons();
  for (var i = 0; i < icons.length; i++) {
    icons[i].createIcon();
  }
  this.updateColour();
  this.updateMovable();
  if (!this.workspace.options.readOnly && !this.eventsInit_) {
    Blockly.bindEvent_(this.getSvgRoot(), 'mousedown', this,
                       this.onMouseDown_);
    var thisBlock = this;
    Blockly.bindEvent_(this.getSvgRoot(), 'touchstart', null,
                       function(e) {Blockly.longStart_(e, thisBlock);});
  }
  // Bind an onchange function, if it exists.
  if (goog.isFunction(this.onchange) && !this.eventsInit_) {
    this.onchangeWrapper_ = Blockly.bindEvent_(this.workspace.getCanvas(),
        'blocklyWorkspaceChange', this, this.onchange);
  }
  this.eventsInit_ = true;

  if (!this.getSvgRoot().parentNode) {
    this.workspace.getCanvas().appendChild(this.getSvgRoot());
  }
};

/**
 * Select this block.  Highlight it visually.
 */
Blockly.BlockSvg.prototype.select = function() {
  if (Blockly.selected) {
    // Unselect any previously selected block.
    Blockly.selected.unselect();
  }
  Blockly.selected = this;
  this.addSelect();
  Blockly.fireUiEvent(this.workspace.getCanvas(), 'blocklySelectChange');
};

/**
 * Unselect this block.  Remove its highlighting.
 */
Blockly.BlockSvg.prototype.unselect = function() {
  Blockly.selected = null;
  this.removeSelect();
  Blockly.fireUiEvent(this.workspace.getCanvas(), 'blocklySelectChange');
};

/**
 * Block's mutator icon (if any).
 * @type {Blockly.Mutator}
 */
Blockly.BlockSvg.prototype.mutator = null;

/**
 * Block's comment icon (if any).
 * @type {Blockly.Comment}
 */
Blockly.BlockSvg.prototype.comment = null;

/**
 * Block's warning icon (if any).
 * @type {Blockly.Warning}
 */
Blockly.BlockSvg.prototype.warning = null;

/**
 * Returns a list of mutator, comment, and warning icons.
 * @return {!Array} List of icons.
 */
Blockly.BlockSvg.prototype.getIcons = function() {
  var icons = [];
  if (this.mutator) {
    icons.push(this.mutator);
  }
  if (this.comment) {
    icons.push(this.comment);
  }
  if (this.warning) {
    icons.push(this.warning);
  }
  return icons;
};

/**
 * Wrapper function called when a mouseUp occurs during a drag operation.
 * @type {Array.<!Array>}
 * @private
 */
Blockly.BlockSvg.onMouseUpWrapper_ = null;

/**
 * Wrapper function called when a mouseMove occurs during a drag operation.
 * @type {Array.<!Array>}
 * @private
 */
Blockly.BlockSvg.onMouseMoveWrapper_ = null;

/**
 * Stop binding to the global mouseup and mousemove events.
 * @private
 */
Blockly.BlockSvg.terminateDrag_ = function() {
  Blockly.BlockSvg.disconnectUiStop_();
  if (Blockly.BlockSvg.onMouseUpWrapper_) {
    Blockly.unbindEvent_(Blockly.BlockSvg.onMouseUpWrapper_);
    Blockly.BlockSvg.onMouseUpWrapper_ = null;
  }
  if (Blockly.BlockSvg.onMouseMoveWrapper_) {
    Blockly.unbindEvent_(Blockly.BlockSvg.onMouseMoveWrapper_);
    Blockly.BlockSvg.onMouseMoveWrapper_ = null;
  }
  var selected = Blockly.selected;
  if (Blockly.dragMode_ == 2) {
    // Terminate a drag operation.
    if (selected) {
      // Update the connection locations.
      var xy = selected.getRelativeToSurfaceXY();
      var dxy = goog.math.Coordinate.difference(xy, selected.dragStartXY_);
      selected.moveConnections_(dxy.x, dxy.y);
      delete selected.draggedBubbles_;
      selected.setDragging_(false);
      selected.render();
      goog.Timer.callOnce(
          selected.snapToGrid, Blockly.BUMP_DELAY / 2, selected);
      goog.Timer.callOnce(
          selected.bumpNeighbours_, Blockly.BUMP_DELAY, selected);
      // Fire an event to allow scrollbars to resize.
      Blockly.fireUiEvent(window, 'resize');
      selected.workspace.fireChangeEvent();
    }
  }
  Blockly.dragMode_ = 0;
  Blockly.Css.setCursor(Blockly.Css.Cursor.OPEN);
};

/**
 * Set parent of this block to be a new block or null.
 * @param {Blockly.BlockSvg} newParent New parent block.
 */
Blockly.BlockSvg.prototype.setParent = function(newParent) {
  var svgRoot = this.getSvgRoot();
  if (this.parentBlock_ && svgRoot) {
    // Move this block up the DOM.  Keep track of x/y translations.
    var xy = this.getRelativeToSurfaceXY();
    this.workspace.getCanvas().appendChild(svgRoot);
    svgRoot.setAttribute('transform', 'translate(' + xy.x + ',' + xy.y + ')');
  }

  Blockly.Field.startCache();
  Blockly.BlockSvg.superClass_.setParent.call(this, newParent);
  Blockly.Field.stopCache();

  if (newParent) {
    var oldXY = this.getRelativeToSurfaceXY();
    newParent.getSvgRoot().appendChild(svgRoot);
    var newXY = this.getRelativeToSurfaceXY();
    // Move the connections to match the child's new position.
    this.moveConnections_(newXY.x - oldXY.x, newXY.y - oldXY.y);
  }
};

/**
 * Return the coordinates of the top-left corner of this block relative to the
 * drawing surface's origin (0,0).
 * @return {!goog.math.Coordinate} Object with .x and .y properties.
 */
Blockly.BlockSvg.prototype.getRelativeToSurfaceXY = function() {
  var x = 0;
  var y = 0;
  var element = this.getSvgRoot();
  if (element) {
    do {
      // Loop through this block and every parent.
      var xy = Blockly.getRelativeXY_(element);
      x += xy.x;
      y += xy.y;
      element = element.parentNode;
    } while (element && element != this.workspace.getCanvas());
  }
  return new goog.math.Coordinate(x, y);
};

/**
 * Move a block by a relative offset.
 * @param {number} dx Horizontal offset.
 * @param {number} dy Vertical offset.
 */
Blockly.BlockSvg.prototype.moveBy = function(dx, dy) {
  var xy = this.getRelativeToSurfaceXY();
  this.getSvgRoot().setAttribute('transform',
      'translate(' + (xy.x + dx) + ',' + (xy.y + dy) + ')');
  this.moveConnections_(dx, dy);
};

/**
 * Snap this block to the nearest grid point.
 */
Blockly.BlockSvg.prototype.snapToGrid = function() {
  if (!this.workspace) {
    return;  // Deleted block.
  }
  if (Blockly.dragMode_ != 0) {
    return;  // Don't bump blocks during a drag.
  }
  if (this.getParent()) {
    return;  // Only snap top-level blocks.
  }
  if (this.isInFlyout) {
    return;  // Don't move blocks around in a flyout.
  }
  if (!this.workspace.options.gridOptions ||
      !this.workspace.options.gridOptions['snap']) {
    return;  // Config says no snapping.
  }
  var spacing = this.workspace.options.gridOptions['spacing'];
  var half = spacing / 2;
  var xy = this.getRelativeToSurfaceXY();
  var dx = Math.round((xy.x - half) / spacing) * spacing + half - xy.x;
  var dy = Math.round((xy.y - half) / spacing) * spacing + half - xy.y;
  dx = Math.round(dx);
  dy = Math.round(dy);
  if (dx != 0 || dy != 0) {
    this.moveBy(dx, dy);
  }
};

/**
 * Returns a bounding box describing the dimensions of this block
 * and any blocks stacked below it.
 * @return {!{height: number, width: number}} Object with height and width properties.
 */
Blockly.BlockSvg.prototype.getHeightWidth = function() {
  var height = this.height;
  var width = this.width;
  // Recursively add size of subsequent blocks.
  var nextBlock = this.getNextBlock();
  if (nextBlock) {
    var nextHeightWidth = nextBlock.getHeightWidth();
    height += nextHeightWidth.height - 4;  // Height of tab.
    width = Math.max(width, nextHeightWidth.width);
  } else if (!this.nextConnection && !this.outputConnection) {
    // Add a bit of margin under blocks with no bottom tab.
    height += 2;
  }
  return {height: height, width: width};
};

/**
 * Open the next (or previous) FieldTextInput.
 * @param {Blockly.Field|Blockly.Block} start Current location.
 * @param {boolean} forward If true go forward, otherwise backward.
 */
Blockly.BlockSvg.prototype.tab = function(start, forward) {
  // This function need not be efficient since it runs once on a keypress.
  // Create an ordered list of all text fields and connected inputs.
  var list = [];
  for (var i = 0, input; input = this.inputList[i]; i++) {
    for (var j = 0, field; field = input.fieldRow[j]; j++) {
      if (field instanceof Blockly.FieldTextInput) {
        // TODO: Also support dropdown fields.
        list.push(field);
      }
    }
    if (input.connection) {
      var block = input.connection.targetBlock();
      if (block) {
        list.push(block);
      }
    }
  }
  var i = list.indexOf(start);
  if (i == -1) {
    // No start location, start at the beginning or end.
    i = forward ? -1 : list.length;
  }
  var target = list[forward ? i + 1 : i - 1];
  if (!target) {
    // Ran off of list.
    var parent = this.getParent();
    if (parent) {
      parent.tab(this, forward);
    }
  } else if (target instanceof Blockly.Field) {
    target.showEditor_();
  } else {
    target.tab(null, forward);
  }
};

/**
 * Handle a mouse-down on an SVG block.
 * @param {!Event} e Mouse down event.
 * @private
 */
Blockly.BlockSvg.prototype.onMouseDown_ = function(e) {
  if (this.isInFlyout) {
    e.stopPropagation();
    return;
  }
  this.workspace.markFocused();
  // Update Blockly's knowledge of its own location.
  Blockly.svgResize(this.workspace);
  Blockly.terminateDrag_();
  this.select();
  Blockly.hideChaff();
  if (Blockly.isRightButton(e)) {
    // Right-click.
    this.showContextMenu_(e);
  } else if (!this.isMovable()) {
    // Allow unmovable blocks to be selected and context menued, but not
    // dragged.  Let this event bubble up to document, so the workspace may be
    // dragged instead.
    return;
  } else {
    // Left-click (or middle click)
    Blockly.removeAllRanges();
    Blockly.Css.setCursor(Blockly.Css.Cursor.CLOSED);

    this.dragStartXY_ = this.getRelativeToSurfaceXY();
    this.workspace.startDrag(e, this.dragStartXY_.x, this.dragStartXY_.y);

    Blockly.dragMode_ = 1;
    Blockly.BlockSvg.onMouseUpWrapper_ = Blockly.bindEvent_(document,
        'mouseup', this, this.onMouseUp_);
    Blockly.BlockSvg.onMouseMoveWrapper_ = Blockly.bindEvent_(document,
        'mousemove', this, this.onMouseMove_);
    // Build a list of bubbles that need to be moved and where they started.
    this.draggedBubbles_ = [];
    var descendants = this.getDescendants();
    for (var i = 0, descendant; descendant = descendants[i]; i++) {
      var icons = descendant.getIcons();
      for (var j = 0; j < icons.length; j++) {
        var data = icons[j].getIconLocation();
        data.bubble = icons[j];
        this.draggedBubbles_.push(data);
      }
    }
  }
  // This event has been handled.  No need to bubble up to the document.
  e.stopPropagation();
};

/**
 * Handle a mouse-up anywhere in the SVG pane.  Is only registered when a
 * block is clicked.  We can't use mouseUp on the block since a fast-moving
 * cursor can briefly escape the block before it catches up.
 * @param {!Event} e Mouse up event.
 * @private
 */
Blockly.BlockSvg.prototype.onMouseUp_ = function(e) {
  Blockly.terminateDrag_();
  if (Blockly.selected && Blockly.highlightedConnection_) {
    // Connect two blocks together.
    Blockly.localConnection_.connect(Blockly.highlightedConnection_);
    if (this.rendered) {
      // Trigger a connection animation.
      // Determine which connection is inferior (lower in the source stack).
      var inferiorConnection;
      if (Blockly.localConnection_.isSuperior()) {
        inferiorConnection = Blockly.highlightedConnection_;
      } else {
        inferiorConnection = Blockly.localConnection_;
      }
      inferiorConnection.sourceBlock_.connectionUiEffect();
    }
    if (this.workspace.trashcan) {
      // Don't throw an object in the trash can if it just got connected.
      this.workspace.trashcan.close();
    }
  } else if (!this.getParent() && Blockly.selected.isDeletable() &&
      this.workspace.isDeleteArea(e)) {
    var trashcan = this.workspace.trashcan;
    if (trashcan) {
      goog.Timer.callOnce(trashcan.close, 100, trashcan);
    }
    Blockly.selected.dispose(false, true);
    // Dropping a block on the trash can will usually cause the workspace to
    // resize to contain the newly positioned block.  Force a second resize
    // now that the block has been deleted.
    Blockly.fireUiEvent(window, 'resize');
  }
  if (Blockly.highlightedConnection_) {
    Blockly.highlightedConnection_.unhighlight();
    Blockly.highlightedConnection_ = null;
  }
  Blockly.Css.setCursor(Blockly.Css.Cursor.OPEN);
};

/**
 * Load the block's help page in a new window.
 * @private
 */
Blockly.BlockSvg.prototype.showHelp_ = function() {
  var url = goog.isFunction(this.helpUrl) ? this.helpUrl() : this.helpUrl;
  if (url) {
    // @todo rewrite
    alert(url);
  }
};

/**
 * Show the context menu for this block.
 * @param {!Event} e Mouse event.
 * @private
 */
Blockly.BlockSvg.prototype.showContextMenu_ = function(e) {
  if (this.workspace.options.readOnly || !this.contextMenu) {
    return;
  }
  // Save the current block in a variable for use in closures.
  var block = this;
  var menuOptions = [];

  if (this.isDeletable() && this.isMovable() && !block.isInFlyout) {
    // Option to duplicate this block.
    var duplicateOption = {
      text: Blockly.Msg.DUPLICATE_BLOCK,
      enabled: true,
      callback: function() {
        Blockly.duplicate_(block);
      }
    };
    if (this.getDescendants().length > this.workspace.remainingCapacity()) {
      duplicateOption.enabled = false;
    }
    menuOptions.push(duplicateOption);

    if (this.isEditable() && this.workspace.options.comments) {
      // Option to add/remove a comment.
      var commentOption = {enabled: !goog.userAgent.IE};
      if (this.comment) {
        commentOption.text = Blockly.Msg.REMOVE_COMMENT;
        commentOption.callback = function() {
          block.setCommentText(null);
        };
      } else {
        commentOption.text = Blockly.Msg.ADD_COMMENT;
        commentOption.callback = function() {
          block.setCommentText('');
        };
      }
      menuOptions.push(commentOption);
    }

    // Option to delete this block.
    // Count the number of blocks that are nested in this block.
    var descendantCount = this.getDescendants().length;
    var nextBlock = this.getNextBlock();
    if (nextBlock) {
      // Blocks in the current stack would survive this block's deletion.
      descendantCount -= nextBlock.getDescendants().length;
    }
    var deleteOption = {
      text: descendantCount == 1 ? Blockly.Msg.DELETE_BLOCK :
          Blockly.Msg.DELETE_X_BLOCKS.replace('%1', String(descendantCount)),
      enabled: true,
      callback: function() {
        block.dispose(true, true);
      }
    };
    menuOptions.push(deleteOption);
  }

  // Option to get help.
  var url = goog.isFunction(this.helpUrl) ? this.helpUrl() : this.helpUrl;
  var helpOption = {enabled: !!url};
  helpOption.text = Blockly.Msg.HELP;
  helpOption.callback = function() {
    block.showHelp_();
  };
  menuOptions.push(helpOption);

  // Allow the block to add or modify menuOptions.
  if (this.customContextMenu && !block.isInFlyout) {
    this.customContextMenu(menuOptions);
  }

  Blockly.ContextMenu.show(e, menuOptions, this.RTL);
  Blockly.ContextMenu.currentBlock = this;
};

/**
 * Move the connections for this block and all blocks attached under it.
 * Also update any attached bubbles.
 * @param {number} dx Horizontal offset from current location.
 * @param {number} dy Vertical offset from current location.
 * @private
 */
Blockly.BlockSvg.prototype.moveConnections_ = function(dx, dy) {
  if (!this.rendered) {
    // Rendering is required to lay out the blocks.
    // This is probably an invisible block attached to a collapsed block.
    return;
  }
  var myConnections = this.getConnections_(false);
  for (var i = 0; i < myConnections.length; i++) {
    myConnections[i].moveBy(dx, dy);
  }
  var icons = this.getIcons();
  for (var i = 0; i < icons.length; i++) {
    icons[i].computeIconLocation();
  }

  // Recurse through all blocks attached under this one.
  for (var i = 0; i < this.childBlocks_.length; i++) {
    this.childBlocks_[i].moveConnections_(dx, dy);
  }
};

/**
 * Recursively adds or removes the dragging class to this node and its children.
 * @param {boolean} adding True if adding, false if removing.
 * @private
 */
Blockly.BlockSvg.prototype.setDragging_ = function(adding) {
  if (adding) {
    this.addDragging();
  } else {
    this.removeDragging();
  }
  // Recurse through all blocks attached under this one.
  for (var i = 0; i < this.childBlocks_.length; i++) {
    this.childBlocks_[i].setDragging_(adding);
  }
};

/**
 * Drag this block to follow the mouse.
 * @param {!Event} e Mouse move event.
 * @private
 */
Blockly.BlockSvg.prototype.onMouseMove_ = function(e) {
  if (e.type == 'mousemove' && e.clientX <= 1 && e.clientY == 0 &&
      e.button == 0) {
    /* HACK:
     Safari Mobile 6.0 and Chrome for Android 18.0 fire rogue mousemove
     events on certain touch actions. Ignore events with these signatures.
     This may result in a one-pixel blind spot in other browsers,
     but this shouldn't be noticeable. */
    e.stopPropagation();
    return;
  }
  Blockly.removeAllRanges();

  var oldXY = this.getRelativeToSurfaceXY();
  var newXY = this.workspace.moveDrag(e);

  var group = this.getSvgRoot();
  if (Blockly.dragMode_ == 1) {
    // Still dragging within the sticky DRAG_RADIUS.
    var dr = goog.math.Coordinate.distance(oldXY, newXY) * this.workspace.scale;
    if (dr > Blockly.DRAG_RADIUS) {
      // Switch to unrestricted dragging.
      Blockly.dragMode_ = 2;
      Blockly.longStop_();
      group.translate_ = '';
      group.skew_ = '';
      if (this.parentBlock_) {
        // Push this block to the very top of the stack.
        this.setParent(null);
        this.disconnectUiEffect();
      }
      this.setDragging_(true);
      this.workspace.recordDeleteAreas();
    }
  }
  if (Blockly.dragMode_ == 2) {
    // Unrestricted dragging.
    var dx = oldXY.x - this.dragStartXY_.x;
    var dy = oldXY.y - this.dragStartXY_.y;
    group.translate_ = 'translate(' + newXY.x + ',' + newXY.y + ')';
    group.setAttribute('transform', group.translate_ + group.skew_);
    // Drag all the nested bubbles.
    for (var i = 0; i < this.draggedBubbles_.length; i++) {
      var commentData = this.draggedBubbles_[i];
      commentData.bubble.setIconLocation(commentData.x + dx,
          commentData.y + dy);
    }

    // Check to see if any of this block's connections are within range of
    // another block's connection.
    var myConnections = this.getConnections_(false);
    var closestConnection = null;
    var localConnection = null;
    var radiusConnection = Blockly.SNAP_RADIUS;
    for (var i = 0; i < myConnections.length; i++) {
      var myConnection = myConnections[i];
      var neighbour = myConnection.closest(radiusConnection, dx, dy);
      if (neighbour.connection) {
        closestConnection = neighbour.connection;
        localConnection = myConnection;
        radiusConnection = neighbour.radius;
      }
    }

    // Remove connection highlighting if needed.
    if (Blockly.highlightedConnection_ &&
        Blockly.highlightedConnection_ != closestConnection) {
      Blockly.highlightedConnection_.unhighlight();
      Blockly.highlightedConnection_ = null;
      Blockly.localConnection_ = null;
    }
    // Add connection highlighting if needed.
    if (closestConnection &&
        closestConnection != Blockly.highlightedConnection_) {
      closestConnection.highlight();
      Blockly.highlightedConnection_ = closestConnection;
      Blockly.localConnection_ = localConnection;
    }
    // Provide visual indication of whether the block will be deleted if
    // dropped here.
    if (this.isDeletable()) {
      this.workspace.isDeleteArea(e);
    }
  }
  // This event has been handled.  No need to bubble up to the document.
  e.stopPropagation();
};

/**
 * Add or remove the UI indicating if this block is movable or not.
 */
Blockly.BlockSvg.prototype.updateMovable = function() {
  if (this.isMovable()) {
    Blockly.addClass_(/** @type {!Element} */ (this.svgGroup_),
                      'blocklyDraggable');
  } else {
    Blockly.removeClass_(/** @type {!Element} */ (this.svgGroup_),
                         'blocklyDraggable');
  }
};

/**
 * Set whether this block is movable or not.
 * @param {boolean} movable True if movable.
 */
Blockly.BlockSvg.prototype.setMovable = function(movable) {
  Blockly.BlockSvg.superClass_.setMovable.call(this, movable);
  this.updateMovable();
};

/**
 * Set whether this block is editable or not.
 * @param {boolean} movable True if editable.
 */
Blockly.BlockSvg.prototype.setEditable = function(editable) {
  Blockly.BlockSvg.superClass_.setEditable.call(this, editable);
  if (this.rendered) {
    for (var i = 0; i < this.icons_.length; i++) {
      this.icons_[i].updateEditable();
    }
  }
};

/**
 * Set whether this block is a shadow block or not.
 * @param {boolean} shadow True if a shadow.
 */
Blockly.BlockSvg.prototype.setShadow = function(shadow) {
  Blockly.BlockSvg.superClass_.setShadow.call(this, shadow);
  this.updateColour();
};

/**
 * Return the root node of the SVG or null if none exists.
 * @return {Element} The root SVG node (probably a group).
 */
Blockly.BlockSvg.prototype.getSvgRoot = function() {
  return this.svgGroup_;
};

// UI constants for rendering blocks.
/**
 * Horizontal space between elements.
 * @const
 */
Blockly.BlockSvg.SEP_SPACE_X = 8;
/**
 * Vertical space between elements.
 * @const
 */
Blockly.BlockSvg.SEP_SPACE_Y = 8;
/**
 * Vertical padding around inline elements.
 * @const
 */
Blockly.BlockSvg.INLINE_PADDING_Y = 5;
/**
 * Minimum height of a block.
 * @const
 */
Blockly.BlockSvg.MIN_BLOCK_Y = 25;
/**
 * Width of horizontal puzzle tab.
 * @const
 */
Blockly.BlockSvg.TAB_WIDTH = 8;
/**
 * Width of vertical tab (inc left margin).
 * @const
 */
Blockly.BlockSvg.NOTCH_HEIGHT = 32;
/**
 * Rounded corner radius.
 * @const
 */
Blockly.BlockSvg.CORNER_RADIUS = 4;
/**
 * Rounded corner radius.
 * @const
 */
Blockly.BlockSvg.HAT_CORNER_RADIUS = 16;
/**
 * SVG path for drawing next/previous notch from left to right.
 * @const
 */
Blockly.BlockSvg.NOTCH_PATH_DOWN = 'l 8,8 0,16 -8,8';
/**
 * SVG path for drawing next/previous notch from right to left.
 * @const
 */
Blockly.BlockSvg.NOTCH_PATH_UP = 'l 8,-8 0,-16 -8,-8';
/**
 * SVG path for drawing a horizontal puzzle tab from top to bottom.
 * @const
 */
Blockly.BlockSvg.TAB_PATH_DOWN = 'v 5 c 0,10 -' + Blockly.BlockSvg.TAB_WIDTH +
    ',-8 -' + Blockly.BlockSvg.TAB_WIDTH + ',7.5 s ' +
    Blockly.BlockSvg.TAB_WIDTH + ',-2.5 ' + Blockly.BlockSvg.TAB_WIDTH + ',7.5';
/**
 * SVG start point for drawing the top-left corner.
 * @const
 */
Blockly.BlockSvg.TOP_LEFT_CORNER_START =
    'm ' + Blockly.BlockSvg.CORNER_RADIUS + ',0';
/**
 * SVG path for drawing the rounded top-left corner.
 * @const
 */
Blockly.BlockSvg.TOP_LEFT_CORNER =
    'A ' + Blockly.BlockSvg.CORNER_RADIUS + ',' +
    Blockly.BlockSvg.CORNER_RADIUS + ' 0 0,0 ' +
    '0,' + Blockly.BlockSvg.CORNER_RADIUS;
/**
 * SVG start point for drawing the top-left corner.
 * @const
 */
Blockly.BlockSvg.HAT_TOP_LEFT_CORNER_START =
    'm ' + Blockly.BlockSvg.HAT_CORNER_RADIUS + ',0';
/**
 * SVG path for drawing the rounded top-left corner.
 * @const
 */
Blockly.BlockSvg.HAT_TOP_LEFT_CORNER =
    'A ' + Blockly.BlockSvg.HAT_CORNER_RADIUS + ',' +
    Blockly.BlockSvg.HAT_CORNER_RADIUS + ' 0 0,0 ' +
    '0,' + Blockly.BlockSvg.HAT_CORNER_RADIUS;
/**
 * SVG path for drawing the top-left corner of a statement input.
 * Includes the top notch, a horizontal space, and the rounded inside corner.
 * @const
 */
Blockly.BlockSvg.INNER_TOP_LEFT_CORNER =
    Blockly.BlockSvg.NOTCH_PATH_UP + ' h -' +
    (Blockly.BlockSvg.NOTCH_HEIGHT - 15 - Blockly.BlockSvg.CORNER_RADIUS) +
    ' h -0.5 a ' + Blockly.BlockSvg.CORNER_RADIUS + ',' +
    Blockly.BlockSvg.CORNER_RADIUS + ' 0 0,0 -' +
    Blockly.BlockSvg.CORNER_RADIUS + ',' +
    Blockly.BlockSvg.CORNER_RADIUS;
/**
 * SVG path for drawing the bottom-left corner of a statement input.
 * Includes the rounded inside corner.
 * @const
 */
Blockly.BlockSvg.INNER_BOTTOM_LEFT_CORNER =
    'a ' + Blockly.BlockSvg.CORNER_RADIUS + ',' +
    Blockly.BlockSvg.CORNER_RADIUS + ' 0 0,0 ' +
    Blockly.BlockSvg.CORNER_RADIUS + ',' +
    Blockly.BlockSvg.CORNER_RADIUS;

/**
 * Dispose of this block.
 * @param {boolean} healStack If true, then try to heal any gap by connecting
 *     the next statement with the previous statement.  Otherwise, dispose of
 *     all children of this block.
 * @param {boolean} animate If true, show a disposal animation and sound.
 * @param {boolean=} opt_dontRemoveFromWorkspace If true, don't remove this
 *     block from the workspace's list of top blocks.
 */
Blockly.BlockSvg.prototype.dispose = function(healStack, animate,
                                              opt_dontRemoveFromWorkspace) {
  Blockly.Field.startCache();
  // Terminate onchange event calls.
  if (this.onchangeWrapper_) {
    Blockly.unbindEvent_(this.onchangeWrapper_);
    this.onchangeWrapper_ = null;
  }
  // If this block is being dragged, unlink the mouse events.
  if (Blockly.selected == this) {
    Blockly.terminateDrag_();
  }
  // If this block has a context menu open, close it.
  if (Blockly.ContextMenu.currentBlock == this) {
    Blockly.ContextMenu.hide();
  }

  if (animate && this.rendered) {
    this.unplug(healStack, false);
    this.disposeUiEffect();
  }
  // Stop rerendering.
  this.rendered = false;

  var icons = this.getIcons();
  for (var i = 0; i < icons.length; i++) {
    icons[i].dispose();
  }

  Blockly.BlockSvg.superClass_.dispose.call(this, healStack);

  goog.dom.removeNode(this.svgGroup_);
  // Sever JavaScript to DOM connections.
  this.svgGroup_ = null;
  this.svgPath_ = null;
  Blockly.Field.stopCache();
};

/**
 * Play some UI effects (sound, animation) when disposing of a block.
 */
Blockly.BlockSvg.prototype.disposeUiEffect = function() {
  this.workspace.playAudio('delete');

  var xy = Blockly.getSvgXY_(/** @type {!Element} */ (this.svgGroup_),
                             this.workspace);
  // Deeply clone the current block.
  var clone = this.svgGroup_.cloneNode(true);
  clone.translateX_ = xy.x;
  clone.translateY_ = xy.y;
  clone.setAttribute('transform',
      'translate(' + clone.translateX_ + ',' + clone.translateY_ + ')');
  this.workspace.getParentSvg().appendChild(clone);
  clone.bBox_ = clone.getBBox();
  // Start the animation.
  Blockly.BlockSvg.disposeUiStep_(clone, this.RTL, new Date(),
      this.workspace.scale);
};

/**
 * Animate a cloned block and eventually dispose of it.
 * This is a class method, not an instace method since the original block has
 * been destroyed and is no longer accessible.
 * @param {!Element} clone SVG element to animate and dispose of.
 * @param {boolean} rtl True if RTL, false if LTR.
 * @param {!Date} start Date of animation's start.
 * @param {number} workspaceScale Scale of workspace.
 * @private
 */
Blockly.BlockSvg.disposeUiStep_ = function(clone, rtl, start, workspaceScale) {
  var ms = (new Date()) - start;
  var percent = ms / 150;
  if (percent > 1) {
    goog.dom.removeNode(clone);
  } else {
    var x = clone.translateX_ +
        (rtl ? -1 : 1) * clone.bBox_.width * workspaceScale / 2 * percent;
    var y = clone.translateY_ + clone.bBox_.height * workspaceScale * percent;
    var scale = (1 - percent) * workspaceScale;
    clone.setAttribute('transform', 'translate(' + x + ',' + y + ')' +
        ' scale(' + scale + ')');
    var closure = function() {
      Blockly.BlockSvg.disposeUiStep_(clone, rtl, start, workspaceScale);
    };
    setTimeout(closure, 10);
  }
};

/**
 * Play some UI effects (sound, ripple) after a connection has been established.
 */
Blockly.BlockSvg.prototype.connectionUiEffect = function() {
  this.workspace.playAudio('click');
  if (this.workspace.scale < 1) {
    return;  // Too small to care about visual effects.
  }
  // Determine the absolute coordinates of the inferior block.
  var xy = Blockly.getSvgXY_(/** @type {!Element} */ (this.svgGroup_),
                             this.workspace);
  // Offset the coordinates based on the two connection types, fix scale.
  xy.x += 8 * this.workspace.scale;
  xy.y += this.height - (Blockly.BlockSvg.CORNER_RADIUS * 2 + Blockly.BlockSvg.NOTCH_HEIGHT / 2) - 8 * this.workspace.scale;

  var ripple = Blockly.createSvgElement('circle',
      {'cx': xy.x, 'cy': xy.y, 'r': 0, 'fill': 'none',
       'stroke': '#EEE', 'stroke-width': 8},
      this.workspace.getParentSvg());

  // Start the animation.
  Blockly.BlockSvg.connectionUiStep_(ripple, new Date(), this.workspace.scale);
};

/**
 * Expand a ripple around a connection.
 * @param {!Element} ripple Element to animate.
 * @param {!Date} start Date of animation's start.
 * @param {number} workspaceScale Scale of workspace.
 * @private
 */
Blockly.BlockSvg.connectionUiStep_ = function(ripple, start, workspaceScale) {
  var ms = (new Date()) - start;
  var percent = ms / 150;
  if (percent > 1) {
    goog.dom.removeNode(ripple);
  } else {
    ripple.setAttribute('r', percent * 25 * workspaceScale);
    ripple.style.opacity = 0.8 - percent;
    var closure = function() {
      Blockly.BlockSvg.connectionUiStep_(ripple, start, workspaceScale);
    };
    Blockly.BlockSvg.disconnectUiStop_.pid_ = setTimeout(closure, 10);
  }
};

/**
 * Play some UI effects (sound, animation) when disconnecting a block.
 */
Blockly.BlockSvg.prototype.disconnectUiEffect = function() {
  this.workspace.playAudio('disconnect');
  if (this.workspace.scale < 1) {
    return;  // Too small to care about visual effects.
  }
  // Horizontal distance for bottom of block to wiggle.
  var DISPLACEMENT = 10;
  // Scale magnitude of skew to height of block.
  var height = this.getHeightWidth().height;
  var magnitude = Math.atan(DISPLACEMENT / height) / Math.PI * 180;
  if (!this.RTL) {
    magnitude *= -1;
  }
  // Start the animation.
  Blockly.BlockSvg.disconnectUiStep_(this.svgGroup_, magnitude, new Date());
};

/**
 * Animate a brief wiggle of a disconnected block.
 * @param {!Element} group SVG element to animate.
 * @param {number} magnitude Maximum degrees skew (reversed for RTL).
 * @param {!Date} start Date of animation's start.
 * @private
 */
Blockly.BlockSvg.disconnectUiStep_ = function(group, magnitude, start) {
  var DURATION = 200;  // Milliseconds.
  var WIGGLES = 3;  // Half oscillations.

  var ms = (new Date()) - start;
  var percent = ms / DURATION;

  if (percent > 1) {
    group.skew_ = '';
  } else {
    var skew = Math.round(Math.sin(percent * Math.PI * WIGGLES) *
        (1 - percent) * magnitude);
    group.skew_ = 'skewX(' + skew + ')';
    var closure = function() {
      Blockly.BlockSvg.disconnectUiStep_(group, magnitude, start);
    };
    Blockly.BlockSvg.disconnectUiStop_.group = group;
    Blockly.BlockSvg.disconnectUiStop_.pid = setTimeout(closure, 10);
  }
  group.setAttribute('transform', group.translate_ + group.skew_);
};

/**
 * Stop the disconnect UI animation immediately.
 * @private
 */
Blockly.BlockSvg.disconnectUiStop_ = function() {
  if (Blockly.BlockSvg.disconnectUiStop_.group) {
    clearTimeout(Blockly.BlockSvg.disconnectUiStop_.pid);
    var group = Blockly.BlockSvg.disconnectUiStop_.group
    group.skew_ = '';
    group.setAttribute('transform', group.translate_);
    Blockly.BlockSvg.disconnectUiStop_.group = null;
  }
};

/**
 * PID of disconnect UI animation.  There can only be one at a time.
 * @type {number}
 */
Blockly.BlockSvg.disconnectUiStop_.pid = 0;

/**
 * SVG group of wobbling block.  There can only be one at a time.
 * @type {Element}
 */
Blockly.BlockSvg.disconnectUiStop_.group = null;

/**
 * Change the colour of a block.
 */
Blockly.BlockSvg.prototype.updateColour = function() {
  // Render block fill
  var hexColour = this.getColour();
  var rgb = goog.color.hexToRgb(hexColour);
  if (this.isShadow()) {
    rgb = goog.color.lighten(rgb, 0.6);
    hexColour = goog.color.rgbArrayToHex(rgb);
  }
  this.svgPath_.setAttribute('fill', hexColour);

  // Render block stroke
  var colorShift = goog.color.darken(rgb, 0.1);
  var strokeColor = goog.color.rgbArrayToHex(colorShift);
  this.svgPath_.setAttribute('stroke', strokeColor);

  // Bump every dropdown to change its colour.
  for (var x = 0, input; input = this.inputList[x]; x++) {
    for (var y = 0, field; field = input.fieldRow[y]; y++) {
      field.setText(null);
    }
  }
};

/**
 * Enable or disable a block.
 */
Blockly.BlockSvg.prototype.updateDisabled = function() {
  // not supported
};

/**
 * Returns the comment on this block (or '' if none).
 * @return {string} Block's comment.
 */
Blockly.BlockSvg.prototype.getCommentText = function() {
  if (this.comment) {
    var comment = this.comment.getText();
    // Trim off trailing whitespace.
    return comment.replace(/\s+$/, '').replace(/ +\n/g, '\n');
  }
  return '';
};

/**
 * Set this block's comment text.
 * @param {?string} text The text, or null to delete.
 */
Blockly.BlockSvg.prototype.setCommentText = function(text) {
  var changedState = false;
  if (goog.isString(text)) {
    if (!this.comment) {
      this.comment = new Blockly.Comment(this);
      changedState = true;
    }
    this.comment.setText(/** @type {string} */ (text));
  } else {
    if (this.comment) {
      this.comment.dispose();
      changedState = true;
    }
  }
  if (changedState && this.rendered) {
    this.render();
    // Adding or removing a comment icon will cause the block to change shape.
    this.bumpNeighbours_();
  }
};

/**
 * Set this block's warning text.
 * @param {?string} text The text, or null to delete.
 * @param {string=} opt_id An optional ID for the warning text to be able to
 *     maintain multiple warnings.
 */
Blockly.BlockSvg.prototype.setWarningText = function(text, opt_id) {
  if (!this.setWarningText.pid_) {
    // Create a database of warning PIDs.
    // Only runs once per block (and only those with warnings).
    this.setWarningText.pid_ = Object.create(null);
  }
  var id = opt_id || '';
  if (!id) {
    // Kill all previous pending processes, this edit supercedes them all.
    for (var n in this.setWarningText.pid_) {
      clearTimeout(this.setWarningText.pid_[n]);
      delete this.setWarningText.pid_[n];
    }
  } else if (this.setWarningText.pid_[id]) {
    // Only queue up the latest change.  Kill any earlier pending process.
    clearTimeout(this.setWarningText.pid_[id]);
    delete this.setWarningText.pid_[id];
  }
  if (Blockly.dragMode_ == 2) {
    // Don't change the warning text during a drag.
    // Wait until the drag finishes.
    var thisBlock = this;
    this.setWarningText.pid_[id] = setTimeout(function() {
      if (thisBlock.workspace) {  // Check block wasn't deleted.
        delete thisBlock.setWarningText.pid_[id];
        thisBlock.setWarningText(text, id);
      }
    }, 100);
    return;
  }
  if (this.isInFlyout) {
    text = null;
  }

  var changedState = false;
  if (goog.isString(text)) {
    if (!this.warning) {
      this.warning = new Blockly.Warning(this);
      changedState = true;
    }
    this.warning.setText(/** @type {string} */ (text), id);
  } else {
    // Dispose all warnings if no id is given.
    if (this.warning && !id) {
      this.warning.dispose();
      changedState = true;
    } else if (this.warning) {
      var oldText = this.warning.getText();
      this.warning.setText('', id);
      var newText = this.warning.getText();
      if (!newText) {
        this.warning.dispose();
      }
      changedState = oldText == newText;
    }
  }
  if (changedState && this.rendered) {
    this.render();
    // Adding or removing a warning icon will cause the block to change shape.
    this.bumpNeighbours_();
  }
};

/**
 * Give this block a mutator dialog.
 * @param {Blockly.Mutator} mutator A mutator dialog instance or null to remove.
 */
Blockly.BlockSvg.prototype.setMutator = function(mutator) {
  if (this.mutator && this.mutator !== mutator) {
    this.mutator.dispose();
  }
  if (mutator) {
    mutator.block_ = this;
    this.mutator = mutator;
    mutator.createIcon();
  }
};

/**
 * Select this block.  Highlight it visually.
 */
Blockly.BlockSvg.prototype.addSelect = function() {
  Blockly.addClass_(/** @type {!Element} */ (this.svgGroup_),
                    'blocklySelected');
  // Move the selected block to the top of the stack.
  this.svgGroup_.parentNode.appendChild(this.svgGroup_);
};

/**
 * Unselect this block.  Remove its highlighting.
 */
Blockly.BlockSvg.prototype.removeSelect = function() {
  Blockly.removeClass_(/** @type {!Element} */ (this.svgGroup_),
                       'blocklySelected');
};

/**
 * Adds the dragging class to this block.
 * Also disables the highlights/shadows to improve performance.
 */
Blockly.BlockSvg.prototype.addDragging = function() {
  Blockly.addClass_(/** @type {!Element} */ (this.svgGroup_),
                    'blocklyDragging');
};

/**
 * Removes the dragging class from this block.
 */
Blockly.BlockSvg.prototype.removeDragging = function() {
  Blockly.removeClass_(/** @type {!Element} */ (this.svgGroup_),
                       'blocklyDragging');
};

/**
 * Render the block.
 * Lays out and reflows a block based on its contents and settings.
 * @param {boolean=} opt_bubble If false, just render this block.
 *   If true, also render block's parent, grandparent, etc.  Defaults to true.
 */
Blockly.BlockSvg.prototype.render = function(opt_bubble) {
  Blockly.Field.startCache();
  this.rendered = true;

  var metrics = this.renderCompute_();
  this.renderDraw_(metrics);

  if (opt_bubble !== false) {
    // Render all blocks above this one (propagate a reflow).
    var parentBlock = this.getParent();
    if (parentBlock) {
      parentBlock.render(true);
    } else {
      // Top-most block.  Fire an event to allow scrollbars to resize.
      Blockly.fireUiEvent(window, 'resize');
    }
  }
  Blockly.Field.stopCache();
};

// /**
//  * Render a list of fields starting at the specified location.
//  * @param {!Array.<!Blockly.Field>} fieldList List of fields.
//  * @param {number} cursorX X-coordinate to start the fields.
//  * @param {number} cursorY Y-coordinate to start the fields.
//  * @return {number} X-coordinate of the end of the field row (plus a gap).
//  * @private
//  */
// Blockly.BlockSvg.prototype.renderFields_ =
//     function(fieldList, cursorX, cursorY) {
//
//   var root = metrics.icon.getSvgRoot();
//   root.setAttribute('transform',
//     'translate(' + Blockly.BlockSvg.SEP_SPACE_X + ',' + Blockly.BlockSvg.SEP_SPACE_Y + ')');
//
//   // cursorY += Blockly.BlockSvg.INLINE_PADDING_Y;
//   // if (this.RTL) {
//   //   cursorX = -cursorX;
//   // }
//   // for (var t = 0, field; field = fieldList[t]; t++) {
//   //   var root = field.getSvgRoot();
//   //   if (!root) {
//   //     continue;
//   //   }
//   //   if (this.RTL) {
//   //     cursorX -= field.renderSep + field.renderWidth;
//   //     root.setAttribute('transform',
//   //         'translate(' + cursorX + ',' + cursorY + ')');
//   //     if (field.renderWidth) {
//   //       cursorX -= Blockly.BlockSvg.SEP_SPACE_X;
//   //     }
//   //   } else {
//   //     root.setAttribute('transform',
//   //         'translate(' + (cursorX + field.renderSep) + ',' + cursorY + ')');
//   //     if (field.renderWidth) {
//   //       cursorX += field.renderSep + field.renderWidth +
//   //           Blockly.BlockSvg.SEP_SPACE_X;
//   //     }
//   //   }
//   // }
//   // return this.RTL ? -cursorX : cursorX;
// };

/**
 * Computes the height and widths for each row and field.
 * @param {number} iconWidth Offset of first row due to icons.
 * @return {!Array.<!Array.<!Object>>} 2D array of objects, each containing
 *     position information.
 * @private
 */
Blockly.BlockSvg.prototype.renderCompute_ = function() {
  var metrics = {
    hasStatement: false,
    icon: null,
    width: 0,
    height: 0
  };

  // Does block have a statement?
  for (var i = 0, input; input = this.inputList[i]; i++) {
    if (input.type == Blockly.NEXT_STATEMENT) {
      metrics.hasStatement = true;
    }

    // Find icon
    for (var j = 0, field; field = input.fieldRow[j]; j++) {
      if (field instanceof Blockly.FieldImage) {
        metrics.icon = field;
      }
    }
  }

  var iconSize = (metrics.icon) ? metrics.icon.getSize() : new goog.math.Size(0,0);
  metrics.width = Blockly.BlockSvg.SEP_SPACE_X * 2 + iconSize.width;
  metrics.height = Math.max(
    Blockly.BlockSvg.SEP_SPACE_Y * 2 + iconSize.height,
    Blockly.BlockSvg.NOTCH_HEIGHT + 16 + Blockly.BlockSvg.CORNER_RADIUS * 2
  );

  return metrics;

  // var inputList = this.inputList;
  // var inputRows = [];
  // inputRows.rightEdge = iconWidth + Blockly.BlockSvg.SEP_SPACE_X * 2;
  // if (this.previousConnection || this.nextConnection) {
  //   inputRows.rightEdge = Math.max(inputRows.rightEdge,
  //       Blockly.BlockSvg.NOTCH_HEIGHT + Blockly.BlockSvg.SEP_SPACE_X);
  // }
  // var fieldValueWidth = 0;  // Width of longest external value field.
  // var fieldStatementWidth = 0;  // Width of longest statement field.
  // var hasValue = false;
  // var hasStatement = false;
  // var hasDummy = false;
  // var lastType = undefined;
  //
  // for (var i = 0, input; input = inputList[i]; i++) {
  //   if (!input.isVisible()) {
  //     continue;
  //   }
  //   var row;
  //   if (!lastType ||
  //       lastType == Blockly.NEXT_STATEMENT ||
  //       input.type == Blockly.NEXT_STATEMENT) {
  //     // Create new row.
  //     lastType = input.type;
  //     row = [];
  //     if (input.type != Blockly.NEXT_STATEMENT) {
  //       row.type = Blockly.BlockSvg.INLINE;
  //     } else {
  //       row.type = input.type;
  //     }
  //     row.height = 0;
  //     inputRows.push(row);
  //   } else {
  //     row = inputRows[inputRows.length - 1];
  //   }
  //   row.push(input);
  //
  //   // Compute minimum input size.
  //   input.renderHeight = Blockly.BlockSvg.MIN_BLOCK_Y;
  //   // The width is currently only needed for inline value inputs.
  //   if (input.type == Blockly.INPUT_VALUE) {
  //     input.renderWidth = Blockly.BlockSvg.TAB_WIDTH +
  //         Blockly.BlockSvg.SEP_SPACE_X * 1.25;
  //   } else {
  //     input.renderWidth = 0;
  //   }
  //   // Expand input size if there is a connection.
  //   if (input.connection && input.connection.targetConnection) {
  //     var linkedBlock = input.connection.targetBlock();
  //     var bBox = linkedBlock.getHeightWidth();
  //     input.renderHeight = Math.max(input.renderHeight, bBox.height);
  //     input.renderWidth = Math.max(input.renderWidth, bBox.width);
  //   }
  //   // Blocks have a one pixel shadow that should sometimes overhang.
  //   if (i == inputList.length - 1) {
  //     // Last value input should overhang.
  //     input.renderHeight--;
  //   } else if (input.type == Blockly.INPUT_VALUE &&
  //       inputList[i + 1] && inputList[i + 1].type == Blockly.NEXT_STATEMENT) {
  //     // Value input above statement input should overhang.
  //     input.renderHeight--;
  //   }
  //
  //   row.height = Math.max(row.height, input.renderHeight);
  //   input.fieldWidth = 0;
  //   if (inputRows.length == 1) {
  //     // The first row gets shifted to accommodate any icons.
  //     input.fieldWidth += this.RTL ? -iconWidth : iconWidth;
  //   }
  //   var previousFieldEditable = false;
  //   for (var j = 0, field; field = input.fieldRow[j]; j++) {
  //     if (j != 0) {
  //       input.fieldWidth += Blockly.BlockSvg.SEP_SPACE_X;
  //     }
  //     // Get the dimensions of the field.
  //     var fieldSize = field.getSize();
  //     field.renderWidth = fieldSize.width;
  //     field.renderSep = (previousFieldEditable && field.EDITABLE) ?
  //         Blockly.BlockSvg.SEP_SPACE_X : 0;
  //     input.fieldWidth += field.renderWidth + field.renderSep;
  //     row.height = Math.max(row.height, fieldSize.height);
  //     previousFieldEditable = field.EDITABLE;
  //   }
  //
  //   if (row.type != Blockly.BlockSvg.INLINE) {
  //     if (row.type == Blockly.NEXT_STATEMENT) {
  //       hasStatement = true;
  //       fieldStatementWidth = Math.max(fieldStatementWidth, input.fieldWidth);
  //     } else {
  //       if (row.type == Blockly.INPUT_VALUE) {
  //         hasValue = true;
  //       } else if (row.type == Blockly.DUMMY_INPUT) {
  //         hasDummy = true;
  //       }
  //       fieldValueWidth = Math.max(fieldValueWidth, input.fieldWidth);
  //     }
  //   }
  // }
  //
  // // Make inline rows a bit thicker in order to enclose the values.
  // for (var y = 0, row; row = inputRows[y]; y++) {
  //   row.thicker = false;
  //   if (row.type == Blockly.BlockSvg.INLINE) {
  //     for (var z = 0, input; input = row[z]; z++) {
  //       if (input.type == Blockly.INPUT_VALUE) {
  //         row.height += 2 * Blockly.BlockSvg.INLINE_PADDING_Y;
  //         row.thicker = true;
  //         break;
  //       }
  //     }
  //   }
  // }
  //
  // // Compute the statement edge.
  // // This is the width of a block where statements are nested.
  // inputRows.statementEdge = 2 * Blockly.BlockSvg.SEP_SPACE_X +
  //     fieldStatementWidth;
  // // Compute the preferred right edge.  Inline blocks may extend beyond.
  // // This is the width of the block where external inputs connect.
  // if (hasStatement) {
  //   inputRows.rightEdge = Math.max(inputRows.rightEdge,
  //       inputRows.statementEdge + Blockly.BlockSvg.NOTCH_HEIGHT);
  // }
  // if (hasValue) {
  //   inputRows.rightEdge = Math.max(inputRows.rightEdge, fieldValueWidth +
  //       Blockly.BlockSvg.SEP_SPACE_X * 2 + Blockly.BlockSvg.TAB_WIDTH);
  // } else if (hasDummy) {
  //   inputRows.rightEdge = Math.max(inputRows.rightEdge, fieldValueWidth +
  //       Blockly.BlockSvg.SEP_SPACE_X * 2);
  // }
  //
  // inputRows.hasValue = hasValue;
  // inputRows.hasStatement = hasStatement;
  // inputRows.hasDummy = hasDummy;
  // return inputRows;
};


/**
 * Draw the path of the block.
 * Move the fields to the correct locations.
 * @param {number} iconWidth Offset of first row due to icons.
 * @param {!Array.<!Array.<!Object>>} inputRows 2D array of objects, each
 *     containing position information.
 * @private
 */
Blockly.BlockSvg.prototype.renderDraw_ = function(metrics) {
  // Fetch the block's coordinates on the surface for use in anchoring
  // the connections.
  var connectionsXY = this.getRelativeToSurfaceXY();

  // Assemble the block's path.
  var steps = [];

  this.renderDrawLeft_(steps, connectionsXY, metrics);
  this.renderDrawBottom_(steps, connectionsXY, metrics);
  this.renderDrawRight_(steps, connectionsXY, metrics);
  this.renderDrawTop_(steps, connectionsXY, metrics);

  var pathString = steps.join(' ');
  this.svgPath_.setAttribute('d', pathString);

  if (this.RTL) {
    // Mirror the block's path.
    // This is awesome.
    this.svgPath_.setAttribute('transform', 'scale(-1 1)');
  }

  // Position icon
  if (metrics.icon) {
    var icon = metrics.icon.getSvgRoot();
    icon.setAttribute('transform',
      'translate(' + (metrics.width - metrics.icon.getSize().width - Blockly.BlockSvg.SEP_SPACE_X / 2) + ',' + Blockly.BlockSvg.SEP_SPACE_Y + ')');
    // @todo RTL
  }
};

/**
 * Render the left edge of the block.
 * @param {!Array.<string>} steps Path of block outline.
 * @param {!Object} connectionsXY Location of block.
 * @param {number} rightEdge Minimum width of block.
 * @private
 */
Blockly.BlockSvg.prototype.renderDrawLeft_ =
    function(steps, connectionsXY, metrics) {

  // Top edge.
  if (this.previousConnection) {
    // Position the cursor at the top-left starting point.
    steps.push(Blockly.BlockSvg.TOP_LEFT_CORNER_START);
    // Top-left rounded corner.
    steps.push(Blockly.BlockSvg.TOP_LEFT_CORNER);
    var cursorY = metrics.height - Blockly.BlockSvg.CORNER_RADIUS - 8 - Blockly.BlockSvg.NOTCH_HEIGHT;
    steps.push('V', cursorY);
    steps.push(Blockly.BlockSvg.NOTCH_PATH_DOWN);
    // Create previous block connection.
    var connectionX = connectionsXY.x;
    var connectionY = connectionsXY.y + metrics.height - Blockly.BlockSvg.CORNER_RADIUS * 2;
    this.previousConnection.moveTo(connectionX, connectionY);
    // This connection will be tightened when the parent renders.
    steps.push('V', metrics.height - Blockly.BlockSvg.CORNER_RADIUS);
  } else {
    // Position the cursor at the top-left starting point.
    steps.push(Blockly.BlockSvg.HAT_TOP_LEFT_CORNER_START);
    // Top-left rounded corner.
    steps.push(Blockly.BlockSvg.HAT_TOP_LEFT_CORNER);
    steps.push('V', metrics.height - Blockly.BlockSvg.HAT_CORNER_RADIUS);    
  }
  this.height = metrics.height;
};

/**
 * Render the bottom edge of the block.
 * @param {!Array.<string>} steps Path of block outline.
 * @param {!Object} connectionsXY Location of block.
 * @param {!Array.<!Array.<!Object>>} inputRows 2D array of objects, each
 *     containing position information.
 * @param {number} iconWidth Offset of first row due to icons.
 * @return {number} Height of block.
 * @private
 */
Blockly.BlockSvg.prototype.renderDrawBottom_ = function(steps,
    connectionsXY, metrics) {

  if (this.previousConnection) {
    steps.push('a', Blockly.BlockSvg.CORNER_RADIUS + ',' +
               Blockly.BlockSvg.CORNER_RADIUS + ' 0 0,0 ' +
               Blockly.BlockSvg.CORNER_RADIUS + ',' +
               Blockly.BlockSvg.CORNER_RADIUS);
  } else {
    steps.push('a', Blockly.BlockSvg.HAT_CORNER_RADIUS + ',' +
               Blockly.BlockSvg.HAT_CORNER_RADIUS + ' 0 0,0 ' +
               Blockly.BlockSvg.HAT_CORNER_RADIUS + ',' +
               Blockly.BlockSvg.HAT_CORNER_RADIUS);
  }

  // Has statement
  if (metrics.hasStatement) {
    steps.push('h', 8);
    steps.push('a', Blockly.BlockSvg.CORNER_RADIUS + ',' +
               Blockly.BlockSvg.CORNER_RADIUS + ' 0 0,0 ' +
               Blockly.BlockSvg.CORNER_RADIUS + ',-' +
               Blockly.BlockSvg.CORNER_RADIUS);
    steps.push('v', -8);
    steps.push(Blockly.BlockSvg.NOTCH_PATH_UP);
    steps.push('v', -50 + (Blockly.BlockSvg.CORNER_RADIUS * 2) + Blockly.BlockSvg.NOTCH_HEIGHT + 8);
    steps.push('a', Blockly.BlockSvg.CORNER_RADIUS + ',' +
               Blockly.BlockSvg.CORNER_RADIUS + ' 0 0,1 ' +
               Blockly.BlockSvg.CORNER_RADIUS + ',-' +
               Blockly.BlockSvg.CORNER_RADIUS);
    steps.push('h', 20 - (Blockly.BlockSvg.CORNER_RADIUS * 2));
    steps.push('a', Blockly.BlockSvg.CORNER_RADIUS + ',' +
               Blockly.BlockSvg.CORNER_RADIUS + ' 0 0,1 ' +
               Blockly.BlockSvg.CORNER_RADIUS + ',' +
               Blockly.BlockSvg.CORNER_RADIUS);
    steps.push('v', 50 - (Blockly.BlockSvg.CORNER_RADIUS * 2) - Blockly.BlockSvg.NOTCH_HEIGHT - 8);
    steps.push(Blockly.BlockSvg.NOTCH_PATH_DOWN);
    steps.push('v', 8);
    steps.push('a', Blockly.BlockSvg.CORNER_RADIUS + ',' +
               Blockly.BlockSvg.CORNER_RADIUS + ' 0 0,0 ' +
               Blockly.BlockSvg.CORNER_RADIUS + ',' +
               Blockly.BlockSvg.CORNER_RADIUS);

    // // Nested statement.
    // var input = row[0];
    // if (y == 0) {
    //   // If the first input is a statement stack, add a small row on top.
    //   steps.push('v', Blockly.BlockSvg.SEP_SPACE_Y);
    //   cursorY += Blockly.BlockSvg.SEP_SPACE_Y;
    // }
    // var fieldX = cursorX;
    // var fieldY = cursorY;
    // if (input.align != Blockly.ALIGN_LEFT) {
    //   var fieldRightX = inputRows.statementEdge - input.fieldWidth -
    //       2 * Blockly.BlockSvg.SEP_SPACE_X;
    //   if (input.align == Blockly.ALIGN_RIGHT) {
    //     fieldX += fieldRightX;
    //   } else if (input.align == Blockly.ALIGN_CENTRE) {
    //     fieldX += fieldRightX / 2;
    //   }
    // }
    // this.renderFields_(input.fieldRow, fieldX, fieldY);
    // cursorX = inputRows.statementEdge + Blockly.BlockSvg.NOTCH_HEIGHT;
    // steps.push('H', cursorX);
    // steps.push(Blockly.BlockSvg.INNER_TOP_LEFT_CORNER);
    // steps.push('v', row.height - 2 * Blockly.BlockSvg.CORNER_RADIUS);
    // steps.push(Blockly.BlockSvg.INNER_BOTTOM_LEFT_CORNER);
    // steps.push('H', inputRows.rightEdge);
    //
    // // Create statement connection.
    // connectionX = connectionsXY.x + (this.RTL ? -cursorX : cursorX + 1);
    // connectionY = connectionsXY.y + cursorY + 1;
    // input.connection.moveTo(connectionX, connectionY);
    // if (input.connection.targetConnection) {
    //   input.connection.tighten_();
    //   this.width = Math.max(this.width, inputRows.statementEdge +
    //       input.connection.targetBlock().getHeightWidth().width);
    // }
    // if (y == inputRows.length - 1 ||
    //     inputRows[y + 1].type == Blockly.NEXT_STATEMENT) {
    //   // If the final input is a statement stack, add a small row underneath.
    //   // Consecutive statement stacks are also separated by a small divider.
    //   steps.push('v', Blockly.BlockSvg.SEP_SPACE_Y);
    //   cursorY += Blockly.BlockSvg.SEP_SPACE_Y;
    // }
  }

  if (this.nextConnection) {
    steps.push('H', metrics.width - Blockly.BlockSvg.CORNER_RADIUS);
  } else {
    steps.push('H', metrics.width - Blockly.BlockSvg.HAT_CORNER_RADIUS);
  }
};

/**
 * Render the right edge of the block.
 * @param {!Array.<string>} steps Path of block outline.
 * @param {!Object} connectionsXY Location of block.
 * @param {number} cursorY Height of block.
 * @private
 */
Blockly.BlockSvg.prototype.renderDrawRight_ =
    function(steps, connectionsXY, metrics) {
  if (this.nextConnection) {
    steps.push('a', Blockly.BlockSvg.CORNER_RADIUS + ',' +
               Blockly.BlockSvg.CORNER_RADIUS + ' 0 0,0 ' +
               Blockly.BlockSvg.CORNER_RADIUS + ',-' +
               Blockly.BlockSvg.CORNER_RADIUS);
  } else {
    steps.push('a', Blockly.BlockSvg.HAT_CORNER_RADIUS + ',' +
               Blockly.BlockSvg.HAT_CORNER_RADIUS + ' 0 0,0 ' +
               Blockly.BlockSvg.HAT_CORNER_RADIUS + ',-' +
               Blockly.BlockSvg.HAT_CORNER_RADIUS);    
  }
  steps.push('v', -8);

  if (this.nextConnection) {
    steps.push(Blockly.BlockSvg.NOTCH_PATH_UP);

    // Create next block connection.
    var connectionX;
    if (this.RTL) {
      connectionX = connectionsXY.x + metrics.width;
    } else {
      connectionX = connectionsXY.x + metrics.width;
    }
    var connectionY = connectionsXY.y + metrics.height - Blockly.BlockSvg.CORNER_RADIUS * 2;
    this.nextConnection.moveTo(connectionX, connectionY);
    if (this.nextConnection.targetConnection) {
      this.nextConnection.tighten_();
    }
    this.height += 4;  // Height of tab.
    steps.push('V', Blockly.BlockSvg.CORNER_RADIUS);
  } else {
    steps.push('V', Blockly.BlockSvg.HAT_CORNER_RADIUS);
  }
};

/**
 * Render the top edge of the block.
 * @param {!Array.<string>} steps Path of block outline.
 * @param {!Object} connectionsXY Location of block.
 * @param {number} cursorY Height of block.
 * @private
 */
Blockly.BlockSvg.prototype.renderDrawTop_ =
    function(steps, connectionsXY, metrics) {
  if (this.nextConnection) {
    steps.push('a', Blockly.BlockSvg.CORNER_RADIUS + ',' +
               Blockly.BlockSvg.CORNER_RADIUS + ' 0 0,0 -' +
               Blockly.BlockSvg.CORNER_RADIUS + ',-' +
               Blockly.BlockSvg.CORNER_RADIUS);
  } else {
    steps.push('a', Blockly.BlockSvg.HAT_CORNER_RADIUS + ',' +
               Blockly.BlockSvg.HAT_CORNER_RADIUS + ' 0 0,0 -' +
               Blockly.BlockSvg.HAT_CORNER_RADIUS + ',-' +
               Blockly.BlockSvg.HAT_CORNER_RADIUS);
  }
  steps.push('z');
};
