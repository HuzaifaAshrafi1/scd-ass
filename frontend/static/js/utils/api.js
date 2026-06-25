(() => {
    const csrfToken = () => window.AppConfig?.csrfToken || "";

    async function api(path, options = {}) {
        const headers = new Headers(options.headers || {});
        headers.set("X-CSRFToken", csrfToken());

        let body = options.body;
        if (body && !(body instanceof FormData) && typeof body === "object") {
            headers.set("Content-Type", "application/json");
            body = JSON.stringify(body);
        }

        const response = await fetch(path, {
            ...options,
            body,
            headers,
            credentials: "same-origin"
        });

        const contentType = response.headers.get("content-type") || "";
        const payload = contentType.includes("application/json") ? await response.json() : {};
        if (!response.ok) {
            throw new Error(payload.error || `Request failed with status ${response.status}`);
        }
        return payload;
    }

    window.AppUtils = window.AppUtils || {};
    window.AppUtils.api = api;
})();
