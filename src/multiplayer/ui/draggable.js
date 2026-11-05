/**
 * @file src/multiplayer/ui/draggable.js
 * @description Reusable, zero-dependency dragging controller for shapez.io Co-op UI panels & modals.
 *
 * Invariants:
 * - Stops DOM event propagation (mousedown, mousemove, pointerdown) so dragging UI never pans the underlying game canvas.
 * - Safely ignores clicks on interactive child elements (buttons, inputs, select dropdowns, scrollable logs).
 * - Calibrates coordinate conversion from CSS right/bottom or flex-centering to explicit left/top.
 * - Clamps panels within the viewport and auto-recalibrates on window resize.
 * - Provides a cleanup callback to detach global window event listeners.
 */

/**
 * Checks whether an element or any of its ancestors up to boundary is interactive.
 * @param {HTMLElement|null} target
 * @param {HTMLElement} boundary
 * @returns {boolean}
 */
function isInteractiveElement(target, boundary) {
    let curr = target;
    const docBody = typeof document !== "undefined" ? document.body : null;
    while (curr && curr !== boundary && curr !== docBody) {
        const tag = (curr.tagName || "").toUpperCase();
        if (
            tag === "BUTTON" ||
            tag === "INPUT" ||
            tag === "SELECT" ||
            tag === "TEXTAREA" ||
            tag === "A" ||
            curr.classList?.contains("styledButton") ||
            curr.classList?.contains("mpCollapseBtn") ||
            curr.classList?.contains("mpCloseModalBtn") ||
            curr.classList?.contains("mpChatMessages") ||
            curr.classList?.contains("mpRoster") ||
            curr.classList?.contains("mpFriendsList") ||
            tag === "PRE"
        ) {
            return true;
        }
        curr = curr.parentElement;
    }
    return false;
}

/**
 * Attaches smooth dragging behavior to a DOM panel.
 *
 * @param {HTMLElement} panelEl - The container element to be moved.
 * @param {object} [options={}] - Configuration options.
 * @param {HTMLElement} [options.handle] - Dedicated drag handle (e.g. header bar). Defaults to panelEl.
 * @param {boolean} [options.allowBackgroundDrag=true] - If true, dragging can also start from non-interactive body areas.
 * @param {boolean} [options.constrainMaxHeight=false] - If true, dynamically adjusts maxHeight so bottom doesn't overflow screen.
 * @param {{ left: number, top: number } | null} [options.initialPosition=null] - Saved position to restore.
 * @param {(pos: { left: number, top: number }) => void} [options.onPositionChange] - Callback when dragged.
 * @param {number} [options.margin=10] - Viewport margin buffer in pixels.
 * @returns {() => void} Cleanup function to detach all event listeners.
 */
