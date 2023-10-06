// Local js definitions:
/* global addClass, getSettingValue, hasClass, searchState */
/* global onEach, onEachLazy, removeClass, getVar */

"use strict";

// The amount of time that the cursor must remain still over a hover target before
// revealing a tooltip.
//
// https://www.nngroup.com/articles/timing-exposing-content/
window.RUSTDOC_TOOLTIP_HOVER_MS = 300;
window.RUSTDOC_TOOLTIP_HOVER_EXIT_MS = 450;

// Given a basename (e.g. "storage") and an extension (e.g. ".js"), return a URL
// for a resource under the root-path, with the resource-suffix.
function resourcePath(basename, extension) {
    return getVar("root-path") + basename + getVar("resource-suffix") + extension;
}

function hideMain() {
    addClass(document.getElementById(MAIN_ID), "hidden");
}

function showMain() {
    removeClass(document.getElementById(MAIN_ID), "hidden");
}

function elemIsInParent(elem, parent) {
    while (elem && elem !== document.body) {
        if (elem === parent) {
            return true;
        }
        elem = elem.parentElement;
    }
    return false;
}

function blurHandler(event, parentElem, hideCallback) {
    if (!elemIsInParent(document.activeElement, parentElem) &&
        !elemIsInParent(event.relatedTarget, parentElem)
    ) {
        hideCallback();
    }
}

window.rootPath = getVar("root-path");
window.currentCrate = getVar("current-crate");

function setMobileTopbar() {
    // FIXME: It would be nicer to generate this text content directly in HTML,
    // but with the current code it's hard to get the right information in the right place.
    const mobileTopbar = document.querySelector(".mobile-topbar");
    const locationTitle = document.querySelector(".sidebar h2.location");
    if (mobileTopbar) {
        const mobileTitle = document.createElement("h2");
        mobileTitle.className = "location";
        if (hasClass(document.body, "crate")) {
            mobileTitle.innerText = `Crate ${window.currentCrate}`;
        } else if (locationTitle) {
            mobileTitle.innerHTML = locationTitle.innerHTML;
        }
        mobileTopbar.appendChild(mobileTitle);
    }
}

// Gets the human-readable string for the virtual-key code of the
// given KeyboardEvent, ev.
//
// This function is meant as a polyfill for KeyboardEvent#key,
// since it is not supported in IE 11 or Chrome for Android. We also test for
// KeyboardEvent#keyCode because the handleShortcut handler is
// also registered for the keydown event, because Blink doesn't fire
// keypress on hitting the Escape key.
//
// So I guess you could say things are getting pretty interoperable.
function getVirtualKey(ev) {
    if ("key" in ev && typeof ev.key !== "undefined") {
        return ev.key;
    }

    const c = ev.charCode || ev.keyCode;
    if (c === 27) {
        return "Escape";
    }
    return String.fromCharCode(c);
}

const MAIN_ID = "main-content";
const SETTINGS_BUTTON_ID = "settings-menu";
const ALTERNATIVE_DISPLAY_ID = "alternative-display";
const NOT_DISPLAYED_ID = "not-displayed";
const HELP_BUTTON_ID = "help-button";

function getSettingsButton() {
    return document.getElementById(SETTINGS_BUTTON_ID);
}

function getHelpButton() {
    return document.getElementById(HELP_BUTTON_ID);
}

// Returns the current URL without any query parameter or hash.
function getNakedUrl() {
    return window.location.href.split("?")[0].split("#")[0];
}

/**
 * This function inserts `newNode` after `referenceNode`. It doesn't work if `referenceNode`
 * doesn't have a parent node.
 *
 * @param {HTMLElement} newNode
 * @param {HTMLElement} referenceNode
 */
function insertAfter(newNode, referenceNode) {
    referenceNode.parentNode.insertBefore(newNode, referenceNode.nextSibling);
}

/**
 * This function creates a new `<section>` with the given `id` and `classes` if it doesn't already
 * exist.
 *
 * More information about this in `switchDisplayedElement` documentation.
 *
 * @param {string} id
 * @param {string} classes
 */
function getOrCreateSection(id, classes) {
    let el = document.getElementById(id);

    if (!el) {
        el = document.createElement("section");
        el.id = id;
        el.className = classes;
        insertAfter(el, document.getElementById(MAIN_ID));
    }
    return el;
}

/**
 * Returns the `<section>` element which contains the displayed element.
 *
 * @return {HTMLElement}
 */
function getAlternativeDisplayElem() {
    return getOrCreateSection(ALTERNATIVE_DISPLAY_ID, "content hidden");
}

/**
 * Returns the `<section>` element which contains the not-displayed elements.
 *
 * @return {HTMLElement}
 */
function getNotDisplayedElem() {
    return getOrCreateSection(NOT_DISPLAYED_ID, "hidden");
}

/**
 * To nicely switch between displayed "extra" elements (such as search results or settings menu)
 * and to alternate between the displayed and not displayed elements, we hold them in two different
 * `<section>` elements. They work in pair: one holds the hidden elements while the other
 * contains the displayed element (there can be only one at the same time!). So basically, we switch
 * elements between the two `<section>` elements.
 *
 * @param {HTMLElement} elemToDisplay
 */
function switchDisplayedElement(elemToDisplay) {
    const el = getAlternativeDisplayElem();

    if (el.children.length > 0) {
        getNotDisplayedElem().appendChild(el.firstElementChild);
    }
    if (elemToDisplay === null) {
        addClass(el, "hidden");
        showMain();
        return;
    }
    el.appendChild(elemToDisplay);
    hideMain();
    removeClass(el, "hidden");
}

function browserSupportsHistoryApi() {
    return window.history && typeof window.history.pushState === "function";
}

function preLoadCss(cssUrl) {
    // https://developer.mozilla.org/en-US/docs/Web/HTML/Link_types/preload
    const link = document.createElement("link");
    link.href = cssUrl;
    link.rel = "preload";
    link.as = "style";
    document.getElementsByTagName("head")[0].appendChild(link);
}

