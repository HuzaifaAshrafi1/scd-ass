(() => {
    const PREFIX = "pulsechat";

    function readJson(key, fallback) {
        try {
            return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
        } catch {
            return fallback;
        }
    }

    function readRecentSearches(type) {
        return readJson(`${PREFIX}-recent-${type}`, []);
    }

    function saveRecentSearch(type, query, existing = readRecentSearches(type)) {
        const clean = query.trim();
        if (clean.length < 2) return existing;
        const next = [clean, ...existing.filter((item) => item.toLowerCase() !== clean.toLowerCase())].slice(0, 5);
        localStorage.setItem(`${PREFIX}-recent-${type}`, JSON.stringify(next));
        return next;
    }

    function readMessageSide() {
        return localStorage.getItem(`${PREFIX}-message-side`) === "sender" ? "sender" : "receiver";
    }

    function writeMessageSide(side) {
        const mode = side === "sender" ? "sender" : "receiver";
        localStorage.setItem(`${PREFIX}-message-side`, mode);
        return mode;
    }

    function readDarkMode() {
        return localStorage.getItem(`${PREFIX}-dark`) === "1";
    }

    function writeDarkMode(enabled) {
        localStorage.setItem(`${PREFIX}-dark`, enabled ? "1" : "0");
    }

    window.AppUtils = window.AppUtils || {};
    Object.assign(window.AppUtils, {
        readRecentSearches,
        saveRecentSearch,
        readMessageSide,
        writeMessageSide,
        readDarkMode,
        writeDarkMode
    });
})();
