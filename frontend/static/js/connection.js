(() => {
    const RETRY_INTERVALS_MS = [1000, 2000, 5000, 10000, 30000];
    const HEALTHY_POLL_MS = 30000;
    const REQUEST_TIMEOUT_MS = 8000;
    const FRONTEND_VERSION = window.AppConfig?.frontendVersion || "1.0.0";

    const state = {
        frontend: "connected",
        backend: "online",
        database: "connected",
        socket: "unavailable",
        health: null,
        retryIndex: 0,
        pollTimer: null,
        retryTimer: null,
        wasOffline: false,
        lastCheckedAt: null
    };

    const listeners = new Set();
    const actionQueue = [];

    const elements = {
        pill: null,
        pillText: null,
        banner: null,
        bannerText: null,
        center: null,
        diagnostics: null,
        messageForm: null,
        sendBtn: null,
        attachmentBtn: null
    };

    function bindElements() {
        elements.pill = document.querySelector("#connectionPill");
        elements.pillText = document.querySelector("#connectionPillText");
        elements.banner = document.querySelector("#connectionBanner");
        elements.bannerText = document.querySelector("#connectionBannerText");
        elements.center = document.querySelector("#connectionCenter");
        elements.diagnostics = document.querySelector("#connectionDiagnostics");
        elements.messageForm = document.querySelector("#messageForm");
        elements.sendBtn = document.querySelector("#messageForm .send-btn");
        elements.attachmentBtn = document.querySelector("#attachmentBtn");
    }

    function notify() {
        for (const listener of listeners) {
            listener({ ...state });
        }
        renderUI();
        updateComposerState();
    }

    function onChange(listener) {
        listeners.add(listener);
        listener({ ...state });
        return () => listeners.delete(listener);
    }

    function isBackendOnline() {
        return state.backend === "online";
    }

    function isDatabaseConnected() {
        return state.database === "connected";
    }

    function isOperational() {
        return isBackendOnline() && isDatabaseConnected();
    }

    function canSendMessages() {
        return isOperational();
    }

    function queueAction(action) {
        if (typeof action === "function") actionQueue.push(action);
    }

    async function flushActionQueue() {
        if (!isOperational() || !actionQueue.length) return;
        const pending = actionQueue.splice(0, actionQueue.length);
        for (const action of pending) {
            try {
                await action();
            } catch {
                // Keep UX resilient; individual actions surface their own errors.
            }
        }
    }

    function clearTimers() {
        if (state.pollTimer) window.clearTimeout(state.pollTimer);
        if (state.retryTimer) window.clearTimeout(state.retryTimer);
        state.pollTimer = null;
        state.retryTimer = null;
    }

    function scheduleNextPoll(delayMs) {
        clearTimers();
        state.pollTimer = window.setTimeout(() => {
            checkHealth({ reason: "scheduled" });
        }, delayMs);
    }

    async function fetchHealth() {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        const healthUrl = window.AppConfig?.healthUrl || "/health";
        try {
            const response = await fetch(healthUrl, {
                method: "GET",
                cache: "no-store",
                credentials: "same-origin",
                signal: controller.signal,
                headers: { Accept: "application/json" }
            });
            window.clearTimeout(timeoutId);
            if (!response.ok) {
                throw new Error(`Health check failed (${response.status})`);
            }
            return response.json();
        } catch (error) {
            window.clearTimeout(timeoutId);
            throw error;
        }
    }

    let outageActive = false;
    let lastHealthAt = 0;
    const HEALTH_DEDUP_MS = 4000;

    async function checkHealth(options = {}) {
        const nowMs = Date.now();
        const reason = options.reason || "manual";
        if (
            reason !== "startup" &&
            reason !== "scheduled" &&
            lastHealthAt &&
            nowMs - lastHealthAt < HEALTH_DEDUP_MS
        ) {
            return { ...state };
        }
        state.lastCheckedAt = new Date();

        try {
            const payload = await fetchHealth();
            state.health = payload;
            state.backend = "online";
            state.database = payload.database ? "connected" : "degraded";
            state.retryIndex = 0;

            const restored = outageActive && state.wasOffline;
            if (restored) {
                state.wasOffline = false;
                outageActive = false;
                document.dispatchEvent(new CustomEvent("connection:restored", { detail: { ...state } }));
            }

            scheduleNextPoll(HEALTHY_POLL_MS);
        } catch {
            state.health = null;
            state.database = "disconnected";
            if (state.backend === "online") {
                state.backend = "reconnecting";
            }
            state.wasOffline = true;
            const delay = RETRY_INTERVALS_MS[Math.min(state.retryIndex, RETRY_INTERVALS_MS.length - 1)];
            state.retryIndex += 1;
            if (state.retryIndex >= RETRY_INTERVALS_MS.length) {
                state.backend = "offline";
            }
            if (!outageActive) {
                outageActive = true;
                document.dispatchEvent(new CustomEvent("connection:lost", { detail: { ...state } }));
            }
            scheduleNextPoll(delay);
        }

        lastHealthAt = Date.now();
        notify();
        return { ...state };
    }

    function setSocketStatus(status) {
        const allowed = new Set(["connected", "reconnecting", "disconnected", "unavailable"]);
        if (!allowed.has(status)) return;
        state.socket = status;
        notify();
    }

    function pillState() {
        if (state.backend === "offline") return "offline";
        if (state.backend === "reconnecting") return "reconnecting";
        if (state.socket === "reconnecting" || state.socket === "disconnected") return "syncing";
        return "online";
    }

    function pillLabel() {
        const visual = pillState();
        if (visual === "offline") return "Backend Offline";
        if (visual === "reconnecting") return "Reconnecting...";
        if (visual === "syncing") return "Syncing...";
        return "Backend Online";
    }

    function labelFor(kind, value) {
        const labels = {
            frontend: {
                connected: "Connected"
            },
            backend: {
                online: "Connected",
                reconnecting: "Reconnecting",
                offline: "Offline"
            },
            database: {
                connected: "Connected",
                degraded: "Degraded",
                disconnected: "Unavailable"
            },
            socket: {
                connected: "Connected",
                reconnecting: "Reconnecting",
                disconnected: "Disconnected",
                unavailable: "Unavailable"
            }
        };
        return labels[kind]?.[value] || value;
    }

    function renderDiagnostics() {
        if (!elements.diagnostics) return;
        const rows = [
            ["Frontend", state.frontend, labelFor("frontend", state.frontend)],
            ["Backend", state.backend, labelFor("backend", state.backend)],
            ["Database", state.database, labelFor("database", state.database)],
            ["Realtime", state.socket, labelFor("socket", state.socket)],
            ["Backend version", "meta", state.health?.version || "—"],
            ["Frontend version", "meta", FRONTEND_VERSION],
            ["Environment", "meta", state.health?.environment || window.AppConfig?.environment || "—"],
            ["Current user", "meta", window.AppConfig?.currentUsername ? `@${window.AppConfig.currentUsername}` : "—"]
        ];

        elements.diagnostics.replaceChildren();
        for (const [label, statusKey, displayValue] of rows) {
            const row = document.createElement("div");
            row.className = "connection-diagnostics-row";
            const term = document.createElement("dt");
            term.textContent = label;
            const desc = document.createElement("dd");
            if (statusKey === "meta") {
                desc.textContent = displayValue;
            } else {
                const dot = document.createElement("span");
                dot.className = "connection-state-dot";
                dot.dataset.state = statusKey;
                dot.setAttribute("aria-hidden", "true");
                const text = document.createElement("span");
                text.textContent = displayValue;
                desc.append(dot, text);
            }
            row.append(term, desc);
            elements.diagnostics.appendChild(row);
        }
    }

    function renderUI() {
        const visual = pillState();
        if (elements.pill) {
            elements.pill.dataset.state = visual;
            elements.pill.setAttribute("aria-label", pillLabel());
        }
        if (elements.pillText) elements.pillText.textContent = pillLabel();

        const showBanner = visual === "offline" || visual === "reconnecting" || visual === "syncing"
            || (state.backend === "online" && state.database === "degraded");
        if (elements.banner) {
            elements.banner.classList.toggle("hidden", !showBanner);
            if (state.database === "degraded" && state.backend === "online") {
                elements.banner.dataset.level = "error";
            } else if (visual === "offline") elements.banner.dataset.level = "error";
            else if (visual === "reconnecting") elements.banner.dataset.level = "warning";
            else elements.banner.dataset.level = "info";
        }
        if (elements.bannerText) {
            if (visual === "offline") {
                elements.bannerText.textContent = "Backend is offline. Messages are saved locally and will send when connection returns.";
            } else if (visual === "reconnecting") {
                elements.bannerText.textContent = "Reconnecting to backend... Your draft is preserved.";
            } else if (state.database === "degraded") {
                elements.bannerText.textContent = "Database is unavailable. Messaging is temporarily disabled.";
            } else {
                elements.bannerText.textContent = "Realtime sync paused. Retrying...";
            }
        }

        renderDiagnostics();
    }

    function updateComposerState() {
        const disabled = !canSendMessages();
        if (elements.messageForm) {
            elements.messageForm.classList.toggle("is-offline", disabled);
            elements.messageForm.setAttribute("aria-disabled", disabled ? "true" : "false");
        }
        if (elements.sendBtn) {
            elements.sendBtn.disabled = disabled;
            elements.sendBtn.title = disabled ? "Unavailable while offline" : "Send";
        }
        if (elements.attachmentBtn) {
            elements.attachmentBtn.disabled = disabled;
            elements.attachmentBtn.title = disabled ? "Unavailable while offline" : "Attach file";
        }
    }

    function start() {
        bindElements();
        renderUI();
        checkHealth({ reason: "startup" });
        window.addEventListener("online", () => checkHealth({ reason: "browser-online" }));
        window.addEventListener("offline", () => {
            state.backend = "reconnecting";
            state.database = "disconnected";
            state.wasOffline = true;
            notify();
            scheduleNextPoll(RETRY_INTERVALS_MS[0]);
        });
    }

    function stop() {
        clearTimers();
        listeners.clear();
    }

    window.ConnectionManager = {
        start,
        stop,
        onChange,
        checkHealth,
        setSocketStatus,
        isBackendOnline,
        isDatabaseConnected,
        isOperational,
        canSendMessages,
        queueAction,
        flushActionQueue,
        getState: () => ({ ...state })
    };
})();
