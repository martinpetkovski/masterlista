// Lightweight list virtualizer. Renders only the rows inside the visible
// scroll window (+ overscan) and reserves the remaining height with top/bottom
// spacer elements. Works for both tables (`<tbody>`) and ordered/unordered
// lists (`<ol>`, `<ul>`). Row height is assumed to be uniform.
//
// Usage:
//   const vl = new VirtualList({
//     scrollEl, contentEl, items, rowHeight,
//     renderRow: (item, absoluteIndex) => htmlString,
//     onRendered: (contentEl, startIdx, endIdx) => {}, // optional
//     overscan: 12, // optional, default 10
//     colspan: 8,   // optional, for <tbody> spacers
//   });
//   vl.update(newItems);
//   vl.destroy();
(function(global) {
    'use strict';

    function VirtualList(opts) {
        this.scrollEl = opts.scrollEl;
        this.contentEl = opts.contentEl;
        this.items = opts.items || [];
        this.rowHeight = opts.rowHeight;
        this.renderRow = opts.renderRow;
        this.onRendered = opts.onRendered || null;
        this.overscan = opts.overscan != null ? opts.overscan : 10;
        this.renderStep = Math.max(1, opts.renderStep || 1);
        this.colspan = opts.colspan || 1;
        this._isTableBody = (this.contentEl.tagName || '').toUpperCase() === 'TBODY';

        this._lastStart = -1;
        this._lastEnd = -1;
        this._raf = 0;
        this._topSpacerNode = null;
        this._bottomSpacerNode = null;
        this._rowNodes = [];
        this._onScroll = this._onScroll.bind(this);
        this._onResize = this._onResize.bind(this);

        this.scrollEl.addEventListener('scroll', this._onScroll, { passive: true });
        if (typeof ResizeObserver !== 'undefined') {
            this._ro = new ResizeObserver(this._onResize);
            this._ro.observe(this.scrollEl);
        } else {
            window.addEventListener('resize', this._onResize);
        }

        this.render();
    }

    VirtualList.prototype._spacerTag = function() {
        var tag = (this.contentEl.tagName || '').toUpperCase();
        if (tag === 'TBODY') {
            return { open: '<tr class="vl-spacer" aria-hidden="true" style="height:', mid: 'px"><td colspan="' + this.colspan + '" style="padding:0;border:0;"></td></tr>', isRow: true };
        }
        // Default: list item (works for OL, UL, DIV containers)
        var child = tag === 'OL' || tag === 'UL' ? 'li' : 'div';
        return { open: '<' + child + ' class="vl-spacer" aria-hidden="true" style="height:', mid: 'px;list-style:none;margin:0;padding:0;"></' + child + '>', isRow: false };
    };

    VirtualList.prototype._createTableSpacerNode = function() {
        var tr = document.createElement('tr');
        var td = document.createElement('td');

        tr.className = 'vl-spacer';
        tr.setAttribute('aria-hidden', 'true');
        td.colSpan = this.colspan;
        td.style.padding = '0';
        td.style.border = '0';
        tr.appendChild(td);

        return tr;
    };

    VirtualList.prototype._setTableSpacerHeight = function(node, height) {
        if (!node) return;
        node.style.height = Math.max(0, height) + 'px';
    };

    VirtualList.prototype._buildTableRowNode = function(item, index) {
        var tbody = document.createElement('tbody');
        tbody.innerHTML = this.renderRow(item, index);
        return tbody.firstElementChild;
    };

    VirtualList.prototype._ensureTableWindow = function() {
        if (this._topSpacerNode && this._bottomSpacerNode && this._topSpacerNode.parentNode === this.contentEl && this._bottomSpacerNode.parentNode === this.contentEl) {
            return;
        }

        this.contentEl.innerHTML = '';
        this._rowNodes = [];
        this._topSpacerNode = this._createTableSpacerNode();
        this._bottomSpacerNode = this._createTableSpacerNode();
        this.contentEl.appendChild(this._topSpacerNode);
        this.contentEl.appendChild(this._bottomSpacerNode);
    };

    VirtualList.prototype._trimTableStart = function(count) {
        var removeCount = Math.min(count, this._rowNodes.length);
        while (removeCount > 0) {
            var node = this._rowNodes.shift();
            if (node && node.parentNode === this.contentEl) {
                this.contentEl.removeChild(node);
            }
            removeCount -= 1;
        }
    };

    VirtualList.prototype._trimTableEnd = function(count) {
        var removeCount = Math.min(count, this._rowNodes.length);
        while (removeCount > 0) {
            var node = this._rowNodes.pop();
            if (node && node.parentNode === this.contentEl) {
                this.contentEl.removeChild(node);
            }
            removeCount -= 1;
        }
    };

    VirtualList.prototype._appendTableRows = function(start, end) {
        var frag;
        var i;

        if (start >= end) return;

        frag = document.createDocumentFragment();
        for (i = start; i < end; i++) {
            var node = this._buildTableRowNode(this.items[i], i);
            this._rowNodes.push(node);
            frag.appendChild(node);
        }

        this.contentEl.insertBefore(frag, this._bottomSpacerNode);
    };

    VirtualList.prototype._prependTableRows = function(start, end) {
        var frag;
        var nodes = [];
        var i;

        if (start >= end) return;

        frag = document.createDocumentFragment();
        for (i = start; i < end; i++) {
            var node = this._buildTableRowNode(this.items[i], i);
            nodes.push(node);
            frag.appendChild(node);
        }

        this._rowNodes = nodes.concat(this._rowNodes);
        this.contentEl.insertBefore(frag, this._rowNodes[nodes.length] || this._bottomSpacerNode);
    };

    VirtualList.prototype._rebuildTableWindow = function(start, end) {
        this._ensureTableWindow();
        this._trimTableEnd(this._rowNodes.length);
        this._appendTableRows(start, end);
    };

    VirtualList.prototype._renderTableWindow = function(start, end, prevStart, prevEnd, topPad, bottomPad) {
        var prevCount = prevEnd > prevStart ? (prevEnd - prevStart) : 0;
        var newCount = end - start;
        var shift = start - prevStart;
        var canPatch = false;
        var appendStart;

        this._ensureTableWindow();

        if (this._rowNodes.length && prevCount > 0) {
            if (shift === 0) {
                canPatch = true;
            } else if (shift > 0 && shift < prevCount) {
                this._trimTableStart(shift);
                canPatch = true;
            } else if (shift < 0 && (-shift) < prevCount) {
                this._trimTableEnd(-shift);
                this._prependTableRows(start, prevStart);
                canPatch = true;
            }
        }

        if (!canPatch) {
            this._rebuildTableWindow(start, end);
        } else {
            if (this._rowNodes.length > newCount) {
                this._trimTableEnd(this._rowNodes.length - newCount);
            }
            appendStart = start + this._rowNodes.length;
            if (appendStart < end) {
                this._appendTableRows(appendStart, end);
            }
        }

        this._setTableSpacerHeight(this._topSpacerNode, topPad);
        this._setTableSpacerHeight(this._bottomSpacerNode, bottomPad);
    };

    VirtualList.prototype._onScroll = function() {
        if (this._raf) return;
        var self = this;
        this._raf = requestAnimationFrame(function() {
            self._raf = 0;
            self.render();
        });
    };

    VirtualList.prototype._onResize = function() {
        this._lastStart = -1;
        this.render();
    };

    VirtualList.prototype.update = function(items, options) {
        this.items = items || [];
        this._lastStart = -1;
        this._lastEnd = -1;
        if (!options || options.preserveScroll !== true) {
            this.scrollEl.scrollTop = 0;
        }
        this.render();
    };

    VirtualList.prototype.setRowHeight = function(rowHeight) {
        this.rowHeight = rowHeight;
        this._lastStart = -1;
        this.render();
    };

    VirtualList.prototype.render = function() {
        var total = this.items.length;
        var rh = this.rowHeight;
        var viewH = this.scrollEl.clientHeight || 0;
        var scrollTop = this.scrollEl.scrollTop || 0;
        var visibleRows = rh > 0 ? Math.ceil(viewH / rh) : total;

        var start = total === 0 ? 0 : Math.max(0, Math.floor(scrollTop / rh) - this.overscan);
        var end = total === 0 ? 0 : Math.min(total, Math.ceil((scrollTop + viewH) / rh) + this.overscan);
        // Always render at least one window to seed column widths for tables
        if (total > 0 && end === 0) end = Math.min(total, this.overscan * 2);

        if (this.renderStep > 1 && total > 0) {
            start = Math.max(0, Math.floor(start / this.renderStep) * this.renderStep);
            end = Math.min(total, Math.ceil(end / this.renderStep) * this.renderStep);
            if (end < start + visibleRows + (this.overscan * 2)) {
                end = Math.min(total, start + visibleRows + (this.overscan * 2));
            }
        }

        var prevStart = this._lastStart;
        var prevEnd = this._lastEnd;

        if (start === prevStart && end === prevEnd) return;

        var topPad = start * rh;
        var bottomPad = Math.max(0, (total - end) * rh);

        if (this._isTableBody) {
            this._renderTableWindow(start, end, prevStart, prevEnd, topPad, bottomPad);
        } else {
            var spacer = this._spacerTag();
            var html = '';
            if (topPad > 0) html += spacer.open + topPad + spacer.mid;

            for (var i = start; i < end; i++) {
                html += this.renderRow(this.items[i], i);
            }

            if (bottomPad > 0) html += spacer.open + bottomPad + spacer.mid;

            this.contentEl.innerHTML = html;
        }

        this._lastStart = start;
        this._lastEnd = end;

        if (this.onRendered) {
            try { this.onRendered(this.contentEl, start, end); } catch (e) { /* swallow */ }
        }
    };

    VirtualList.prototype.destroy = function() {
        this.scrollEl.removeEventListener('scroll', this._onScroll);
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
        else { window.removeEventListener('resize', this._onResize); }
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
        this._topSpacerNode = null;
        this._bottomSpacerNode = null;
        this._rowNodes = [];
        this.contentEl.innerHTML = '';
    };

    global.VirtualList = VirtualList;
})(typeof window !== 'undefined' ? window : this);