(function() {
    const isHelpPage = window.location.pathname.endsWith("/help.html");

    function loadScript(url) {
        const script = document.createElement("script");
        script.src = url;
        document.head.append(script);
    }

    getSettingsButton().onclick = event => {
        if (event.ctrlKey || event.altKey || event.metaKey) {
            return;
        }
        window.hideAllModals(false);
        addClass(getSettingsButton(), "rotate");
        event.preventDefault();
        // Sending request for the CSS and the JS files at the same time so it will
        // hopefully be loaded when the JS will generate the settings content.
        loadScript(getVar("static-root-path") + getVar("settings-js"));
        // Pre-load all theme CSS files, so that switching feels seamless.
        //
        // When loading settings.html as a standalone page, the equivalent HTML is
        // generated in context.rs.
        setTimeout(() => {
            const themes = getVar("themes").split(",");
            for (const theme of themes) {
                // if there are no themes, do nothing
                // "".split(",") == [""]
                if (theme !== "") {
                    preLoadCss(getVar("root-path") + theme + ".css");
                }
            }
        }, 0);
    };

    window.searchState = {
        loadingText: "Loading search results...",
        input: document.getElementsByClassName("search-input")[0],
        outputElement: () => {
            let el = document.getElementById("search");
            if (!el) {
                el = document.createElement("section");
                el.id = "search";
                getNotDisplayedElem().appendChild(el);
            }
            return el;
        },
        title: document.title,
        titleBeforeSearch: document.title,
        timeout: null,
        // On the search screen, so you remain on the last tab you opened.
        //
        // 0 for "In Names"
        // 1 for "In Parameters"
        // 2 for "In Return Types"
        currentTab: 0,
        // tab and back preserves the element that was focused.
        focusedByTab: [null, null, null],
        clearInputTimeout: () => {
            if (searchState.timeout !== null) {
                clearTimeout(searchState.timeout);
                searchState.timeout = null;
            }
        },
        isDisplayed: () => searchState.outputElement().parentElement.id === ALTERNATIVE_DISPLAY_ID,
        // Sets the focus on the search bar at the top of the page
        focus: () => {
            searchState.input.focus();
        },
        // Removes the focus from the search bar.
        defocus: () => {
            searchState.input.blur();
        },
        showResults: search => {
            if (search === null || typeof search === "undefined") {
                search = searchState.outputElement();
            }
            switchDisplayedElement(search);
            searchState.mouseMovedAfterSearch = false;
            document.title = searchState.title;
        },
        removeQueryParameters: () => {
            // We change the document title.
            document.title = searchState.titleBeforeSearch;
            if (browserSupportsHistoryApi()) {
                history.replaceState(null, "", getNakedUrl() + window.location.hash);
            }
        },
        hideResults: () => {
            switchDisplayedElement(null);
            // We also remove the query parameter from the URL.
            searchState.removeQueryParameters();
        },
        getQueryStringParams: () => {
            const params = {};
            window.location.search.substring(1).split("&").
                map(s => {
                    const pair = s.split("=");
                    params[decodeURIComponent(pair[0])] =
                        typeof pair[1] === "undefined" ? null : decodeURIComponent(pair[1]);
                });
            return params;
        },
        setup: () => {
            const search_input = searchState.input;
            if (!searchState.input) {
                return;
            }
            let searchLoaded = false;
            function loadSearch() {
                if (!searchLoaded) {
                    searchLoaded = true;
                    loadScript(getVar("static-root-path") + getVar("search-js"));
                    loadScript(resourcePath("search-index", ".js"));
                }
            }

            search_input.addEventListener("focus", () => {
                search_input.origPlaceholder = search_input.placeholder;
                search_input.placeholder = "Type your search here.";
                loadSearch();
            });

            if (search_input.value !== "") {
                loadSearch();
            }

            const params = searchState.getQueryStringParams();
            if (params.search !== undefined) {
                searchState.setLoadingSearch();
                loadSearch();
            }
        },
        setLoadingSearch: () => {
            const search = searchState.outputElement();
            search.innerHTML = "<h3 class=\"search-loading\">" + searchState.loadingText + "</h3>";
            searchState.showResults(search);
        },
    };

    const toggleAllDocsId = "toggle-all-docs";
    let savedHash = "";

    function handleHashes(ev) {
        if (ev !== null && searchState.isDisplayed() && ev.newURL) {
            // This block occurs when clicking on an element in the navbar while
            // in a search.
            switchDisplayedElement(null);
            const hash = ev.newURL.slice(ev.newURL.indexOf("#") + 1);
            if (browserSupportsHistoryApi()) {
                // `window.location.search`` contains all the query parameters, not just `search`.
                history.replaceState(null, "",
                    getNakedUrl() + window.location.search + "#" + hash);
            }
            const elem = document.getElementById(hash);
            if (elem) {
                elem.scrollIntoView();
            }
        }
        // This part is used in case an element is not visible.
        const pageId = window.location.hash.replace(/^#/, "");
        if (savedHash !== pageId) {
            savedHash = pageId;
            if (pageId !== "") {
                expandSection(pageId);
            }
        }
        if (savedHash.startsWith("impl-")) {
            // impl-disambiguated links, used by the search engine
            // format: impl-X[-for-Y]/method.WHATEVER
            // turn this into method.WHATEVER[-NUMBER]
            const splitAt = savedHash.indexOf("/");
            if (splitAt !== -1) {
                const implId = savedHash.slice(0, splitAt);
                const assocId = savedHash.slice(splitAt + 1);
                const implElem = document.getElementById(implId);
                if (implElem && implElem.parentElement.tagName === "SUMMARY" &&
                    implElem.parentElement.parentElement.tagName === "DETAILS") {
                    onEachLazy(implElem.parentElement.parentElement.querySelectorAll(
                        `[id^="${assocId}"]`),
                        item => {
                            const numbered = /([^-]+)-([0-9]+)/.exec(item.id);
                            if (item.id === assocId || (numbered && numbered[1] === assocId)) {
                                openParentDetails(item);
                                item.scrollIntoView();
                                // Let the section expand itself before trying to highlight
                                setTimeout(() => {
                                    window.location.replace("#" + item.id);
                                }, 0);
                            }
                        }
                    );
                }
            }
        }
    }

    function onHashChange(ev) {
        // If we're in mobile mode, we should hide the sidebar in any case.
        hideSidebar();
        handleHashes(ev);
    }

    function openParentDetails(elem) {
        while (elem) {
            if (elem.tagName === "DETAILS") {
                elem.open = true;
            }
            elem = elem.parentNode;
        }
    }

    function expandSection(id) {
        openParentDetails(document.getElementById(id));
    }

    function handleEscape(ev) {
        searchState.clearInputTimeout();
        searchState.hideResults();
        ev.preventDefault();
        searchState.defocus();
        window.hideAllModals(true); // true = reset focus for tooltips
    }

    function handleShortcut(ev) {
        // Don't interfere with browser shortcuts
        const disableShortcuts = getSettingValue("disable-shortcuts") === "true";
        if (ev.ctrlKey || ev.altKey || ev.metaKey || disableShortcuts) {
            return;
        }

        if (document.activeElement.tagName === "INPUT" &&
            document.activeElement.type !== "checkbox" &&
            document.activeElement.type !== "radio") {
            switch (getVirtualKey(ev)) {
            case "Escape":
                handleEscape(ev);
                break;
            }
        } else {
            switch (getVirtualKey(ev)) {
            case "Escape":
                handleEscape(ev);
                break;

            case "s":
            case "S":
                ev.preventDefault();
                searchState.focus();
                break;

            case "+":
                ev.preventDefault();
                expandAllDocs();
                break;
            case "-":
                ev.preventDefault();
                collapseAllDocs();
                break;

            case "?":
                showHelp();
                break;

            default:
                break;
            }
        }
    }

    document.addEventListener("keypress", handleShortcut);
    document.addEventListener("keydown", handleShortcut);

    function addSidebarItems() {
        if (!window.SIDEBAR_ITEMS) {
            return;
        }
        const sidebar = document.getElementsByClassName("sidebar-elems")[0];

        /**
         * Append to the sidebar a "block" of links - a heading along with a list (`<ul>`) of items.
         *
         * @param {string} shortty - A short type name, like "primitive", "mod", or "macro"
         * @param {string} id - The HTML id of the corresponding section on the module page.
         * @param {string} longty - A long, capitalized, plural name, like "Primitive Types",
         *                          "Modules", or "Macros".
         */
        function block(shortty, id, longty) {
            const filtered = window.SIDEBAR_ITEMS[shortty];
            if (!filtered) {
                return;
            }

            const modpath = hasClass(document.body, "mod") ? "../" : "";

            const h3 = document.createElement("h3");
            h3.innerHTML = `<a href="${modpath}index.html#${id}">${longty}</a>`;
            const ul = document.createElement("ul");
            ul.className = "block " + shortty;

            for (const name of filtered) {
                let path;
                if (shortty === "mod") {
                    path = `${modpath}${name}/index.html`;
                } else {
                    path = `${modpath}${shortty}.${name}.html`;
                }
                let current_page = document.location.href.toString();
                if (current_page.endsWith("/")) {
                    current_page += "index.html";
                }
                const link = document.createElement("a");
                link.href = path;
                if (link.href === current_page) {
                    link.className = "current";
                }
                link.textContent = name;
                const li = document.createElement("li");
                li.appendChild(link);
                ul.appendChild(li);
            }
            sidebar.appendChild(h3);
            sidebar.appendChild(ul);
        }

        if (sidebar) {
            // keep this synchronized with ItemSection::ALL in html/render/mod.rs
            // Re-exports aren't shown here, because they don't have child pages
            //block("reexport", "reexports", "Re-exports");
            block("primitive", "primitives", "Primitive Types");
            block("mod", "modules", "Modules");
            block("macro", "macros", "Macros");
            block("struct", "structs", "Structs");
            block("enum", "enums", "Enums");
            block("constant", "constants", "Constants");
            block("static", "static", "Statics");
            block("trait", "traits", "Traits");
            block("fn", "functions", "Functions");
            block("type", "types", "Type Aliases");
            block("union", "unions", "Unions");
            // No point, because these items don't appear in modules
            //block("impl", "impls", "Implementations");
            //block("tymethod", "tymethods", "Type Methods");
            //block("method", "methods", "Methods");
            //block("structfield", "fields", "Fields");
            //block("variant", "variants", "Variants");
            //block("associatedtype", "associated-types", "Associated Types");
            //block("associatedconstant", "associated-consts", "Associated Constants");
            block("foreigntype", "foreign-types", "Foreign Types");
            block("keyword", "keywords", "Keywords");
            block("opaque", "opaque-types", "Opaque Types");
            block("attr", "attributes", "Attribute Macros");
            block("derive", "derives", "Derive Macros");
            block("traitalias", "trait-aliases", "Trait Aliases");
        }
    }

    // <https://github.com/search?q=repo%3Arust-lang%2Frust+[RUSTDOCIMPL]+trait.impl&type=code>
    window.register_implementors = imp => {
        const implementors = document.getElementById("implementors-list");
        const synthetic_implementors = document.getElementById("synthetic-implementors-list");
        const inlined_types = new Set();

        const TEXT_IDX = 0;
        const SYNTHETIC_IDX = 1;
        const TYPES_IDX = 2;

        if (synthetic_implementors) {
            // This `inlined_types` variable is used to avoid having the same implementation
            // showing up twice. For example "String" in the "Sync" doc page.
            //
            // By the way, this is only used by and useful for traits implemented automatically
            // (like "Send" and "Sync").
            onEachLazy(synthetic_implementors.getElementsByClassName("impl"), el => {
                const aliases = el.getAttribute("data-aliases");
                if (!aliases) {
                    return;
                }
                aliases.split(",").forEach(alias => {
                    inlined_types.add(alias);
                });
            });
        }

        let currentNbImpls = implementors.getElementsByClassName("impl").length;
        const traitName = document.querySelector(".main-heading h1 > .trait").textContent;
        const baseIdName = "impl-" + traitName + "-";
        const libs = Object.getOwnPropertyNames(imp);
        // We don't want to include impls from this JS file, when the HTML already has them.
        // The current crate should always be ignored. Other crates that should also be
        // ignored are included in the attribute `data-ignore-extern-crates`.
        const script = document
            .querySelector("script[data-ignore-extern-crates]");
        const ignoreExternCrates = new Set(
            (script ? script.getAttribute("data-ignore-extern-crates") : "").split(",")
        );
        for (const lib of libs) {
            if (lib === window.currentCrate || ignoreExternCrates.has(lib)) {
                continue;
            }
            const structs = imp[lib];

            struct_loop:
            for (const struct of structs) {
                const list = struct[SYNTHETIC_IDX] ? synthetic_implementors : implementors;

                // The types list is only used for synthetic impls.
                // If this changes, `main.js` and `write_shared.rs` both need changed.
                if (struct[SYNTHETIC_IDX]) {
                    for (const struct_type of struct[TYPES_IDX]) {
                        if (inlined_types.has(struct_type)) {
                            continue struct_loop;
                        }
                        inlined_types.add(struct_type);
                    }
                }

                const code = document.createElement("h3");
                code.innerHTML = struct[TEXT_IDX];
                addClass(code, "code-header");

                onEachLazy(code.getElementsByTagName("a"), elem => {
                    const href = elem.getAttribute("href");

                    if (href && !href.startsWith("#") && !/^(?:[a-z+]+:)?\/\//.test(href)) {
                        elem.setAttribute("href", window.rootPath + href);
                    }
                });

                const currentId = baseIdName + currentNbImpls;
                const anchor = document.createElement("a");
                anchor.href = "#" + currentId;
                addClass(anchor, "anchor");

                const display = document.createElement("div");
                display.id = currentId;
                addClass(display, "impl");
                display.appendChild(anchor);
                display.appendChild(code);
                list.appendChild(display);
                currentNbImpls += 1;
            }
        }
    };
    if (window.pending_implementors) {
        window.register_implementors(window.pending_implementors);
    }

    /**
     * <https://github.com/search?q=repo%3Arust-lang%2Frust+[RUSTDOCIMPL]+type.impl&type=code>
     *
     * [RUSTDOCIMPL] type.impl
     *
     * This code inlines implementations into the type alias docs at runtime. It's done at
     * runtime because some crates have many type aliases and many methods, and we don't want
     * to generate *O*`(types*methods)` HTML text. The data inside is mostly HTML fragments,
     * wrapped in JSON.
     *
     * - It only includes docs generated for the current crate. This function accepts an
     *   object mapping crate names to the set of impls.
     *
     * - It filters down to the set of applicable impls. The Rust type checker is used to
     *   tag each HTML blob with the set of type aliases that can actually use it, so the
     *   JS only needs to consult the attached list of type aliases.
     *
     * - It renames the ID attributes, to avoid conflicting IDs in the resulting DOM.
     *
     * - It adds the necessary items to the sidebar. If it's an inherent impl, that means
     *   adding methods, associated types, and associated constants. If it's a trait impl,
     *   that means adding it to the trait impl sidebar list.
     *
     * - It adds the HTML block itself. If it's an inherent impl, it goes after the type
     *   alias's own inherent impls. If it's a trait impl, it goes in the Trait
     *   Implementations section.
     *
     * - After processing all of the impls, it sorts the sidebar items by name.
     *
     * @param {{[cratename: string]: Array<Array<string|0>>}} impl
     */
    window.register_type_impls = imp => {
        if (!imp || !imp[window.currentCrate]) {
            return;
        }
        window.pending_type_impls = null;
        const idMap = new Map();

        let implementations = document.getElementById("implementations-list");
        let trait_implementations = document.getElementById("trait-implementations-list");

        // We want to include the current type alias's impls, and no others.
        const script = document.querySelector("script[data-self-path]");
        const selfPath = script ? script.getAttribute("data-self-path") : null;

        // These sidebar blocks need filled in, too.
        const sidebarSection = document.querySelector(".sidebar section");
        let methods = document.querySelector(".sidebar .block.method");
        let associatedTypes = document.querySelector(".sidebar .block.associatedtype");
        let associatedConstants = document.querySelector(".sidebar .block.associatedconstant");
        let sidebarTraitList = document.querySelector(".sidebar .block.trait-implementation");

        for (const impList of imp[window.currentCrate]) {
            const types = impList.slice(2);
            const text = impList[0];
            const isTrait = impList[1] !== 0;
            const traitName = impList[1];
            if (types.indexOf(selfPath) === -1) {
                continue;
            }
            let outputList = isTrait ? trait_implementations : implementations;
            if (outputList === null) {
                const outputListName = isTrait ? "Trait Implementations" : "Implementations";
                const outputListId = isTrait ?
                    "trait-implementations-list" :
                    "implementations-list";
                const outputListHeaderId = isTrait ? "trait-implementations" : "implementations";
                const outputListHeader = document.createElement("h2");
                outputListHeader.id = outputListHeaderId;
                outputListHeader.innerText = outputListName;
                outputList = document.createElement("div");
                outputList.id = outputListId;
                if (isTrait) {
                    const link = document.createElement("a");
                    link.href = `#${outputListHeaderId}`;
                    link.innerText = "Trait Implementations";
                    const h = document.createElement("h3");
                    h.appendChild(link);
                    trait_implementations = outputList;
                    sidebarSection.appendChild(h);
                    sidebarTraitList = document.createElement("ul");
                    sidebarTraitList.className = "block trait-implementation";
                    sidebarSection.appendChild(sidebarTraitList);
                    const mainContent = document.querySelector("#main-content");
                    mainContent.appendChild(outputListHeader);
                    mainContent.appendChild(outputList);
                } else {
                    implementations = outputList;
                    if (trait_implementations) {
                        document.insertBefore(outputListHeader, trait_implementations);
                        document.insertBefore(outputList, trait_implementations);
                    } else {
                        const mainContent = document.querySelector("#main-content");
                        mainContent.appendChild(outputListHeader);
                        mainContent.appendChild(outputList);
                    }
                }
            }
            const template = document.createElement("template");
            template.innerHTML = text;

            onEachLazy(template.content.querySelectorAll("a"), elem => {
                const href = elem.getAttribute("href");

                if (href && !href.startsWith("#") && !/^(?:[a-z+]+:)?\/\//.test(href)) {
                    elem.setAttribute("href", window.rootPath + href);
                }
            });
            onEachLazy(template.content.querySelectorAll("[id]"), el => {
                let i = 0;
                if (idMap.has(el.id)) {
                    i = idMap.get(el.id);
                } else if (document.getElementById(el.id)) {
                    i = 1;
                    while (document.getElementById(`${el.id}-${2 * i}`)) {
                        i = 2 * i;
                    }
                    while (document.getElementById(`${el.id}-${i}`)) {
                        i += 1;
                    }
                }
                if (i !== 0) {
                    el.id = `${el.id}-${i}`;
                }
                idMap.set(el.id, i + 1);
            });
            const templateAssocItems = template.content.querySelectorAll("section.tymethod, " +
                "section.method, section.associatedtype, section.associatedconstant");
            if (isTrait) {
                const li = document.createElement("li");
                const a = document.createElement("a");
                a.href = `#${template.content.querySelector(".impl").id}`;
                a.textContent = traitName;
                li.appendChild(a);
                sidebarTraitList.append(li);
            } else {
                onEachLazy(templateAssocItems, item => {
                    let block = hasClass(item, "associatedtype") ? associatedTypes : (
                        hasClass(item, "associatedconstant") ? associatedConstants : (
                        methods));
                    if (!block) {
                        const blockTitle = hasClass(item, "associatedtype") ? "Associated Types" : (
                            hasClass(item, "associatedconstant") ? "Associated Constants" : (
                            "Methods"));
                        const blockClass = hasClass(item, "associatedtype") ? "associatedtype" : (
                            hasClass(item, "associatedconstant") ? "associatedconstant" : (
                            "method"));
                        const blockHeader = document.createElement("h3");
                        const blockLink = document.createElement("a");
                        blockLink.href = "#implementations";
                        blockLink.innerText = blockTitle;
                        blockHeader.appendChild(blockLink);
                        block = document.createElement("ul");
                        block.className = `block ${blockClass}`;
                        const insertionReference = methods || sidebarTraitList;
                        if (insertionReference) {
                            const insertionReferenceH = insertionReference.previousElementSibling;
                            sidebarSection.insertBefore(blockHeader, insertionReferenceH);
                            sidebarSection.insertBefore(block, insertionReferenceH);
                        } else {
                            sidebarSection.appendChild(blockHeader);
                            sidebarSection.appendChild(block);
                        }
                        if (hasClass(item, "associatedtype")) {
                            associatedTypes = block;
                        } else if (hasClass(item, "associatedconstant")) {
                            associatedConstants = block;
                        } else {
                            methods = block;
                        }
                    }
                    const li = document.createElement("li");
                    const a = document.createElement("a");
                    a.innerText = item.id.split("-")[0].split(".")[1];
                    a.href = `#${item.id}`;
                    li.appendChild(a);
                    block.appendChild(li);
                });
            }
            outputList.appendChild(template.content);
        }

        for (const list of [methods, associatedTypes, associatedConstants, sidebarTraitList]) {
            if (!list) {
                continue;
            }
            const newChildren = Array.prototype.slice.call(list.children);
            newChildren.sort((a, b) => {
                const aI = a.innerText;
                const bI = b.innerText;
                return aI < bI ? -1 :
                    aI > bI ? 1 :
                    0;
            });
            list.replaceChildren(...newChildren);
        }
    };
    if (window.pending_type_impls) {
        window.register_type_impls(window.pending_type_impls);
    }

    function addSidebarCrates() {
        if (!window.ALL_CRATES) {
            return;
        }
        const sidebarElems = document.getElementsByClassName("sidebar-elems")[0];
        if (!sidebarElems) {
            return;
        }
        // Draw a convenient sidebar of known crates if we have a listing
        const h3 = document.createElement("h3");
        h3.innerHTML = "Crates";
        const ul = document.createElement("ul");
        ul.className = "block crate";

        for (const crate of window.ALL_CRATES) {
            const link = document.createElement("a");
            link.href = window.rootPath + crate + "/index.html";
            if (window.rootPath !== "./" && crate === window.currentCrate) {
                link.className = "current";
            }
            link.textContent = crate;

            const li = document.createElement("li");
            li.appendChild(link);
            ul.appendChild(li);
        }
        sidebarElems.appendChild(h3);
        sidebarElems.appendChild(ul);
    }

    function expandAllDocs() {
        const innerToggle = document.getElementById(toggleAllDocsId);
        removeClass(innerToggle, "will-expand");
        onEachLazy(document.getElementsByClassName("toggle"), e => {
            if (!hasClass(e, "type-contents-toggle") && !hasClass(e, "more-examples-toggle")) {
                e.open = true;
            }
        });
        innerToggle.title = "collapse all docs";
        innerToggle.children[0].innerText = "\u2212"; // "\u2212" is "−" minus sign
    }

    function collapseAllDocs() {
        const innerToggle = document.getElementById(toggleAllDocsId);
        addClass(innerToggle, "will-expand");
        onEachLazy(document.getElementsByClassName("toggle"), e => {
            if (e.parentNode.id !== "implementations-list" ||
                (!hasClass(e, "implementors-toggle") &&
                 !hasClass(e, "type-contents-toggle"))
            ) {
                e.open = false;
            }
        });
        innerToggle.title = "expand all docs";
        innerToggle.children[0].innerText = "+";
    }

    function toggleAllDocs() {
        const innerToggle = document.getElementById(toggleAllDocsId);
        if (!innerToggle) {
            return;
        }
        if (hasClass(innerToggle, "will-expand")) {
            expandAllDocs();
        } else {
            collapseAllDocs();
        }
    }

    (function() {
        const toggles = document.getElementById(toggleAllDocsId);
        if (toggles) {
            toggles.onclick = toggleAllDocs;
        }

        const hideMethodDocs = getSettingValue("auto-hide-method-docs") === "true";
        const hideImplementations = getSettingValue("auto-hide-trait-implementations") === "true";
        const hideLargeItemContents = getSettingValue("auto-hide-large-items") !== "false";

        function setImplementorsTogglesOpen(id, open) {
            const list = document.getElementById(id);
            if (list !== null) {
                onEachLazy(list.getElementsByClassName("implementors-toggle"), e => {
                    e.open = open;
                });
            }
        }

        if (hideImplementations) {
            setImplementorsTogglesOpen("trait-implementations-list", false);
            setImplementorsTogglesOpen("blanket-implementations-list", false);
        }

        onEachLazy(document.getElementsByClassName("toggle"), e => {
            if (!hideLargeItemContents && hasClass(e, "type-contents-toggle")) {
                e.open = true;
            }
            if (hideMethodDocs && hasClass(e, "method-toggle")) {
                e.open = false;
            }

        });
    }());

    window.rustdoc_add_line_numbers_to_examples = () => {
        onEachLazy(document.getElementsByClassName("rust-example-rendered"), x => {
            const parent = x.parentNode;
            const line_numbers = parent.querySelectorAll(".example-line-numbers");
            if (line_numbers.length > 0) {
                return;
            }
            const count = x.textContent.split("\n").length;
            const elems = [];
            for (let i = 0; i < count; ++i) {
                elems.push(i + 1);
            }
            const node = document.createElement("pre");
            addClass(node, "example-line-numbers");
            node.innerHTML = elems.join("\n");
            parent.insertBefore(node, x);
        });
    };

    window.rustdoc_remove_line_numbers_from_examples = () => {
        onEachLazy(document.getElementsByClassName("rust-example-rendered"), x => {
            const parent = x.parentNode;
            const line_numbers = parent.querySelectorAll(".example-line-numbers");
            for (const node of line_numbers) {
                parent.removeChild(node);
            }
        });
    };

    if (getSettingValue("line-numbers") === "true") {
        window.rustdoc_add_line_numbers_to_examples();
    }

    function showSidebar() {
        window.hideAllModals(false);
        const sidebar = document.getElementsByClassName("sidebar")[0];
        addClass(sidebar, "shown");
    }

    function hideSidebar() {
        const sidebar = document.getElementsByClassName("sidebar")[0];
        removeClass(sidebar, "shown");
    }

    window.addEventListener("resize", () => {
        if (window.CURRENT_TOOLTIP_ELEMENT) {
            // As a workaround to the behavior of `contains: layout` used in doc togglers,
            // tooltip popovers are positioned using javascript.
            //
            // This means when the window is resized, we need to redo the layout.
            const base = window.CURRENT_TOOLTIP_ELEMENT.TOOLTIP_BASE;
            const force_visible = base.TOOLTIP_FORCE_VISIBLE;
            hideTooltip(false);
            if (force_visible) {
                showTooltip(base);
                base.TOOLTIP_FORCE_VISIBLE = true;
            }
        }
    });

    const mainElem = document.getElementById(MAIN_ID);
    if (mainElem) {
        mainElem.addEventListener("click", hideSidebar);
    }

    onEachLazy(document.querySelectorAll("a[href^='#']"), el => {
        // For clicks on internal links (<A> tags with a hash property), we expand the section we're
        // jumping to *before* jumping there. We can't do this in onHashChange, because it changes
        // the height of the document so we wind up scrolled to the wrong place.
        el.addEventListener("click", () => {
            expandSection(el.hash.slice(1));
            hideSidebar();
        });
    });

    onEachLazy(document.querySelectorAll(".toggle > summary:not(.hideme)"), el => {
        el.addEventListener("click", e => {
            if (e.target.tagName !== "SUMMARY" && e.target.tagName !== "A") {
                e.preventDefault();
            }
        });
    });

    /**
     * Show a tooltip immediately.
     *
     * @param {DOMElement} e - The tooltip's anchor point. The DOM is consulted to figure
     *                         out what the tooltip should contain, and where it should be
     *                         positioned.
     */
    function showTooltip(e) {
        const notable_ty = e.getAttribute("data-notable-ty");
        if (!window.NOTABLE_TRAITS && notable_ty) {
            const data = document.getElementById("notable-traits-data");
            if (data) {
                window.NOTABLE_TRAITS = JSON.parse(data.innerText);
            } else {
                throw new Error("showTooltip() called with notable without any notable traits!");
            }
        }
        // Make this function idempotent. If the tooltip is already shown, avoid doing extra work
        // and leave it alone.
        if (window.CURRENT_TOOLTIP_ELEMENT && window.CURRENT_TOOLTIP_ELEMENT.TOOLTIP_BASE === e) {
            clearTooltipHoverTimeout(window.CURRENT_TOOLTIP_ELEMENT);
            return;
        }
        window.hideAllModals(false);
        const wrapper = document.createElement("div");
        if (notable_ty) {
            wrapper.innerHTML = "<div class=\"content\">" +
                window.NOTABLE_TRAITS[notable_ty] + "</div>";
        } else {
            // Replace any `title` attribute with `data-title` to avoid double tooltips.
            if (e.getAttribute("title") !== null) {
                e.setAttribute("data-title", e.getAttribute("title"));
                e.removeAttribute("title");
            }
            if (e.getAttribute("data-title") !== null) {
                const titleContent = document.createElement("div");
                titleContent.className = "content";
                titleContent.appendChild(document.createTextNode(e.getAttribute("data-title")));
                wrapper.appendChild(titleContent);
            }
        }
        wrapper.className = "tooltip popover";
        const focusCatcher = document.createElement("div");
        focusCatcher.setAttribute("tabindex", "0");
        focusCatcher.onfocus = hideTooltip;
        wrapper.appendChild(focusCatcher);
        const pos = e.getBoundingClientRect();
        // 5px overlap so that the mouse can easily travel from place to place
        wrapper.style.top = (pos.top + window.scrollY + pos.height) + "px";
        wrapper.style.left = 0;
        wrapper.style.right = "auto";
        wrapper.style.visibility = "hidden";
        const body = document.getElementsByTagName("body")[0];
        body.appendChild(wrapper);
        const wrapperPos = wrapper.getBoundingClientRect();
        // offset so that the arrow points at the center of the "(i)"
        const finalPos = pos.left + window.scrollX - wrapperPos.width + 24;
        if (finalPos > 0) {
            wrapper.style.left = finalPos + "px";
        } else {
            wrapper.style.setProperty(
                "--popover-arrow-offset",
                (wrapperPos.right - pos.right + 4) + "px"
            );
        }
        wrapper.style.visibility = "";
        window.CURRENT_TOOLTIP_ELEMENT = wrapper;
        window.CURRENT_TOOLTIP_ELEMENT.TOOLTIP_BASE = e;
        clearTooltipHoverTimeout(window.CURRENT_TOOLTIP_ELEMENT);
        wrapper.onpointerenter = ev => {
            // If this is a synthetic touch event, ignore it. A click event will be along shortly.
            if (ev.pointerType !== "mouse") {
                return;
            }
            clearTooltipHoverTimeout(e);
        };
        wrapper.onpointerleave = ev => {
            // If this is a synthetic touch event, ignore it. A click event will be along shortly.
            if (ev.pointerType !== "mouse") {
                return;
            }
            if (!e.TOOLTIP_FORCE_VISIBLE && !elemIsInParent(ev.relatedTarget, e)) {
                // See "Tooltip pointer leave gesture" below.
                setTooltipHoverTimeout(e, false);
                addClass(wrapper, "fade-out");
            }
        };
    }

    /**
     * Show or hide the tooltip after a timeout. If a timeout was already set before this function
     * was called, that timeout gets cleared. If the tooltip is already in the requested state,
     * this function will still clear any pending timeout, but otherwise do nothing.
     *
     * @param {DOMElement} element - The tooltip's anchor point. The DOM is consulted to figure
     *                               out what the tooltip should contain, and where it should be
     *                               positioned.
     * @param {boolean}    show    - If true, the tooltip will be made visible. If false, it will
     *                               be hidden.
     */
    function setTooltipHoverTimeout(element, show) {
        clearTooltipHoverTimeout(element);
        if (!show && !window.CURRENT_TOOLTIP_ELEMENT) {
            // To "hide" an already hidden element, just cancel its timeout.
            return;
        }
        if (show && window.CURRENT_TOOLTIP_ELEMENT) {
            // To "show" an already visible element, just cancel its timeout.
            return;
        }
        if (window.CURRENT_TOOLTIP_ELEMENT &&
            window.CURRENT_TOOLTIP_ELEMENT.TOOLTIP_BASE !== element) {
            // Don't do anything if another tooltip is already visible.
            return;
        }
        element.TOOLTIP_HOVER_TIMEOUT = setTimeout(() => {
            if (show) {
                showTooltip(element);
            } else if (!element.TOOLTIP_FORCE_VISIBLE) {
                hideTooltip(false);
            }
        }, show ? window.RUSTDOC_TOOLTIP_HOVER_MS : window.RUSTDOC_TOOLTIP_HOVER_EXIT_MS);
    }

    /**
     * If a show/hide timeout was set by `setTooltipHoverTimeout`, cancel it. If none exists,
     * do nothing.
     *
     * @param {DOMElement} element - The tooltip's anchor point,
     *                               as passed to `setTooltipHoverTimeout`.
     */
    function clearTooltipHoverTimeout(element) {
        if (element.TOOLTIP_HOVER_TIMEOUT !== undefined) {
            removeClass(window.CURRENT_TOOLTIP_ELEMENT, "fade-out");
            clearTimeout(element.TOOLTIP_HOVER_TIMEOUT);
            delete element.TOOLTIP_HOVER_TIMEOUT;
        }
    }

    function tooltipBlurHandler(event) {
        if (window.CURRENT_TOOLTIP_ELEMENT &&
            !elemIsInParent(document.activeElement, window.CURRENT_TOOLTIP_ELEMENT) &&
            !elemIsInParent(event.relatedTarget, window.CURRENT_TOOLTIP_ELEMENT) &&
            !elemIsInParent(document.activeElement, window.CURRENT_TOOLTIP_ELEMENT.TOOLTIP_BASE) &&
            !elemIsInParent(event.relatedTarget, window.CURRENT_TOOLTIP_ELEMENT.TOOLTIP_BASE)
        ) {
            // Work around a difference in the focus behaviour between Firefox, Chrome, and Safari.
            // When I click the button on an already-opened tooltip popover, Safari
            // hides the popover and then immediately shows it again, while everyone else hides it
            // and it stays hidden.
            //
            // To work around this, make sure the click finishes being dispatched before
            // hiding the popover. Since `hideTooltip()` is idempotent, this makes Safari behave
            // consistently with the other two.
            setTimeout(() => hideTooltip(false), 0);
        }
    }

    /**
     * Hide the current tooltip immediately.
     *
     * @param {boolean} focus - If set to `true`, move keyboard focus to the tooltip anchor point.
     *                          If set to `false`, leave keyboard focus alone.
     */
    function hideTooltip(focus) {
        if (window.CURRENT_TOOLTIP_ELEMENT) {
            if (window.CURRENT_TOOLTIP_ELEMENT.TOOLTIP_BASE.TOOLTIP_FORCE_VISIBLE) {
                if (focus) {
                    window.CURRENT_TOOLTIP_ELEMENT.TOOLTIP_BASE.focus();
                }
                window.CURRENT_TOOLTIP_ELEMENT.TOOLTIP_BASE.TOOLTIP_FORCE_VISIBLE = false;
            }
            const body = document.getElementsByTagName("body")[0];
            body.removeChild(window.CURRENT_TOOLTIP_ELEMENT);
            clearTooltipHoverTimeout(window.CURRENT_TOOLTIP_ELEMENT);
            window.CURRENT_TOOLTIP_ELEMENT = null;
        }
    }

    onEachLazy(document.getElementsByClassName("tooltip"), e => {
        e.onclick = () => {
            e.TOOLTIP_FORCE_VISIBLE = e.TOOLTIP_FORCE_VISIBLE ? false : true;
            if (window.CURRENT_TOOLTIP_ELEMENT && !e.TOOLTIP_FORCE_VISIBLE) {
                hideTooltip(true);
            } else {
                showTooltip(e);
                window.CURRENT_TOOLTIP_ELEMENT.setAttribute("tabindex", "0");
                window.CURRENT_TOOLTIP_ELEMENT.focus();
                window.CURRENT_TOOLTIP_ELEMENT.onblur = tooltipBlurHandler;
            }
            return false;
        };
        e.onpointerenter = ev => {
            // If this is a synthetic touch event, ignore it. A click event will be along shortly.
            if (ev.pointerType !== "mouse") {
                return;
            }
            setTooltipHoverTimeout(e, true);
        };
        e.onpointermove = ev => {
            // If this is a synthetic touch event, ignore it. A click event will be along shortly.
            if (ev.pointerType !== "mouse") {
                return;
            }
            setTooltipHoverTimeout(e, true);
        };
        e.onpointerleave = ev => {
            // If this is a synthetic touch event, ignore it. A click event will be along shortly.
            if (ev.pointerType !== "mouse") {
                return;
            }
            if (!e.TOOLTIP_FORCE_VISIBLE &&
                !elemIsInParent(ev.relatedTarget, window.CURRENT_TOOLTIP_ELEMENT)) {
                // Tooltip pointer leave gesture:
                //
                // Designing a good hover microinteraction is a matter of guessing user
                // intent from what are, literally, vague gestures. In this case, guessing if
                // hovering in or out of the tooltip base is intentional or not.
                //
                // To figure this out, a few different techniques are used:
                //
                // * When the mouse pointer enters a tooltip anchor point, its hitbox is grown
                //   on the bottom, where the popover is/will appear. Search "hover tunnel" in
                //   rustdoc.css for the implementation.
                // * There's a delay when the mouse pointer enters the popover base anchor, in
                //   case the mouse pointer was just passing through and the user didn't want
                //   to open it.
                // * Similarly, a delay is added when exiting the anchor, or the popover
                //   itself, before hiding it.
                // * A fade-out animation is layered onto the pointer exit delay to immediately
                //   inform the user that they successfully dismissed the popover, while still
                //   providing a way for them to cancel it if it was a mistake and they still
                //   wanted to interact with it.
                // * No animation is used for revealing it, because we don't want people to try
                //   to interact with an element while it's in the middle of fading in: either
                //   they're allowed to interact with it while it's fading in, meaning it can't
                //   serve as mistake-proofing for the popover, or they can't, but
                //   they might try and be frustrated.
                //
                // See also:
                // * https://www.nngroup.com/articles/timing-exposing-content/
                // * https://www.nngroup.com/articles/tooltip-guidelines/
                // * https://bjk5.com/post/44698559168/breaking-down-amazons-mega-dropdown
                setTooltipHoverTimeout(e, false);
                addClass(window.CURRENT_TOOLTIP_ELEMENT, "fade-out");
            }
        };
    });

    const sidebar_menu_toggle = document.getElementsByClassName("sidebar-menu-toggle")[0];
    if (sidebar_menu_toggle) {
        sidebar_menu_toggle.addEventListener("click", () => {
            const sidebar = document.getElementsByClassName("sidebar")[0];
            if (!hasClass(sidebar, "shown")) {
                showSidebar();
            } else {
                hideSidebar();
            }
        });
    }

    function helpBlurHandler(event) {
        blurHandler(event, getHelpButton(), window.hidePopoverMenus);
    }

    function buildHelpMenu() {
        const book_info = document.createElement("span");
        const channel = getVar("channel");
        book_info.className = "top";
        book_info.innerHTML = `You can find more information in \
<a href="https://doc.rust-lang.org/${channel}/rustdoc/">the rustdoc book</a>.`;

        const shortcuts = [
            ["?", "Show this help dialog"],
            ["S", "Focus the search field"],
            ["↑", "Move up in search results"],
            ["↓", "Move down in search results"],
            ["← / →", "Switch result tab (when results focused)"],
            ["&#9166;", "Go to active search result"],
            ["+", "Expand all sections"],
            ["-", "Collapse all sections"],
        ].map(x => "<dt>" +
            x[0].split(" ")
                .map((y, index) => ((index & 1) === 0 ? "<kbd>" + y + "</kbd>" : " " + y + " "))
                .join("") + "</dt><dd>" + x[1] + "</dd>").join("");
        const div_shortcuts = document.createElement("div");
        addClass(div_shortcuts, "shortcuts");
        div_shortcuts.innerHTML = "<h2>Keyboard Shortcuts</h2><dl>" + shortcuts + "</dl></div>";

        const infos = [
            `For a full list of all search features, take a look <a \
href="https://doc.rust-lang.org/${channel}/rustdoc/how-to-read-rustdoc.html\
#the-search-interface">here</a>.`,
            "Prefix searches with a type followed by a colon (e.g., <code>fn:</code>) to \
             restrict the search to a given item kind.",
            "Accepted kinds are: <code>fn</code>, <code>mod</code>, <code>struct</code>, \
             <code>enum</code>, <code>trait</code>, <code>type</code>, <code>macro</code>, \
             and <code>const</code>.",
            "Search functions by type signature (e.g., <code>vec -&gt; usize</code> or \
             <code>-&gt; vec</code> or <code>String, enum:Cow -&gt; bool</code>)",
            "You can look for items with an exact name by putting double quotes around \
             your request: <code>\"string\"</code>",
             "Look for functions that accept or return \
              <a href=\"https://doc.rust-lang.org/std/primitive.slice.html\">slices</a> and \
              <a href=\"https://doc.rust-lang.org/std/primitive.array.html\">arrays</a> by writing \
              square brackets (e.g., <code>-&gt; [u8]</code> or <code>[] -&gt; Option</code>)",
            "Look for items inside another one by searching for a path: <code>vec::Vec</code>",
        ].map(x => "<p>" + x + "</p>").join("");
        const div_infos = document.createElement("div");
        addClass(div_infos, "infos");
        div_infos.innerHTML = "<h2>Search Tricks</h2>" + infos;

        const rustdoc_version = document.createElement("span");
        rustdoc_version.className = "bottom";
        const rustdoc_version_code = document.createElement("code");
        rustdoc_version_code.innerText = "rustdoc " + getVar("rustdoc-version");
        rustdoc_version.appendChild(rustdoc_version_code);

        const container = document.createElement("div");
        if (!isHelpPage) {
            container.className = "popover";
        }
        container.id = "help";
        container.style.display = "none";

        const side_by_side = document.createElement("div");
        side_by_side.className = "side-by-side";
        side_by_side.appendChild(div_shortcuts);
        side_by_side.appendChild(div_infos);

        container.appendChild(book_info);
        container.appendChild(side_by_side);
        container.appendChild(rustdoc_version);

        if (isHelpPage) {
            const help_section = document.createElement("section");
            help_section.appendChild(container);
            document.getElementById("main-content").appendChild(help_section);
            container.style.display = "block";
        } else {
            const help_button = getHelpButton();
            help_button.appendChild(container);

            container.onblur = helpBlurHandler;
            help_button.onblur = helpBlurHandler;
            help_button.children[0].onblur = helpBlurHandler;
        }

        return container;
    }

    /**
     * Hide popover menus, clickable tooltips, and the sidebar (if applicable).
     *
     * Pass "true" to reset focus for tooltip popovers.
     */
    window.hideAllModals = switchFocus => {
        hideSidebar();
        window.hidePopoverMenus();
        hideTooltip(switchFocus);
    };

    /**
     * Hide all the popover menus.
     */
    window.hidePopoverMenus = () => {
        onEachLazy(document.querySelectorAll(".search-form .popover"), elem => {
            elem.style.display = "none";
        });
    };

    /**
     * Returns the help menu element (not the button).
     *
     * @param {boolean} buildNeeded - If this argument is `false`, the help menu element won't be
     *                                built if it doesn't exist.
     *
     * @return {HTMLElement}
     */
    function getHelpMenu(buildNeeded) {
        let menu = getHelpButton().querySelector(".popover");
        if (!menu && buildNeeded) {
            menu = buildHelpMenu();
        }
        return menu;
    }

    /**
     * Show the help popup menu.
     */
    function showHelp() {
        // Prevent `blur` events from being dispatched as a result of closing
        // other modals.
        getHelpButton().querySelector("a").focus();
        const menu = getHelpMenu(true);
        if (menu.style.display === "none") {
            window.hideAllModals();
            menu.style.display = "";
        }
    }

    if (isHelpPage) {
        showHelp();
        document.querySelector(`#${HELP_BUTTON_ID} > a`).addEventListener("click", event => {
            // Already on the help page, make help button a no-op.
            const target = event.target;
            if (target.tagName !== "A" ||
                target.parentElement.id !== HELP_BUTTON_ID ||
                event.ctrlKey ||
                event.altKey ||
                event.metaKey) {
                return;
            }
            event.preventDefault();
        });
    } else {
        document.querySelector(`#${HELP_BUTTON_ID} > a`).addEventListener("click", event => {
            // By default, have help button open docs in a popover.
            // If user clicks with a moderator, though, use default browser behavior,
            // probably opening in a new window or tab.
            const target = event.target;
            if (target.tagName !== "A" ||
                target.parentElement.id !== HELP_BUTTON_ID ||
                event.ctrlKey ||
                event.altKey ||
                event.metaKey) {
                return;
            }
            event.preventDefault();
            const menu = getHelpMenu(true);
            const shouldShowHelp = menu.style.display === "none";
            if (shouldShowHelp) {
                showHelp();
            } else {
                window.hidePopoverMenus();
            }
        });
    }

    setMobileTopbar();
    addSidebarItems();
    addSidebarCrates();
    onHashChange(null);
    window.addEventListener("hashchange", onHashChange);
    searchState.setup();
}());

(function() {
    let reset_button_timeout = null;

    const but = document.getElementById("copy-path");
    if (!but) {
        return;
    }
    but.onclick = () => {
        const parent = but.parentElement;
        const path = [];

        onEach(parent.childNodes, child => {
            if (child.tagName === "A") {
                path.push(child.textContent);
            }
        });

        const el = document.createElement("textarea");
        el.value = path.join("::");
        el.setAttribute("readonly", "");
        // To not make it appear on the screen.
        el.style.position = "absolute";
        el.style.left = "-9999px";

        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);

        // There is always one children, but multiple childNodes.
        but.children[0].style.display = "none";

        let tmp;
        if (but.childNodes.length < 2) {
            tmp = document.createTextNode("✓");
            but.appendChild(tmp);
        } else {
            onEachLazy(but.childNodes, e => {
                if (e.nodeType === Node.TEXT_NODE) {
                    tmp = e;
                    return true;
                }
            });
            tmp.textContent = "✓";
        }

        if (reset_button_timeout !== null) {
            window.clearTimeout(reset_button_timeout);
        }

        function reset_button() {
            tmp.textContent = "";
            reset_button_timeout = null;
            but.children[0].style.display = "";
        }

        reset_button_timeout = window.setTimeout(reset_button, 1000);
    };
}());
