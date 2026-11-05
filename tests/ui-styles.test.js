/**
 * @file tests/ui-styles.test.js
 * @description Unit tests for multiplayer CSS styles, UI dynamic scaling, and button normalization.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { D, MULTIPLAYER_CSS, injectStyles } = require("../src/multiplayer/ui/styles");

describe("Multiplayer UI Styles and Scaling", () => {
    it("D(px) helper generates valid CSS calc scaling expression with fallback", () => {
        const val10 = D(10);
        assert.equal(val10, "calc(10px * var(--ui-scale, 1))");

        const val24 = D(24);
        assert.equal(val24, "calc(24px * var(--ui-scale, 1))");
    });

    it("MULTIPLAYER_CSS incorporates dynamic --ui-scale throughout modal and HUD components", () => {
        assert.ok(typeof MULTIPLAYER_CSS === "string" && MULTIPLAYER_CSS.length > 0);

        // Verify that var(--ui-scale is heavily utilized (at least 30 occurrences)
        const uiScaleMatches = MULTIPLAYER_CSS.match(/var\(--ui-scale/g) || [];
        assert.ok(
            uiScaleMatches.length >= 30,
            `Expected at least 30 var(--ui-scale) occurrences, found ${uiScaleMatches.length}`
        );
    });

    it("normalizes shapez global .styledButton inside .mpModalCard and dialog overlays", () => {
        // Must scope .styledButton inside .mpModalCard to prevent inheriting giant game menu buttons
        assert.match(
            MULTIPLAYER_CSS,
            /\.mpModalCard\s+\.styledButton[\s\S]*?font-size:\s*calc\(\d+px\s*\*\s*var\(--ui-scale,\s*1\)\)\s*!important;/
        );
        assert.match(MULTIPLAYER_CSS, /\.mpModalCard\s+\.styledButton[\s\S]*?white-space:\s*nowrap\s*!important;/);
    });

    it("prevents friends header overflow by allowing wrapping and truncating long names", () => {
        // .mpFriendsHeader must have flex-wrap: wrap
        assert.match(MULTIPLAYER_CSS, /\.mpFriendsHeader\s*\{[\s\S]*?flex-wrap:\s*wrap;/);

        // .mpFriendsHeader h3 must have white-space: nowrap
        assert.match(MULTIPLAYER_CSS, /\.mpFriendsHeader\s+h3\s*\{[\s\S]*?white-space:\s*nowrap;/);

        // Friend names must have text-overflow: ellipsis
        assert.match(
            MULTIPLAYER_CSS,
            /\.mpFriendInfo\s+strong\s*\{[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/
        );
    });

    it("ensures join code input and connect button share matching scaled heights", () => {
        // Both the input and the join button must share calc(34px * var(--ui-scale, 1))
        assert.match(
            MULTIPLAYER_CSS,
            /\.mpInputJoinCode[\s\S]*?height:\s*calc\(34px\s*\*\s*var\(--ui-scale,\s*1\)\)\s*!important;/
        );
        assert.match(
            MULTIPLAYER_CSS,
            /\.mpInputGroup\s+\.mpJoinByCodeBtn[\s\S]*?height:\s*calc\(34px\s*\*\s*var\(--ui-scale,\s*1\)\)\s*!important;/
        );
    });

    it("scales HUD panel dimensions and action buttons dynamically", () => {
        assert.match(
            MULTIPLAYER_CSS,
            /#ingame_HUD_Multiplayer\.mpHudPanel\s*\{[\s\S]*?width:\s*calc\(290px\s*\*\s*var\(--ui-scale,\s*1\)\);/
        );
        assert.match(
            MULTIPLAYER_CSS,
            /\.mpActionRow\s+\.styledButton\s*\{[\s\S]*?height:\s*calc\(28px\s*\*\s*var\(--ui-scale,\s*1\)\)\s*!important;/
        );
    });

    it("ensures modal card uses flex layout with fixed header and scrollable friends list", () => {
        // .mpModalCard must use flex column with overflow hidden to prevent header from scrolling off
        assert.match(MULTIPLAYER_CSS, /\.mpModalCard\s*\{[\s\S]*?display:\s*flex;[\s\S]*?overflow:\s*hidden;/);

        // .mpFriendsList must be scrollable
        assert.match(MULTIPLAYER_CSS, /\.mpFriendsList\s*\{[\s\S]*?overflow-y:\s*auto;/);
    });

    it("injectStyles invokes modInterface.registerCss when available", () => {
        let registeredCss = null;
        const mockModInterface = {
            registerCss: css => {
                registeredCss = css;
            },
        };

        injectStyles(mockModInterface);
        assert.equal(registeredCss, MULTIPLAYER_CSS);

        // Gracefully handles null / undefined / missing registerCss
        assert.doesNotThrow(() => injectStyles(null));
        assert.doesNotThrow(() => injectStyles({}));
    });
});
