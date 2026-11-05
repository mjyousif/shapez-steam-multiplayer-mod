const { test, describe } = require("node:test");
const assert = require("node:assert");
const { makeDraggable, isInteractiveElement } = require("../src/multiplayer/ui/draggable");
const { MULTIPLAYER_CSS } = require("../src/multiplayer/ui/styles");
const { HUDMultiplayer } = require("../src/multiplayer/hud/hud_multiplayer");

describe("Draggable UI System & Component Interactions", () => {
    function createMockElement(tag = "div", className = "") {
        const listeners = {};
        const classSet = new Set(className.split(" ").filter(Boolean));
        const style = {};
        const children = [];
        let innerTextVal = "";
        let valueVal = "";

        const el = {
            tagName: tag.toUpperCase(),
            className,
            classList: {
                contains: cls => classSet.has(cls),
                add: cls => classSet.add(cls),
                remove: cls => classSet.delete(cls),
                toggle: (cls, force) => {
                    if (force !== undefined) {
                        if (force) classSet.add(cls);
                        else classSet.delete(cls);
                    } else if (classSet.has(cls)) {
                        classSet.delete(cls);
                    } else {
                        classSet.add(cls);
                    }
                },
            },
            style,
            children,
            parentElement: null,
            offsetWidth: 290,
            offsetHeight: 320,
            scrollTop: 0,
            scrollHeight: 500,
            focus: () => {},
            blur: () => {},
            remove: () => {
                if (el.parentElement) {
                    const idx = el.parentElement.children.indexOf(el);
                    if (idx !== -1) el.parentElement.children.splice(idx, 1);
                    el.parentElement = null;
                }
            },
            get innerText() {
                return innerTextVal;
            },
            set innerText(v) {
                innerTextVal = String(v);
            },
            get value() {
                return valueVal;
            },
            set value(v) {
                valueVal = String(v);
            },
            getAttribute: attr => el[attr] || null,
            setAttribute: (attr, val) => {
                el[attr] = val;
            },
            getBoundingClientRect: () => ({
                left: style.left ? parseFloat(style.left) : 950,
                top: style.top ? parseFloat(style.top) : 70,
                width: 290,
                height: 320,
            }),
            appendChild: child => {
                children.push(child);
                child.parentElement = el;
                return child;
            },
            addEventListener: (ev, fn) => {
                listeners[ev] = listeners[ev] || [];
                listeners[ev].push(fn);
            },
            removeEventListener: (ev, fn) => {
                if (!listeners[ev]) return;
                listeners[ev] = listeners[ev].filter(f => f !== fn);
            },
            dispatch: (evName, evObj = {}) => {
                const list = listeners[evName] || [];
                let stopped = false;
                let defaultPrevented = false;
                const fullEvent = {
                    ...evObj,
                    target: evObj.target || el,
                    currentTarget: el,
                    button: evObj.button !== undefined ? evObj.button : 0,
                    stopPropagation: () => {
                        stopped = true;
                    },
                    preventDefault: () => {
                        defaultPrevented = true;
                    },
                    get stopped() {
                        return stopped;
                    },
                    get defaultPrevented() {
                        return defaultPrevented;
                    },
                };
                for (const fn of list) {
                    fn(fullEvent);
                }
                return fullEvent;
            },
            querySelector: sel => {
                function search(node) {
                    for (const c of node.children) {
                        if (sel.startsWith(".") && c.classList.contains(sel.slice(1))) {
                            return c;
                        }
                        if (sel.startsWith("#") && c.id === sel.slice(1)) {
                            return c;
                        }
                        if (c.tagName.toLowerCase() === sel.toLowerCase()) {
                            return c;
                        }
                        const found = search(c);
                        if (found) return found;
                    }
                    return null;
                }
                return search(el);
            },
            querySelectorAll: sel => {
                const results = [];
                function search(node) {
                    for (const c of node.children) {
                        if (sel.startsWith(".") && c.classList.contains(sel.slice(1))) {
                            results.push(c);
                        } else if (c.tagName.toLowerCase() === sel.toLowerCase()) {
                            results.push(c);
                        }
                        search(c);
                    }
                }
                search(el);
                return results;
            },
        };
        return el;
    }

    function createMockWindow(width = 1280, height = 720) {
        const listeners = {};
        return {
            innerWidth: width,
            innerHeight: height,
            addEventListener: (ev, fn) => {
                listeners[ev] = listeners[ev] || [];
                listeners[ev].push(fn);
            },
            removeEventListener: (ev, fn) => {
                if (!listeners[ev]) return;
                listeners[ev] = listeners[ev].filter(f => f !== fn);
            },
            dispatch: (evName, evObj = {}) => {
                const list = listeners[evName] || [];
                let stopped = false;
                let defaultPrevented = false;
                const fullEvent = {
                    ...evObj,
                    button: evObj.button !== undefined ? evObj.button : 0,
                    stopPropagation: () => {
                        stopped = true;
                    },
                    preventDefault: () => {
                        defaultPrevented = true;
                    },
                    get stopped() {
                        return stopped;
                    },
                    get defaultPrevented() {
                        return defaultPrevented;
                    },
                };
                for (const fn of list) {
                    fn(fullEvent);
                }
                return fullEvent;
            },
            listenerCount: evName => (listeners[evName] || []).length,
        };
    }

    test("isInteractiveElement accurately identifies interactive children", () => {
        const panel = createMockElement("div", "mpHudPanel");
        const btn = createMockElement("button", "styledButton");
        const collapseBtn = createMockElement("button", "mpCollapseBtn");
        const input = createMockElement("input", "mpChatInput");
        const chatBox = createMockElement("div", "mpChatMessages");
        const header = createMockElement("div", "mpHudHeader");
        const titleSpan = createMockElement("span", "mpHeaderTitle");
        const dot = createMockElement("div", "mpStatusDot");
        const grip = createMockElement("span", "mpGripHandle");

        panel.appendChild(header);
        header.appendChild(grip);
        header.appendChild(dot);
        header.appendChild(titleSpan);
        header.appendChild(collapseBtn);
        panel.appendChild(btn);
        panel.appendChild(input);
        panel.appendChild(chatBox);

        assert.strictEqual(isInteractiveElement(btn, panel), true);
        assert.strictEqual(isInteractiveElement(collapseBtn, panel), true);
        assert.strictEqual(isInteractiveElement(input, panel), true);
        assert.strictEqual(isInteractiveElement(chatBox, panel), true);

        // Header, title span, grip, and status dot should not be considered interactive
        assert.strictEqual(isInteractiveElement(header, panel), false);
        assert.strictEqual(isInteractiveElement(titleSpan, panel), false);
        assert.strictEqual(isInteractiveElement(grip, panel), false);
        assert.strictEqual(isInteractiveElement(dot, panel), false);
    });

    test("makeDraggable drags panel and stops event propagation", () => {
        const mockWin = createMockWindow(1280, 720);
        global.window = mockWin;

        const panel = createMockElement("div", "mpHudPanel");
        panel.style.top = "70px";
        panel.style.right = "16px";

        const header = createMockElement("div", "mpHudHeader");
        const titleSpan = createMockElement("span", "mpHeaderTitle");
        header.appendChild(titleSpan);
        panel.appendChild(header);

        let positionUpdates = [];
        const cleanup = makeDraggable(panel, {
            handle: header,
            allowBackgroundDrag: true,
            onPositionChange: pos => positionUpdates.push(pos),
        });

        // 1. Mouse down on titleSpan inside header
        const downEv = panel.dispatch("mousedown", {
            clientX: 980,
            clientY: 80,
            target: titleSpan,
        });
        assert.strictEqual(downEv.stopped, true, "mousedown must stop propagation to canvas");
        assert.strictEqual(downEv.defaultPrevented, true, "mousedown must preventDefault");
        assert.strictEqual(panel.style.right, "auto", "right must be cleared to auto");
        assert.strictEqual(panel.classList.contains("mpDragging"), true);

        // 2. Window mouse move
        const moveEv = mockWin.dispatch("mousemove", {
            clientX: 900, // dragged left by 80px
            clientY: 120, // dragged down by 40px
        });
        assert.strictEqual(moveEv.stopped, true, "mousemove must stop propagation");
        assert.strictEqual(panel.style.left, "870px");
        assert.strictEqual(panel.style.top, "110px");
        assert.strictEqual(positionUpdates.length, 1);
        assert.deepStrictEqual(positionUpdates[0], { left: 870, top: 110 });

        // 3. Window mouse up
        mockWin.dispatch("mouseup", {});
        assert.strictEqual(panel.classList.contains("mpDragging"), false);

        cleanup();
        assert.strictEqual(mockWin.listenerCount("mousemove"), 0);
        assert.strictEqual(mockWin.listenerCount("mouseup"), 0);
    });

    test("clicking interactive button does not start dragging", () => {
        const mockWin = createMockWindow(1280, 720);
        global.window = mockWin;

        const panel = createMockElement("div", "mpHudPanel");
        const header = createMockElement("div", "mpHudHeader");
        const collapseBtn = createMockElement("button", "mpCollapseBtn");
        header.appendChild(collapseBtn);
        panel.appendChild(header);

        makeDraggable(panel, { handle: header });

        const downEv = panel.dispatch("mousedown", {
            clientX: 1000,
            clientY: 80,
            target: collapseBtn,
        });
        assert.strictEqual(panel.classList.contains("mpDragging"), false);
        assert.strictEqual(downEv.defaultPrevented, false);
    });

    test("viewport clamping prevents dragging outside screen", () => {
        const mockWin = createMockWindow(1280, 720);
        global.window = mockWin;

        const panel = createMockElement("div", "mpHudPanel");
        const header = createMockElement("div", "mpHudHeader");
        panel.appendChild(header);

        makeDraggable(panel, { handle: header, margin: 10 });

        // Start drag
        panel.dispatch("mousedown", { clientX: 950, clientY: 70, target: header });

        // Drag far off to the top-left (-500, -500)
        mockWin.dispatch("mousemove", { clientX: -500, clientY: -500 });
        assert.strictEqual(panel.style.left, "10px");
        assert.strictEqual(panel.style.top, "10px");

        // Drag far off to the bottom-right (2500, 2000)
        mockWin.dispatch("mousemove", { clientX: 2500, clientY: 2000 });
        assert(parseFloat(panel.style.left) <= 1280 - 40);
        assert(parseFloat(panel.style.top) <= 720 - 40);

        mockWin.dispatch("mouseup", {});
    });

    test("HUDMultiplayer: action buttons, collapse toggle, chat send, and persistence work without triggering drag", () => {
        const mockWin = createMockWindow(1280, 720);
        global.window = mockWin;

        let openedModal = false;
        let copiedInfo = false;
        let sentPing = false;
        let requestedResync = false;
        let sentChatMessage = null;

        const mockMod = {
            hudPosition: { left: 450, top: 200 },
            attachGameRoot: () => {},
            detachGameRoot: () => {},
            isSessionActive: () => true,
            role: "client",
            getAllPlayersList: () => [{ name: "Player 1", color: "#38bdf8", isHost: false, isLocal: true }],
            openMultiplayerModal: () => {
                openedModal = true;
            },
            copyJoinInfoToClipboard: () => {
                copiedInfo = true;
            },
            sendMapPingAtCursor: () => {
                sentPing = true;
            },
            requestWorldResync: () => {
                requestedResync = true;
            },
            sendChatMessage: text => {
                sentChatMessage = text;
            },
        };
        global.window.$shapezMultiplayerMod = mockMod;

        const parent = createMockElement("div", "ingame_HUD");
        global.shapez = {
            BaseHUDPart: class {},
            makeDiv: (p, id, classes, html) => {
                const el = createMockElement("div", classes.join(" "));
                el.id = id;
                const header = createMockElement("div", "mpHudHeader");
                const body = createMockElement("div", "mpHudBody");
                const grip = createMockElement("span", "mpGripHandle");
                const collapseBtn = createMockElement("button", "mpCollapseBtn");
                const dot = createMockElement("div", "mpStatusDot");
                const title = createMockElement("span", "mpHeaderTitle");
                const badge = createMockElement("span", "mpPlayerCountBadge");
                const roster = createMockElement("div", "mpRoster");
                const copyBtn = createMockElement("button", "styledButton mpBtnCopyCode");
                const resyncBtn = createMockElement("button", "styledButton mpBtnResync");
                const inviteBtn = createMockElement("button", "styledButton mpBtnInvite");
                const pingBtn = createMockElement("button", "styledButton mpBtnPing");
                const chatInput = createMockElement("input", "mpChatInput");
                const chatSendBtn = createMockElement("button", "styledButton mpChatSendBtn");
                const chatMessages = createMockElement("div", "mpChatMessages");

                header.appendChild(grip);
                header.appendChild(dot);
                header.appendChild(title);
                header.appendChild(badge);
                header.appendChild(collapseBtn);

                body.appendChild(roster);
                body.appendChild(copyBtn);
                body.appendChild(resyncBtn);
                body.appendChild(inviteBtn);
                body.appendChild(pingBtn);
                body.appendChild(chatMessages);
                body.appendChild(chatInput);
                body.appendChild(chatSendBtn);

                el.appendChild(header);
                el.appendChild(body);
                p.appendChild(el);
                return el;
            },
        };

        const hud = new HUDMultiplayer();
        hud.createElements(parent);
        hud.initialize();

        // 1. Verify restored position
        assert.strictEqual(hud.container.style.left, "450px");
        assert.strictEqual(hud.container.style.top, "200px");

        // 2. Test collapse button click (toggle .collapsed, switch – to +)
        const collapseBtn = hud.container.querySelector(".mpCollapseBtn");
        collapseBtn.dispatch("click", {});
        assert.strictEqual(hud.container.classList.contains("collapsed"), true);
        assert.strictEqual(collapseBtn.innerText, "+");
        assert.strictEqual(hud.container.classList.contains("mpDragging"), false);

        collapseBtn.dispatch("click", {});
        assert.strictEqual(hud.container.classList.contains("collapsed"), false);
        assert.strictEqual(collapseBtn.innerText, "–");

        // 3. Test action buttons (Invite, Copy, Ping, Resync)
        const inviteBtn = hud.container.querySelector(".mpBtnInvite");
        const copyBtn = hud.container.querySelector(".mpBtnCopyCode");
        const pingBtn = hud.container.querySelector(".mpBtnPing");
        const resyncBtn = hud.container.querySelector(".mpBtnResync");

        inviteBtn.dispatch("click", {});
        assert.strictEqual(openedModal, true);
        assert.strictEqual(hud.container.classList.contains("mpDragging"), false);

        copyBtn.dispatch("click", {});
        assert.strictEqual(copiedInfo, true);

        pingBtn.dispatch("click", {});
        assert.strictEqual(sentPing, true);

        resyncBtn.dispatch("click", {});
        assert.strictEqual(requestedResync, true);

        // 4. Test chat input & send button
        const chatInput = hud.container.querySelector(".mpChatInput");
        const chatSendBtn = hud.container.querySelector(".mpChatSendBtn");

        chatInput.value = "Hello factory team!";
        chatSendBtn.dispatch("click", {});
        assert.strictEqual(sentChatMessage, "Hello factory team!");
        assert.strictEqual(chatInput.value, "", "Input should clear after send");

        // 5. Test wheel scrolling isolation
        const chatMessages = hud.container.querySelector(".mpChatMessages");
        const wheelEv = chatMessages.dispatch("wheel", { deltaY: 20 });
        assert.strictEqual(wheelEv.stopped, true, "Wheel events inside chat must stop canvas zoom propagation");

        // 6. Test dragging via grip handle
        const gripEl = hud.container.querySelector(".mpGripHandle");
        hud.container.dispatch("mousedown", { clientX: 450, clientY: 200, target: gripEl });
        mockWin.dispatch("mousemove", { clientX: 600, clientY: 280 });
        mockWin.dispatch("mouseup", {});

        assert.strictEqual(mockMod.hudPosition.left, 600);
        assert.strictEqual(mockMod.hudPosition.top, 280);

        hud.cleanup();
        assert.strictEqual(hud.dragCleanup, null);
    });

    test("Dialogs: Modal cards, logs modal, invite banner, and progress overlay support dragging and clean interaction", () => {
        const mockWin = createMockWindow(1280, 720);
        global.window = mockWin;

        // 1. Modal Card Draggability & Interactive Control Exclusion
        const modalCard = createMockElement("div", "mpModalCard");
        modalCard.style.left = "300px";
        modalCard.style.top = "100px";
        const modalHeader = createMockElement("div", "mpModalHeader");
        const closeBtn = createMockElement("button", "mpCloseModalBtn");
        const inputJoin = createMockElement("input", "mpInputJoinCode");
        const joinBtn = createMockElement("button", "styledButton mpJoinByCodeBtn");

        modalHeader.appendChild(closeBtn);
        modalCard.appendChild(modalHeader);
        modalCard.appendChild(inputJoin);
        modalCard.appendChild(joinBtn);

        const modalCleanup = makeDraggable(modalCard, { handle: modalHeader, allowBackgroundDrag: true });

        // Header drag moves modal
        modalCard.dispatch("mousedown", { clientX: 300, clientY: 100, target: modalHeader });
        mockWin.dispatch("mousemove", { clientX: 350, clientY: 150 });
        mockWin.dispatch("mouseup", {});
        assert.strictEqual(modalCard.style.left, "350px");
        assert.strictEqual(modalCard.style.top, "150px");

        // Clicking inputJoin does NOT initiate drag
        const inputDown = modalCard.dispatch("mousedown", { clientX: 350, clientY: 200, target: inputJoin });
        assert.strictEqual(modalCard.classList.contains("mpDragging"), false);
        assert.strictEqual(inputDown.defaultPrevented, false);

        // Clicking joinBtn does NOT initiate drag
        const btnDown = modalCard.dispatch("mousedown", { clientX: 450, clientY: 200, target: joinBtn });
        assert.strictEqual(modalCard.classList.contains("mpDragging"), false);
        assert.strictEqual(btnDown.defaultPrevented, false);

        modalCleanup();

        // 2. Logs Modal Draggability & Text Selection Exclusion
        const logsCard = createMockElement("div", "mpModalCard");
        logsCard.style.left = "200px";
        logsCard.style.top = "80px";
        const logsHeader = createMockElement("div", "mpModalHeader");
        const preEl = createMockElement("pre", "logsPre");
        const copyLogsBtn = createMockElement("button", "styledButton mpCopyLogsBtn");

        logsCard.appendChild(logsHeader);
        logsCard.appendChild(preEl);
        logsCard.appendChild(copyLogsBtn);

        const logsCleanup = makeDraggable(logsCard, { handle: logsHeader, allowBackgroundDrag: true });

        // Dragging by header moves logs modal
        logsCard.dispatch("mousedown", { clientX: 200, clientY: 80, target: logsHeader });
        mockWin.dispatch("mousemove", { clientX: 260, clientY: 120 });
        mockWin.dispatch("mouseup", {});
        assert.strictEqual(logsCard.style.left, "260px");
        assert.strictEqual(logsCard.style.top, "120px");

        // Clicking pre element for text selection does NOT initiate drag
        const preDown = logsCard.dispatch("mousedown", { clientX: 260, clientY: 180, target: preEl });
        assert.strictEqual(logsCard.classList.contains("mpDragging"), false);
        assert.strictEqual(preDown.defaultPrevented, false);

        logsCleanup();

        // 3. Invite Banner Draggability & Action Button Exclusion
        const banner = createMockElement("div", "mpInviteBanner");
        banner.style.left = "1100px";
        banner.style.top = "30px";
        const acceptBtn = createMockElement("button", "styledButton mpAcceptInviteBtn");
        const dismissBtn = createMockElement("button", "styledButton mpDismissInviteBtn");
        banner.appendChild(acceptBtn);
        banner.appendChild(dismissBtn);

        const bannerCleanup = makeDraggable(banner, { allowBackgroundDrag: true });

        // Background drag moves banner
        banner.dispatch("mousedown", { clientX: 1100, clientY: 30, target: banner });
        mockWin.dispatch("mousemove", { clientX: 1050, clientY: 80 });
        mockWin.dispatch("mouseup", {});
        assert.strictEqual(banner.style.left, "1050px");
        assert.strictEqual(banner.style.top, "80px");

        // Clicking acceptBtn does not drag
        const acceptDown = banner.dispatch("mousedown", { clientX: 1060, clientY: 90, target: acceptBtn });
        assert.strictEqual(banner.classList.contains("mpDragging"), false);
        assert.strictEqual(acceptDown.defaultPrevented, false);

        bannerCleanup();

        // 4. Progress Card Draggability & Cancel Button Exclusion
        const joinCard = createMockElement("div", "mpJoinCard");
        joinCard.style.left = "500px";
        joinCard.style.top = "250px";
        const cancelBtn = createMockElement("button", "styledButton mpCancelJoinBtn");
        joinCard.appendChild(cancelBtn);

        const joinCleanup = makeDraggable(joinCard, { allowBackgroundDrag: true });

        // Background drag moves progress card
        joinCard.dispatch("mousedown", { clientX: 500, clientY: 250, target: joinCard });
        mockWin.dispatch("mousemove", { clientX: 540, clientY: 290 });
        mockWin.dispatch("mouseup", {});
        assert.strictEqual(joinCard.style.left, "540px");
        assert.strictEqual(joinCard.style.top, "290px");

        // Clicking cancelBtn does not drag
        const cancelDown = joinCard.dispatch("mousedown", { clientX: 540, clientY: 320, target: cancelBtn });
        assert.strictEqual(joinCard.classList.contains("mpDragging"), false);
        assert.strictEqual(cancelDown.defaultPrevented, false);

        joinCleanup();
    });

    test("CSS rules enforce pointer-events: all !important on HUD and Modal subtrees", () => {
        assert(
            MULTIPLAYER_CSS.includes("#ingame_HUD_Multiplayer.mpHudPanel,") &&
            MULTIPLAYER_CSS.includes("#ingame_HUD_Multiplayer.mpHudPanel *"),
            "HUD panel and all child elements must enforce pointer-events: all !important"
        );
        assert(
            MULTIPLAYER_CSS.includes(".mpModalBackdrop,") &&
            MULTIPLAYER_CSS.includes(".mpModalBackdrop *"),
            "Modal backdrop and children must enforce pointer-events: all !important"
        );
        assert(
            MULTIPLAYER_CSS.includes(".mpInviteBanner,") &&
            MULTIPLAYER_CSS.includes(".mpInviteBanner *"),
            "Invite banner and children must enforce pointer-events: all !important"
        );
        assert(
            MULTIPLAYER_CSS.includes(".mpToastNotification") &&
            MULTIPLAYER_CSS.includes("pointer-events: none !important"),
            "Toast notifications must keep pointer-events: none !important"
        );
        assert(
            MULTIPLAYER_CSS.includes("cursor: grab"),
            "Headers and grip handles must have cursor: grab"
        );
        assert(
            MULTIPLAYER_CSS.includes(".mpDragging"),
            "mpDragging state class must be present in CSS"
        );
    });
});
