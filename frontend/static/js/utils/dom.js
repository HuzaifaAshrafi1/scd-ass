(() => {
    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

    const cache = new Map();

    function byId(id) {
        if (!id) return null;
        if (!cache.has(id)) {
            cache.set(id, document.getElementById(id));
        }
        return cache.get(id);
    }

    function invalidate() {
        cache.clear();
    }

    window.AppUtils = window.AppUtils || {};
    Object.assign(window.AppUtils, { $, $$, byId, invalidateDomCache: invalidate });
})();