function makeDraggable(panelEl, options = {}) {
    if (!panelEl) return () => {};

    const handle = options.handle || panelEl;
    const allowBackgroundDrag = options.allowBackgroundDrag !== false;
    const constrainMaxHeight = Boolean(options.constrainMaxHeight);
    const margin = typeof options.margin === "number" ? options.margin : 10;
    const onPositionChange = typeof options.onPositionChange === "function" ? options.onPositionChange : null;

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    // Apply cursor styling to handle
    if (handle && handle.style) {
        handle.style.cursor = "grab";
    }

    /**
     * Clamps (left, top) within viewport bounds.
     */
    function clampPosition(left, top) {
        const winWidth = typeof window !== "undefined" ? window.innerWidth : 1280;
        const winHeight = typeof window !== "undefined" ? window.innerHeight : 720;
        const width = panelEl.offsetWidth || 280;
        const minVisible = 40;

        const maxLeft = Math.max(margin, winWidth - minVisible);
        const minLeft = Math.min(margin, winWidth - width - margin);
        const clampedLeft = Math.max(minLeft < 0 ? minLeft : margin, Math.min(maxLeft, left));

        const maxTop = Math.max(margin, winHeight - minVisible);
        const clampedTop = Math.max(margin, Math.min(maxTop, top));

        return { left: Math.round(clampedLeft), top: Math.round(clampedTop) };
    }

    /**
     * Applies coordinate positioning and optional dynamic maxHeight.
     */
    function applyPosition(left, top) {
        if (!panelEl.style) return;
        panelEl.style.right = "auto";
        panelEl.style.bottom = "auto";
        panelEl.style.transform = "none";
        panelEl.style.left = left + "px";
        panelEl.style.top = top + "px";

        if (constrainMaxHeight && typeof window !== "undefined") {
            const availHeight = Math.max(120, window.innerHeight - top - margin);
            panelEl.style.maxHeight = availHeight + "px";
        }
    }

    // Restore initial position if valid
    if (options.initialPosition && typeof options.initialPosition.left === "number") {
        const clamped = clampPosition(options.initialPosition.left, options.initialPosition.top);
        applyPosition(clamped.left, clamped.top);
    }

    function onMouseDown(ev) {
        // Left click only
        if (ev.button !== 0) return;

        // Never initiate drag from interactive controls
        if (isInteractiveElement(ev.target, panelEl)) {
            return;
        }

        // If background dragging is disabled and click wasn't on the handle, ignore
        if (!allowBackgroundDrag && handle && !handle.contains(ev.target)) {
            return;
        }

        if (typeof ev.stopPropagation === "function") {
            ev.stopPropagation();
        }

        isDragging = true;
        startX = ev.clientX;
        startY = ev.clientY;

        const rect = (panelEl.getBoundingClientRect && panelEl.getBoundingClientRect()) || {
            left: 0,
            top: 0,
            width: panelEl.offsetWidth || 280,
            height: panelEl.offsetHeight || 300,
        };
        startLeft = rect.left;
        startTop = rect.top;

        // Switch to explicit left/top coordinates
        applyPosition(startLeft, startTop);

        // Calibrate against any parent offsets or CSS zoom
        if (panelEl.getBoundingClientRect) {
            const afterRect = panelEl.getBoundingClientRect();
            const deltaX = afterRect.left - startLeft;
            const deltaY = afterRect.top - startTop;
            if (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) {
                startLeft -= deltaX;
                startTop -= deltaY;
                applyPosition(startLeft, startTop);
            }
        }

        if (handle && handle.style) {
            handle.style.cursor = "grabbing";
        }
        if (panelEl.classList && typeof panelEl.classList.add === "function") {
            panelEl.classList.add("mpDragging");
        }
        if (typeof ev.preventDefault === "function") {
            ev.preventDefault();
        }
    }

    function onMouseMove(ev) {
        if (!isDragging) return;
        if (typeof ev.stopPropagation === "function") {
            ev.stopPropagation();
        }

        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        const clamped = clampPosition(startLeft + dx, startTop + dy);
        applyPosition(clamped.left, clamped.top);

        if (onPositionChange) {
            onPositionChange({ left: clamped.left, top: clamped.top });
        }
    }

    function onMouseUp(ev) {
        if (!isDragging) return;
        isDragging = false;
        if (handle && handle.style) {
            handle.style.cursor = "grab";
        }
        if (panelEl.classList && typeof panelEl.classList.remove === "function") {
            panelEl.classList.remove("mpDragging");
        }
    }

    function onResize() {
        if (!panelEl.style) return;
        const rect = (panelEl.getBoundingClientRect && panelEl.getBoundingClientRect()) || {
            left: parseFloat(panelEl.style.left) || 0,
            top: parseFloat(panelEl.style.top) || 0,
        };
        if (panelEl.style.left && panelEl.style.left !== "auto") {
            const clamped = clampPosition(rect.left, rect.top);
            applyPosition(clamped.left, clamped.top);
            if (onPositionChange) {
                onPositionChange({ left: clamped.left, top: clamped.top });
            }
        }
    }

    // Attach start listeners
    if (panelEl && typeof panelEl.addEventListener === "function") {
        panelEl.addEventListener("mousedown", onMouseDown);
    }
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        window.addEventListener("mousemove", onMouseMove, { passive: false });
        window.addEventListener("mouseup", onMouseUp);
        window.addEventListener("blur", onMouseUp);
        window.addEventListener("resize", onResize);
    }

    return function cleanup() {
        if (panelEl && typeof panelEl.removeEventListener === "function") {
            panelEl.removeEventListener("mousedown", onMouseDown);
        }
        if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
            window.removeEventListener("blur", onMouseUp);
            window.removeEventListener("resize", onResize);
        }
    };
}

module.exports = {
    makeDraggable,
    isInteractiveElement,
};
